use crate::PendingMap;
use serde_json::Value;
use std::sync::Arc;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::ChildStdin;
use tokio::sync::Mutex;

/// Wrapper around the sidecar ChildStdin for sending messages
pub struct StdinWriter {
    stdin: Mutex<ChildStdin>,
}

impl StdinWriter {
    pub async fn write(&self, data: String) -> Result<(), String> {
        let mut stdin = self.stdin.lock().await;
        stdin
            .write_all(data.as_bytes())
            .await
            .map_err(|e| format!("Failed to write to sidecar stdin: {}", e))?;
        stdin
            .flush()
            .await
            .map_err(|e| format!("Failed to flush sidecar stdin: {}", e))
    }
}

/// Spawn the Python sidecar and set up stdout reading
pub async fn spawn_sidecar(
    app: &tauri::AppHandle,
    pending: PendingMap,
    writer: Arc<Mutex<Option<StdinWriter>>>,
) -> Result<(), String> {
    // Two ways to run the sidecar:
    //   - the compiled (PyInstaller) binary bundled with release packages
    //   - the python/ source tree, spawned with a system Python interpreter
    // Release builds must prefer the compiled binary: the python source is
    // not bundled, and compile-time paths (CARGO_MANIFEST_DIR) point at the
    // CI runner's workspace, which doesn't exist on user machines.
    // Dev builds prefer the source so edits take effect without re-packaging.
    let compiled = resolve_sidecar_binary();
    let source = resolve_python_source();

    let mut child = match (cfg!(debug_assertions), source, compiled) {
        // Dev: source first, compiled as fallback
        (true, Some((dir, script)), _) => spawn_from_source(&dir, &script)?,
        (true, None, Some(bin)) => spawn_compiled(&bin)?,
        // Release: compiled first, source as fallback (portable installs)
        (false, _, Some(bin)) => spawn_compiled(&bin)?,
        (false, Some((dir, script)), None) => spawn_from_source(&dir, &script)?,
        _ => {
            return Err(
                "Sidecar not found. Looked for a bundled 'grapefruit-sidecar' \
                 binary next to the app executable, and for python/sidecar_main.py \
                 next to the executable."
                    .into(),
            )
        }
    };

    let stdin = child
        .stdin
        .take()
        .ok_or("Failed to capture sidecar stdin")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Failed to capture sidecar stdout")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("Failed to capture sidecar stderr")?;

    // Store the stdin writer
    {
        let mut w = writer.lock().await;
        *w = Some(StdinWriter {
            stdin: Mutex::new(stdin),
        });
    }

    // Read stdout events in background
    let app_handle = app.clone();
    let pending_clone = pending.clone();
    tauri::async_runtime::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();

        while let Ok(Some(line)) = reader.next_line().await {
            let trimmed = line.trim().to_string();
            if trimmed.is_empty() {
                continue;
            }

            match serde_json::from_str::<Value>(&trimmed) {
                Ok(msg) => {
                    if let Some(id) = msg.get("id").and_then(|v| v.as_u64()) {
                        // Response — route to pending request
                        let mut pending_map = pending_clone.lock().await;
                        if let Some(tx) = pending_map.remove(&id) {
                            if let Some(error) = msg.get("error") {
                                let err_msg = error
                                    .get("message")
                                    .and_then(|m| m.as_str())
                                    .unwrap_or("Unknown sidecar error");
                                let _ = tx.send(Err(err_msg.to_string()));
                            } else {
                                let result =
                                    msg.get("result").cloned().unwrap_or(Value::Null);
                                let _ = tx.send(Ok(result));
                            }
                        }
                    } else if msg.get("method").is_some() {
                        // Notification (progress) — emit as Tauri event
                        let params =
                            msg.get("params").cloned().unwrap_or(Value::Null);
                        let _ = app_handle.emit("sidecar:progress", &params);
                    }
                }
                Err(e) => {
                    log::warn!(
                        "Failed to parse sidecar output: {} — line: {}",
                        e, trimmed
                    );
                }
            }
        }

        // Stdout closed — sidecar process exited
        log::error!("Sidecar stdout closed — process exited");
        let mut pending_map = pending_clone.lock().await;
        for (_, tx) in pending_map.drain() {
            let _ = tx.send(Err("Sidecar process terminated".into()));
        }
    });

    // Read stderr in background (logging only)
    tauri::async_runtime::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            if !line.trim().is_empty() {
                log::warn!("Sidecar stderr: {}", line.trim());
            }
        }
    });

    Ok(())
}

/// Spawn the compiled (PyInstaller) sidecar binary.
fn spawn_compiled(sidecar_bin: &std::path::Path) -> Result<tokio::process::Child, String> {
    log::info!("Spawning compiled sidecar: {}", sidecar_bin.display());
    tokio::process::Command::new(sidecar_bin)
        .current_dir(sidecar_bin.parent().unwrap_or(sidecar_bin))
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn compiled sidecar: {}", e))
}

/// Spawn the sidecar from python source, trying interpreter names in order
/// ("python3" is standard on Unix; Windows installs typically expose "python").
fn spawn_from_source(
    python_dir: &std::path::Path,
    script: &std::path::Path,
) -> Result<tokio::process::Child, String> {
    log::info!("Spawning Python sidecar from: {}", script.display());
    let interpreters: &[&str] = if cfg!(target_os = "windows") {
        &["python3", "python", "py"]
    } else {
        &["python3", "python"]
    };

    let mut last_err = String::new();
    for interp in interpreters {
        match tokio::process::Command::new(interp)
            .arg(script.to_string_lossy().as_ref())
            .current_dir(python_dir)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
        {
            Ok(child) => return Ok(child),
            Err(e) => last_err = format!("{}: {}", interp, e),
        }
    }
    Err(format!("Failed to spawn Python interpreter ({})", last_err))
}

/// Find the python/ source tree, returning (dir, sidecar_main.py).
///
/// The compile-time CARGO_MANIFEST_DIR path is only meaningful on the machine
/// that built the binary (in CI that's the runner workspace, e.g.
/// `D:\a\grapefruit\grapefruit`), so it is only consulted in debug builds.
/// All builds also accept a python/ directory next to the executable, which
/// supports portable from-source installs.
fn resolve_python_source() -> Option<(std::path::PathBuf, std::path::PathBuf)> {
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();

    #[cfg(debug_assertions)]
    if let Some(parent) = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent() {
        candidates.push(parent.join("python"));
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            candidates.push(exe_dir.join("python"));
        }
    }

    for dir in candidates {
        let script = dir.join("sidecar_main.py");
        if script.exists() {
            return Some((dir, script));
        }
    }
    None
}

/// Resolve sidecar binary path for bundled production builds.
/// Returns Some(path) if a compiled sidecar exists, None to fall back to python3.
fn resolve_sidecar_binary() -> Option<std::path::PathBuf> {
    if let Ok(exe) = std::env::current_exe() {
        let bin_dir = exe.parent()?;

        // Tauri externalBin places binaries next to the main executable
        let sidecar = if cfg!(target_os = "windows") {
            bin_dir.join("grapefruit-sidecar.exe")
        } else {
            bin_dir.join("grapefruit-sidecar")
        };

        if sidecar.exists() {
            return Some(sidecar);
        }

        // macOS: also check inside .app bundle Resources
        #[cfg(target_os = "macos")]
        {
            let resources = bin_dir.parent()
                .map(|p| p.join("Resources").join("grapefruit-sidecar"));
            if let Some(ref path) = resources {
                if path.exists() {
                    return resources;
                }
            }
        }
    }
    None
}

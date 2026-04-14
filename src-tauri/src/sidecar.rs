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
    let python_dir = resolve_python_dir()?;
    let script = python_dir.join("sidecar_main.py");

    if !script.exists() {
        return Err(format!(
            "Python sidecar not found at: {}",
            script.display()
        ));
    }

    // In dev mode (python/ source dir exists), always use python3 directly.
    // Only use the compiled sidecar binary in production builds where the
    // python source dir won't exist.
    let use_compiled = !script.exists() || resolve_sidecar_binary().is_some() && !python_dir.join("core").exists();

    let mut child = if use_compiled {
        if let Some(sidecar_bin) = resolve_sidecar_binary() {
            log::info!("Spawning compiled sidecar: {}", sidecar_bin.display());
            tokio::process::Command::new(&sidecar_bin)
                .current_dir(sidecar_bin.parent().unwrap_or(&sidecar_bin))
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn()
                .map_err(|e| format!("Failed to spawn sidecar: {}", e))?
        } else {
            return Err("No compiled sidecar binary found and python source not available".into());
        }
    } else {
        log::info!("Spawning Python sidecar from: {}", script.display());
        tokio::process::Command::new("python3")
            .arg(script.to_string_lossy().as_ref())
            .current_dir(&python_dir)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn sidecar: {}", e))?
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

/// Resolve the python/ directory — works in both dev and bundled mode
fn resolve_python_dir() -> Result<std::path::PathBuf, String> {
    // In dev: project_root/python/
    let dev_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.join("python"))
        .unwrap_or_default();

    if dev_path.exists() {
        return Ok(dev_path);
    }

    // In production: look next to the app binary
    if let Ok(exe) = std::env::current_exe() {
        let prod_path = exe.parent().unwrap_or(&exe).join("python");
        if prod_path.exists() {
            return Ok(prod_path);
        }
    }

    Err(format!(
        "Could not find python directory. Tried: {}",
        dev_path.display()
    ))
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

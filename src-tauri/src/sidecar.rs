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

    log::info!("Spawning Python sidecar from: {}", script.display());

    // Spawn python3 directly using tokio (no Tauri shell plugin needed)
    let mut child = tokio::process::Command::new("python3")
        .arg(script.to_string_lossy().as_ref())
        .current_dir(&python_dir)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

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

use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, oneshot};

mod sidecar;

/// Pending RPC requests: id -> oneshot sender for the response
type PendingMap = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>;

/// State shared across Tauri commands
pub struct SidecarState {
    pending: PendingMap,
    writer: Arc<Mutex<Option<sidecar::StdinWriter>>>,
    next_id: Arc<Mutex<u64>>,
}

/// Tauri command: send an RPC call to the Python sidecar and await response.
/// Automatically restarts the sidecar if it has died.
#[tauri::command]
async fn sidecar_rpc(
    app: tauri::AppHandle,
    state: tauri::State<'_, SidecarState>,
    method: String,
    params: Value,
) -> Result<Value, String> {
    // Attempt up to 2 tries: first try, then restart sidecar + retry
    for attempt in 0..2 {
        let result = do_rpc_call(&state, &method, &params).await;

        match &result {
            Ok(_) => return result,
            Err(e) if attempt == 0 && (e.contains("Broken pipe") || e.contains("Sidecar not running") || e.contains("Sidecar process terminated")) => {
                log::warn!("Sidecar appears dead ({}), restarting...", e);
                // Clear the old writer
                {
                    let mut w = state.writer.lock().await;
                    *w = None;
                }
                // Respawn
                match sidecar::spawn_sidecar(&app, state.pending.clone(), state.writer.clone()).await {
                    Ok(()) => {
                        log::info!("Sidecar restarted successfully, retrying RPC");
                        // Small delay to let sidecar initialize
                        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
                        continue;
                    }
                    Err(spawn_err) => {
                        return Err(format!("Sidecar died and failed to restart: {}", spawn_err));
                    }
                }
            }
            Err(_) => return result,
        }
    }
    Err("Sidecar RPC failed after restart".into())
}

async fn do_rpc_call(
    state: &SidecarState,
    method: &str,
    params: &Value,
) -> Result<Value, String> {
    let id = {
        let mut next = state.next_id.lock().await;
        let id = *next;
        *next += 1;
        id
    };

    let request = serde_json::json!({
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
        "id": id,
    });

    let line = format!("{}\n", serde_json::to_string(&request).map_err(|e| e.to_string())?);

    // Register pending request
    let (tx, rx) = oneshot::channel();
    {
        let mut pending = state.pending.lock().await;
        pending.insert(id, tx);
    }

    // Write to stdin
    {
        let writer_lock = state.writer.lock().await;
        if let Some(ref writer) = *writer_lock {
            writer.write(line).await?;
        } else {
            // Remove pending before returning error
            let mut pending = state.pending.lock().await;
            pending.remove(&id);
            return Err("Sidecar not running".into());
        }
    }

    // Await response (with timeout)
    match tokio::time::timeout(std::time::Duration::from_secs(120), rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("Sidecar process terminated".into()),
        Err(_) => {
            let mut pending = state.pending.lock().await;
            pending.remove(&id);
            Err("Sidecar RPC timed out".into())
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
    let writer: Arc<Mutex<Option<sidecar::StdinWriter>>> = Arc::new(Mutex::new(None));
    let next_id = Arc::new(Mutex::new(1u64));

    let sidecar_state = SidecarState {
        pending: pending.clone(),
        writer: writer.clone(),
        next_id,
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .manage(sidecar_state)
        .invoke_handler(tauri::generate_handler![sidecar_rpc])
        .setup(move |app| {
            let app_handle = app.handle().clone();
            let pending_clone = pending.clone();
            let writer_clone = writer.clone();

            // Spawn sidecar on startup
            tauri::async_runtime::spawn(async move {
                match sidecar::spawn_sidecar(&app_handle, pending_clone, writer_clone).await {
                    Ok(()) => log::info!("Sidecar spawned successfully"),
                    Err(e) => log::error!("Failed to spawn sidecar: {}", e),
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

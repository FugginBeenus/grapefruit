import { invoke } from "@tauri-apps/api/core";

/**
 * Send a JSON-RPC call to the Python sidecar via the Tauri bridge.
 * Returns the parsed result or throws on error.
 */
export async function rpcCall<T = unknown>(
  method: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  return invoke<T>("sidecar_rpc", { method, params });
}

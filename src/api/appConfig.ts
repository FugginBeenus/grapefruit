import { rpcCall } from "./sidecar";

export interface AppConfig {
  master_library_path: string;
}

export async function getAppConfig(): Promise<AppConfig> {
  return rpcCall<AppConfig>("get_app_config");
}

export async function setAppConfig(patch: Partial<AppConfig>): Promise<void> {
  await rpcCall("set_app_config", patch);
}

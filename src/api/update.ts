import { rpcCall } from "./sidecar";

export interface LatestRelease {
  tag_name: string;
  name: string;
  html_url: string;
  published_at: string;
}

export async function getLatestRelease(): Promise<LatestRelease> {
  return rpcCall<LatestRelease>("get_latest_release");
}

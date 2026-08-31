import { rpcCall } from "./sidecar";

export interface SoulseekStatus {
  configured: boolean;
  url: string;
  download_dir: string;
  connected: boolean;
  version?: string;
  state?: string;
  error?: string;
}

export interface SoulseekCandidate {
  username: string;
  filename: string;
  name: string;
  size: number;
  bitrate: number | null;
  length: number | null;
  extension: string;
  has_slot: boolean;
  speed: number;
  queue: number;
  quality: number;
}

export interface SoulseekDownload {
  username: string;
  name: string;
  state: string;
  size: number;
  transferred: number;
  percent: number;
}

export function soulseekStatus() {
  return rpcCall<SoulseekStatus>("soulseek_status");
}

export function soulseekSearch(query: string, limit?: number) {
  return rpcCall<SoulseekCandidate[]>("soulseek_search", limit ? { query, limit } : { query });
}

export function soulseekDownload(username: string, files: { filename: string; size: number }[]) {
  return rpcCall<{ ok: boolean; count: number }>("soulseek_download", { username, files });
}

export function soulseekDownloads() {
  return rpcCall<SoulseekDownload[]>("soulseek_downloads");
}

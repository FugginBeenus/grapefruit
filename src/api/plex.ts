import { rpcCall } from "./sidecar";
import type { PlexConfig, PlexSection, PlexServerInfo, PlexSyncResult } from "../types/models";

export type { PlexConfig, PlexSection, PlexServerInfo, PlexSyncResult };

export function plexTestConnection(serverUrl: string, token: string) {
  return rpcCall<PlexServerInfo>("plex_test_connection", { server_url: serverUrl, token });
}

export function plexGetSections() {
  return rpcCall<PlexSection[]>("plex_get_sections");
}

export function plexSyncPlaylists(playlists?: string[]) {
  return rpcCall<PlexSyncResult[]>("plex_sync_playlists", playlists ? { playlists } : {});
}

export interface PlexPlaylist { ratingKey: string; title: string; leafCount: number; }

export function plexListPlaylists() {
  return rpcCall<PlexPlaylist[]>("plex_list_playlists");
}

/** Device relative_paths that also exist on Plex (presence check, no tag reads). */
export function plexPresentPaths() {
  return rpcCall<string[]>("plex_present_paths");
}

export function loadPlexConfig() {
  return rpcCall<PlexConfig>("load_plex_config");
}

export function savePlexConfig(config: Partial<PlexConfig>) {
  return rpcCall<{ ok: boolean }>("save_plex_config", config as Record<string, unknown>);
}

import { rpcCall } from "./sidecar";
import type { PlaylistMetadata, PlaylistTrack, SpotifyStatus } from "../types/models";

export async function spotifyGetStatus(): Promise<SpotifyStatus> {
  return rpcCall<SpotifyStatus>("spotify_get_status");
}

export async function spotifySetClientId(clientId: string): Promise<void> {
  await rpcCall("spotify_set_client_id", { client_id: clientId });
}

export async function spotifyAuthStart(): Promise<{ auth_url: string }> {
  return rpcCall<{ auth_url: string }>("spotify_auth_start");
}

export async function spotifyAuthPoll(): Promise<{
  status: "idle" | "pending" | "connected" | "error";
  user_name: string;
  error: string;
}> {
  return rpcCall("spotify_auth_poll");
}

export async function spotifyDisconnect(): Promise<void> {
  await rpcCall("spotify_disconnect");
}

export async function spotifyFetchLibrary(includePlaylists: boolean): Promise<{
  metadata: PlaylistMetadata;
  tracks: PlaylistTrack[];
}> {
  return rpcCall("spotify_fetch_library", { include_playlists: includePlaylists });
}

/** Device relative_paths matching a track in the user's Spotify library ([] if not connected). */
export async function spotifyPresentPaths(): Promise<string[]> {
  return rpcCall<string[]>("spotify_present_paths");
}

export interface SpotifyPlaylistInfo { name: string; track_count: number; }

/** The user's Spotify playlists (name + count); [] if not connected. */
export async function spotifyListPlaylists(): Promise<SpotifyPlaylistInfo[]> {
  return rpcCall<SpotifyPlaylistInfo[]>("spotify_list_playlists");
}

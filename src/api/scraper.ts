import { rpcCall } from "./sidecar";

export interface PlaylistMetadata {
  name: string;
  description: string;
  track_count: number;
  source_url: string | null;
  source_type: string;
}

export interface PlaylistTrack {
  title: string;
  artist: string;
  album: string;
  duration_seconds: number | null;
  track_number: number | null;
  source_index: number;
}

export function fetchPlaylist(url: string) {
  return rpcCall<{ metadata: PlaylistMetadata; tracks: PlaylistTrack[] }>(
    "fetch_playlist",
    { url }
  );
}

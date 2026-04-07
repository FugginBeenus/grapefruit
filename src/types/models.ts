/** TypeScript mirrors of Python dataclasses from core/models.py */

export interface DeviceInfo {
  mount_point: string;
  label: string;
  model: string;
  firmware: string;
  capacity_bytes: number;
  used_bytes: number;
  free_bytes: number;
}

export interface DeviceTrack {
  file_path: string;
  relative_path: string;
  title: string;
  artist: string;
  album: string;
  duration_seconds: number | null;
  track_number: number | null;
  file_size: number;
  format: string;
}

export interface PlaylistInfo {
  name: string;
  path: string;
  track_count: number;
}

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

export type MatchStatus =
  | "matched"
  | "uncertain"
  | "missing"
  | "confirmed"
  | "rejected"
  | "manual";

export interface MatchCandidate {
  local_track: {
    file_path: string;
    title: string;
    artist: string;
    album: string;
    duration_seconds: number | null;
  };
  score: number;
  matched_on: string;
}

export interface MatchResult {
  playlist_track: PlaylistTrack;
  status: MatchStatus;
  best_match: MatchCandidate | null;
  candidates: MatchCandidate[];
  user_selected: MatchCandidate | null;
}

export interface PlexConfig {
  server_url: string;
  token: string;
  last_section_key: string;
  music_library_path: string;
  playlist_map: Record<string, string>;
}

export interface PlexSection {
  key: string;
  title: string;
  type: string;
}

export interface PlexServerInfo {
  name: string;
  version: string;
}

export interface PlexSyncResult {
  name: string;
  matched: number;
  missing: number;
  missing_tracks: string[];
  status: "created" | "updated" | "error" | "no_matches" | "pending";
  error?: string;
}

export interface DuplicateGroup {
  artist: string;
  title: string;
  copies: DeviceTrack[];
}

export interface SyncPlan {
  files_to_copy: string[];
  files_to_delete: string[];
  files_unchanged: string[];
  total_copy_bytes: number;
  total_delete_bytes: number;
  device_free_bytes: number;
}

export interface ProgressEvent {
  op: string;
  current: number;
  total: number;
  message?: string;
  state?: string;
}

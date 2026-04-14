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
  files_to_copy: number;
  files_to_delete: number;
  files_unchanged: number;
  total_copy_bytes: number;
  total_delete_bytes: number;
  device_free_bytes: number;
  fits_on_device: boolean;
  shortfall_bytes: number;
  _copy_paths: string[];
  _delete_paths: string[];
}

export interface ProgressEvent {
  op: string;
  current: number;
  total: number;
  message?: string;
  state?: string;
}

export interface TrackMetadata {
  path: string;
  title: string;
  artist: string;
  album: string;
  albumartist: string;
  track_number: number | null;
  disc_number: number | null;
  year: number | null;
  genre: string;
  comment: string;
  has_artwork: boolean;
  artwork_mime: string;
}

export interface AlbumArt {
  has_artwork: boolean;
  mime?: string;
  data?: string; // base64
}

export interface UndoAction {
  type: string;
  timestamp: number;
  detail: string;
}

export interface LibraryStats {
  total_tracks: number;
  total_size: number;
  total_duration: number;
  total_albums: number;
  total_artists: number;
  formats: Record<string, number>;
  genres: Record<string, number>;
}

/* ── Plex Metadata Sync ────────────────────── */

export interface MetadataFieldDiff {
  field: string;
  device_value: string;
  plex_value: string;
}

export interface MetadataTrackDiff {
  path: string;
  title: string;
  artist: string;
  album: string;
  plex_rating_key: string;
  fields: MetadataFieldDiff[];
}

export interface MetadataDiffResult {
  total_device_tracks: number;
  matched_to_plex: number;
  tracks_with_diffs: number;
  tracks_unchanged: number;
  unmatched: number;
  diffs: MetadataTrackDiff[];
}

export interface MetadataPullResult {
  updated: number;
  errors: string[];
  total: number;
}

/* ── Library Health Check ──────────────────── */

export interface HealthIssueTrack {
  path: string;
  title?: string;
  artist?: string;
  album?: string;
  filename?: string;
  error?: string;
}

export interface AlbumInconsistency {
  album: string;
  artists: string[];
  track_count: number;
}

export interface HealthCheckResult {
  total_tracks: number;
  issues: {
    missing_title: HealthIssueTrack[];
    missing_artist: HealthIssueTrack[];
    missing_album: HealthIssueTrack[];
    no_artwork: HealthIssueTrack[];
    broken_files: HealthIssueTrack[];
    inconsistent_albums: AlbumInconsistency[];
  };
  summary: Record<string, number>;
}

/* ── Auto Organize ─────────────────────────── */

export interface OrganizeResult {
  moved: number;
  errors: string[];
  dry_run: boolean;
  plan?: { from: string; to: string }[];
}

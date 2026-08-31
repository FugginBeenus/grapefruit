import { rpcCall } from "./sidecar";

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

export function scanDeviceLibrary(mountPoint: string) {
  return rpcCall<DeviceTrack[]>("scan_device_library", { mount_point: mountPoint });
}

export function getPlaylists() {
  return rpcCall<PlaylistInfo[]>("get_playlists");
}

/** Playlists on the connected iPod (separate from the library); [] if no iPod. */
export function getIpodPlaylists() {
  return rpcCall<PlaylistInfo[]>("get_ipod_playlists");
}

/** Read the tracks of a playlist that lives on the iPod. */
export function readIpodPlaylist(path: string) {
  return rpcCall<DeviceTrack[]>("read_ipod_playlist", { path });
}

export function readPlaylist(path: string) {
  return rpcCall<DeviceTrack[]>("read_playlist", { path });
}

export function writePlaylist(name: string, trackPaths: string[]) {
  return rpcCall<{ path: string }>("write_playlist", { name, track_paths: trackPaths });
}

/** Sync a playlist onto the iPod: copy any missing song files, then write the M3U8. */
export function writeIpodPlaylist(name: string, trackPaths: string[]) {
  return rpcCall<{ path: string; count: number; copied: number; errors: string[] }>("write_ipod_playlist", { name, track_paths: trackPaths });
}

export function deletePlaylist(path: string) {
  return rpcCall<{ ok: boolean }>("delete_playlist", { path });
}

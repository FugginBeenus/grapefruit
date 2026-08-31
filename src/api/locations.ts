import { rpcCall } from "./sidecar";

export interface SourcePresence {
  available: boolean;
  paths: string[];
  label?: string;
  error?: string;
}

export interface PoolLocations {
  lib: SourcePresence;
  dev: SourcePresence;
  plex: SourcePresence;
  spotify: SourcePresence;
}

/** Tag every current track by which sources hold it — master library, device, Plex, Spotify — pooled. */
export function poolLocations() {
  return rpcCall<PoolLocations>("pool_locations");
}

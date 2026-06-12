import { create } from "zustand";
import type { PlaylistMetadata, PlaylistTrack, MatchResult } from "../types/models";
import { fetchPlaylist } from "../api/scraper";
import { spotifyFetchLibrary } from "../api/spotify";
import { rpcCall } from "../api/sidecar";

export type GapSource = "url" | "spotify";
export type GapStep = "idle" | "fetching" | "matching" | "results";
export type GapFilter = "missing" | "uncertain" | "all";

interface GapState {
  source: GapSource;
  step: GapStep;
  url: string;
  metadata: PlaylistMetadata | null;
  matchResults: MatchResult[];
  filter: GapFilter;
  error: string | null;

  setSource: (s: GapSource) => void;
  setUrl: (u: string) => void;
  setFilter: (f: GapFilter) => void;
  runUrlGap: (url: string) => Promise<void>;
  runSpotifyGap: (includePlaylists: boolean) => Promise<void>;
  reset: () => void;
}

async function matchAgainstLibrary(tracks: PlaylistTrack[]): Promise<MatchResult[]> {
  return rpcCall<MatchResult[]>("match_tracks", { playlist_tracks: tracks });
}

export const useGapStore = create<GapState>((set) => ({
  source: "url",
  step: "idle",
  url: "",
  metadata: null,
  matchResults: [],
  filter: "missing",
  error: null,

  setSource: (source) => set({ source }),
  setUrl: (url) => set({ url }),
  setFilter: (filter) => set({ filter }),

  runUrlGap: async (url) => {
    set({ step: "fetching", url, error: null, matchResults: [] });
    try {
      const { metadata, tracks } = await fetchPlaylist(url);
      set({ metadata, step: "matching" });
      const results = await matchAgainstLibrary(tracks);
      set({ matchResults: results, step: "results" });
    } catch (e) {
      set({ error: String(e), step: "idle" });
    }
  },

  runSpotifyGap: async (includePlaylists) => {
    set({ step: "fetching", error: null, matchResults: [] });
    try {
      const { metadata, tracks } = await spotifyFetchLibrary(includePlaylists);
      set({ metadata, step: "matching" });
      const results = await matchAgainstLibrary(tracks);
      set({ matchResults: results, step: "results" });
    } catch (e) {
      set({ error: String(e), step: "idle" });
    }
  },

  reset: () =>
    set({
      step: "idle",
      metadata: null,
      matchResults: [],
      filter: "missing",
      error: null,
    }),
}));

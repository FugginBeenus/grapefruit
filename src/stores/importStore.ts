import { create } from "zustand";
import type {
  PlaylistMetadata,
  PlaylistTrack,
  MatchResult,
} from "../types/models";
import { fetchPlaylist } from "../api/scraper";
import { rpcCall } from "../api/sidecar";

type ImportStep = "url" | "fetching" | "matching" | "results" | "saving" | "done";

interface ImportState {
  step: ImportStep;
  url: string;
  metadata: PlaylistMetadata | null;
  sourceTracks: PlaylistTrack[];
  matchResults: MatchResult[];
  savedPath: string | null;
  error: string | null;
  loading: boolean;

  setUrl: (url: string) => void;
  fetchFromUrl: (url: string) => Promise<void>;
  matchTracks: () => Promise<void>;
  savePlaylist: (name: string) => Promise<void>;
  reset: () => void;
}

export const useImportStore = create<ImportState>((set, get) => ({
  step: "url",
  url: "",
  metadata: null,
  sourceTracks: [],
  matchResults: [],
  savedPath: null,
  error: null,
  loading: false,

  setUrl: (url) => set({ url }),

  fetchFromUrl: async (url) => {
    set({ step: "fetching", url, loading: true, error: null });
    try {
      const result = await fetchPlaylist(url);
      set({
        metadata: result.metadata,
        sourceTracks: result.tracks,
        step: "matching",
        loading: false,
      });
    } catch (e) {
      set({ error: String(e), loading: false, step: "url" });
    }
  },

  matchTracks: async () => {
    set({ step: "matching", loading: true, error: null });
    try {
      const { sourceTracks } = get();
      const results = await rpcCall<MatchResult[]>("match_tracks", {
        playlist_tracks: sourceTracks,
      });
      set({ matchResults: results, step: "results", loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  savePlaylist: async (name) => {
    set({ step: "saving", loading: true, error: null });
    try {
      const { matchResults } = get();
      const trackPaths = matchResults
        .filter((r) => r.status === "matched" || r.status === "confirmed" || r.status === "manual")
        .map((r) => {
          const match = r.user_selected || r.best_match;
          return match?.local_track.file_path ?? "";
        })
        .filter(Boolean);

      const result = await rpcCall<{ path: string }>("write_playlist", {
        name,
        track_paths: trackPaths,
      });
      set({ savedPath: result.path, step: "done", loading: false });
    } catch (e) {
      set({ error: String(e), loading: false, step: "results" });
    }
  },

  reset: () =>
    set({
      step: "url",
      url: "",
      metadata: null,
      sourceTracks: [],
      matchResults: [],
      savedPath: null,
      error: null,
      loading: false,
    }),
}));

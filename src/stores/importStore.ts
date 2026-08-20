import { create } from "zustand";
import type {
  PlaylistMetadata,
  PlaylistTrack,
  MatchResult,
  MatchCandidate,
  MatchStatus,
} from "../types/models";
import { fetchPlaylist } from "../api/scraper";
import { rpcCall } from "../api/sidecar";

type ImportStep = "url" | "fetching" | "matching" | "results" | "saving" | "done";

const SAVEABLE: MatchStatus[] = ["matched", "confirmed", "manual", "uncertain"];

interface ImportState {
  step: ImportStep;
  url: string;
  metadata: PlaylistMetadata | null;
  sourceTracks: PlaylistTrack[];
  matchResults: MatchResult[];
  savedPath: string | null;
  savedCount: number;
  error: string | null;
  loading: boolean;

  setUrl: (url: string) => void;
  fetchFromUrl: (url: string) => Promise<void>;
  matchTracks: () => Promise<void>;
  savePlaylist: (name: string) => Promise<void>;
  resolveMatch: (index: number, candidate: MatchCandidate) => void;
  rejectMatch: (index: number) => void;
  reset: () => void;
}

export const useImportStore = create<ImportState>((set, get) => ({
  step: "url",
  url: "",
  metadata: null,
  sourceTracks: [],
  matchResults: [],
  savedPath: null,
  savedCount: 0,
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
        .filter((r) => SAVEABLE.includes(r.status))
        .map((r) => (r.user_selected || r.best_match)?.local_track.file_path ?? "")
        .filter(Boolean);

      const result = await rpcCall<{ path: string; count: number }>("write_playlist", {
        name,
        track_paths: trackPaths,
      });
      set({ savedPath: result.path, savedCount: result.count, step: "done", loading: false });
    } catch (e) {
      set({ error: String(e), loading: false, step: "results" });
    }
  },

  resolveMatch: (index, candidate) =>
    set((s) => {
      const matchResults = s.matchResults.slice();
      matchResults[index] = { ...matchResults[index], user_selected: candidate, status: "manual" };
      return { matchResults };
    }),

  rejectMatch: (index) =>
    set((s) => {
      const matchResults = s.matchResults.slice();
      matchResults[index] = { ...matchResults[index], user_selected: null, status: "missing" };
      return { matchResults };
    }),

  reset: () =>
    set({
      step: "url",
      url: "",
      metadata: null,
      sourceTracks: [],
      matchResults: [],
      savedPath: null,
      savedCount: 0,
      error: null,
      loading: false,
    }),
}));

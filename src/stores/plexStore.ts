import { create } from "zustand";
import type {
  PlexConfig,
  PlexSection,
  PlexSyncResult,
} from "../types/models";
import {
  loadPlexConfig,
  savePlexConfig,
  plexTestConnection,
  plexGetSections,
  plexSyncPlaylists,
} from "../api/plex";

interface PlexState {
  config: PlexConfig | null;
  sections: PlexSection[];
  connected: boolean;
  serverName: string;
  syncResults: PlexSyncResult[];
  loading: boolean;
  syncing: boolean;
  testing: boolean;
  error: string | null;

  loadConfig: () => Promise<void>;
  saveConfig: (config: Partial<PlexConfig>) => Promise<void>;
  testConnection: (url: string, token: string) => Promise<boolean>;
  fetchSections: () => Promise<void>;
  syncAll: (playlists?: string[]) => Promise<void>;
  clearResults: () => void;
}

export const usePlexStore = create<PlexState>((set, get) => ({
  config: null,
  sections: [],
  connected: false,
  serverName: "",
  syncResults: [],
  loading: false,
  syncing: false,
  testing: false,
  error: null,

  loadConfig: async () => {
    set({ loading: true });
    try {
      const config = await loadPlexConfig();
      set({ config, loading: false });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  saveConfig: async (partial) => {
    const existing = get().config;
    const config: PlexConfig = {
      server_url: partial.server_url ?? existing?.server_url ?? "",
      token: partial.token ?? existing?.token ?? "",
      last_section_key: partial.last_section_key ?? existing?.last_section_key ?? "",
      music_library_path: partial.music_library_path ?? existing?.music_library_path ?? "",
      playlist_map: partial.playlist_map ?? existing?.playlist_map ?? {},
    };
    await savePlexConfig(config);
    set({ config });
  },

  testConnection: async (url, token) => {
    set({ testing: true, error: null });
    try {
      const info = await plexTestConnection(url, token);
      set({ connected: true, serverName: info.name, testing: false });
      return true;
    } catch (e) {
      set({ connected: false, testing: false, error: String(e) });
      return false;
    }
  },

  fetchSections: async () => {
    try {
      const sections = await plexGetSections();
      set({ sections });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  syncAll: async (playlists) => {
    set({ syncing: true, error: null, syncResults: [] });
    try {
      const results = await plexSyncPlaylists(playlists);
      set({ syncResults: results, syncing: false });
    } catch (e) {
      set({ syncing: false, error: String(e) });
    }
  },

  clearResults: () => set({ syncResults: [], error: null }),
}));

import { create } from "zustand";
import type { DeviceInfo, DeviceTrack, PlaylistInfo } from "../types/models";
import { scanDevices, setDevice } from "../api/device";
import { scanDeviceLibrary, getPlaylists } from "../api/library";

interface DeviceState {
  devices: DeviceInfo[];
  selectedDevice: DeviceInfo | null;
  tracks: DeviceTrack[];
  playlists: PlaylistInfo[];
  scanning: boolean;
  loadingLibrary: boolean;
  loadingPlaylists: boolean;
  error: string | null;

  scanForDevices: () => Promise<void>;
  selectDevice: (device: DeviceInfo) => Promise<void>;
  refreshLibrary: () => Promise<void>;
  refreshPlaylists: () => Promise<void>;
  disconnect: () => void;
}

export const useDeviceStore = create<DeviceState>((set, get) => ({
  devices: [],
  selectedDevice: null,
  tracks: [],
  playlists: [],
  scanning: false,
  loadingLibrary: false,
  loadingPlaylists: false,
  error: null,

  scanForDevices: async () => {
    set({ scanning: true, error: null });
    try {
      const devices = await scanDevices();
      set({ devices, scanning: false });
      // Auto-select first device if none selected
      if (devices.length > 0 && !get().selectedDevice) {
        await get().selectDevice(devices[0]);
      }
    } catch (e) {
      set({ scanning: false, error: String(e) });
    }
  },

  selectDevice: async (device) => {
    set({ selectedDevice: device, error: null });
    await setDevice(device.mount_point);
    // Load library and playlists
    await Promise.all([get().refreshLibrary(), get().refreshPlaylists()]);
  },

  refreshLibrary: async () => {
    const device = get().selectedDevice;
    if (!device) return;
    set({ loadingLibrary: true, error: null });
    try {
      const tracks = await scanDeviceLibrary(device.mount_point);
      set({ tracks, loadingLibrary: false });
    } catch (e) {
      set({ loadingLibrary: false, error: String(e) });
    }
  },

  refreshPlaylists: async () => {
    const device = get().selectedDevice;
    if (!device) return;
    set({ loadingPlaylists: true });
    try {
      const playlists = await getPlaylists();
      set({ playlists, loadingPlaylists: false });
    } catch (e) {
      set({ loadingPlaylists: false, error: String(e) });
    }
  },

  disconnect: () => {
    set({
      selectedDevice: null,
      tracks: [],
      playlists: [],
      error: null,
    });
  },
}));

import { create } from "zustand";
import type { DeviceInfo, DeviceTrack, PlaylistInfo } from "../types/models";
import { scanDevices, setDevice, setDeviceManual, setIpod, clearIpod } from "../api/device";
import { scanDeviceLibrary, getPlaylists } from "../api/library";
import { rpcCall } from "../api/sidecar";

interface DeviceState {
  devices: DeviceInfo[];
  selectedDevice: DeviceInfo | null;
  ipod: DeviceInfo | null;
  ipodConnecting: boolean;
  tracks: DeviceTrack[];
  playlists: PlaylistInfo[];
  scanning: boolean;
  loadingLibrary: boolean;
  loadingPlaylists: boolean;
  error: string | null;

  scanForDevices: () => Promise<void>;
  selectDevice: (device: DeviceInfo) => Promise<void>;
  connectLocalLibrary: (path: string) => Promise<void>;
  connectDeviceManual: (path: string) => Promise<void>;
  connectIpod: (device: DeviceInfo) => Promise<void>;
  connectIpodManual: (path: string) => Promise<void>;
  disconnectIpod: () => void;
  refreshLibrary: () => Promise<void>;
  refreshPlaylists: () => Promise<void>;
  disconnect: () => void;
}

export const useDeviceStore = create<DeviceState>((set, get) => ({
  devices: [],
  selectedDevice: null,
  ipod: null,
  ipodConnecting: false,
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
      // Detected iPods populate the device slot for the user to connect — they
      // no longer hijack the primary (library) connection.
      if (devices.length > 0 && !get().ipod && !get().selectedDevice) {
        await get().connectIpod(devices[0]);
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

  connectLocalLibrary: async (path: string) => {
    set({ scanning: true, error: null });
    try {
      const device = await rpcCall<DeviceInfo>("set_local_library", { path });
      set({ selectedDevice: device, scanning: false });
      await Promise.all([get().refreshLibrary(), get().refreshPlaylists()]);
    } catch (e) {
      set({ scanning: false, error: String(e) });
      throw e; // re-throw so callers can handle
    }
  },

  connectDeviceManual: async (path: string) => {
    set({ scanning: true, error: null });
    try {
      const device = await setDeviceManual(path);
      set({ selectedDevice: device, scanning: false });
      await Promise.all([get().refreshLibrary(), get().refreshPlaylists()]);
    } catch (e) {
      set({ scanning: false, error: String(e) });
      throw e; // re-throw so callers can handle
    }
  },

  connectIpod: async (device: DeviceInfo) => {
    set({ ipodConnecting: true, error: null });
    try {
      const info = await setIpod(device.mount_point);
      set({ ipod: info, ipodConnecting: false });
    } catch (e) {
      set({ ipodConnecting: false, error: String(e) });
      throw e;
    }
  },

  connectIpodManual: async (path: string) => {
    set({ ipodConnecting: true, error: null });
    try {
      const info = await setIpod(path);
      set({ ipod: info, ipodConnecting: false });
    } catch (e) {
      set({ ipodConnecting: false, error: String(e) });
      throw e;
    }
  },

  disconnectIpod: () => {
    clearIpod().catch(() => {});
    set({ ipod: null });
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

import { rpcCall } from "./sidecar";

export interface DeviceInfo {
  mount_point: string;
  label: string;
  model: string;
  firmware: string;
  capacity_bytes: number;
  used_bytes: number;
  free_bytes: number;
}

export function scanDevices() {
  return rpcCall<DeviceInfo[]>("scan_devices");
}

export function setDevice(mountPoint: string) {
  return rpcCall("set_device", { mount_point: mountPoint });
}

/** Connect a device by explicit mount path (manual fallback when auto-detect misses it). */
export function setDeviceManual(path: string) {
  return rpcCall<DeviceInfo>("set_device_manual", { path });
}

/** Connect a secondary iPod (separate sync target that coexists with the library). */
export function setIpod(path: string) {
  return rpcCall<DeviceInfo>("set_ipod", { path });
}

export function clearIpod() {
  return rpcCall("clear_ipod");
}

export function clearDevice() {
  return rpcCall("clear_device");
}

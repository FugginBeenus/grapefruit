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

export function clearDevice() {
  return rpcCall("clear_device");
}

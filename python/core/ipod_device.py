import os
import shutil
import subprocess
import threading
import time
from pathlib import Path

from core.models import DeviceInfo, DeviceFirmware


class DeviceDetector:
    """Monitors /Volumes/ for iPod connections."""

    POLL_INTERVAL = 2.0
    VOLUMES_PATH = Path("/Volumes")

    def __init__(self):
        self._known_devices: dict[str, DeviceInfo] = {}
        self._monitoring = False
        self._monitor_thread: threading.Thread | None = None
        self._on_connect = None
        self._on_disconnect = None

    def scan_once(self) -> list[DeviceInfo]:
        """One-shot scan for iPod devices."""
        devices = []
        if not self.VOLUMES_PATH.exists():
            return devices

        try:
            volumes = list(self.VOLUMES_PATH.iterdir())
        except PermissionError:
            return devices

        for vol in volumes:
            if not vol.is_dir():
                continue
            firmware = self._identify_firmware(vol)
            if firmware != DeviceFirmware.UNKNOWN:
                device = self._build_device_info(vol, firmware)
                devices.append(device)

        return devices

    def start_monitoring(self, on_connect=None, on_disconnect=None):
        """Start background polling for device changes."""
        if self._monitoring:
            return
        self._on_connect = on_connect
        self._on_disconnect = on_disconnect
        self._monitoring = True

        # Initial scan
        for device in self.scan_once():
            key = str(device.mount_point)
            self._known_devices[key] = device

        self._monitor_thread = threading.Thread(target=self._poll_loop, daemon=True)
        self._monitor_thread.start()

    def stop_monitoring(self):
        """Stop the background polling."""
        self._monitoring = False

    def _poll_loop(self):
        """Background polling loop."""
        while self._monitoring:
            time.sleep(self.POLL_INTERVAL)
            try:
                current = self.scan_once()
                current_keys = {str(d.mount_point) for d in current}
                known_keys = set(self._known_devices.keys())

                # New devices
                for device in current:
                    key = str(device.mount_point)
                    if key not in known_keys:
                        self._known_devices[key] = device
                        if self._on_connect:
                            self._on_connect(device)

                # Removed devices
                for key in known_keys - current_keys:
                    if self._on_disconnect:
                        self._on_disconnect(key)
                    del self._known_devices[key]

            except Exception:
                pass

    def _identify_firmware(self, mount_point: Path) -> DeviceFirmware:
        """Check for Rockbox or Apple firmware."""
        try:
            if (mount_point / ".rockbox").is_dir():
                return DeviceFirmware.ROCKBOX
            if (mount_point / "iPod_Control").is_dir():
                return DeviceFirmware.APPLE
        except PermissionError:
            pass
        return DeviceFirmware.UNKNOWN

    def _build_device_info(self, mount_point: Path, firmware: DeviceFirmware) -> DeviceInfo:
        """Build a DeviceInfo from a mount point."""
        total, used, free = self._get_storage(mount_point)
        label = mount_point.name
        model = self._get_model(mount_point)

        return DeviceInfo(
            mount_point=mount_point,
            firmware=firmware,
            label=label,
            model=model,
            total_bytes=total,
            used_bytes=used,
            free_bytes=free,
        )

    def _get_storage(self, mount_point: Path) -> tuple[int, int, int]:
        """Get total, used, free bytes."""
        try:
            usage = shutil.disk_usage(mount_point)
            return usage.total, usage.used, usage.free
        except OSError:
            return 0, 0, 0

    def _get_model(self, mount_point: Path) -> str:
        """Try to identify device model via system_profiler."""
        try:
            import plistlib
            result = subprocess.run(
                ["system_profiler", "SPUSBDataType", "-xml"],
                capture_output=True, timeout=5,
            )
            if result.returncode != 0:
                return ""

            data = plistlib.loads(result.stdout)
            return self._find_ipod_in_usb(data)
        except Exception:
            return ""

    def _find_ipod_in_usb(self, data, depth=0) -> str:
        """Recursively search USB data for iPod device info."""
        if depth > 10:
            return ""
        if isinstance(data, list):
            for item in data:
                result = self._find_ipod_in_usb(item, depth + 1)
                if result:
                    return result
        elif isinstance(data, dict):
            name = data.get("_name", "")
            if "ipod" in name.lower():
                return name
            for key in ("_items", "_SPUSBDataType"):
                if key in data:
                    result = self._find_ipod_in_usb(data[key], depth + 1)
                    if result:
                        return result
        return ""

import getpass
import os
import platform
import shutil
import subprocess
import threading
import time
from pathlib import Path

from core.models import DeviceInfo, DeviceFirmware


class DeviceDetector:
    """Monitors for iPod connections (macOS, Windows, Linux)."""

    POLL_INTERVAL = 2.0

    def __init__(self):
        self._known_devices: dict[str, DeviceInfo] = {}
        self._monitoring = False
        self._monitor_thread: threading.Thread | None = None
        self._on_connect = None
        self._on_disconnect = None

    def scan_once(self) -> list[DeviceInfo]:
        """One-shot scan for iPod devices."""
        devices = []
        for vol in self._find_volumes():
            if not vol.is_dir():
                continue
            firmware = self._identify_firmware(vol)
            if firmware != DeviceFirmware.UNKNOWN:
                device = self._build_device_info(vol, firmware)
                devices.append(device)
        return devices

    def _find_volumes(self) -> list[Path]:
        """Return candidate mount points to check, based on OS."""
        system = platform.system()
        if system == "Darwin":
            return self._find_volumes_macos()
        elif system == "Windows":
            return self._find_volumes_windows()
        elif system == "Linux":
            return self._find_volumes_linux()
        return []

    def _find_volumes_macos(self) -> list[Path]:
        """Scan /Volumes/ for mounted devices (macOS)."""
        volumes_path = Path("/Volumes")
        if not volumes_path.exists():
            return []
        try:
            return [v for v in volumes_path.iterdir() if v.is_dir()]
        except PermissionError:
            return []

    def _find_volumes_windows(self) -> list[Path]:
        """Scan drive letters D:\\ through Z:\\ for iPod volumes (Windows)."""
        volumes = []
        for letter in "DEFGHIJKLMNOPQRSTUVWXYZ":
            drive = Path(f"{letter}:\\")
            if not drive.exists():
                continue
            # Only include drives that look like an iPod
            if (drive / "iPod_Control").is_dir() or (drive / ".rockbox").is_dir():
                volumes.append(drive)
        return volumes

    def _find_volumes_linux(self) -> list[Path]:
        """Scan /media/{user}/ and /mnt/ for mounted iPod volumes (Linux)."""
        volumes = []
        # /media/<username>/<volume>
        user_media = Path(f"/media/{getpass.getuser()}")
        if user_media.is_dir():
            try:
                for vol in user_media.iterdir():
                    if vol.is_dir():
                        volumes.append(vol)
            except PermissionError:
                pass
        # /mnt/<volume>
        mnt = Path("/mnt")
        if mnt.is_dir():
            try:
                for vol in mnt.iterdir():
                    if vol.is_dir():
                        volumes.append(vol)
            except PermissionError:
                pass
        return volumes

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
        """Try to identify device model using OS-specific tools."""
        system = platform.system()
        if system == "Darwin":
            return self._get_model_macos()
        elif system == "Windows":
            return self._get_model_windows(mount_point)
        elif system == "Linux":
            return self._get_model_linux(mount_point)
        return ""

    def _get_model_macos(self) -> str:
        """Identify device model via system_profiler (macOS)."""
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

    def _get_model_windows(self, mount_point: Path) -> str:
        """Identify device model via wmic or volume name (Windows)."""
        try:
            drive_letter = str(mount_point).rstrip("\\")
            result = subprocess.run(
                ["wmic", "logicaldisk", "where", f"DeviceID='{drive_letter}'",
                 "get", "VolumeName", "/value"],
                capture_output=True, text=True, timeout=5,
            )
            if result.returncode == 0:
                for line in result.stdout.splitlines():
                    if line.startswith("VolumeName="):
                        name = line.split("=", 1)[1].strip()
                        if name:
                            return name
        except Exception:
            pass
        return mount_point.name

    def _get_model_linux(self, mount_point: Path) -> str:
        """Identify device model via lsblk or volume name (Linux)."""
        try:
            result = subprocess.run(
                ["lsblk", "-no", "LABEL", "-J"],
                capture_output=True, text=True, timeout=5,
            )
            if result.returncode == 0:
                import json
                data = json.loads(result.stdout)
                for device in data.get("blockdevices", []):
                    label = device.get("label", "")
                    if label and label.lower() in mount_point.name.lower():
                        return label
        except Exception:
            pass
        return mount_point.name

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

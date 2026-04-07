"""Stateful session for the sidecar — replaces the old _state dict."""

from pathlib import Path


class Session:
    """Holds state across RPC calls within a single sidecar lifetime."""

    def __init__(self):
        self.device_mount: Path | None = None
        self.device_tracks: list = []
        self.rockbox_library = None
        self.local_tracks: list = []
        self.match_results: list = []
        self.plex_client = None
        self.sync_engine = None

    def get_rockbox_library(self):
        """Lazily create RockboxLibrary if device is connected."""
        if self.rockbox_library is None and self.device_mount:
            from core.rockbox_library import RockboxLibrary
            self.rockbox_library = RockboxLibrary(self.device_mount)
        return self.rockbox_library

    def clear_device(self):
        """Reset device-related state."""
        self.device_mount = None
        self.device_tracks = []
        self.rockbox_library = None
        self.match_results = []

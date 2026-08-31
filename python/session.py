"""Stateful session for the sidecar — replaces the old _state dict."""

import threading
from pathlib import Path


class Session:
    """Holds state across RPC calls within a single sidecar lifetime.

    All access to mutable state is protected by a reentrant lock
    so concurrent RPC calls from the thread pool don't corrupt data.
    """

    def __init__(self):
        self._lock = threading.RLock()
        # Primary connection — the library/hub the Library view is built from.
        self.device_mount: Path | None = None
        self.device_tracks: list = []
        self.rockbox_library = None
        # Secondary connection — the iPod (a separate sync target that can be
        # connected alongside the library).
        self.ipod_mount: Path | None = None
        self.match_results: list = []
        self.plex_client = None
        self.sync_engine = None
        self._action_history: list[dict] = []  # for undo support

    def get_rockbox_library(self):
        """Lazily create RockboxLibrary if device is connected."""
        with self._lock:
            if self.rockbox_library is None and self.device_mount:
                from core.rockbox_library import RockboxLibrary
                self.rockbox_library = RockboxLibrary(self.device_mount)
            return self.rockbox_library

    def clear_device(self):
        """Reset device-related state."""
        with self._lock:
            self.device_mount = None
            self.device_tracks = []
            self.rockbox_library = None
            self.match_results = []
            self.sync_engine = None
            self._action_history = []

    def clear_ipod(self):
        """Disconnect the secondary iPod, leaving the library untouched."""
        with self._lock:
            self.ipod_mount = None

    def record_action(self, action: dict):
        """Record a reversible action for undo support."""
        with self._lock:
            self._action_history.append(action)
            # Keep last 50 actions
            if len(self._action_history) > 50:
                self._action_history = self._action_history[-50:]

    def pop_last_action(self) -> dict | None:
        """Pop the most recent action for undo."""
        with self._lock:
            if self._action_history:
                return self._action_history.pop()
            return None

    def get_action_history(self) -> list[dict]:
        """Return the current action history."""
        with self._lock:
            return list(self._action_history)

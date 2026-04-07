"""JSON-RPC method dispatch — routes method names to Python core functions."""

import dataclasses
import os
from pathlib import Path
from typing import Callable

from session import Session


def _serialize(obj):
    """Recursively convert dataclasses and Paths to JSON-safe dicts/strings."""
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        return {k: _serialize(v) for k, v in dataclasses.asdict(obj).items()}
    if isinstance(obj, Path):
        return str(obj)
    if isinstance(obj, list):
        return [_serialize(item) for item in obj]
    if isinstance(obj, dict):
        return {k: _serialize(v) for k, v in obj.items()}
    if isinstance(obj, (set, frozenset)):
        return [_serialize(item) for item in obj]
    return obj


class RpcHandler:
    """Dispatches JSON-RPC methods to the appropriate Python core functions."""

    def __init__(self, notify_fn: Callable[[str, dict], None]):
        self._notify = notify_fn
        self._session = Session()

    def dispatch(self, method: str, params: dict):
        """Route a method name to its handler and return the result."""
        handler = getattr(self, f"_rpc_{method}", None)
        if handler is None:
            raise ValueError(f"Unknown method: {method}")
        return handler(params)

    # ── Device ──────────────────────────────────────────────────────

    def _rpc_scan_devices(self, params: dict):
        from core.ipod_device import DeviceDetector
        detector = DeviceDetector()
        devices = detector.scan_once()
        result = []
        for d in devices:
            result.append({
                "mount_point": str(d.mount_point),
                "label": d.label,
                "model": d.model,
                "firmware": d.firmware.value if hasattr(d.firmware, 'value') else str(d.firmware),
                "capacity_bytes": d.total_bytes,
                "used_bytes": d.used_bytes,
                "free_bytes": d.free_bytes,
            })
        return result

    def _rpc_set_device(self, params: dict):
        mount = params.get("mount_point", "")
        self._session.device_mount = Path(mount)
        self._session.rockbox_library = None
        self._session.device_tracks = []
        return {"ok": True}

    def _rpc_clear_device(self, params: dict):
        self._session.clear_device()
        return {"ok": True}

    # ── Library ─────────────────────────────────────────────────────

    def _rpc_scan_device_library(self, params: dict):
        mount = params.get("mount_point")
        if mount:
            self._session.device_mount = Path(mount)
            self._session.rockbox_library = None

        library = self._session.get_rockbox_library()
        if not library:
            raise ValueError("No device connected")

        def progress(current, total):
            self._notify("progress", {
                "op": "scan_device_library",
                "current": current,
                "total": total,
            })

        tracks = library.scan_music(progress_callback=progress)
        self._session.device_tracks = tracks
        return _serialize(tracks)

    def _rpc_get_playlists(self, params: dict):
        library = self._session.get_rockbox_library()
        if not library:
            raise ValueError("No device connected")

        playlists = library.get_playlists()
        result = []
        for name, path in playlists:
            track_paths = library.read_playlist(path)
            result.append({
                "name": name,
                "path": str(path),
                "track_count": len(track_paths),
            })
        return result

    def _rpc_read_playlist(self, params: dict):
        library = self._session.get_rockbox_library()
        if not library:
            raise ValueError("No device connected")

        path = Path(params["path"])
        track_paths = library.read_playlist(path)

        # Resolve to device tracks with metadata
        dt_by_path = {}
        for dt in self._session.device_tracks:
            dt_by_path[dt.relative_path.lower()] = dt
            dt_by_path[dt.relative_path.replace("\\", "/").lower()] = dt

        tracks = []
        for tp in track_paths:
            clean = tp.lstrip("/").lower()
            dt = dt_by_path.get(clean)
            if dt:
                tracks.append(_serialize(dt))
            else:
                tracks.append({"relative_path": tp, "title": os.path.basename(tp)})

        return tracks

    def _rpc_write_playlist(self, params: dict):
        library = self._session.get_rockbox_library()
        if not library:
            raise ValueError("No device connected")

        name = params["name"]
        # Accept track relative paths — resolve to DeviceTracks
        track_paths = params.get("track_paths", [])
        dt_by_path = {}
        for dt in self._session.device_tracks:
            dt_by_path[dt.relative_path.lower()] = dt

        tracks = []
        for tp in track_paths:
            dt = dt_by_path.get(tp.lower().lstrip("/"))
            if dt:
                tracks.append(dt)

        output_path = library.write_playlist(name, tracks)
        return {"path": str(output_path)}

    def _rpc_delete_playlist(self, params: dict):
        library = self._session.get_rockbox_library()
        if not library:
            raise ValueError("No device connected")

        path = Path(params["path"])
        ok = library.delete_playlist(path)
        return {"ok": ok}

    # ── Scrapers ────────────────────────────────────────────────────

    def _rpc_fetch_playlist(self, params: dict):
        """Auto-detect source and fetch playlist tracks."""
        url = params["url"]

        from core.utils import detect_playlist_source

        source = detect_playlist_source(url)

        def progress(current, total):
            self._notify("progress", {
                "op": "fetch_playlist",
                "current": current,
                "total": total,
            })

        if source == "apple_music":
            from core.apple_music_scraper import AppleMusicScraper
            scraper = AppleMusicScraper()
            metadata, tracks = scraper.fetch_playlist(url, progress_callback=progress)
        elif source == "spotify":
            from core.spotify_scraper import SpotifyScraper
            scraper = SpotifyScraper()
            metadata, tracks = scraper.fetch_playlist(url, progress_callback=progress)
        else:
            raise ValueError(f"Unsupported playlist source: {url}")

        return {
            "metadata": _serialize(metadata),
            "tracks": _serialize(tracks),
        }

    # ── Matching ────────────────────────────────────────────────────

    def _rpc_match_tracks(self, params: dict):
        """Match playlist tracks against device library."""
        from core.matcher import Matcher
        from core.models import PlaylistTrack
        from core.local_scanner import LocalTrack

        playlist_tracks_raw = params.get("playlist_tracks", [])
        playlist_tracks = [
            PlaylistTrack(
                title=t.get("title", ""),
                artist=t.get("artist", ""),
                album=t.get("album", ""),
                duration_seconds=t.get("duration_seconds"),
                source_index=t.get("source_index", i),
            )
            for i, t in enumerate(playlist_tracks_raw)
        ]

        # Convert device tracks to LocalTracks for matcher
        local_tracks = []
        for dt in self._session.device_tracks:
            lt = LocalTrack(
                file_path=dt.file_path,
                title=dt.title,
                artist=dt.artist,
                album=dt.album,
                duration_seconds=dt.duration_seconds,
                track_number=dt.track_number,
            )
            local_tracks.append(lt)

        def progress(current, total):
            self._notify("progress", {
                "op": "match_tracks",
                "current": current,
                "total": total,
            })

        matcher = Matcher()
        results = matcher.match_all(
            playlist_tracks, local_tracks,
            progress_callback=progress,
        )
        self._session.match_results = results
        return _serialize(results)

    # ── Plex ────────────────────────────────────────────────────────

    def _rpc_plex_test_connection(self, params: dict):
        from core.plex_client import PlexClient
        url = params["server_url"]
        token = params["token"]
        client = PlexClient(url, token)
        info = client.test_connection()
        self._session.plex_client = client
        return info

    def _rpc_plex_get_sections(self, params: dict):
        client = self._session.plex_client
        if not client:
            raise ValueError("Not connected to Plex")
        return client.get_music_sections()

    def _rpc_plex_sync_playlists(self, params: dict):
        """Sync iPod playlists to Plex — bulk operation."""
        from core.plex_client import PlexClient
        from core.plex_config import load_plex_config, save_plex_config
        from core.utils import normalize_for_matching

        config = load_plex_config()
        client = PlexClient(config.server_url, config.token)
        client.test_connection()

        sections = client.get_music_sections()
        if not sections:
            raise ValueError("No music libraries on Plex")

        section = sections[0]
        for s in sections:
            if s["key"] == config.last_section_key:
                section = s
                break

        config.last_section_key = section["key"]

        self._notify("progress", {
            "op": "plex_sync",
            "current": 0,
            "total": 1,
            "message": "Loading Plex library...",
        })

        def fetch_progress(i, total):
            self._notify("progress", {
                "op": "plex_sync",
                "current": i,
                "total": total,
                "message": f"Indexing Plex library... {i}/{total}",
            })

        all_plex = client.get_all_tracks(section["key"], fetch_progress)
        file_lookup = client.build_file_lookup(all_plex)
        title_lookup = client.build_lookup(all_plex)

        library = self._session.get_rockbox_library()
        if not library:
            raise ValueError("No device connected")

        dt_by_path = {}
        for dt in self._session.device_tracks:
            dt_by_path[dt.relative_path.lower()] = dt
            dt_by_path[dt.relative_path.replace("\\", "/").lower()] = dt

        playlist_names = params.get("playlists")
        all_playlists = library.get_playlists()

        if playlist_names:
            name_set = set(playlist_names)
            all_playlists = [(n, p) for n, p in all_playlists if n in name_set]

        results = []
        for idx, (name, path) in enumerate(all_playlists):
            self._notify("progress", {
                "op": "plex_sync",
                "current": idx,
                "total": len(all_playlists),
                "message": f"Syncing: {name}",
            })

            track_paths = library.read_playlist(path)
            matched_keys = []
            missing_tracks = []

            for tp in track_paths:
                clean = tp.lstrip("/")
                dt = dt_by_path.get(clean.lower())
                plex_track = None

                # Strategy 1: filename
                if dt and dt.file_path:
                    basename = os.path.basename(str(dt.file_path)).lower()
                    plex_track = file_lookup.get(basename)
                if not plex_track:
                    basename = os.path.basename(clean).lower()
                    plex_track = file_lookup.get(basename)

                # Strategy 2: artist + title
                if not plex_track and dt:
                    key = (normalize_for_matching(dt.artist),
                           normalize_for_matching(dt.title))
                    hits = title_lookup.get(key)
                    if hits:
                        plex_track = hits[0]

                if plex_track:
                    matched_keys.append(plex_track["ratingKey"])
                else:
                    label = (f"{dt.artist} - {dt.title}"
                             if dt else os.path.basename(clean))
                    missing_tracks.append(label)

            playlist_result = {
                "name": name,
                "matched": len(matched_keys),
                "missing": len(missing_tracks),
                "missing_tracks": missing_tracks,
                "status": "pending",
            }

            if matched_keys:
                existing_rk = config.playlist_map.get(name)
                try:
                    if existing_rk:
                        rk = client.replace_playlist(existing_rk, name, matched_keys)
                        playlist_result["status"] = "updated"
                    else:
                        rk = client.create_playlist(name, matched_keys)
                        playlist_result["status"] = "created"
                    config.playlist_map[name] = rk
                except Exception as e:
                    playlist_result["status"] = "error"
                    playlist_result["error"] = str(e)
            else:
                playlist_result["status"] = "no_matches"

            results.append(playlist_result)

        save_plex_config(config)

        self._notify("progress", {
            "op": "plex_sync",
            "current": len(all_playlists),
            "total": len(all_playlists),
            "message": "Done",
        })

        return results

    def _rpc_load_plex_config(self, params: dict):
        from core.plex_config import load_plex_config
        config = load_plex_config()
        return _serialize(config)

    def _rpc_save_plex_config(self, params: dict):
        from core.plex_config import load_plex_config, save_plex_config, PlexConfig
        config = PlexConfig(
            server_url=params.get("server_url", ""),
            token=params.get("token", ""),
            last_section_key=params.get("last_section_key", ""),
            music_library_path=params.get("music_library_path", ""),
            playlist_map=params.get("playlist_map", {}),
        )
        save_plex_config(config)
        return {"ok": True}

    # ── Duplicates ──────────────────────────────────────────────────

    def _rpc_find_duplicates(self, params: dict):
        from core.utils import normalize_for_matching

        groups = {}
        for dt in self._session.device_tracks:
            key = (normalize_for_matching(dt.artist), normalize_for_matching(dt.title))
            groups.setdefault(key, []).append(dt)

        duplicates = []
        for key, tracks in groups.items():
            if len(tracks) > 1:
                duplicates.append({
                    "artist": tracks[0].artist,
                    "title": tracks[0].title,
                    "copies": _serialize(tracks),
                })

        return duplicates

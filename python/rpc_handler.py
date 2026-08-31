"""JSON-RPC method dispatch — routes method names to Python core functions."""

import dataclasses
import os
import shutil
import time
from enum import Enum
from pathlib import Path
from typing import Callable

from session import Session


def _serialize(obj):
    """Recursively convert dataclasses, enums, and Paths to JSON-safe values."""
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        return {k: _serialize(v) for k, v in dataclasses.asdict(obj).items()}
    if isinstance(obj, Enum):
        # Emit the .value (e.g. "matched"), not "MatchStatus.MATCHED" — the
        # frontend matches on the string values.
        return obj.value
    if isinstance(obj, Path):
        return str(obj)
    if isinstance(obj, list):
        return [_serialize(item) for item in obj]
    if isinstance(obj, dict):
        return {k: _serialize(v) for k, v in obj.items()}
    if isinstance(obj, (set, frozenset)):
        return [_serialize(item) for item in obj]
    return obj


def _require(params: dict, *keys: str):
    """Validate that required keys exist in params. Raises ValueError with details."""
    missing = [k for k in keys if k not in params or params[k] is None]
    if missing:
        raise ValueError(f"Missing required parameters: {', '.join(missing)}")


class RpcHandler:
    """Dispatches JSON-RPC methods to the appropriate Python core functions."""

    def __init__(self, notify_fn: Callable[[str, dict], None]):
        self._notify = notify_fn
        self._session = Session()
        self._spotify_flow = None  # in-flight OAuth flow, if any
        self._src_cache = {}       # source index cache for location pooling

    def dispatch(self, method: str, params: dict):
        """Route a method name to its handler and return the result."""
        handler = getattr(self, f"_rpc_{method}", None)
        if handler is None:
            raise ValueError(f"Unknown method: {method}")
        if not isinstance(params, dict):
            raise ValueError("Parameters must be a JSON object")
        try:
            return handler(params)
        except PermissionError as e:
            # Turn a raw TCC/permission denial into an actionable message.
            raise ValueError(
                "macOS is blocking file access. Grant Grapefruit permission in "
                "System Settings → Privacy & Security → Files and Folders "
                "(enable 'Removable Volumes' for an iPod), then try again."
            ) from e

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
        _require(params, "mount_point")
        mount = params["mount_point"]
        mount_path = Path(mount)
        if not mount_path.exists():
            raise ValueError(f"Device path does not exist: {mount}")
        with self._session._lock:
            self._session.device_mount = mount_path
            self._session.rockbox_library = None
            self._session.device_tracks = []
        return {"ok": True}

    def _rpc_set_local_library(self, params: dict):
        """Connect to any local directory as a music library (no device required)."""
        _require(params, "path")
        lib_path = Path(params["path"])
        if not lib_path.exists():
            raise ValueError(f"Directory does not exist: {params['path']}")
        if not lib_path.is_dir():
            raise ValueError(f"Path is not a directory: {params['path']}")

        import shutil as _shutil
        usage = _shutil.disk_usage(str(lib_path))

        with self._session._lock:
            self._session.device_mount = lib_path
            self._session.rockbox_library = None
            self._session.device_tracks = []

        return {
            "mount_point": str(lib_path),
            "label": lib_path.name,
            "model": "Local Library",
            "firmware": "local",
            "capacity_bytes": usage.total,
            "used_bytes": usage.used,
            "free_bytes": usage.free,
        }

    def _rpc_set_device_manual(self, params: dict):
        """Connect a device by an explicit mount path — the manual fallback for
        when auto-detection misses an iPod (e.g. blocked removable-volume
        permission, or a volume without the expected marker folders)."""
        from core.models import DeviceFirmware
        _require(params, "path")
        mount_path = Path(params["path"])
        if not mount_path.exists():
            raise ValueError(f"Path does not exist: {params['path']}")
        if not mount_path.is_dir():
            raise ValueError(f"Path is not a directory: {params['path']}")

        firmware = self._get_device_firmware(mount_path)
        import shutil as _shutil
        usage = _shutil.disk_usage(str(mount_path))

        with self._session._lock:
            self._session.device_mount = mount_path
            self._session.rockbox_library = None
            self._session.device_tracks = []

        return {
            "mount_point": str(mount_path),
            "label": mount_path.name,
            "model": "iPod" if firmware != DeviceFirmware.UNKNOWN else "Device",
            "firmware": firmware.value,
            "capacity_bytes": usage.total,
            "used_bytes": usage.used,
            "free_bytes": usage.free,
        }

    def _rpc_set_ipod(self, params: dict):
        """Connect a secondary iPod — a separate sync target that coexists with
        the library. Caches its filenames (fast, no tag reads) so its tracks can
        be tagged 'on device' and it can be synced to, without disturbing the
        connected library."""
        from core.models import DeviceFirmware
        from core.location_cache import save_device_index
        _require(params, "path")
        mount_path = Path(params["path"])
        if not mount_path.exists():
            raise ValueError(f"Path does not exist: {params['path']}")
        if not mount_path.is_dir():
            raise ValueError(f"Path is not a directory: {params['path']}")

        firmware = self._get_device_firmware(mount_path)
        import shutil as _shutil
        usage = _shutil.disk_usage(str(mount_path))

        with self._session._lock:
            self._session.ipod_mount = mount_path

        try:
            save_device_index(self._folder_basenames(str(mount_path)), label=mount_path.name)
        except Exception:
            pass

        return {
            "mount_point": str(mount_path),
            "label": mount_path.name,
            "model": "iPod" if firmware != DeviceFirmware.UNKNOWN else "Device",
            "firmware": firmware.value,
            "capacity_bytes": usage.total,
            "used_bytes": usage.used,
            "free_bytes": usage.free,
        }

    def _rpc_clear_ipod(self, params: dict):
        self._session.clear_ipod()
        return {"ok": True}

    def _rpc_clear_device(self, params: dict):
        self._session.clear_device()
        return {"ok": True}

    # ── Library ─────────────────────────────────────────────────────

    def _rpc_scan_device_library(self, params: dict):
        mount = params.get("mount_point")
        if mount:
            mount_path = Path(mount)
            if not mount_path.exists():
                raise ValueError(f"Device path does not exist: {mount}")
            with self._session._lock:
                self._session.device_mount = mount_path
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
        with self._session._lock:
            self._session.device_tracks = tracks

        # If this target is a device (not a plain library folder), remember its
        # contents so tracks can be tagged 'on device' even when it's unplugged.
        try:
            dm = self._session.device_mount
            if dm and ((dm / ".rockbox").exists() or (dm / "iPod_Control").exists()):
                from core.location_cache import save_device_index
                names = {os.path.basename(t.relative_path).lower() for t in tracks}
                save_device_index(names, label=dm.name)
        except Exception:
            pass

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

    def _rpc_get_ipod_playlists(self, params: dict):
        """Read playlists (M3U/M3U8) on the connected iPod, separate from the
        library. [] when no iPod is connected."""
        if not self._session.ipod_mount:
            return []
        from core.rockbox_library import RockboxLibrary
        lib = RockboxLibrary(self._session.ipod_mount)
        result = []
        for name, path in lib.get_playlists():
            track_paths = lib.read_playlist(path)
            result.append({"name": name, "path": str(path), "track_count": len(track_paths)})
        return result

    def _rpc_read_ipod_playlist(self, params: dict):
        """Read the tracks of a playlist that lives on the iPod. Resolves each
        entry against the library's metadata when possible, else shows the
        filename."""
        _require(params, "path")
        if not self._session.ipod_mount:
            raise ValueError("No iPod connected")
        from core.rockbox_library import RockboxLibrary
        lib = RockboxLibrary(self._session.ipod_mount)
        track_paths = lib.read_playlist(Path(params["path"]))

        dt_by_path = {}
        for dt in self._session.device_tracks:
            dt_by_path[dt.relative_path.lower()] = dt
            dt_by_path[dt.relative_path.replace("\\", "/").lower()] = dt

        tracks = []
        for tp in track_paths:
            dt = dt_by_path.get(tp.lstrip("/").lower())
            if dt:
                tracks.append(_serialize(dt))
            else:
                name = os.path.basename(tp)
                tracks.append({
                    "file_path": tp, "relative_path": tp, "title": name,
                    "artist": "", "album": "", "duration_seconds": None,
                    "track_number": None, "file_size": 0,
                    "format": os.path.splitext(name)[1].lstrip(".").lower(),
                })
        return tracks

    def _rpc_read_playlist(self, params: dict):
        _require(params, "path")
        library = self._session.get_rockbox_library()
        if not library:
            raise ValueError("No device connected")

        path = Path(params["path"])
        track_paths = library.read_playlist(path)

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
        _require(params, "name")
        library = self._session.get_rockbox_library()
        if not library:
            raise ValueError("No device connected")

        name = params["name"]
        track_paths = params.get("track_paths", [])

        def norm(p):
            return str(p).replace("\\", "/").lstrip("/").lower()

        # Match results carry absolute file paths, other callers send relative
        # ones, so index device tracks by both.
        dt_by_path = {}
        for dt in self._session.device_tracks:
            dt_by_path[norm(dt.file_path)] = dt
            dt_by_path[norm(dt.relative_path)] = dt

        tracks = []
        for tp in track_paths:
            dt = dt_by_path.get(norm(tp))
            if dt:
                tracks.append(dt)

        output_path = library.write_playlist(name, tracks)
        return {"path": str(output_path), "count": len(tracks)}

    def _rpc_write_ipod_playlist(self, params: dict):
        """Sync a playlist onto the iPod: copy any of its song files the iPod is
        missing (so the playlist never points at absent tracks), then write the
        M3U8. Track paths are resolved against the library for the files."""
        _require(params, "name")
        if not self._session.ipod_mount:
            raise ValueError("No iPod connected")
        from core.rockbox_library import RockboxLibrary
        from core.file_copier import FileCopier
        ipod = self._session.ipod_mount
        lib = RockboxLibrary(ipod)
        name = params["name"]
        track_paths = params.get("track_paths", [])

        def norm(p):
            return str(p).replace("\\", "/").lstrip("/").lower()

        dt_by_path = {}
        for dt in self._session.device_tracks:
            dt_by_path[norm(dt.file_path)] = dt
            dt_by_path[norm(dt.relative_path)] = dt

        tracks = []
        for tp in track_paths:
            dt = dt_by_path.get(norm(tp))
            if dt:
                tracks.append(dt)

        # Copy any missing song files to the iPod, mirroring the library's
        # relative layout (which is what the M3U8 references).
        copier = FileCopier()
        copied = 0
        errors = []
        total = len(tracks)
        for i, dt in enumerate(tracks):
            src = Path(dt.file_path)
            dst = ipod / dt.relative_path
            try:
                if not dst.exists() and src.exists():
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    if copier.copy_with_progress(src, dst):
                        copied += 1
                    else:
                        errors.append(dt.relative_path)
            except OSError as e:
                errors.append(f"{dt.relative_path}: {e}")
            self._notify("progress", {
                "op": "sync_playlist_ipod", "current": i + 1, "total": total,
                "message": f"Copying tracks {i + 1}/{total}",
            })

        output_path = lib.write_playlist(name, tracks)
        return {"path": str(output_path), "count": len(tracks), "copied": copied, "errors": errors}

    def _rpc_delete_playlist(self, params: dict):
        _require(params, "path")
        library = self._session.get_rockbox_library()
        if not library:
            raise ValueError("No device connected")

        path = Path(params["path"])
        ok = library.delete_playlist(path)
        return {"ok": ok}

    # ── Scrapers ────────────────────────────────────────────────────

    def _rpc_fetch_playlist(self, params: dict):
        """Auto-detect source and fetch playlist tracks."""
        _require(params, "url")
        url = params["url"]

        from core.utils import detect_playlist_source

        # detect_playlist_source returns (source_type, url) or None.
        detected = detect_playlist_source(url)
        if detected is None:
            raise ValueError(
                "Unrecognized URL. Paste a public Spotify or Apple Music "
                "playlist link."
            )
        source_type, _ = detected

        def progress(current, total):
            self._notify("progress", {
                "op": "fetch_playlist",
                "current": current,
                "total": total,
            })

        if source_type == "apple_music":
            from core.apple_music_scraper import AppleMusicScraper
            scraper = AppleMusicScraper()
            metadata, tracks = scraper.fetch_playlist(url, progress_callback=progress)
        elif source_type == "spotify":
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
        from core.models import PlaylistTrack, LocalTrack
        from core.utils import normalize_for_matching

        playlist_tracks_raw = params.get("playlist_tracks", [])
        if not playlist_tracks_raw:
            raise ValueError("No playlist tracks provided")

        if not self._session.device_tracks:
            raise ValueError(
                "No library loaded — connect a folder or device and let it "
                "finish scanning before matching."
            )

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

        # The Matcher indexes local tracks by their *normalized* fields, so
        # those must be populated here — DeviceTrack doesn't carry them.
        local_tracks = []
        for dt in self._session.device_tracks:
            lt = LocalTrack(
                file_path=dt.file_path,
                title=dt.title,
                artist=dt.artist,
                album=dt.album,
                duration_seconds=dt.duration_seconds,
                track_number=dt.track_number,
                normalized_title=normalize_for_matching(dt.title),
                normalized_artist=normalize_for_matching(dt.artist),
            )
            local_tracks.append(lt)

        def progress(current, total):
            self._notify("progress", {
                "op": "match_tracks",
                "current": current,
                "total": total,
            })

        matcher = Matcher(local_tracks)
        results = matcher.match_all(playlist_tracks, progress_callback=progress)
        with self._session._lock:
            self._session.match_results = results
        return _serialize(results)

    # ── Sync Engine ────────────────────────────────────────────────

    def _rpc_compute_sync_plan(self, params: dict):
        """Compute a sync plan comparing the library to the connected device."""
        _require(params, "source_paths")
        mount = self._sync_target()
        if not mount:
            raise ValueError("Connect a device (iPod) in the sidebar to sync to.")

        from core.models import SyncMode, DeviceInfo
        from core.sync_engine import SyncEngine
        from core.sync_db import SyncDatabase

        source_paths = [Path(p) for p in params["source_paths"]]
        for p in source_paths:
            if not p.exists():
                raise ValueError(f"Source path does not exist: {p}")

        mode_str = params.get("mode", "selective")
        try:
            mode = SyncMode(mode_str)
        except ValueError:
            raise ValueError(f"Invalid sync mode: {mode_str}. Use: full, selective, or delta")

        import shutil as _shutil
        usage = _shutil.disk_usage(str(mount))
        device_info = DeviceInfo(
            mount_point=mount,
            firmware=self._get_device_firmware(mount),
            total_bytes=usage.total,
            used_bytes=usage.used,
            free_bytes=usage.free,
        )

        sync_db = SyncDatabase(mount)
        engine = SyncEngine(device_info, sync_db)

        def progress(current, total):
            self._notify("progress", {
                "op": "compute_sync_plan",
                "current": current,
                "total": total,
            })

        plan = engine.compute_plan(source_paths, mode, progress_callback=progress)
        sync_db.close()

        return {
            "files_to_copy": len(plan.files_to_copy),
            "files_to_delete": len(plan.files_to_delete),
            "files_unchanged": len(plan.files_unchanged),
            "total_copy_bytes": plan.total_copy_bytes,
            "total_delete_bytes": plan.total_delete_bytes,
            "device_free_bytes": plan.device_free_bytes,
            "fits_on_device": plan.fits_on_device,
            "shortfall_bytes": plan.shortfall_bytes,
            # Store plan paths for execute_sync
            "_copy_paths": [str(p) for p in plan.files_to_copy],
            "_delete_paths": [str(p) for p in plan.files_to_delete],
        }

    def _rpc_execute_sync(self, params: dict):
        """Execute a previously computed sync plan."""
        _require(params, "source_paths")
        mount = self._sync_target()
        if not mount:
            raise ValueError("Connect a device (iPod) in the sidebar to sync to.")

        from core.models import SyncMode, SyncPlan, DeviceInfo
        from core.sync_engine import SyncEngine
        from core.sync_db import SyncDatabase

        source_paths = [Path(p) for p in params["source_paths"]]
        copy_paths = [Path(p) for p in params.get("copy_paths", [])]
        delete_paths = [Path(p) for p in params.get("delete_paths", [])]

        import shutil as _shutil
        usage = _shutil.disk_usage(str(mount))
        device_info = DeviceInfo(
            mount_point=mount,
            firmware=self._get_device_firmware(mount),
            total_bytes=usage.total,
            used_bytes=usage.used,
            free_bytes=usage.free,
        )

        sync_db = SyncDatabase(mount)
        engine = SyncEngine(device_info, sync_db)

        plan = SyncPlan(
            files_to_copy=copy_paths,
            files_to_delete=delete_paths,
            total_copy_bytes=sum(p.stat().st_size for p in copy_paths if p.exists()),
            total_delete_bytes=sum(p.stat().st_size for p in delete_paths if p.exists()),
            device_free_bytes=usage.free,
        )

        def progress(transfer_progress):
            self._notify("progress", {
                "op": "execute_sync",
                "current": transfer_progress.current_file_index,
                "total": transfer_progress.total_files,
                "message": f"Copying: {transfer_progress.current_file}",
            })

        result = engine.execute_plan(plan, source_paths, progress_callback=progress)
        sync_db.close()

        return {
            "files_copied": result.current_file_index,
            "bytes_copied": result.bytes_copied,
            "errors": result.errors,
        }

    def _get_device_firmware(self, mount: Path):
        """Quick firmware detection without full device scan."""
        from core.models import DeviceFirmware
        if (mount / ".rockbox").exists():
            return DeviceFirmware.ROCKBOX
        if (mount / "iPod_Control").exists():
            return DeviceFirmware.APPLE
        return DeviceFirmware.UNKNOWN

    def _sync_target(self):
        """The device to sync TO: the secondary iPod if connected, else the
        primary connection when it is itself a device (iPod-only setups)."""
        s = self._session
        if s.ipod_mount:
            return s.ipod_mount
        dm = s.device_mount
        if dm and ((dm / ".rockbox").exists() or (dm / "iPod_Control").exists()):
            return dm
        return None

    # ── Plex ────────────────────────────────────────────────────────

    def _rpc_plex_test_connection(self, params: dict):
        _require(params, "server_url", "token")
        from core.plex_client import PlexClient
        url = params["server_url"]
        token = params["token"]
        client = PlexClient(url, token)
        info = client.test_connection()
        with self._session._lock:
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

    def _rpc_plex_list_playlists(self, params: dict):
        """List audio playlists currently on the Plex server (for viewing)."""
        from core.plex_client import PlexClient
        from core.plex_config import load_plex_config
        config = load_plex_config()
        if not config.server_url or not config.token:
            raise ValueError("Plex is not configured")
        client = PlexClient(config.server_url, config.token)
        client.test_connection()
        return client.get_playlists()

    def _rpc_plex_present_paths(self, params: dict):
        """Return the device relative_paths that also exist on Plex — presence
        only, matched in memory (filename then artist+title), no per-file tag
        reads. Lets the Library tag each track's location."""
        from core.plex_client import PlexClient
        from core.plex_config import load_plex_config
        from core.utils import normalize_for_matching
        config = load_plex_config()
        if not config.server_url or not config.token:
            raise ValueError("Plex is not configured")
        client = PlexClient(config.server_url, config.token)
        client.test_connection()
        sections = client.get_music_sections()
        if not sections:
            return []
        section = sections[0]
        for s in sections:
            if s["key"] == config.last_section_key:
                section = s
                break
        all_plex = client.get_all_tracks(section["key"])
        file_lookup = client.build_file_lookup(all_plex)
        title_lookup = client.build_lookup(all_plex)

        present = []
        for dt in self._session.device_tracks:
            hit = None
            if dt.file_path:
                hit = file_lookup.get(os.path.basename(str(dt.file_path)).lower())
            if not hit:
                hit = file_lookup.get(os.path.basename(dt.relative_path).lower())
            if not hit:
                key = (normalize_for_matching(dt.artist), normalize_for_matching(dt.title))
                if title_lookup.get(key):
                    hit = True
            if hit:
                present.append(dt.relative_path)
        return present

    def _folder_basenames(self, path_str: str) -> set:
        """Lowercased audio-file basenames under a folder — no tag reads, fast."""
        from core.local_scanner import AUDIO_EXTENSIONS
        root = Path(path_str)
        names = set()
        if not root.exists():
            return names
        for dirpath, dirs, files in os.walk(root):
            dirs[:] = [d for d in dirs if not d.startswith(".")]
            for n in files:
                if not n.startswith(".") and Path(n).suffix.lower() in AUDIO_EXTENSIONS:
                    names.add(n.lower())
        return names

    def _plex_keys(self, progress=None) -> set:
        from core.plex_client import PlexClient
        from core.plex_config import load_plex_config
        from core.utils import normalize_for_matching
        cfg = load_plex_config()
        client = PlexClient(cfg.server_url, cfg.token)
        client.test_connection()
        sections = client.get_music_sections()
        if not sections:
            return set()
        section = sections[0]
        for s in sections:
            if s["key"] == cfg.last_section_key:
                section = s
                break
        return {(normalize_for_matching(t["artist"]), normalize_for_matching(t["title"]))
                for t in client.get_all_tracks(section["key"], progress)}

    def _spotify_keys(self, progress=None) -> set:
        from core.spotify_client import SpotifyClient
        from core.utils import normalize_for_matching
        _m, tracks = SpotifyClient().fetch_full_library(
            include_playlists=True, progress=progress or (lambda *a: None))
        return {(normalize_for_matching(getattr(t, "artist", "")),
                 normalize_for_matching(getattr(t, "title", "")))
                for t in tracks}

    def _rpc_pool_locations(self, params: dict):
        """Tag every current track by which sources hold it — master library,
        device, Plex, Spotify — pooled. Local sources match by filename (fast,
        no tag reads); Plex/Spotify by normalized artist+title. Source indexes
        are cached per session; pass refresh:true to rebuild them."""
        from core.utils import normalize_for_matching
        tracks = self._session.device_tracks
        mount = self._session.device_mount
        is_device = bool(mount and ((mount / ".rockbox").exists() or (mount / "iPod_Control").exists()))
        refresh = bool(params.get("refresh"))

        track_base, track_key, all_paths = {}, {}, []
        for dt in tracks:
            track_base[dt.relative_path] = os.path.basename(dt.relative_path).lower()
            track_key[dt.relative_path] = (normalize_for_matching(dt.artist),
                                           normalize_for_matching(dt.title))
            all_paths.append(dt.relative_path)

        def cached(name, builder):
            if not refresh and name in self._src_cache:
                return self._src_cache[name]
            val = builder()
            self._src_cache[name] = val
            return val

        def note(msg, cur=0, total=1):
            self._notify("progress", {"op": "pool_locations", "current": cur, "total": total, "message": msg})

        result = {}

        # Library — master library folder (filename match), or all when the
        # connected target already IS a local library.
        from core.app_config import load_app_config
        acfg = load_app_config()
        if not is_device:
            result["lib"] = {"available": True, "paths": all_paths}
        elif acfg.master_library_path:
            note("Scanning master library...")
            lib_names = cached("lib:" + acfg.master_library_path,
                               lambda: self._folder_basenames(acfg.master_library_path))
            result["lib"] = {"available": True,
                             "paths": [p for p in all_paths if track_base[p] in lib_names]}
        else:
            result["lib"] = {"available": False, "paths": []}

        # Device — current target, else the last-scanned device's cached index.
        if is_device:
            result["dev"] = {"available": True, "paths": all_paths}
        else:
            from core.location_cache import load_device_index
            idx = load_device_index()
            if idx:
                result["dev"] = {"available": True, "label": idx["label"],
                                 "paths": [p for p in all_paths if track_base[p] in idx["names"]]}
            else:
                result["dev"] = {"available": False, "paths": []}

        # Plex.
        from core.plex_config import load_plex_config
        pcfg = load_plex_config()
        if pcfg.server_url and pcfg.token:
            try:
                note("Indexing Plex...")
                plex_keys = cached("plex", lambda: self._plex_keys(
                    lambda i, t: note(f"Indexing Plex... {i}/{t}", i, t or 1)))
                result["plex"] = {"available": True,
                                  "paths": [p for p in all_paths if track_key[p] in plex_keys]}
            except Exception as e:
                result["plex"] = {"available": False, "paths": [], "error": str(e)}
        else:
            result["plex"] = {"available": False, "paths": []}

        # Spotify.
        from core.spotify_config import load_spotify_config
        scfg = load_spotify_config()
        if scfg.refresh_token:
            try:
                note("Indexing Spotify...")
                spot_keys = cached("spotify", lambda: self._spotify_keys(
                    lambda cur, total, label: note(f"Indexing Spotify... {label}", cur, total or 1)))
                result["spotify"] = {"available": True,
                                     "paths": [p for p in all_paths if track_key[p] in spot_keys]}
            except Exception as e:
                result["spotify"] = {"available": False, "paths": [], "error": str(e)}
        else:
            result["spotify"] = {"available": False, "paths": []}

        note("Done", 1, 1)
        return result

    def _rpc_clear_source_cache(self, params: dict):
        """Drop cached source indexes so the next pool re-fetches them."""
        self._src_cache = {}
        return {"ok": True}

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

    # ── Plex Metadata Sync (Pull) ─────────────────────────────────────

    def _rpc_plex_metadata_diff(self, params: dict):
        """Compare Plex metadata against device file tags.

        Returns a list of diffs: each has the device track info, what Plex says,
        and which fields differ. Does NOT modify anything.
        """
        from core.plex_client import PlexClient
        from core.plex_config import load_plex_config
        from core.utils import normalize_for_matching
        import music_tag

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

        self._notify("progress", {
            "op": "plex_metadata_diff",
            "current": 0, "total": 1,
            "message": "Loading Plex library...",
        })

        def fetch_progress(i, total):
            self._notify("progress", {
                "op": "plex_metadata_diff",
                "current": i, "total": total,
                "message": f"Indexing Plex tracks... {i}/{total}",
            })

        plex_tracks = client.get_all_tracks_detailed(section["key"], fetch_progress)
        file_lookup = client.build_file_lookup(plex_tracks)
        title_lookup = {}
        for t in plex_tracks:
            key = (normalize_for_matching(t["artist"]),
                   normalize_for_matching(t["title"]))
            title_lookup.setdefault(key, []).append(t)

        device_tracks = self._session.device_tracks
        total = len(device_tracks)
        diffs = []
        matched_count = 0
        unchanged_count = 0

        for idx, dt in enumerate(device_tracks):
            if idx % 50 == 0:
                self._notify("progress", {
                    "op": "plex_metadata_diff",
                    "current": idx, "total": total,
                    "message": f"Comparing metadata... {idx}/{total}",
                })

            # Match device track to Plex track
            plex_track = None
            basename = os.path.basename(str(dt.file_path)).lower()
            plex_track = file_lookup.get(basename)
            if not plex_track:
                basename = os.path.basename(dt.relative_path).lower()
                plex_track = file_lookup.get(basename)
            if not plex_track:
                key = (normalize_for_matching(dt.artist),
                       normalize_for_matching(dt.title))
                hits = title_lookup.get(key)
                if hits:
                    plex_track = hits[0]

            if not plex_track:
                continue

            matched_count += 1

            # Read current device file tags
            try:
                file_path = self._resolve_device_path(dt.relative_path)
                tag = music_tag.load_file(str(file_path))
            except Exception:
                continue

            # Compare fields
            field_diffs = []
            comparisons = [
                ("title", str(tag["title"] or ""), plex_track.get("title", "")),
                ("artist", str(tag["artist"] or ""), plex_track.get("artist", "")),
                ("album", str(tag["album"] or ""), plex_track.get("album", "")),
                ("albumartist", str(tag["albumartist"] or ""), plex_track.get("albumArtist", "")),
                ("genre", str(tag["genre"] or ""), plex_track.get("genre", "")),
            ]

            # Year comparison
            device_year = None
            try:
                y = tag["year"]
                if y:
                    device_year = int(y.value) if hasattr(y, 'value') else int(y)
            except (ValueError, TypeError):
                pass
            plex_year = plex_track.get("year")
            if plex_year and device_year != plex_year:
                field_diffs.append({
                    "field": "year",
                    "device_value": str(device_year) if device_year else "",
                    "plex_value": str(plex_year),
                })

            # Track number
            device_tracknum = None
            try:
                tn = tag["tracknumber"]
                if tn:
                    device_tracknum = int(tn.value) if hasattr(tn, 'value') else int(tn)
            except (ValueError, TypeError):
                pass
            plex_tracknum = plex_track.get("trackNumber")
            if plex_tracknum and device_tracknum != plex_tracknum:
                field_diffs.append({
                    "field": "track_number",
                    "device_value": str(device_tracknum) if device_tracknum else "",
                    "plex_value": str(plex_tracknum),
                })

            # Disc number
            device_discnum = None
            try:
                dn = tag["discnumber"]
                if dn:
                    device_discnum = int(dn.value) if hasattr(dn, 'value') else int(dn)
            except (ValueError, TypeError):
                pass
            plex_discnum = plex_track.get("discNumber")
            if plex_discnum and device_discnum != plex_discnum:
                field_diffs.append({
                    "field": "disc_number",
                    "device_value": str(device_discnum) if device_discnum else "",
                    "plex_value": str(plex_discnum),
                })

            # String fields
            for field_name, device_val, plex_val in comparisons:
                if not plex_val:
                    continue
                if device_val.strip().lower() != plex_val.strip().lower():
                    field_diffs.append({
                        "field": field_name,
                        "device_value": device_val,
                        "plex_value": plex_val,
                    })

            # Check artwork
            has_device_art = False
            try:
                artwork = tag["artwork"]
                if artwork and artwork.first:
                    has_device_art = True
            except Exception:
                pass
            has_plex_art = bool(plex_track.get("thumb"))
            if has_plex_art and not has_device_art:
                field_diffs.append({
                    "field": "artwork",
                    "device_value": "none",
                    "plex_value": "available",
                })

            if field_diffs:
                diffs.append({
                    "path": dt.relative_path,
                    "title": dt.title,
                    "artist": dt.artist,
                    "album": dt.album or "",
                    "plex_rating_key": plex_track["ratingKey"],
                    "fields": field_diffs,
                })
            else:
                unchanged_count += 1

        self._notify("progress", {
            "op": "plex_metadata_diff",
            "current": total, "total": total,
            "message": "Done",
        })

        return {
            "total_device_tracks": total,
            "matched_to_plex": matched_count,
            "tracks_with_diffs": len(diffs),
            "tracks_unchanged": unchanged_count,
            "unmatched": total - matched_count,
            "diffs": diffs,
        }

    def _rpc_plex_pull_metadata(self, params: dict):
        """Apply Plex metadata to device files.

        Expects params.tracks: list of {path, fields} where fields is list of
        field names to update. If fields is omitted, updates all differing fields.
        Optionally params.pull_artwork: bool to also download and apply artwork.
        """
        from core.plex_client import PlexClient
        from core.plex_config import load_plex_config
        from core.utils import normalize_for_matching
        import music_tag
        import base64

        tracks_to_update = params.get("tracks", [])
        pull_artwork = params.get("pull_artwork", False)

        if not tracks_to_update:
            raise ValueError("No tracks specified")

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

        self._notify("progress", {
            "op": "plex_pull_metadata",
            "current": 0, "total": 1,
            "message": "Loading Plex library...",
        })

        plex_tracks = client.get_all_tracks_detailed(section["key"])
        file_lookup = client.build_file_lookup(plex_tracks)
        title_lookup = {}
        for t in plex_tracks:
            key = (normalize_for_matching(t["artist"]),
                   normalize_for_matching(t["title"]))
            title_lookup.setdefault(key, []).append(t)

        dt_by_path = {}
        for dt in self._session.device_tracks:
            dt_by_path[dt.relative_path] = dt

        total = len(tracks_to_update)
        updated = 0
        errors = []
        field_map = {
            "title": "title",
            "artist": "artist",
            "album": "album",
            "albumartist": "albumartist",
            "genre": "genre",
            "year": "year",
            "track_number": "tracknumber",
            "disc_number": "discnumber",
        }

        plex_field_map = {
            "title": "title",
            "artist": "artist",
            "album": "album",
            "albumartist": "albumArtist",
            "genre": "genre",
            "year": "year",
            "track_number": "trackNumber",
            "disc_number": "discNumber",
        }

        for idx, item in enumerate(tracks_to_update):
            path = item.get("path", "")
            fields_to_apply = item.get("fields")  # None = all

            self._notify("progress", {
                "op": "plex_pull_metadata",
                "current": idx, "total": total,
                "message": f"Updating {os.path.basename(path)}...",
            })

            # Find plex track
            dt = dt_by_path.get(path)
            if not dt:
                errors.append(f"Track not found on device: {path}")
                continue

            plex_track = None
            basename = os.path.basename(str(dt.file_path)).lower()
            plex_track = file_lookup.get(basename)
            if not plex_track:
                basename = os.path.basename(path).lower()
                plex_track = file_lookup.get(basename)
            if not plex_track:
                key = (normalize_for_matching(dt.artist),
                       normalize_for_matching(dt.title))
                hits = title_lookup.get(key)
                if hits:
                    plex_track = hits[0]

            if not plex_track:
                errors.append(f"No Plex match for: {dt.artist} - {dt.title}")
                continue

            try:
                file_path = self._resolve_device_path(path)
                tag = music_tag.load_file(str(file_path))
            except Exception as e:
                errors.append(f"Cannot open {path}: {e}")
                continue

            # Apply metadata fields
            try:
                for field_name, tag_key in field_map.items():
                    if fields_to_apply and field_name not in fields_to_apply:
                        continue
                    plex_key = plex_field_map[field_name]
                    plex_val = plex_track.get(plex_key)
                    if plex_val is not None:
                        tag[tag_key] = plex_val

                # Apply artwork if requested
                if pull_artwork:
                    thumb = plex_track.get("thumb", "")
                    if thumb:
                        art_bytes = client.get_track_artwork(thumb)
                        if art_bytes:
                            tag["artwork"] = art_bytes

                tag.save()
                updated += 1

                # Update in-memory track
                with self._session._lock:
                    if "title" in (fields_to_apply or plex_field_map):
                        if plex_track.get("title"):
                            dt.title = plex_track["title"]
                    if "artist" in (fields_to_apply or plex_field_map):
                        if plex_track.get("artist"):
                            dt.artist = plex_track["artist"]
                    if "album" in (fields_to_apply or plex_field_map):
                        if plex_track.get("album"):
                            dt.album = plex_track["album"]

            except Exception as e:
                errors.append(f"Failed to write {path}: {e}")

        self._notify("progress", {
            "op": "plex_pull_metadata",
            "current": total, "total": total,
            "message": "Done",
        })

        return {
            "updated": updated,
            "errors": errors,
            "total": total,
        }

    def _rpc_library_health_check(self, params: dict):
        """Scan device library and report health issues.

        Returns categorized issues: missing_tags, no_artwork, inconsistent_albums,
        unnamed_tracks, broken_files.
        """
        import music_tag
        from core.utils import normalize_for_matching

        device_tracks = self._session.device_tracks
        if not device_tracks:
            # Auto-scan if a library is connected but tracks not yet loaded
            if self._session.device_mount:
                library = self._session.get_rockbox_library()
                if library:
                    self._notify("progress", {
                        "op": "library_health_check",
                        "current": 0, "total": 1,
                        "message": "Scanning library...",
                    })
                    tracks = library.scan_music()
                    with self._session._lock:
                        self._session.device_tracks = tracks
                    device_tracks = tracks
        if not device_tracks:
            raise ValueError("No device connected or library not scanned")

        total = len(device_tracks)
        missing_title = []
        missing_artist = []
        missing_album = []
        no_artwork = []
        broken_files = []
        inconsistent_albums = {}  # album_name → set of album artists

        for idx, dt in enumerate(device_tracks):
            if idx % 50 == 0:
                self._notify("progress", {
                    "op": "library_health_check",
                    "current": idx, "total": total,
                    "message": f"Checking tracks... {idx}/{total}",
                })

            # Basic tag presence checks from in-memory data
            if not dt.title or dt.title.strip() == "":
                missing_title.append({
                    "path": dt.relative_path,
                    "filename": os.path.basename(dt.relative_path),
                })

            if not dt.artist or dt.artist.strip() == "":
                missing_artist.append({
                    "path": dt.relative_path,
                    "title": dt.title,
                    "filename": os.path.basename(dt.relative_path),
                })

            if not dt.album or dt.album.strip() == "":
                missing_album.append({
                    "path": dt.relative_path,
                    "title": dt.title,
                    "artist": dt.artist,
                })

            # Track album artist consistency
            if dt.album:
                album_key = normalize_for_matching(dt.album)
                if album_key:
                    if album_key not in inconsistent_albums:
                        inconsistent_albums[album_key] = {
                            "album": dt.album,
                            "artists": set(),
                            "paths": [],
                        }
                    if dt.artist:
                        inconsistent_albums[album_key]["artists"].add(dt.artist)
                    inconsistent_albums[album_key]["paths"].append(dt.relative_path)

            # Check artwork (only sample — full check is slow)
            if idx < 200 or idx % 5 == 0:
                try:
                    file_path = self._resolve_device_path(dt.relative_path)
                    tag = music_tag.load_file(str(file_path))
                    artwork = tag["artwork"]
                    if not artwork or not artwork.first:
                        no_artwork.append({
                            "path": dt.relative_path,
                            "title": dt.title,
                            "artist": dt.artist,
                            "album": dt.album or "",
                        })
                except Exception:
                    broken_files.append({
                        "path": dt.relative_path,
                        "title": dt.title or os.path.basename(dt.relative_path),
                        "error": "Cannot read file tags",
                    })

        # Filter inconsistent albums (only where multiple different artists claim same album)
        album_issues = []
        for album_key, info in inconsistent_albums.items():
            if len(info["artists"]) > 2:  # More than 2 different artists for same album = suspicious
                album_issues.append({
                    "album": info["album"],
                    "artists": list(info["artists"])[:10],
                    "track_count": len(info["paths"]),
                })

        self._notify("progress", {
            "op": "library_health_check",
            "current": total, "total": total,
            "message": "Done",
        })

        return {
            "total_tracks": total,
            "issues": {
                "missing_title": missing_title,
                "missing_artist": missing_artist,
                "missing_album": missing_album,
                "no_artwork": no_artwork[:100],  # Cap at 100
                "broken_files": broken_files,
                "inconsistent_albums": album_issues[:50],
            },
            "summary": {
                "missing_title": len(missing_title),
                "missing_artist": len(missing_artist),
                "missing_album": len(missing_album),
                "no_artwork": len(no_artwork),
                "broken_files": len(broken_files),
                "inconsistent_albums": len(album_issues),
            },
        }

    # ── Duplicates ──────────────────────────────────────────────────

    def _rpc_find_duplicates(self, params: dict):
        from core.utils import normalize_for_matching

        device_tracks = self._session.device_tracks
        if not device_tracks:
            # Auto-scan if a library is connected but tracks not yet loaded
            if self._session.device_mount:
                library = self._session.get_rockbox_library()
                if library:
                    tracks = library.scan_music()
                    with self._session._lock:
                        self._session.device_tracks = tracks
                    device_tracks = tracks
        if not device_tracks:
            raise ValueError("No device connected or library not scanned")

        groups = {}
        for dt in device_tracks:
            artist_key = normalize_for_matching(dt.artist) if dt.artist else ""
            title_key = normalize_for_matching(dt.title) if dt.title else ""
            if not artist_key and not title_key:
                continue
            key = (artist_key, title_key)
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

    def _rpc_delete_files(self, params: dict):
        """Delete files from the device. Moves to .trash for undo support."""
        _require(params, "paths")
        paths = params["paths"]
        if not paths:
            raise ValueError("No file paths provided")
        if not self._session.device_mount:
            raise ValueError("No device connected")

        mount = self._session.device_mount
        trash_dir = mount / ".trash"
        trash_dir.mkdir(exist_ok=True)

        deleted = []
        errors = []
        trashed_files = []

        for p in paths:
            file_path = Path(p) if Path(p).is_absolute() else mount / p
            if not file_path.exists():
                errors.append(f"File not found: {p}")
                continue
            # Safety: only delete files under the device mount
            try:
                file_path.resolve().relative_to(mount.resolve())
            except ValueError:
                errors.append(f"File is not on device: {p}")
                continue

            try:
                # Move to trash instead of permanent delete
                trash_dest = trash_dir / file_path.name
                # Handle name collisions in trash
                counter = 1
                while trash_dest.exists():
                    stem = file_path.stem
                    trash_dest = trash_dir / f"{stem}_{counter}{file_path.suffix}"
                    counter += 1
                shutil.move(str(file_path), str(trash_dest))
                deleted.append(p)
                trashed_files.append({
                    "original": str(file_path),
                    "trash": str(trash_dest),
                })
            except OSError as e:
                errors.append(f"Failed to delete {file_path.name}: {e}")

        # Record for undo
        if trashed_files:
            self._session.record_action({
                "type": "delete_files",
                "files": trashed_files,
                "timestamp": time.time(),
            })

        # Update in-memory track list
        deleted_set = set(deleted)
        with self._session._lock:
            self._session.device_tracks = [
                dt for dt in self._session.device_tracks
                if str(dt.file_path) not in deleted_set
                and dt.relative_path not in deleted_set
            ]

        return {"deleted": len(deleted), "errors": errors}

    def _rpc_undo_last(self, params: dict):
        """Undo the last reversible action."""
        action = self._session.pop_last_action()
        if not action:
            raise ValueError("Nothing to undo")

        if action["type"] == "delete_files":
            restored = []
            errors = []
            for entry in action["files"]:
                trash_path = Path(entry["trash"])
                original_path = Path(entry["original"])
                if not trash_path.exists():
                    errors.append(f"Trash file missing: {trash_path.name}")
                    continue
                try:
                    original_path.parent.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(trash_path), str(original_path))
                    restored.append(str(original_path))
                except OSError as e:
                    errors.append(f"Failed to restore {original_path.name}: {e}")
            return {"action": "delete_files", "restored": len(restored), "errors": errors}

        raise ValueError(f"Cannot undo action type: {action['type']}")

    def _rpc_get_undo_history(self, params: dict):
        """Return the list of undoable actions."""
        history = self._session.get_action_history()
        return [{
            "type": a["type"],
            "timestamp": a["timestamp"],
            "detail": (f"{len(a['files'])} files" if a["type"] == "delete_files"
                       else str(a)),
        } for a in history]

    def _rpc_empty_trash(self, params: dict):
        """Permanently delete all files in device trash."""
        if not self._session.device_mount:
            raise ValueError("No device connected")
        trash_dir = self._session.device_mount / ".trash"
        if not trash_dir.exists():
            return {"deleted": 0}
        count = 0
        for f in trash_dir.iterdir():
            try:
                if f.is_file():
                    f.unlink()
                    count += 1
            except OSError:
                pass
        return {"deleted": count}

    # ── Music Manager: Track Metadata ──────────────────────────────

    def _rpc_get_track_metadata(self, params: dict):
        """Get full metadata for a single track, including album art info."""
        _require(params, "path")
        file_path = self._resolve_device_path(params["path"])

        import music_tag
        try:
            tag = music_tag.load_file(str(file_path))
        except Exception as e:
            raise ValueError(f"Cannot read metadata: {e}")

        artwork = tag["artwork"]
        has_art = False
        art_mime = ""
        if artwork and artwork.first:
            has_art = True
            raw = artwork.first
            if hasattr(raw, 'mime') and raw.mime:
                art_mime = raw.mime
            elif hasattr(raw, 'data'):
                data = raw.data if isinstance(raw.data, bytes) else bytes(raw.data)
                if data[:3] == b'\xff\xd8\xff':
                    art_mime = "image/jpeg"
                elif data[:8] == b'\x89PNG\r\n\x1a\n':
                    art_mime = "image/png"

        return {
            "path": str(file_path),
            "title": str(tag["title"] or ""),
            "artist": str(tag["artist"] or ""),
            "album": str(tag["album"] or ""),
            "albumartist": str(tag["albumartist"] or ""),
            "track_number": int(tag["tracknumber"] or 0) if tag["tracknumber"] else None,
            "disc_number": int(tag["discnumber"] or 0) if tag["discnumber"] else None,
            "year": int(tag["year"] or 0) if tag["year"] else None,
            "genre": str(tag["genre"] or ""),
            "comment": str(tag["comment"] or ""),
            "has_artwork": has_art,
            "artwork_mime": art_mime,
        }

    def _rpc_set_track_metadata(self, params: dict):
        """Update metadata fields on a track file."""
        _require(params, "path", "metadata")
        file_path = self._resolve_device_path(params["path"])
        meta = params["metadata"]

        import music_tag
        try:
            tag = music_tag.load_file(str(file_path))
        except Exception as e:
            raise ValueError(f"Cannot open file for editing: {e}")

        field_map = {
            "title": "title",
            "artist": "artist",
            "album": "album",
            "albumartist": "albumartist",
            "track_number": "tracknumber",
            "disc_number": "discnumber",
            "year": "year",
            "genre": "genre",
            "comment": "comment",
        }

        for key, tag_key in field_map.items():
            if key in meta:
                tag[tag_key] = meta[key]

        tag.save()

        # Update in-memory track list
        with self._session._lock:
            for dt in self._session.device_tracks:
                if str(dt.file_path) == str(file_path) or dt.relative_path == params["path"]:
                    if "title" in meta:
                        dt.title = meta["title"]
                    if "artist" in meta:
                        dt.artist = meta["artist"]
                    if "album" in meta:
                        dt.album = meta["album"]
                    if "track_number" in meta:
                        dt.track_number = meta["track_number"]
                    break

        return {"ok": True}

    def _rpc_get_album_art(self, params: dict):
        """Get album art as base64-encoded data.

        Never raises on unreadable/malformed files — a tag Grapefruit can't
        parse (e.g. a corrupt MP4 freeform atom) just reports no artwork, so
        the album grid falls back to its placeholder instead of erroring.
        """
        _require(params, "path")
        import base64
        file_path = self._resolve_device_path(params["path"])

        import music_tag
        try:
            tag = music_tag.load_file(str(file_path))
            artwork = tag["artwork"]
            if not artwork or not artwork.first:
                return {"has_artwork": False}
            raw = artwork.first
            data = raw.data if isinstance(raw.data, bytes) else bytes(raw.data)
        except Exception:
            return {"has_artwork": False}

        mime = "image/jpeg"
        if data[:8] == b'\x89PNG\r\n\x1a\n':
            mime = "image/png"

        return {
            "has_artwork": True,
            "mime": mime,
            "data": base64.b64encode(data).decode("ascii"),
        }

    def _rpc_set_album_art(self, params: dict):
        """Set album art from base64-encoded data."""
        _require(params, "path", "data")
        import base64
        file_path = self._resolve_device_path(params["path"])

        import music_tag
        try:
            tag = music_tag.load_file(str(file_path))
        except Exception as e:
            raise ValueError(f"Cannot open file for editing: {e}")

        art_data = base64.b64decode(params["data"])
        tag["artwork"] = art_data
        tag.save()

        return {"ok": True}

    def _rpc_remove_album_art(self, params: dict):
        """Remove album art from a track."""
        _require(params, "path")
        file_path = self._resolve_device_path(params["path"])

        import music_tag
        try:
            tag = music_tag.load_file(str(file_path))
        except Exception as e:
            raise ValueError(f"Cannot open file: {e}")

        tag["artwork"] = None
        tag.save()
        return {"ok": True}

    # ── Music Manager: File Operations ─────────────────────────────

    def _rpc_add_files_to_device(self, params: dict):
        """Copy local files to the device."""
        _require(params, "files")
        if not self._session.device_mount:
            raise ValueError("No device connected")

        mount = self._session.device_mount
        files = params["files"]
        dest_folder = params.get("dest_folder", "Music")

        dest_dir = mount / dest_folder
        dest_dir.mkdir(parents=True, exist_ok=True)

        from core.file_copier import FileCopier
        copier = FileCopier()

        copied = []
        errors = []
        total = len(files)

        for i, src_path_str in enumerate(files):
            src = Path(src_path_str)
            if not src.exists():
                errors.append(f"File not found: {src_path_str}")
                continue

            if src.is_dir():
                # Copy entire directory preserving structure
                for root, dirs, dir_files in os.walk(src):
                    dirs[:] = [d for d in dirs if not d.startswith(".")]
                    for f in dir_files:
                        if f.startswith("."):
                            continue
                        fp = Path(root) / f
                        rel = fp.relative_to(src)
                        dst = dest_dir / src.name / rel
                        dst.parent.mkdir(parents=True, exist_ok=True)
                        if copier.copy_with_progress(fp, dst):
                            copied.append(str(dst))
                        else:
                            errors.append(f"Failed to copy: {f}")
            else:
                dst = dest_dir / src.name
                # Handle name collisions
                counter = 1
                while dst.exists():
                    dst = dest_dir / f"{src.stem}_{counter}{src.suffix}"
                    counter += 1

                if copier.copy_with_progress(src, dst):
                    copied.append(str(dst))
                else:
                    errors.append(f"Failed to copy: {src.name}")

            self._notify("progress", {
                "op": "add_files",
                "current": i + 1,
                "total": total,
            })

        return {"copied": len(copied), "errors": errors}

    def _rpc_move_track(self, params: dict):
        """Move a track to a different folder on the device."""
        _require(params, "path", "dest_folder")
        if not self._session.device_mount:
            raise ValueError("No device connected")

        mount = self._session.device_mount
        file_path = self._resolve_device_path(params["path"])
        dest_dir = mount / params["dest_folder"]
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest_path = dest_dir / file_path.name

        try:
            shutil.move(str(file_path), str(dest_path))
        except OSError as e:
            raise ValueError(f"Move failed: {e}")

        # Update in-memory track
        new_rel = str(dest_path.relative_to(mount))
        with self._session._lock:
            for dt in self._session.device_tracks:
                if str(dt.file_path) == str(file_path):
                    dt.file_path = dest_path
                    dt.relative_path = new_rel
                    break

        return {"ok": True, "new_path": new_rel}

    def _rpc_get_device_folders(self, params: dict):
        """List folders on the device that contain music."""
        if not self._session.device_mount:
            raise ValueError("No device connected")

        mount = self._session.device_mount
        folders = set()
        for dt in self._session.device_tracks:
            parent = str(Path(dt.relative_path).parent)
            if parent and parent != ".":
                folders.add(parent)

        return sorted(folders)

    # ── Library Stats ──────────────────────────────────────────────

    def _rpc_get_library_stats(self, params: dict):
        """Return aggregate statistics about the currently loaded library."""
        if not self._session.device_tracks:
            raise ValueError("No tracks loaded — scan a device library first")

        tracks = self._session.device_tracks
        total_tracks = len(tracks)
        total_size = sum(t.file_size for t in tracks)
        total_duration = sum(
            t.duration_seconds for t in tracks if t.duration_seconds is not None
        )

        albums = set()
        artists = set()
        formats: dict[str, int] = {}
        artist_counts: dict[str, int] = {}

        for t in tracks:
            if t.album:
                albums.add(t.album)
            if t.artist:
                artists.add(t.artist)
                artist_counts[t.artist] = artist_counts.get(t.artist, 0) + 1
            if t.format:
                ext = t.format.lstrip(".").lower()
                formats[ext] = formats.get(ext, 0) + 1

        # Top 10 artists by track count
        sorted_artists = sorted(
            artist_counts.items(), key=lambda x: x[1], reverse=True
        )
        top_artists = [
            {"name": name, "count": count} for name, count in sorted_artists[:10]
        ]

        return {
            "total_tracks": total_tracks,
            "total_size": total_size,
            "total_duration": total_duration,
            "total_albums": len(albums),
            "total_artists": len(artists),
            "formats": formats,
            "genres": {},
            "top_artists": top_artists,
        }

    # ── Auto Organize ──────────────────────────────────────────────

    def _rpc_auto_organize(self, params: dict):
        """Reorganize music files into Artist/Album/Track folder structure."""
        import re

        if not self._session.device_mount:
            raise ValueError("No device connected")
        if not self._session.device_tracks:
            raise ValueError("No tracks loaded — scan a device library first")

        pattern = params.get("pattern", "artist/album")
        dry_run = params.get("dry_run", False)
        mount = self._session.device_mount

        # Determine the music root directory
        music_root = mount / "Music"
        if not music_root.exists():
            music_root = mount

        def sanitize(name: str) -> str:
            """Sanitize a name for use as a filesystem component."""
            if not name:
                return "Unknown"
            return re.sub(r'[/:*?"<>|\\]', "_", name).strip().rstrip(".")

        moves = []
        skipped = 0
        total = len(self._session.device_tracks)

        for t in self._session.device_tracks:
            if not t.file_path or not Path(t.file_path).exists():
                skipped += 1
                continue

            src = Path(t.file_path)
            filename = src.name
            artist = sanitize(t.artist or "Unknown Artist")
            album = sanitize(t.album or "Unknown Album")

            if pattern == "artist/album":
                target = music_root / artist / album / filename
            elif pattern == "artist":
                target = music_root / artist / filename
            elif pattern == "album/artist":
                target = music_root / album / artist / filename
            else:
                raise ValueError(
                    f"Unsupported pattern: {pattern}. "
                    "Use: artist/album, artist, or album/artist"
                )

            # Skip if already at target location
            try:
                if src.resolve() == target.resolve():
                    skipped += 1
                    continue
            except (OSError, ValueError):
                skipped += 1
                continue

            moves.append({"from": str(src), "to": str(target)})

        if dry_run:
            return {
                "moves": moves,
                "skipped": skipped,
                "total": total,
            }

        # Execute moves
        moved = 0
        errors = []
        empty_dirs = set()

        for i, move in enumerate(moves):
            src = Path(move["from"])
            dst = Path(move["to"])
            try:
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(src), str(dst))
                moved += 1

                # Track the source directory for cleanup
                empty_dirs.add(src.parent)

                # Update in-memory track
                with self._session._lock:
                    for dt in self._session.device_tracks:
                        if str(dt.file_path) == move["from"]:
                            dt.file_path = dst
                            try:
                                dt.relative_path = str(dst.relative_to(mount))
                            except ValueError:
                                dt.relative_path = str(dst)
                            break
            except OSError as e:
                errors.append(f"Failed to move {src.name}: {e}")

            if (i + 1) % 10 == 0 or i == len(moves) - 1:
                self._notify("progress", {
                    "op": "auto_organize",
                    "current": i + 1,
                    "total": len(moves),
                })

        # Clean up empty directories (bottom-up)
        dirs_to_check = sorted(empty_dirs, key=lambda d: len(d.parts), reverse=True)
        for d in dirs_to_check:
            try:
                while d != mount and d.exists() and not any(d.iterdir()):
                    d.rmdir()
                    d = d.parent
            except OSError:
                pass

        return {
            "moved": moved,
            "skipped": skipped,
            "errors": errors,
            "total": total,
        }

    # ── Bulk Set Metadata ──────────────────────────────────────────

    def _rpc_bulk_set_metadata(self, params: dict):
        """Edit metadata on multiple tracks at once."""
        _require(params, "paths", "metadata")
        paths = params["paths"]
        metadata = params["metadata"]

        if not paths:
            raise ValueError("No file paths provided")
        if not metadata:
            raise ValueError("No metadata fields provided")

        import music_tag

        field_map = {
            "title": "title",
            "artist": "artist",
            "album": "album",
            "albumartist": "albumartist",
            "genre": "genre",
            "year": "year",
            "track_number": "tracknumber",
            "disc_number": "discnumber",
        }

        # Filter to only fields that are present and not None
        fields_to_set = {
            k: v for k, v in metadata.items()
            if k in field_map and v is not None
        }

        if not fields_to_set:
            return {"updated": 0, "errors": []}

        updated = 0
        errors = []

        for path_str in paths:
            try:
                file_path = self._resolve_device_path(path_str)
                tag = music_tag.load_file(str(file_path))

                for key, value in fields_to_set.items():
                    tag[field_map[key]] = value

                tag.save()
                updated += 1

                # Update in-memory track list
                with self._session._lock:
                    for dt in self._session.device_tracks:
                        if (str(dt.file_path) == str(file_path)
                                or dt.relative_path == path_str):
                            if "title" in fields_to_set:
                                dt.title = fields_to_set["title"]
                            if "artist" in fields_to_set:
                                dt.artist = fields_to_set["artist"]
                            if "album" in fields_to_set:
                                dt.album = fields_to_set["album"]
                            if "track_number" in fields_to_set:
                                dt.track_number = fields_to_set["track_number"]
                            break
            except Exception as e:
                errors.append({"path": path_str, "error": str(e)})

        return {"updated": updated, "errors": errors}

    # ── Cancel Sync ────────────────────────────────────────────────

    def _rpc_cancel_sync(self, params: dict):
        """Cancel a running sync operation."""
        engine = self._session.sync_engine
        if engine is None:
            return {"ok": True, "message": "No sync in progress"}
        try:
            engine.cancel()
        except Exception:
            pass
        return {"ok": True}

    # ── Import iTunes XML ──────────────────────────────────────────

    def _rpc_import_itunes_xml(self, params: dict):
        """Import playlists from an iTunes/Apple Music Library.xml file."""
        _require(params, "xml_path")
        xml_path = Path(params["xml_path"])

        if not xml_path.exists():
            raise ValueError(f"XML file not found: {xml_path}")

        from core.library_xml_parser import LibraryXMLParser, LibraryXMLError

        parser = LibraryXMLParser()

        try:
            playlist_names = parser.get_playlist_names(xml_path)
        except LibraryXMLError as e:
            raise ValueError(str(e))

        playlists = []
        for name in playlist_names:
            try:
                metadata, tracks = parser.parse_single_playlist(xml_path, name)
                playlists.append({
                    "name": name,
                    "track_count": len(tracks),
                    "tracks": [
                        {
                            "title": t.title,
                            "artist": t.artist,
                            "album": t.album,
                        }
                        for t in tracks
                    ],
                })
            except LibraryXMLError:
                # Skip playlists that fail to parse
                continue

        return {"playlists": playlists}

    # ── Folder Tree ────────────────────────────────────────────────

    def _rpc_get_folder_tree(self, params: dict):
        """Get the folder structure of the device for browsing."""
        if not self._session.device_mount:
            raise ValueError("No device connected")

        from core.local_scanner import AUDIO_EXTENSIONS

        mount = self._session.device_mount
        root_param = params.get("root", "")

        if root_param:
            browse_path = Path(root_param)
            if not browse_path.is_absolute():
                browse_path = mount / root_param
        else:
            browse_path = mount

        if not browse_path.exists():
            raise ValueError(f"Path does not exist: {browse_path}")
        if not browse_path.is_dir():
            raise ValueError(f"Path is not a directory: {browse_path}")

        # Safety: only allow browsing within the device mount
        try:
            browse_path.resolve().relative_to(mount.resolve())
        except ValueError:
            raise ValueError("Cannot browse outside of device mount")

        folders = []
        files = []

        try:
            for entry in sorted(browse_path.iterdir(), key=lambda e: e.name.lower()):
                # Skip hidden files/directories
                if entry.name.startswith("."):
                    continue

                if entry.is_dir():
                    folders.append({
                        "name": entry.name,
                        "path": str(entry),
                    })
                elif entry.is_file() and entry.suffix.lower() in AUDIO_EXTENSIONS:
                    try:
                        size = entry.stat().st_size
                    except OSError:
                        size = 0
                    files.append({
                        "name": entry.name,
                        "path": str(entry),
                        "size": size,
                    })
        except PermissionError:
            raise ValueError(f"Permission denied: {browse_path}")

        return {
            "path": str(browse_path),
            "folders": folders,
            "files": files,
        }

    # ── Spotify (OAuth full-library) ────────────────────────────────

    def _rpc_spotify_get_status(self, params: dict):
        from core.spotify_config import load_spotify_config
        config = load_spotify_config()
        return {
            "configured": bool(config.client_id),
            "connected": bool(config.refresh_token),
            "client_id": config.client_id,
            "user_name": config.user_name,
        }

    def _rpc_spotify_set_client_id(self, params: dict):
        _require(params, "client_id")
        from core.spotify_config import load_spotify_config, save_spotify_config
        config = load_spotify_config()
        new_id = params["client_id"].strip()
        if config.client_id and new_id != config.client_id:
            # New app identity invalidates existing tokens
            config.access_token = ""
            config.refresh_token = ""
            config.expires_at = 0.0
            config.user_name = ""
            config.user_id = ""
        config.client_id = new_id
        save_spotify_config(config)
        return {"ok": True}

    def _rpc_spotify_auth_start(self, params: dict):
        from core.spotify_auth import SpotifyAuthFlow
        from core.spotify_config import load_spotify_config

        config = load_spotify_config()
        if not config.client_id:
            raise ValueError("Set your Spotify Client ID first")

        # Cancel any stale flow so the loopback port is free
        if self._spotify_flow:
            self._spotify_flow.cancel()
        self._spotify_flow = SpotifyAuthFlow(config.client_id)
        auth_url = self._spotify_flow.start()
        return {"auth_url": auth_url}

    def _rpc_spotify_auth_poll(self, params: dict):
        flow = self._spotify_flow
        if not flow:
            return {"status": "idle"}
        return {
            "status": flow.status,
            "user_name": flow.user_name,
            "error": flow.error,
        }

    def _rpc_spotify_disconnect(self, params: dict):
        from core.spotify_config import load_spotify_config, save_spotify_config
        if self._spotify_flow:
            self._spotify_flow.cancel()
            self._spotify_flow = None
        config = load_spotify_config()
        config.access_token = ""
        config.refresh_token = ""
        config.expires_at = 0.0
        config.user_name = ""
        config.user_id = ""
        save_spotify_config(config)
        return {"ok": True}

    def _rpc_spotify_fetch_library(self, params: dict):
        """Fetch the user's full Spotify library (liked songs + playlists)."""
        from core.spotify_client import SpotifyClient

        include_playlists = params.get("include_playlists", True)
        client = SpotifyClient()

        def progress(current, total, label):
            self._notify("progress", {
                "op": "spotify_fetch",
                "current": current,
                "total": total,
                "message": label,
            })

        metadata, tracks = client.fetch_full_library(
            include_playlists=include_playlists, progress=progress)
        return {
            "metadata": _serialize(metadata),
            "tracks": _serialize(tracks),
        }

    def _rpc_spotify_list_playlists(self, params: dict):
        """List the user's Spotify playlists (name + track count). [] if off."""
        from core.spotify_config import load_spotify_config
        from core.spotify_client import SpotifyClient
        cfg = load_spotify_config()
        if not cfg.refresh_token:
            return []
        pls = SpotifyClient().fetch_user_playlists()
        return [{"name": p.get("name", "Untitled"), "track_count": p.get("track_count", 0)} for p in pls]

    def _rpc_spotify_present_paths(self, params: dict):
        """Return device relative_paths whose artist+title match a track in the
        user's Spotify library (liked + playlists). [] when not connected."""
        from core.spotify_config import load_spotify_config
        from core.spotify_client import SpotifyClient
        from core.utils import normalize_for_matching
        cfg = load_spotify_config()
        if not cfg.refresh_token:
            return []
        client = SpotifyClient()

        def progress(cur, total, label):
            self._notify("progress", {"op": "spotify_present", "current": cur, "total": total, "message": label})

        _meta, tracks = client.fetch_full_library(include_playlists=True, progress=progress)
        lookup = set()
        for t in tracks:
            lookup.add((normalize_for_matching(getattr(t, "artist", "")),
                        normalize_for_matching(getattr(t, "title", ""))))
        present = []
        for dt in self._session.device_tracks:
            if (normalize_for_matching(dt.artist), normalize_for_matching(dt.title)) in lookup:
                present.append(dt.relative_path)
        return present

    # ── Export ──────────────────────────────────────────────────────

    def _rpc_write_text_file(self, params: dict):
        """Write text content to a user-chosen path (export support)."""
        _require(params, "path", "content")
        path = Path(params["path"])
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(params["content"], encoding="utf-8")
        return {"ok": True, "path": str(path)}

    # ── App config ──────────────────────────────────────────────────

    def _rpc_get_app_config(self, params: dict):
        from core.app_config import load_app_config
        return _serialize(load_app_config())

    def _rpc_set_app_config(self, params: dict):
        from core.app_config import load_app_config, save_app_config
        config = load_app_config()
        for key in ("master_library_path", "slskd_url", "slskd_api_key", "soulseek_download_dir"):
            if key in params:
                setattr(config, key, params[key] or "")
        save_app_config(config)
        return {"ok": True}

    # ── Soulseek (via slskd) ────────────────────────────────────────

    def _rpc_soulseek_status(self, params: dict):
        from core.app_config import load_app_config
        cfg = load_app_config()
        configured = bool(cfg.slskd_url and cfg.slskd_api_key)
        result = {
            "configured": configured,
            "url": cfg.slskd_url,
            "download_dir": cfg.soulseek_download_dir,
            "connected": False,
        }
        if configured:
            from core.soulseek_client import SoulseekClient
            try:
                info = SoulseekClient(cfg.slskd_url, cfg.slskd_api_key).test_connection()
                result["connected"] = bool(info.get("connected"))
                result["version"] = info.get("version", "")
                result["state"] = info.get("state", "")
            except Exception as e:
                result["error"] = str(e)
        return result

    def _rpc_soulseek_search(self, params: dict):
        _require(params, "query")
        from core.app_config import load_app_config
        from core.soulseek_client import SoulseekClient
        cfg = load_app_config()
        if not (cfg.slskd_url and cfg.slskd_api_key):
            raise ValueError("Soulseek is not configured. Add your slskd URL and API key in Settings.")
        client = SoulseekClient(cfg.slskd_url, cfg.slskd_api_key)

        def progress(responses, files):
            self._notify("progress", {
                "op": "soulseek_search",
                "current": responses, "total": files,
                "message": f"{files} files from {responses} users",
            })

        results = client.search(params["query"], progress=progress)
        return results[:params.get("limit", 60)]

    def _rpc_soulseek_download(self, params: dict):
        _require(params, "username", "files")
        from core.app_config import load_app_config
        from core.soulseek_client import SoulseekClient
        cfg = load_app_config()
        if not (cfg.slskd_url and cfg.slskd_api_key):
            raise ValueError("Soulseek is not configured.")
        client = SoulseekClient(cfg.slskd_url, cfg.slskd_api_key)
        return client.download(params["username"], params["files"])

    def _rpc_soulseek_downloads(self, params: dict):
        from core.app_config import load_app_config
        from core.soulseek_client import SoulseekClient
        cfg = load_app_config()
        if not (cfg.slskd_url and cfg.slskd_api_key):
            return []
        return SoulseekClient(cfg.slskd_url, cfg.slskd_api_key).downloads()

    def _rpc_list_incoming(self, params: dict):
        """List audio files in the Soulseek download folder for review before
        importing. Works on whatever landed there, independent of slskd's
        transfer bookkeeping."""
        from core.app_config import load_app_config
        from core.local_scanner import AUDIO_EXTENSIONS
        from core.utils import read_audio_metadata
        cfg = load_app_config()
        if not cfg.soulseek_download_dir:
            raise ValueError("Set a Soulseek download folder in Settings first.")
        root = Path(cfg.soulseek_download_dir)
        if not root.exists():
            return []
        files = []
        for dirpath, dirs, names in os.walk(root):
            dirs[:] = [d for d in dirs if not d.startswith(".")]
            for n in names:
                if n.startswith(".") or Path(n).suffix.lower() not in AUDIO_EXTENSIONS:
                    continue
                fp = Path(dirpath) / n
                try:
                    size = fp.stat().st_size
                except OSError:
                    size = 0
                meta = read_audio_metadata(fp)
                files.append({
                    "path": str(fp),
                    "name": n,
                    "title": meta.get("title", ""),
                    "artist": meta.get("artist", ""),
                    "album": meta.get("album", ""),
                    "format": Path(n).suffix.lstrip(".").lower(),
                    "size": size,
                })
        files.sort(key=lambda f: f["name"].lower())
        return files

    def _rpc_import_incoming(self, params: dict):
        """Move reviewed download-folder files into the library hub."""
        _require(params, "paths")
        if not self._session.device_mount:
            raise ValueError("Connect your library first.")
        mount = self._session.device_mount
        dest_dir = mount / params.get("dest_folder", "Music")
        dest_dir.mkdir(parents=True, exist_ok=True)
        moved, errors = [], []
        for p in params["paths"]:
            src = Path(p)
            if not src.exists():
                errors.append(f"Not found: {src.name}")
                continue
            dst = dest_dir / src.name
            counter = 1
            while dst.exists():
                dst = dest_dir / f"{src.stem}_{counter}{src.suffix}"
                counter += 1
            try:
                shutil.move(str(src), str(dst))
                moved.append(str(dst))
            except OSError as e:
                errors.append(f"{src.name}: {e}")
        return {"moved": len(moved), "errors": errors}

    # ── Updates ─────────────────────────────────────────────────────

    def _rpc_get_latest_release(self, params: dict):
        """Fetch the latest GitHub release so the UI can offer an update."""
        import requests
        repo = params.get("repo", "FugginBeenus/grapefruit")
        resp = requests.get(
            f"https://api.github.com/repos/{repo}/releases/latest",
            headers={
                "Accept": "application/vnd.github+json",
                "User-Agent": "Grapefruit",
            },
            timeout=10,
        )
        if resp.status_code != 200:
            raise ValueError(f"GitHub API returned {resp.status_code}")
        data = resp.json()
        return {
            "tag_name": data.get("tag_name", ""),
            "name": data.get("name", ""),
            "html_url": data.get("html_url", ""),
            "published_at": data.get("published_at", ""),
        }

    # ── Helpers ─────────────────────────────────────────────────────

    def _resolve_device_path(self, path_str: str) -> Path:
        """Resolve a path string to an absolute path on the device."""
        p = Path(path_str)
        if p.is_absolute() and p.exists():
            return p
        if self._session.device_mount:
            device_path = self._session.device_mount / path_str
            if device_path.exists():
                return device_path
        raise ValueError(f"File not found: {path_str}")

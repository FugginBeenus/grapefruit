"""Client for a headless slskd daemon (https://github.com/slskd/slskd).

slskd logs in to the Soulseek network with the user's own account and exposes a
REST API. Grapefruit talks to that API — it never speaks the Soulseek protocol
itself. The user runs slskd and gives us its URL + API key in Settings.

Targets slskd's /api/v0 surface. Endpoints/shapes are per slskd's documented API
and will need a live daemon to fully validate.
"""

import os
import time

import requests


class SoulseekError(Exception):
    pass


class SoulseekClient:
    def __init__(self, base_url: str, api_key: str):
        self._base = base_url.rstrip("/") + "/api/v0"
        self._session = requests.Session()
        self._session.headers.update({
            "X-API-Key": api_key,
            "Accept": "application/json",
            "Content-Type": "application/json",
        })

    # ── Connection ───────────────────────────────────────────────────

    def test_connection(self) -> dict:
        """Return slskd application state; raises SoulseekError on failure."""
        try:
            resp = self._session.get(f"{self._base}/application", timeout=10)
            resp.raise_for_status()
            data = resp.json()
            server = data.get("server", {}) if isinstance(data, dict) else {}
            return {
                "version": data.get("version", "") if isinstance(data, dict) else "",
                "connected": str(server.get("state", "")).lower().find("connected") >= 0,
                "state": server.get("state", ""),
            }
        except (requests.ConnectionError, requests.Timeout) as e:
            raise SoulseekError(
                "Couldn't reach slskd. Check the URL and that slskd is running."
            ) from e
        except Exception as e:
            raise SoulseekError(f"slskd error: {e}") from e

    # ── Search ───────────────────────────────────────────────────────

    def search(self, query: str, timeout: float = 12.0,
               progress=None) -> list[dict]:
        """Run a search and return flattened file candidates, best-ranked first.

        Each candidate: {username, filename, name, size, bitrate, length,
        extension, has_slot, speed, queue, quality}.
        """
        try:
            resp = self._session.post(
                f"{self._base}/searches",
                json={"searchText": query},
                timeout=15,
            )
            resp.raise_for_status()
            search = resp.json()
            search_id = search.get("id")
            if not search_id:
                raise SoulseekError("slskd did not return a search id")
        except Exception as e:
            raise SoulseekError(f"Search failed to start: {e}") from e

        # Poll until the search reports complete, or we hit the time box.
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            time.sleep(1.0)
            try:
                s = self._session.get(f"{self._base}/searches/{search_id}", timeout=10).json()
            except Exception:
                continue
            if progress:
                progress(s.get("responseCount", 0), s.get("fileCount", 0))
            if s.get("isComplete") or str(s.get("state", "")).lower().startswith("completed"):
                break

        try:
            responses = self._session.get(
                f"{self._base}/searches/{search_id}/responses", timeout=15
            ).json()
        except Exception as e:
            raise SoulseekError(f"Failed to read search responses: {e}") from e

        candidates = []
        for r in responses or []:
            username = r.get("username", "")
            has_slot = bool(r.get("hasFreeUploadSlot"))
            speed = r.get("uploadSpeed", 0) or 0
            queue = r.get("queueLength", 0) or 0
            for f in r.get("files", []) or []:
                filename = f.get("filename", "")
                if not filename:
                    continue
                ext = (f.get("extension") or os.path.splitext(filename)[1].lstrip(".")).lower()
                candidates.append({
                    "username": username,
                    "filename": filename,
                    "name": filename.replace("\\", "/").split("/")[-1],
                    "size": f.get("size", 0) or 0,
                    "bitrate": f.get("bitRate"),
                    "length": f.get("length"),
                    "extension": ext,
                    "has_slot": has_slot,
                    "speed": speed,
                    "queue": queue,
                    "quality": _quality_rank(ext, f.get("bitRate")),
                })

        # Best first: higher quality, then free slot, then faster.
        candidates.sort(key=lambda c: (c["quality"], c["has_slot"], c["speed"]), reverse=True)
        return candidates

    # ── Downloads ────────────────────────────────────────────────────

    def download(self, username: str, files: list[dict]) -> dict:
        """Enqueue downloads. files: [{filename, size}]."""
        try:
            resp = self._session.post(
                f"{self._base}/transfers/downloads/{username}",
                json=[{"filename": f["filename"], "size": f.get("size", 0)} for f in files],
                timeout=15,
            )
            resp.raise_for_status()
            return {"ok": True, "count": len(files)}
        except Exception as e:
            raise SoulseekError(f"Download failed to enqueue: {e}") from e

    def downloads(self) -> list[dict]:
        """Return flattened active/finished downloads for progress display."""
        try:
            data = self._session.get(f"{self._base}/transfers/downloads", timeout=10).json()
        except Exception as e:
            raise SoulseekError(f"Failed to read downloads: {e}") from e

        out = []
        for user in data or []:
            username = user.get("username", "")
            for d in user.get("directories", []) or []:
                for f in d.get("files", []) or []:
                    size = f.get("size", 0) or 0
                    transferred = f.get("bytesTransferred", 0) or 0
                    out.append({
                        "username": username,
                        "name": (f.get("filename", "") or "").replace("\\", "/").split("/")[-1],
                        "state": f.get("state", ""),
                        "size": size,
                        "transferred": transferred,
                        "percent": round(transferred / size * 100, 1) if size else 0.0,
                    })
        return out


def _quality_rank(ext: str, bitrate) -> int:
    ext = (ext or "").lower()
    if ext in ("flac", "alac", "wav", "aiff", "ape", "wv"):
        return 100
    if ext in ("mp3", "m4a", "aac", "ogg", "opus"):
        br = bitrate or 0
        if br >= 320:
            return 80
        if br >= 256:
            return 70
        if br >= 192:
            return 55
        return 40
    return 10

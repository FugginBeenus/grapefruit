"""Spotify Web API client — official API, OAuth-authenticated.

Pulls the user's full library (Liked Songs + every playlist they own or
follow) as PlaylistTrack lists, for gap analysis against the local library.
"""

from __future__ import annotations

import time
from typing import Callable

import requests

from core.models import PlaylistMetadata, PlaylistTrack
from core.spotify_auth import ensure_fresh_token
from core.spotify_config import load_spotify_config
from core.utils import normalize_for_matching

API_BASE = "https://api.spotify.com/v1"

ProgressFn = Callable[[int, int, str], None] | None


class SpotifyClientError(Exception):
    pass


class SpotifyClient:
    """Authenticated Spotify Web API access with pagination + rate-limit handling."""

    def __init__(self):
        self._config = ensure_fresh_token(load_spotify_config())
        self._session = requests.Session()

    # ── HTTP plumbing ────────────────────────────────────────────────

    def _get(self, url: str, params: dict | None = None) -> dict:
        for attempt in range(5):
            self._config = ensure_fresh_token(self._config)
            resp = self._session.get(
                url if url.startswith("http") else f"{API_BASE}{url}",
                headers={"Authorization": f"Bearer {self._config.access_token}"},
                params=params,
                timeout=30,
            )
            if resp.status_code == 429:
                wait = int(resp.headers.get("Retry-After", "2"))
                time.sleep(min(wait, 30))
                continue
            if resp.status_code == 401:
                # Force refresh on next loop
                self._config.expires_at = 0
                continue
            if resp.status_code != 200:
                raise SpotifyClientError(
                    f"Spotify API error {resp.status_code}: {resp.text[:200]}")
            return resp.json()
        raise SpotifyClientError("Spotify API kept rate-limiting; try again later")

    def _paginate(self, url: str, params: dict | None = None):
        """Yield items across all pages of a paged endpoint."""
        page = self._get(url, params)
        while True:
            for item in page.get("items", []):
                yield item, page.get("total", 0)
            next_url = page.get("next")
            if not next_url:
                return
            page = self._get(next_url)

    # ── Library fetch ────────────────────────────────────────────────

    def get_profile(self) -> dict:
        me = self._get("/me")
        return {"id": me.get("id", ""), "name": me.get("display_name", "")}

    def fetch_liked_songs(self, progress: ProgressFn = None) -> list[PlaylistTrack]:
        tracks: list[PlaylistTrack] = []
        for item, total in self._paginate("/me/tracks", {"limit": 50}):
            t = item.get("track")
            if not t:
                continue
            tracks.append(self._to_playlist_track(t, len(tracks)))
            if progress and len(tracks) % 50 == 0:
                progress(len(tracks), total, "Liked Songs")
        return tracks

    def fetch_user_playlists(self) -> list[dict]:
        playlists = []
        for item, _total in self._paginate("/me/playlists", {"limit": 50}):
            playlists.append({
                "id": item["id"],
                "name": item.get("name", "Untitled"),
                "track_count": item.get("tracks", {}).get("total", 0),
                "owner": item.get("owner", {}).get("display_name", ""),
            })
        return playlists

    def fetch_playlist_tracks(self, playlist_id: str,
                              progress: ProgressFn = None,
                              label: str = "") -> list[PlaylistTrack]:
        tracks: list[PlaylistTrack] = []
        for item, total in self._paginate(
                f"/playlists/{playlist_id}/tracks",
                {"limit": 100, "additional_types": "track"}):
            t = item.get("track")
            # Skip episodes, local-only files without metadata, and ghosts
            if not t or t.get("type") != "track":
                continue
            tracks.append(self._to_playlist_track(t, len(tracks)))
            if progress and len(tracks) % 100 == 0:
                progress(len(tracks), total, label)
        return tracks

    def fetch_full_library(self, include_playlists: bool = True,
                           progress: ProgressFn = None
                           ) -> tuple[PlaylistMetadata, list[PlaylistTrack]]:
        """Liked Songs + all playlists, deduplicated by (artist, title)."""
        if progress:
            progress(0, 0, "Fetching Liked Songs...")
        all_tracks = self.fetch_liked_songs(progress)

        if include_playlists:
            playlists = self.fetch_user_playlists()
            for i, pl in enumerate(playlists):
                if progress:
                    progress(i + 1, len(playlists),
                             f"Playlist: {pl['name']}")
                try:
                    all_tracks.extend(self.fetch_playlist_tracks(
                        pl["id"], progress, pl["name"]))
                except SpotifyClientError:
                    continue  # skip unreadable playlists, keep going

        # Dedupe by normalized (artist, title)
        seen: set[tuple[str, str]] = set()
        unique: list[PlaylistTrack] = []
        for t in all_tracks:
            key = (normalize_for_matching(t.artist),
                   normalize_for_matching(t.title))
            if key in seen:
                continue
            seen.add(key)
            t.source_index = len(unique)
            unique.append(t)

        name = (f"{self._config.user_name}'s Spotify Library"
                if self._config.user_name else "Spotify Library")
        metadata = PlaylistMetadata(
            name=name,
            description="Liked Songs"
                        + (" + playlists" if include_playlists else ""),
            track_count=len(unique),
            source_url=None,
            source_type="spotify_library",
        )
        return metadata, unique

    # ── Helpers ──────────────────────────────────────────────────────

    @staticmethod
    def _to_playlist_track(t: dict, index: int) -> PlaylistTrack:
        artists = t.get("artists") or []
        artist = ", ".join(a.get("name", "") for a in artists if a.get("name"))
        album = (t.get("album") or {}).get("name", "")
        dur_ms = t.get("duration_ms")
        return PlaylistTrack(
            title=t.get("name", ""),
            artist=artist,
            album=album,
            duration_seconds=(dur_ms / 1000.0) if dur_ms else None,
            track_number=t.get("track_number"),
            source_index=index,
        )

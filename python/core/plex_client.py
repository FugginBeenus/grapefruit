"""Plex Media Server API client for playlist management."""

import requests

from core.models import PlaylistMetadata, PlaylistTrack
from core.utils import normalize_for_matching


class PlexClientError(Exception):
    pass


class PlexConnectionError(PlexClientError):
    pass


class PlexPlaylistError(PlexClientError):
    pass


class PlexClient:
    """Interact with a Plex Media Server for playlist operations."""

    def __init__(self, server_url: str, token: str):
        self._base = server_url.rstrip("/")
        self._token = token
        self._session = requests.Session()
        self._session.headers.update({
            "X-Plex-Token": token,
            "Accept": "application/json",
            "X-Plex-Client-Identifier": "grapefruit-music-app",
            "X-Plex-Product": "Grapefruit",
        })
        self._machine_id: str | None = None

    # ── Connection ───────────────────────────────────────────────────

    def test_connection(self) -> dict:
        """Test the connection and return server info.

        Returns dict with keys: name, version, machineIdentifier.
        Raises PlexConnectionError on failure.
        """
        try:
            resp = self._get("/identity")
            info = resp.get("MediaContainer", resp)
            self._machine_id = info.get("machineIdentifier", "")
            return {
                "name": info.get("friendlyName", info.get("name", "Plex Server")),
                "version": info.get("version", ""),
                "machineIdentifier": self._machine_id,
            }
        except Exception as e:
            raise PlexConnectionError(f"Cannot connect to Plex: {e}") from e

    def get_machine_id(self) -> str:
        """Return cached machine identifier, fetching if needed."""
        if not self._machine_id:
            self.test_connection()
        return self._machine_id

    # ── Library Discovery ────────────────────────────────────────────

    def get_music_sections(self) -> list[dict]:
        """Return music library sections: [{key, title}]."""
        try:
            resp = self._get("/library/sections")
            container = resp.get("MediaContainer", resp)
            directories = container.get("Directory", [])
            return [
                {"key": d["key"], "title": d["title"]}
                for d in directories
                if d.get("type") == "artist"
            ]
        except PlexClientError:
            raise
        except Exception as e:
            raise PlexClientError(f"Failed to list library sections: {e}") from e

    # ── Bulk Track Fetch ─────────────────────────────────────────────

    def get_all_tracks(self, section_key: str,
                       progress_callback=None) -> list[dict]:
        """Fetch ALL tracks from a music library section in one request.

        Returns list of {ratingKey, title, artist, album, duration_ms}.
        Much faster than per-track searching.
        """
        try:
            resp = self._get(
                f"/library/sections/{section_key}/all",
                params={"type": 10},
                timeout=60,  # Large libraries may take a moment
            )
            container = resp.get("MediaContainer", resp)
            tracks_data = container.get("Metadata", [])

            total = len(tracks_data)
            results = []
            for i, t in enumerate(tracks_data):
                if progress_callback and i % 500 == 0:
                    progress_callback(i, total)

                # Extract file path from Media → Part
                file_path = ""
                media = t.get("Media", [])
                if media:
                    parts = media[0].get("Part", [])
                    if parts:
                        file_path = parts[0].get("file", "")

                results.append({
                    "ratingKey": str(t.get("ratingKey", "")),
                    "title": t.get("title", ""),
                    "artist": t.get("grandparentTitle", ""),
                    "album": t.get("parentTitle", ""),
                    "duration_ms": t.get("duration"),
                    "file": file_path,
                })

            if progress_callback:
                progress_callback(total, total)

            return results

        except PlexClientError:
            raise
        except Exception as e:
            raise PlexClientError(f"Failed to fetch library tracks: {e}") from e

    def build_lookup(self, tracks: list[dict]) -> dict[tuple[str, str], list[dict]]:
        """Build a (normalized_artist, normalized_title) → [track] lookup.

        Returns a dict mapping (artist, title) keys to lists of matching
        Plex tracks (multiple entries for duplicates/remasters).
        """
        lookup: dict[tuple[str, str], list[dict]] = {}
        for t in tracks:
            key = (normalize_for_matching(t["artist"]),
                   normalize_for_matching(t["title"]))
            lookup.setdefault(key, []).append(t)
        return lookup

    def build_file_lookup(self, tracks: list[dict]) -> dict[str, dict]:
        """Build a filename → track lookup for file-path matching.

        Uses just the filename (basename) for matching since the local
        library and Plex library share the same files.
        """
        import os
        lookup: dict[str, dict] = {}
        for t in tracks:
            fp = t.get("file", "")
            if fp:
                basename = os.path.basename(fp).lower()
                # First match wins (avoid overwriting with dupes)
                if basename not in lookup:
                    lookup[basename] = t
        return lookup

    # ── Detailed Metadata Fetch ───────────────────────────────────────

    def get_track_details(self, rating_key: str) -> dict:
        """Fetch full metadata for a single track by ratingKey.

        Returns dict with: title, artist, album, albumArtist, year, genre,
        trackNumber, discNumber, duration_ms, file, thumb.
        """
        try:
            resp = self._get(f"/library/metadata/{rating_key}")
            container = resp.get("MediaContainer", resp)
            items = container.get("Metadata", [])
            if not items:
                return {}
            t = items[0]

            file_path = ""
            media = t.get("Media", [])
            if media:
                parts = media[0].get("Part", [])
                if parts:
                    file_path = parts[0].get("file", "")

            return {
                "ratingKey": str(t.get("ratingKey", "")),
                "title": t.get("title", ""),
                "artist": t.get("grandparentTitle", ""),
                "album": t.get("parentTitle", ""),
                "albumArtist": t.get("grandparentTitle", ""),
                "year": t.get("parentYear") or t.get("year"),
                "genre": (t.get("Genre", [{}])[0].get("tag", "")
                          if t.get("Genre") else ""),
                "trackNumber": t.get("index"),
                "discNumber": t.get("parentIndex"),
                "duration_ms": t.get("duration"),
                "file": file_path,
                "thumb": t.get("thumb", ""),
            }
        except Exception as e:
            raise PlexClientError(f"Failed to get track details: {e}") from e

    def get_track_artwork(self, thumb_path: str) -> bytes | None:
        """Download artwork for a track given its thumb path.

        Returns raw image bytes or None if no artwork.
        """
        if not thumb_path:
            return None
        try:
            url = self._base + thumb_path
            resp = self._session.get(url, timeout=15)
            resp.raise_for_status()
            content_type = resp.headers.get("Content-Type", "")
            if "image" in content_type or len(resp.content) > 100:
                return resp.content
            return None
        except Exception:
            return None

    def get_all_tracks_detailed(self, section_key: str,
                                progress_callback=None) -> list[dict]:
        """Fetch ALL tracks with extended metadata (year, genre, track#, disc#, thumb).

        Like get_all_tracks but includes extra fields needed for metadata sync.
        """
        try:
            resp = self._get(
                f"/library/sections/{section_key}/all",
                params={"type": 10, "includeGenres": 1},
                timeout=60,
            )
            container = resp.get("MediaContainer", resp)
            tracks_data = container.get("Metadata", [])

            total = len(tracks_data)
            results = []
            for i, t in enumerate(tracks_data):
                if progress_callback and i % 500 == 0:
                    progress_callback(i, total)

                file_path = ""
                media = t.get("Media", [])
                if media:
                    parts = media[0].get("Part", [])
                    if parts:
                        file_path = parts[0].get("file", "")

                genre = ""
                genres = t.get("Genre", [])
                if genres:
                    genre = genres[0].get("tag", "")

                results.append({
                    "ratingKey": str(t.get("ratingKey", "")),
                    "title": t.get("title", ""),
                    "artist": t.get("grandparentTitle", ""),
                    "album": t.get("parentTitle", ""),
                    "albumArtist": t.get("grandparentTitle", ""),
                    "year": t.get("parentYear") or t.get("year"),
                    "genre": genre,
                    "trackNumber": t.get("index"),
                    "discNumber": t.get("parentIndex"),
                    "duration_ms": t.get("duration"),
                    "file": file_path,
                    "thumb": t.get("thumb", ""),
                })

            if progress_callback:
                progress_callback(total, total)

            return results

        except PlexClientError:
            raise
        except Exception as e:
            raise PlexClientError(f"Failed to fetch detailed tracks: {e}") from e

    # ── Pull Direction (Plex → iPod) ─────────────────────────────────

    def get_playlists(self) -> list[dict]:
        """Return audio playlists: [{ratingKey, title, leafCount}]."""
        try:
            resp = self._get("/playlists", params={"playlistType": "audio"})
            container = resp.get("MediaContainer", resp)
            playlists = container.get("Metadata", [])
            return [
                {
                    "ratingKey": p["ratingKey"],
                    "title": p.get("title", "Untitled"),
                    "leafCount": p.get("leafCount", 0),
                }
                for p in playlists
            ]
        except PlexClientError:
            raise
        except Exception as e:
            raise PlexClientError(f"Failed to list playlists: {e}") from e

    def fetch_playlist(self, rating_key: str,
                       progress_callback=None,
                       ) -> tuple[PlaylistMetadata, list[PlaylistTrack]]:
        """Fetch a playlist's tracks, returning the same format as other scrapers.

        Returns (PlaylistMetadata, list[PlaylistTrack]).
        """
        try:
            # Get playlist metadata
            pl_resp = self._get(f"/playlists/{rating_key}")
            pl_container = pl_resp.get("MediaContainer", pl_resp)
            pl_meta_list = pl_container.get("Metadata", [{}])
            pl_info = pl_meta_list[0] if pl_meta_list else {}

            playlist_title = pl_info.get("title", "Plex Playlist")

            # Get items
            items_resp = self._get(f"/playlists/{rating_key}/items")
            items_container = items_resp.get("MediaContainer", items_resp)
            tracks_data = items_container.get("Metadata", [])

            tracks: list[PlaylistTrack] = []
            for i, t in enumerate(tracks_data):
                if progress_callback and i % 20 == 0:
                    progress_callback(i, len(tracks_data))

                duration_ms = t.get("duration")
                duration_s = duration_ms / 1000.0 if duration_ms else None

                tracks.append(PlaylistTrack(
                    title=t.get("title", ""),
                    artist=t.get("grandparentTitle", ""),
                    album=t.get("parentTitle", ""),
                    duration_seconds=duration_s,
                    track_number=t.get("index"),
                    source_index=i,
                ))

            metadata = PlaylistMetadata(
                name=playlist_title,
                description="",
                track_count=len(tracks),
                source_url=f"{self._base}/playlists/{rating_key}",
                source_type="plex",
            )

            if progress_callback:
                progress_callback(len(tracks), len(tracks))

            return metadata, tracks

        except PlexClientError:
            raise
        except Exception as e:
            raise PlexPlaylistError(
                f"Failed to fetch playlist: {e}"
            ) from e

    # ── Push Direction (Create / Update / Delete) ────────────────────

    def create_playlist(self, title: str,
                        track_rating_keys: list[str]) -> str:
        """Create a playlist on the Plex server.

        Returns the new playlist's ratingKey.
        """
        machine_id = self.get_machine_id()
        keys_str = ",".join(track_rating_keys)
        uri = (
            f"server://{machine_id}/com.plexapp.plugins.library"
            f"/library/metadata/{keys_str}"
        )
        try:
            resp = self._post("/playlists", params={
                "title": title,
                "type": "audio",
                "smart": "0",
                "uri": uri,
            })
            container = resp.get("MediaContainer", resp)
            playlists = container.get("Metadata", [])
            if playlists:
                return playlists[0].get("ratingKey", "")
            return ""
        except PlexClientError:
            raise
        except Exception as e:
            raise PlexPlaylistError(
                f"Failed to create playlist: {e}"
            ) from e

    def delete_playlist(self, rating_key: str) -> None:
        """Delete a playlist from the Plex server."""
        try:
            self._delete(f"/playlists/{rating_key}")
        except PlexClientError:
            raise
        except Exception as e:
            raise PlexPlaylistError(
                f"Failed to delete playlist: {e}"
            ) from e

    def replace_playlist(self, rating_key: str, title: str,
                         track_rating_keys: list[str]) -> str:
        """Replace a Plex playlist by deleting and recreating it.

        Returns the new playlist's ratingKey.
        """
        self.delete_playlist(rating_key)
        return self.create_playlist(title, track_rating_keys)

    # ── HTTP Helpers ─────────────────────────────────────────────────

    def _get(self, path: str, params: dict = None,
             timeout: int = 20) -> dict:
        """GET request, returning parsed JSON."""
        url = self._base + path
        resp = self._session.get(url, params=params, timeout=timeout)
        resp.raise_for_status()
        return resp.json()

    def _post(self, path: str, params: dict = None) -> dict:
        """POST request, returning parsed JSON."""
        url = self._base + path
        resp = self._session.post(url, params=params, timeout=20)
        resp.raise_for_status()
        return resp.json()

    def _put(self, path: str, params: dict = None) -> dict:
        """PUT request, returning parsed JSON."""
        url = self._base + path
        resp = self._session.put(url, params=params, timeout=20)
        resp.raise_for_status()
        return resp.json()

    def _delete(self, path: str, params: dict = None) -> None:
        """DELETE request."""
        url = self._base + path
        resp = self._session.delete(url, params=params, timeout=20)
        resp.raise_for_status()

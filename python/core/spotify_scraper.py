"""Spotify playlist scraper — extracts data from the embed page, no API key needed."""

import json
import re

import requests

from core.models import PlaylistTrack, PlaylistMetadata
from core.utils import parse_spotify_url


class SpotifyScraperError(Exception):
    pass


class PlaylistFetchError(SpotifyScraperError):
    pass


class SpotifyScraper:
    """Fetch Spotify playlists by scraping the embed page."""

    USER_AGENT = (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/605.1.15 (KHTML, like Gecko) "
        "Version/17.0 Safari/605.1.15"
    )
    HTML_ACCEPT = (
        "text/html,application/xhtml+xml,"
        "application/xml;q=0.9,*/*;q=0.8"
    )

    def __init__(self):
        self._session = requests.Session()
        self._session.headers.update({"User-Agent": self.USER_AGENT})

    def fetch_playlist(self, url: str, progress_callback=None
                       ) -> tuple[PlaylistMetadata, list[PlaylistTrack]]:
        """Fetch a Spotify playlist and return metadata + tracks."""
        playlist_id = parse_spotify_url(url)
        if not playlist_id:
            raise PlaylistFetchError(
                "Invalid Spotify URL. Expected: "
                "https://open.spotify.com/playlist/..."
            )

        # Step 1 — Fetch the embed page (first 100 tracks + access token)
        entity, token = self._fetch_embed(playlist_id)
        embed_tracks = entity.get("trackList", [])

        name = entity.get("name") or entity.get("title") or "Spotify Playlist"
        metadata = PlaylistMetadata(
            name=name,
            description=entity.get("subtitle", ""),
            track_count=len(embed_tracks),
            source_url=f"https://open.spotify.com/playlist/{playlist_id}",
            source_type="spotify_url",
        )

        # Parse the first 100 tracks from the embed page
        tracks = self._parse_embed_tracks(embed_tracks)

        if progress_callback:
            progress_callback(len(tracks), metadata.track_count)

        # Step 2 — Check for tracks beyond 100 via the internal playlist API
        if len(embed_tracks) >= 100 and token:
            extra = self._fetch_remaining_tracks(
                playlist_id, token, embed_tracks, progress_callback,
            )
            tracks.extend(extra)
            metadata = PlaylistMetadata(
                name=metadata.name,
                description=metadata.description,
                track_count=len(tracks),
                source_url=metadata.source_url,
                source_type=metadata.source_type,
            )

        if not tracks:
            raise PlaylistFetchError("No tracks found in Spotify playlist.")

        return (metadata, tracks)

    # ── Embed page ──────────────────────────────────────────────────

    def _fetch_embed(self, playlist_id: str) -> tuple[dict, str | None]:
        """Fetch the embed page and return (entity_dict, access_token)."""
        embed_url = f"https://open.spotify.com/embed/playlist/{playlist_id}"
        try:
            resp = self._session.get(
                embed_url,
                headers={
                    "Accept": self.HTML_ACCEPT,
                    "Accept-Language": "en-US,en;q=0.9",
                },
                timeout=20,
            )
            resp.raise_for_status()
        except requests.RequestException as e:
            raise PlaylistFetchError(
                f"Failed to load Spotify embed page: {e}"
            )

        nd_match = re.search(
            r'<script\s+id="__NEXT_DATA__"[^>]*>(.*?)</script>',
            resp.text, re.DOTALL,
        )
        if not nd_match:
            raise PlaylistFetchError(
                "Could not find playlist data in Spotify embed page."
            )

        try:
            next_data = json.loads(nd_match.group(1))
            entity = (
                next_data["props"]["pageProps"]["state"]["data"]["entity"]
            )
        except (json.JSONDecodeError, KeyError, TypeError):
            raise PlaylistFetchError(
                "Unexpected Spotify embed data structure."
            )

        # Extract access token (needed for fetching remaining tracks)
        token = None
        token_match = re.search(
            r'"accessToken"\s*:\s*"([^"]{20,})"', resp.text,
        )
        if token_match:
            token = token_match.group(1)

        return entity, token

    # ── Remaining tracks (beyond 100) ───────────────────────────────

    def _fetch_remaining_tracks(
        self, playlist_id: str, token: str,
        embed_tracks: list[dict], progress_callback,
    ) -> list[PlaylistTrack]:
        """Fetch tracks beyond the embed page's 100-track limit."""
        # Get the full track URI list from the internal playlist API
        try:
            resp = self._session.get(
                f"https://spclient.wg.spotify.com/playlist/v2/"
                f"playlist/{playlist_id}",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/json",
                },
                timeout=15,
            )
            if not resp.ok:
                return []
            spc_data = resp.json()
        except (requests.RequestException, ValueError):
            return []

        all_uris = [
            item["uri"]
            for item in spc_data.get("contents", {}).get("items", [])
            if "uri" in item
        ]

        # Find URIs not covered by the embed page
        embed_uri_set = {t.get("uri", "") for t in embed_tracks}
        missing_uris = [u for u in all_uris if u not in embed_uri_set]

        if not missing_uris:
            return []

        # Fetch metadata for each missing track from its embed page
        extra_tracks: list[PlaylistTrack] = []
        base_index = len(embed_tracks)
        for i, uri in enumerate(missing_uris):
            track_id = uri.split(":")[-1]
            track = self._fetch_track_embed(track_id, base_index + i)
            if track:
                extra_tracks.append(track)
            if progress_callback:
                progress_callback(
                    base_index + len(extra_tracks),
                    base_index + len(missing_uris),
                )

        return extra_tracks

    def _fetch_track_embed(self, track_id: str,
                           index: int) -> PlaylistTrack | None:
        """Fetch a single track's metadata from its embed page."""
        try:
            resp = self._session.get(
                f"https://open.spotify.com/embed/track/{track_id}",
                headers={
                    "Accept": self.HTML_ACCEPT,
                    "Accept-Language": "en-US,en;q=0.9",
                },
                timeout=15,
            )
            if not resp.ok:
                return None
        except requests.RequestException:
            return None

        nd_match = re.search(
            r'<script\s+id="__NEXT_DATA__"[^>]*>(.*?)</script>',
            resp.text, re.DOTALL,
        )
        if not nd_match:
            return None

        try:
            data = json.loads(nd_match.group(1))
            entity = data["props"]["pageProps"]["state"]["data"]["entity"]
        except (json.JSONDecodeError, KeyError, TypeError):
            return None

        title = entity.get("title") or entity.get("name") or ""
        if not title:
            return None

        # Artists: list of {name, uri} dicts
        artist = ""
        artists = entity.get("artists", [])
        if isinstance(artists, list) and artists:
            artist = artists[0].get("name", "")

        dur_ms = entity.get("duration")
        duration = dur_ms / 1000.0 if dur_ms else None

        return PlaylistTrack(
            title=title,
            artist=artist,
            album="",
            duration_seconds=duration,
            track_number=None,
            source_index=index,
        )

    # ── Embed track parsing ─────────────────────────────────────────

    def _parse_embed_tracks(self,
                            track_list: list[dict]) -> list[PlaylistTrack]:
        """Parse tracks from the embed page's trackList array."""
        tracks: list[PlaylistTrack] = []
        for i, item in enumerate(track_list):
            title = item.get("title", "")
            if not title:
                continue

            # subtitle is comma-separated artists with \xa0
            raw_artist = item.get("subtitle", "")
            artist = raw_artist.split(",")[0].replace("\xa0", " ").strip()

            dur_ms = item.get("duration")
            duration = dur_ms / 1000.0 if dur_ms else None

            tracks.append(PlaylistTrack(
                title=title,
                artist=artist,
                album="",
                duration_seconds=duration,
                track_number=None,
                source_index=i,
            ))
        return tracks

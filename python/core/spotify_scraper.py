"""Spotify playlist scraper — extracts data from the embed page, no API key needed."""

import functools
import json
import random
import re
import time

import requests

from core.models import PlaylistTrack, PlaylistMetadata
from core.utils import parse_spotify_url

# ── Retry decorator ────────────────────────────────────────────────────

_RETRYABLE = (
    requests.exceptions.ConnectionError,
    requests.exceptions.Timeout,
    requests.exceptions.ChunkedEncodingError,
)


def _retry(max_retries: int = 3, delay: float = 1.0):
    """Retry on transient network errors with exponential backoff."""
    def decorator(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            last_exc = None
            for attempt in range(max_retries + 1):
                try:
                    return fn(*args, **kwargs)
                except _RETRYABLE as exc:
                    last_exc = exc
                    if attempt < max_retries:
                        time.sleep(delay * (2 ** attempt))
            raise last_exc
        return wrapper
    return decorator


class SpotifyScraperError(Exception):
    pass


class PlaylistFetchError(SpotifyScraperError):
    pass


class SpotifyScraper:
    """Fetch Spotify playlists by scraping the embed page."""

    _USER_AGENTS = [
        (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/605.1.15 (KHTML, like Gecko) "
            "Version/17.0 Safari/605.1.15"
        ),
        (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        (
            "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) "
            "Gecko/20100101 Firefox/125.0"
        ),
    ]
    HTML_ACCEPT = (
        "text/html,application/xhtml+xml,"
        "application/xml;q=0.9,*/*;q=0.8"
    )

    # Keep the old attribute around for anything that references it directly.
    USER_AGENT = _USER_AGENTS[0]

    def __init__(self):
        self._session = requests.Session()
        self._session.headers.update(
            {"User-Agent": self._random_ua()}
        )

    # ── Helpers ─────────────────────────────────────────────────────

    @classmethod
    def _random_ua(cls) -> str:
        """Return a randomly chosen User-Agent string."""
        return random.choice(cls._USER_AGENTS)

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

    @_retry(max_retries=3, delay=1.0)
    def _fetch_embed(self, playlist_id: str) -> tuple[dict, str | None]:
        """Fetch the embed page and return (entity_dict, access_token)."""
        embed_url = f"https://open.spotify.com/embed/playlist/{playlist_id}"
        try:
            resp = self._session.get(
                embed_url,
                headers={
                    "Accept": self.HTML_ACCEPT,
                    "Accept-Language": "en-US,en;q=0.9",
                    "User-Agent": self._random_ua(),
                },
                timeout=15,
            )
            resp.raise_for_status()
        except requests.HTTPError as e:
            status = getattr(e.response, "status_code", "unknown")
            hint = self._http_error_hint(status)
            raise PlaylistFetchError(
                f"Spotify embed page returned HTTP {status}. {hint}"
            )
        except requests.RequestException as e:
            raise PlaylistFetchError(
                f"Network error loading Spotify embed page: {e}"
            )

        html = resp.text
        entity, token = None, None

        # ── Strategy 1: __NEXT_DATA__ JSON (primary) ────────────
        entity, token = self._extract_next_data(html)

        # ── Strategy 2: ld+json structured data (fallback) ──────
        if entity is None:
            entity = self._extract_ld_json(html)

        # ── Strategy 3: oEmbed API (last resort, basic metadata) ─
        if entity is None:
            entity = self._fetch_oembed_fallback(playlist_id)

        if entity is None:
            raise PlaylistFetchError(
                "Could not find playlist data in Spotify embed page. "
                "The page structure may have changed."
            )

        # Try to extract token from raw HTML if we didn't get it yet
        if token is None:
            token_match = re.search(
                r'"accessToken"\s*:\s*"([^"]{20,})"', html,
            )
            if token_match:
                token = token_match.group(1)

        return entity, token

    # ── Extraction strategies ──────────────────────────────────────

    @staticmethod
    def _extract_next_data(html: str) -> tuple[dict | None, str | None]:
        """Strategy 1: Parse __NEXT_DATA__ script tag."""
        nd_match = re.search(
            r'<script\s+id="__NEXT_DATA__"[^>]*>(.*?)</script>',
            html, re.DOTALL,
        )
        if not nd_match:
            return None, None

        try:
            next_data = json.loads(nd_match.group(1))
            entity = (
                next_data["props"]["pageProps"]["state"]["data"]["entity"]
            )
        except (json.JSONDecodeError, KeyError, TypeError):
            return None, None

        token = None
        token_match = re.search(
            r'"accessToken"\s*:\s*"([^"]{20,})"', html,
        )
        if token_match:
            token = token_match.group(1)

        return entity, token

    @staticmethod
    def _extract_ld_json(html: str) -> dict | None:
        """Strategy 2: Parse application/ld+json structured data."""
        ld_match = re.search(
            r'<script\s+type="application/ld\+json"[^>]*>(.*?)</script>',
            html, re.DOTALL,
        )
        if not ld_match:
            return None

        try:
            ld_data = json.loads(ld_match.group(1))
        except (json.JSONDecodeError, TypeError):
            return None

        # Normalise ld+json into the entity shape the rest of the code
        # expects: {name, subtitle, trackList}
        name = ld_data.get("name", "")
        if not name:
            return None

        tracks = []
        for item in ld_data.get("track", []):
            t = {
                "title": item.get("name", ""),
                "subtitle": (
                    item.get("byArtist", {}).get("name", "")
                    if isinstance(item.get("byArtist"), dict)
                    else ""
                ),
                "duration": item.get("duration"),
                "uri": item.get("url", ""),
            }
            if t["title"]:
                tracks.append(t)

        return {
            "name": name,
            "subtitle": ld_data.get("description", ""),
            "trackList": tracks,
        }

    def _fetch_oembed_fallback(self, playlist_id: str) -> dict | None:
        """Strategy 3: Use the oEmbed API for basic metadata."""
        oembed_url = (
            "https://open.spotify.com/oembed?url="
            f"https://open.spotify.com/playlist/{playlist_id}"
        )
        try:
            resp = self._session.get(oembed_url, timeout=15)
            if not resp.ok:
                return None
            data = resp.json()
        except (requests.RequestException, ValueError):
            return None

        name = data.get("title", "")
        if not name:
            return None

        # oEmbed doesn't give us tracks, only playlist-level metadata.
        return {
            "name": name,
            "subtitle": data.get("description", ""),
            "trackList": [],
        }

    @staticmethod
    def _http_error_hint(status_code) -> str:
        """Return a human-friendly hint for common HTTP status codes."""
        hints = {
            401: "Authentication required -- Spotify may have changed access rules.",
            403: "Forbidden -- the playlist may be private or region-locked.",
            404: "Not found -- the playlist may have been deleted or the URL is wrong.",
            429: "Rate limited -- too many requests. Try again in a few minutes.",
            500: "Spotify server error. Try again later.",
            502: "Bad gateway. Spotify may be experiencing issues.",
            503: "Service unavailable. Spotify may be down for maintenance.",
        }
        return hints.get(status_code, "Check that the URL is correct and the playlist is public.")

    # ── Remaining tracks (beyond 100) ───────────────────────────────

    # Rate-limit threshold: add a delay between requests when fetching
    # more than this many individual tracks.
    _RATE_LIMIT_THRESHOLD = 100
    _RATE_LIMIT_DELAY = 0.3  # seconds

    @_retry(max_retries=3, delay=1.0)
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
                    "User-Agent": self._random_ua(),
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

        # Fetch metadata for each missing track from its embed page.
        # Apply rate limiting for large playlists to avoid being blocked.
        needs_rate_limit = len(missing_uris) > self._RATE_LIMIT_THRESHOLD
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
            if needs_rate_limit and i < len(missing_uris) - 1:
                time.sleep(self._RATE_LIMIT_DELAY)

        return extra_tracks

    @_retry(max_retries=3, delay=1.0)
    def _fetch_track_embed(self, track_id: str,
                           index: int) -> PlaylistTrack | None:
        """Fetch a single track's metadata from its embed page."""
        try:
            resp = self._session.get(
                f"https://open.spotify.com/embed/track/{track_id}",
                headers={
                    "Accept": self.HTML_ACCEPT,
                    "Accept-Language": "en-US,en;q=0.9",
                    "User-Agent": self._random_ua(),
                },
                timeout=15,
            )
            if not resp.ok:
                return None
        except requests.RequestException:
            return None

        html = resp.text
        entity = None

        # Strategy 1: __NEXT_DATA__
        nd_result, _ = self._extract_next_data(html)
        if nd_result is not None:
            entity = nd_result

        # Strategy 2: ld+json
        if entity is None:
            entity = self._extract_ld_json(html)

        # Strategy 3: oEmbed for a single track
        if entity is None:
            entity = self._fetch_track_oembed_fallback(track_id)

        if entity is None:
            return None

        title = entity.get("title") or entity.get("name") or ""
        if not title:
            return None

        # Artists: list of {name, uri} dicts or a subtitle string
        artist = ""
        artists = entity.get("artists", [])
        if isinstance(artists, list) and artists:
            artist = artists[0].get("name", "")
        elif entity.get("subtitle"):
            artist = (
                entity["subtitle"].split(",")[0]
                .replace("\xa0", " ").strip()
            )

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

    def _fetch_track_oembed_fallback(self, track_id: str) -> dict | None:
        """oEmbed fallback for a single track."""
        oembed_url = (
            "https://open.spotify.com/oembed?url="
            f"https://open.spotify.com/track/{track_id}"
        )
        try:
            resp = self._session.get(oembed_url, timeout=15)
            if not resp.ok:
                return None
            data = resp.json()
        except (requests.RequestException, ValueError):
            return None

        title = data.get("title", "")
        if not title:
            return None

        # oEmbed title is typically "Song - Artist"; split if possible.
        parts = title.split(" - ", 1)
        name = parts[0].strip()
        artist = parts[1].strip() if len(parts) > 1 else ""

        return {
            "title": name,
            "subtitle": artist,
            "artists": [{"name": artist}] if artist else [],
        }

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

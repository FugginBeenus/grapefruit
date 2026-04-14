import functools
import json
import logging
import random
import re
import time
from urllib.parse import unquote, urlparse

import requests
from bs4 import BeautifulSoup

from core.models import PlaylistTrack, PlaylistMetadata
from core.utils import parse_apple_music_url

logger = logging.getLogger(__name__)


def _retry(max_retries=3, delay=1.0):
    """Retry decorator with exponential backoff for network errors."""
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            last_exc = None
            for attempt in range(max_retries):
                try:
                    return func(*args, **kwargs)
                except (requests.RequestException, ConnectionError, TimeoutError) as e:
                    last_exc = e
                    if attempt < max_retries - 1:
                        wait = delay * (2 ** attempt)
                        logger.debug(
                            "Retry %d/%d for %s after %.1fs: %s",
                            attempt + 1, max_retries, func.__name__, wait, e,
                        )
                        time.sleep(wait)
            raise last_exc
        return wrapper
    return decorator


class AppleMusicScraperError(Exception):
    pass


class TokenExtractionError(AppleMusicScraperError):
    pass


class PlaylistFetchError(AppleMusicScraperError):
    pass


class AppleMusicScraper:
    """Scrapes Apple Music playlist data without an API key."""

    BASE_API_URL = "https://amp-api.music.apple.com"
    USER_AGENTS = [
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
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) "
            "Gecko/20100101 Firefox/125.0"
        ),
    ]
    TRACKS_PER_PAGE = 100
    REQUEST_TIMEOUT = 15
    PAGE_FETCH_DELAY = 0.3

    def __init__(self):
        self._session = requests.Session()
        self._session.headers.update({
            "User-Agent": random.choice(self.USER_AGENTS),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        })
        self._bearer_token: str | None = None

    def fetch_playlist(self, url: str, progress_callback=None):
        """
        Fetch playlist tracks from an Apple Music URL.
        Returns (PlaylistMetadata, list[PlaylistTrack]).
        """
        parsed = parse_apple_music_url(url)
        if not parsed:
            raise PlaylistFetchError(
                "Invalid Apple Music URL. Expected format: "
                "https://music.apple.com/us/playlist/name/pl.xxxxx"
            )

        storefront, content_type, content_id = parsed

        # Get bearer token (use cached token if available)
        if not self._bearer_token:
            self._bearer_token = self._extract_bearer_token(url)

        # Fetch playlist metadata
        metadata = self._fetch_playlist_metadata(storefront, content_id)

        # Fetch all tracks with pagination
        tracks = []
        offset = 0
        total = metadata.track_count or 1

        while True:
            if offset > 0:
                time.sleep(self.PAGE_FETCH_DELAY)

            data = self._fetch_tracks_page(storefront, content_id, offset)
            page_tracks = data.get("data", [])

            if not page_tracks:
                break

            for i, track_json in enumerate(page_tracks):
                track = self._parse_track_data(track_json, offset + i)
                tracks.append(track)

            if progress_callback:
                progress_callback(len(tracks), total)

            # Check for next page
            next_url = data.get("next")
            if next_url and len(page_tracks) == self.TRACKS_PER_PAGE:
                offset += self.TRACKS_PER_PAGE
            else:
                break

        metadata.track_count = len(tracks)
        return metadata, tracks

    @_retry(max_retries=3, delay=1.0)
    def _extract_bearer_token(self, url: str) -> str:
        """Extract bearer token from Apple Music page meta tag."""
        try:
            response = self._session.get(url, timeout=self.REQUEST_TIMEOUT)
            response.raise_for_status()
        except requests.RequestException as e:
            raise TokenExtractionError(
                f"Failed to fetch Apple Music page (URL: {url}): {e}"
            )

        soup = BeautifulSoup(response.text, "html.parser")

        # Method 1: meta tag approach
        meta = soup.find("meta", attrs={"name": "desktop-music-app/config/environment"})
        if meta and meta.get("content"):
            try:
                decoded = unquote(meta["content"])
                config = json.loads(decoded)
                token = config.get("MEDIA_API", {}).get("token")
                if token:
                    return token
                logger.debug(
                    "Method 1 (meta tag): Found config but MEDIA_API.token "
                    "was missing or empty."
                )
            except (json.JSONDecodeError, KeyError) as e:
                logger.debug(
                    "Method 1 (meta tag): Found meta element but could not "
                    "parse config JSON: %s", e,
                )
        else:
            logger.debug(
                "Method 1 (meta tag): 'desktop-music-app/config/environment' "
                "meta tag not found on page."
            )

        # Method 2: look for token in script tags
        script_count = len(soup.find_all("script"))
        found_jwt = False
        for script in soup.find_all("script"):
            text = script.string or ""
            # Look for JWT tokens (they start with eyJ)
            match = re.search(r'(eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)', text)
            if match:
                found_jwt = True
                return match.group(1)
        if not found_jwt:
            logger.debug(
                "Method 2 (script tag scan): Scanned %d script tags, "
                "no JWT token found.", script_count,
            )

        # Method 3: try fetching JS bundle from beta.music.apple.com
        return self._extract_token_from_js()

    @_retry(max_retries=3, delay=1.0)
    def _extract_token_from_js(self) -> str:
        """Fallback: extract token from Apple Music JS bundle."""
        try:
            response = self._session.get(
                "https://beta.music.apple.com", timeout=self.REQUEST_TIMEOUT,
            )
            response.raise_for_status()
        except requests.RequestException as e:
            raise TokenExtractionError(
                f"Method 3 (JS bundle): Failed to fetch "
                f"beta.music.apple.com: {e}"
            )

        # Find JS bundle URL
        match = re.search(r'/(assets/index-legacy-[^"]+\.js)', response.text)
        if not match:
            match = re.search(r'/(assets/index[^"]*\.js)', response.text)
        if not match:
            raise TokenExtractionError(
                "Method 3 (JS bundle): Could not find JS bundle URL on "
                "beta.music.apple.com. Apple may have changed their page "
                "structure. Check https://beta.music.apple.com manually to "
                "verify it still loads."
            )

        js_url = f"https://beta.music.apple.com/{match.group(1)}"
        try:
            js_response = self._session.get(js_url, timeout=self.REQUEST_TIMEOUT)
            js_response.raise_for_status()
        except requests.RequestException as e:
            raise TokenExtractionError(
                f"Method 3 (JS bundle): Found bundle URL ({js_url}) but "
                f"failed to download it: {e}"
            )

        # Find JWT in the JS bundle
        token_match = re.search(
            r'(eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)',
            js_response.text
        )
        if token_match:
            return token_match.group(1)

        raise TokenExtractionError(
            "All 3 token extraction methods failed. Apple Music may have "
            "changed their page structure or token delivery mechanism. "
            "Please check if the playlist URL is still accessible in a "
            "browser and consider opening an issue."
        )

    @_retry(max_retries=3, delay=1.0)
    def _fetch_playlist_metadata(self, storefront: str, playlist_id: str) -> PlaylistMetadata:
        """Fetch playlist name and track count."""
        url = f"{self.BASE_API_URL}/v1/catalog/{storefront}/playlists/{playlist_id}"
        headers = {
            "Authorization": f"Bearer {self._bearer_token}",
            "Origin": "https://music.apple.com",
        }
        try:
            response = self._session.get(
                url, headers=headers, timeout=self.REQUEST_TIMEOUT,
            )
            response.raise_for_status()
            data = response.json()
        except requests.HTTPError as e:
            status = e.response.status_code if e.response is not None else "unknown"
            hint = ""
            if status == 404:
                hint = " Playlist may have been deleted or the ID is incorrect."
            elif status == 403:
                hint = " Playlist may be private or region-locked."
            elif status == 401:
                hint = (
                    " Bearer token may be expired. Try again to force a "
                    "new token extraction."
                )
            raise PlaylistFetchError(
                f"Failed to fetch playlist metadata (HTTP {status}).{hint}"
            ) from e
        except requests.RequestException as e:
            raise PlaylistFetchError(
                f"Network error fetching playlist metadata: {e}"
            ) from e
        except json.JSONDecodeError:
            raise PlaylistFetchError(
                "Invalid JSON response from Apple Music API while fetching "
                "playlist metadata."
            )

        playlist_data = data.get("data", [{}])[0]
        attrs = playlist_data.get("attributes", {})

        return PlaylistMetadata(
            name=attrs.get("name", "Unknown Playlist"),
            description=attrs.get("description", {}).get("standard", ""),
            track_count=attrs.get("trackCount", 0) if "trackCount" in attrs else 0,
            source_url=f"https://music.apple.com/{storefront}/playlist/{playlist_id}",
            source_type="apple_music_url",
        )

    @_retry(max_retries=3, delay=1.0)
    def _fetch_tracks_page(self, storefront: str, playlist_id: str, offset: int = 0) -> dict:
        """Fetch one page of tracks from the API."""
        url = (
            f"{self.BASE_API_URL}/v1/catalog/{storefront}/playlists/{playlist_id}/tracks"
            f"?limit={self.TRACKS_PER_PAGE}&offset={offset}"
        )
        headers = {
            "Authorization": f"Bearer {self._bearer_token}",
            "Origin": "https://music.apple.com",
        }
        try:
            response = self._session.get(
                url, headers=headers, timeout=self.REQUEST_TIMEOUT,
            )
            response.raise_for_status()
            return response.json()
        except requests.HTTPError as e:
            status = e.response.status_code if e.response is not None else "unknown"
            hint = ""
            if status == 403:
                hint = " Playlist may be private or region-locked."
            elif status == 401:
                hint = " Bearer token may have expired mid-session."
            raise PlaylistFetchError(
                f"Failed to fetch tracks at offset {offset} "
                f"(HTTP {status}).{hint}"
            ) from e
        except requests.RequestException as e:
            raise PlaylistFetchError(
                f"Network error fetching tracks at offset {offset}: {e}"
            ) from e
        except json.JSONDecodeError:
            raise PlaylistFetchError(
                f"Invalid JSON in track data from API (offset {offset}). "
                f"The response may have been truncated or corrupted."
            )

    def _parse_track_data(self, track_json: dict, index: int) -> PlaylistTrack:
        """Convert API track JSON to a PlaylistTrack."""
        attrs = track_json.get("attributes", {})
        duration_ms = attrs.get("durationInMillis", 0)

        return PlaylistTrack(
            title=attrs.get("name", "Unknown"),
            artist=attrs.get("artistName", "Unknown"),
            album=attrs.get("albumName", ""),
            duration_seconds=duration_ms / 1000.0 if duration_ms else None,
            track_number=attrs.get("trackNumber"),
            source_index=index,
        )

import json
import re
from urllib.parse import unquote, urlparse

import requests
from bs4 import BeautifulSoup

from core.models import PlaylistTrack, PlaylistMetadata
from core.utils import parse_apple_music_url


class AppleMusicScraperError(Exception):
    pass


class TokenExtractionError(AppleMusicScraperError):
    pass


class PlaylistFetchError(AppleMusicScraperError):
    pass


class AppleMusicScraper:
    """Scrapes Apple Music playlist data without an API key."""

    BASE_API_URL = "https://amp-api.music.apple.com"
    USER_AGENT = (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/605.1.15 (KHTML, like Gecko) "
        "Version/17.0 Safari/605.1.15"
    )
    TRACKS_PER_PAGE = 100

    def __init__(self):
        self._session = requests.Session()
        self._session.headers.update({
            "User-Agent": self.USER_AGENT,
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

        # Get bearer token
        self._bearer_token = self._extract_bearer_token(url)

        # Fetch playlist metadata
        metadata = self._fetch_playlist_metadata(storefront, content_id)

        # Fetch all tracks with pagination
        tracks = []
        offset = 0
        total = metadata.track_count or 1

        while True:
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

    def _extract_bearer_token(self, url: str) -> str:
        """Extract bearer token from Apple Music page meta tag."""
        try:
            response = self._session.get(url, timeout=15)
            response.raise_for_status()
        except requests.RequestException as e:
            raise TokenExtractionError(f"Failed to fetch Apple Music page: {e}")

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
            except (json.JSONDecodeError, KeyError):
                pass

        # Method 2: look for token in script tags
        for script in soup.find_all("script"):
            text = script.string or ""
            # Look for JWT tokens (they start with eyJ)
            match = re.search(r'(eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)', text)
            if match:
                return match.group(1)

        # Method 3: try fetching JS bundle from beta.music.apple.com
        return self._extract_token_from_js()

    def _extract_token_from_js(self) -> str:
        """Fallback: extract token from Apple Music JS bundle."""
        try:
            response = self._session.get("https://beta.music.apple.com", timeout=15)
            response.raise_for_status()
        except requests.RequestException as e:
            raise TokenExtractionError(f"Failed to fetch beta.music.apple.com: {e}")

        # Find JS bundle URL
        match = re.search(r'/(assets/index-legacy-[^"]+\.js)', response.text)
        if not match:
            match = re.search(r'/(assets/index[^"]*\.js)', response.text)
        if not match:
            raise TokenExtractionError("Could not find JS bundle URL")

        js_url = f"https://beta.music.apple.com/{match.group(1)}"
        try:
            js_response = self._session.get(js_url, timeout=15)
            js_response.raise_for_status()
        except requests.RequestException as e:
            raise TokenExtractionError(f"Failed to fetch JS bundle: {e}")

        # Find JWT in the JS bundle
        token_match = re.search(
            r'(eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)',
            js_response.text
        )
        if token_match:
            return token_match.group(1)

        raise TokenExtractionError(
            "Could not extract bearer token. Apple may have changed their page structure."
        )

    def _fetch_playlist_metadata(self, storefront: str, playlist_id: str) -> PlaylistMetadata:
        """Fetch playlist name and track count."""
        url = f"{self.BASE_API_URL}/v1/catalog/{storefront}/playlists/{playlist_id}"
        headers = {
            "Authorization": f"Bearer {self._bearer_token}",
            "Origin": "https://music.apple.com",
        }
        try:
            response = self._session.get(url, headers=headers, timeout=15)
            response.raise_for_status()
            data = response.json()
        except requests.RequestException as e:
            raise PlaylistFetchError(f"Failed to fetch playlist metadata: {e}")
        except json.JSONDecodeError:
            raise PlaylistFetchError("Invalid response from Apple Music API")

        playlist_data = data.get("data", [{}])[0]
        attrs = playlist_data.get("attributes", {})

        return PlaylistMetadata(
            name=attrs.get("name", "Unknown Playlist"),
            description=attrs.get("description", {}).get("standard", ""),
            track_count=attrs.get("trackCount", 0) if "trackCount" in attrs else 0,
            source_url=f"https://music.apple.com/{storefront}/playlist/{playlist_id}",
            source_type="apple_music_url",
        )

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
            response = self._session.get(url, headers=headers, timeout=15)
            response.raise_for_status()
            return response.json()
        except requests.RequestException as e:
            raise PlaylistFetchError(f"Failed to fetch tracks (offset {offset}): {e}")
        except json.JSONDecodeError:
            raise PlaylistFetchError(f"Invalid track data from API (offset {offset})")

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

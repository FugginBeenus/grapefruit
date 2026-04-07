import re
from urllib.parse import urlparse


def normalize_for_matching(text: str) -> str:
    """Normalize a string for fuzzy matching comparison."""
    if not text:
        return ""
    text = text.lower().strip()
    # Remove content in parentheses: (feat. X), (Remix), (Live), etc.
    text = re.sub(r'\s*\(.*?\)', '', text)
    # Remove content in brackets: [feat. X], [Deluxe], etc.
    text = re.sub(r'\s*\[.*?\]', '', text)
    # Remove "feat.", "ft.", "featuring" even without parens
    text = re.sub(r'\s*(feat\.?|ft\.?|featuring)\s+.*$', '', text, flags=re.IGNORECASE)
    # Replace & with and
    text = re.sub(r'\s*&\s*', ' and ', text)
    # Strip non-alphanumeric (keep spaces)
    text = re.sub(r'[^\w\s]', '', text)
    # Collapse whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def parse_apple_music_url(url: str) -> tuple[str, str, str] | None:
    """
    Parse an Apple Music URL into (storefront, content_type, content_id).
    Returns None if the URL is not a valid Apple Music URL.
    """
    try:
        parsed = urlparse(url.strip())
        if parsed.hostname not in ('music.apple.com', 'embed.music.apple.com'):
            return None
        parts = [p for p in parsed.path.split('/') if p]
        # Expected: /{storefront}/{type}/{name}/{id}
        if len(parts) < 3:
            return None
        storefront = parts[0]
        content_type = parts[1]
        content_id = parts[-1]
        if content_type not in ('playlist', 'album'):
            return None
        return (storefront, content_type, content_id)
    except Exception:
        return None


def parse_spotify_url(url: str) -> str | None:
    """
    Parse a Spotify playlist URL and return the playlist_id.
    Returns None if the URL is not a valid Spotify playlist URL.

    Handles:
      - https://open.spotify.com/playlist/{id}
      - https://open.spotify.com/playlist/{id}?si=...
    """
    try:
        parsed = urlparse(url.strip())
        if parsed.hostname != 'open.spotify.com':
            return None
        parts = [p for p in parsed.path.split('/') if p]
        if len(parts) != 2 or parts[0] != 'playlist':
            return None
        playlist_id = parts[1]
        return playlist_id if playlist_id else None
    except Exception:
        return None


def detect_playlist_source(url: str) -> tuple[str, str] | None:
    """
    Detect whether a URL is Apple Music or Spotify.
    Returns ("apple_music", url) or ("spotify", url) or None if unrecognized.
    """
    url = url.strip()
    if parse_apple_music_url(url):
        return ("apple_music", url)
    if parse_spotify_url(url):
        return ("spotify", url)
    return None


def format_duration(seconds: float | None) -> str:
    """Format seconds as M:SS or H:MM:SS."""
    if seconds is None:
        return "--:--"
    total = int(seconds)
    h, remainder = divmod(total, 3600)
    m, s = divmod(remainder, 60)
    if h > 0:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


def safe_filename(name: str) -> str:
    """Sanitize a string for use as a filename."""
    # Remove characters invalid on macOS/Windows
    name = re.sub(r'[<>:"/\\|?*]', '', name)
    name = name.strip('. ')
    return name or "playlist"


def format_file_size(size_bytes: int) -> str:
    """Format bytes as human-readable size."""
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 ** 2:
        return f"{size_bytes / 1024:.1f} KB"
    elif size_bytes < 1024 ** 3:
        return f"{size_bytes / (1024 ** 2):.1f} MB"
    else:
        return f"{size_bytes / (1024 ** 3):.2f} GB"


def read_audio_metadata(file_path) -> dict:
    """Read audio metadata with music-tag -> tinytag -> filename fallback.
    Returns dict with title, artist, album, duration_seconds, track_number."""
    from pathlib import Path
    file_path = Path(file_path)

    # Try music-tag
    try:
        import music_tag
        f = music_tag.load_file(str(file_path))
        title = str(f["title"]) if f["title"] else ""
        artist = str(f["artist"]) if f["artist"] else ""
        album = str(f["album"]) if f["album"] else ""
        track_num = None
        try:
            tn = f["tracknumber"]
            if tn:
                track_num = int(tn.value) if hasattr(tn, 'value') else int(tn)
        except (ValueError, TypeError):
            pass
        duration = None
        try:
            dur = f["#length"]
            if dur:
                duration = float(dur.value) if hasattr(dur, 'value') else float(dur)
        except (ValueError, TypeError, KeyError):
            pass

        if title or artist:
            return {
                "title": title or file_path.stem,
                "artist": artist,
                "album": album,
                "duration_seconds": duration,
                "track_number": track_num,
            }
    except Exception:
        pass

    # Try tinytag
    try:
        from tinytag import TinyTag
        tag = TinyTag.get(str(file_path))
        title = tag.title or ""
        artist = tag.artist or ""
        album = tag.album or ""
        duration = tag.duration
        track_num = None
        if tag.track:
            try:
                track_num = int(tag.track)
            except (ValueError, TypeError):
                pass

        if title or artist:
            return {
                "title": title or file_path.stem,
                "artist": artist,
                "album": album,
                "duration_seconds": duration,
                "track_number": track_num,
            }
    except Exception:
        pass

    # Fallback: filename parsing
    stem = file_path.stem
    artist = ""
    title = stem
    if " - " in stem:
        parts = stem.split(" - ", 1)
        artist = parts[0].strip()
        title = parts[1].strip()

    return {
        "title": title,
        "artist": artist,
        "album": file_path.parent.name,
        "duration_seconds": None,
        "track_number": None,
    }

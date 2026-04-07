import re
from pathlib import Path

from core.models import LocalTrack
from core.utils import normalize_for_matching

AUDIO_EXTENSIONS = {
    ".mp3", ".m4a", ".flac", ".alac", ".aac", ".ogg",
    ".opus", ".wma", ".wav", ".aiff", ".aif", ".wv",
    ".ape", ".dsf", ".dff",
}


class ScanError(Exception):
    pass


class LocalScanner:
    """Scans a directory tree for music files and reads metadata."""

    def __init__(self, music_root: Path):
        if not music_root.exists():
            raise ScanError(f"Music folder not found: {music_root}")
        if not music_root.is_dir():
            raise ScanError(f"Not a directory: {music_root}")
        self._music_root = music_root
        self._tracks: list[LocalTrack] = []

    def scan(self, progress_callback=None) -> list[LocalTrack]:
        """Recursively scan for audio files and read metadata."""
        # Phase 1: collect file paths
        audio_files = []
        for ext in AUDIO_EXTENSIONS:
            audio_files.extend(self._music_root.rglob(f"*{ext}"))
            # Also match uppercase extensions
            audio_files.extend(self._music_root.rglob(f"*{ext.upper()}"))

        # Filter out macOS resource fork (._*) and other hidden files (.*)
        audio_files = [f for f in audio_files if not f.name.startswith(".")]

        # Deduplicate (in case of case-insensitive filesystem)
        seen = set()
        unique_files = []
        for f in audio_files:
            resolved = f.resolve()
            if resolved not in seen:
                seen.add(resolved)
                unique_files.append(f)

        total = len(unique_files)

        # Phase 2: read metadata
        self._tracks = []
        for i, file_path in enumerate(unique_files):
            track = self._read_metadata(file_path)
            if track:
                self._tracks.append(track)
            if progress_callback:
                progress_callback(i + 1, total)

        return self._tracks

    def _read_metadata(self, file_path: Path) -> LocalTrack | None:
        """Read metadata with music-tag -> tinytag -> filename fallback."""
        # Try music-tag first
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
                return LocalTrack(
                    file_path=file_path,
                    title=title or file_path.stem,
                    artist=artist,
                    album=album,
                    duration_seconds=duration,
                    track_number=track_num,
                    normalized_title=normalize_for_matching(title or file_path.stem),
                    normalized_artist=normalize_for_matching(artist),
                )
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
                return LocalTrack(
                    file_path=file_path,
                    title=title or file_path.stem,
                    artist=artist,
                    album=album,
                    duration_seconds=duration,
                    track_number=track_num,
                    normalized_title=normalize_for_matching(title or file_path.stem),
                    normalized_artist=normalize_for_matching(artist),
                )
        except Exception:
            pass

        # Fallback: parse filename
        return self._parse_filename(file_path)

    def _parse_filename(self, file_path: Path) -> LocalTrack:
        """Extract metadata from filename as last resort."""
        stem = file_path.stem
        artist = ""
        title = stem

        # Try "Artist - Title" pattern
        if " - " in stem:
            parts = stem.split(" - ", 1)
            artist = parts[0].strip()
            title = parts[1].strip()
        # Try "## Title" pattern (track number prefix)
        elif re.match(r'^\d{1,3}\s+', stem):
            title = re.sub(r'^\d{1,3}\s+', '', stem).strip()
            # Use parent directory as artist hint
            artist = file_path.parent.name

        return LocalTrack(
            file_path=file_path,
            title=title,
            artist=artist,
            album=file_path.parent.name,
            normalized_title=normalize_for_matching(title),
            normalized_artist=normalize_for_matching(artist),
        )

    @property
    def tracks(self) -> list[LocalTrack]:
        return self._tracks

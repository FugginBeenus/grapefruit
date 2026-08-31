import os
from pathlib import Path

from core.models import DeviceTrack
from core.utils import read_audio_metadata
from core.local_scanner import AUDIO_EXTENSIONS


class RockboxLibrary:
    """Read and manage music files and playlists on a Rockbox iPod."""

    PLAYLIST_DIR = "Playlists"
    SKIP_DIRS = {".rockbox", "iPod_Control", ".Trashes", ".Spotlight-V100", ".fseventsd"}

    def __init__(self, device_root: Path):
        self._root = device_root
        self._tracks: list[DeviceTrack] = []

    def scan_music(self, progress_callback=None) -> list[DeviceTrack]:
        """Scan device for audio files and read metadata."""
        # Phase 1: collect file paths
        audio_files = []
        for root, dirs, files in os.walk(self._root):
            # Skip system/hidden directories
            dirs[:] = [d for d in dirs if d not in self.SKIP_DIRS and not d.startswith(".")]
            for f in files:
                if f.startswith("."):
                    continue
                ext = Path(f).suffix.lower()
                if ext in AUDIO_EXTENSIONS:
                    audio_files.append(Path(root) / f)

        total = len(audio_files)
        self._tracks = []

        # Phase 2: read metadata. Every audio file found is counted — a
        # metadata or stat hiccup degrades a track's fields, it never drops
        # the track, so the count matches the files actually on disk.
        for i, file_path in enumerate(audio_files):
            try:
                meta = read_audio_metadata(file_path)
            except Exception:
                meta = {}
            try:
                relative = str(file_path.relative_to(self._root))
            except ValueError:
                relative = file_path.name
            try:
                file_size = file_path.stat().st_size
            except OSError:
                file_size = 0

            self._tracks.append(DeviceTrack(
                file_path=file_path,
                relative_path=relative,
                title=meta.get("title") or file_path.stem,
                artist=meta.get("artist", ""),
                album=meta.get("album", ""),
                duration_seconds=meta.get("duration_seconds"),
                track_number=meta.get("track_number"),
                file_size=file_size,
                format=file_path.suffix.lstrip(".").lower(),
            ))

            if progress_callback and (i % 50 == 0 or i == total - 1):
                progress_callback(i + 1, total)

        return self._tracks

    def get_playlists(self) -> list[tuple[str, Path]]:
        """Find all M3U/M3U8 playlists on the device."""
        playlists = []
        for root, dirs, files in os.walk(self._root):
            dirs[:] = [d for d in dirs if d not in self.SKIP_DIRS]
            for f in files:
                if f.lower().endswith((".m3u8", ".m3u")):
                    path = Path(root) / f
                    name = Path(f).stem
                    playlists.append((name, path))
        return sorted(playlists, key=lambda x: x[0].lower())

    def read_playlist(self, playlist_path: Path) -> list[str]:
        """Read an M3U8 file and return track paths."""
        paths = []
        try:
            with open(playlist_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#"):
                        paths.append(line)
        except UnicodeDecodeError:
            with open(playlist_path, "r", encoding="latin-1") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#"):
                        paths.append(line)
        return paths

    def write_playlist(self, name: str, tracks: list[DeviceTrack],
                       output_dir: Path | None = None) -> Path:
        """Write an M3U8 playlist to the device."""
        if output_dir is None:
            output_dir = self._root / self.PLAYLIST_DIR
        output_dir.mkdir(parents=True, exist_ok=True)

        # Sanitize filename
        safe_name = "".join(c for c in name if c not in '<>:"/\\|?*').strip()
        if not safe_name:
            safe_name = "playlist"
        output_path = output_dir / f"{safe_name}.m3u8"

        lines = ["#EXTM3U", f"#PLAYLIST:{name}"]
        for track in tracks:
            duration = int(track.duration_seconds) if track.duration_seconds else -1
            display = f"{track.artist} - {track.title}" if track.artist else track.title
            lines.append(f"#EXTINF:{duration},{display}")
            # Use absolute path from device root with forward slashes
            lines.append(f"/{track.relative_path}")

        with open(output_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")

        return output_path

    def delete_playlist(self, playlist_path: Path) -> bool:
        """Delete a playlist file from the device."""
        try:
            playlist_path.unlink()
            return True
        except OSError:
            return False

    def get_artists(self) -> list[str]:
        """Return sorted unique artist list."""
        artists = set()
        for track in self._tracks:
            if track.artist:
                artists.add(track.artist)
        return sorted(artists, key=str.lower)

    def get_albums(self, artist: str | None = None) -> list[str]:
        """Return albums, optionally filtered by artist."""
        albums = set()
        for track in self._tracks:
            if artist and track.artist != artist:
                continue
            if track.album:
                albums.add(track.album)
        return sorted(albums, key=str.lower)

    def get_tracks_by_album(self, album: str) -> list[DeviceTrack]:
        """Return tracks for a specific album, sorted by track number."""
        tracks = [t for t in self._tracks if t.album == album]
        tracks.sort(key=lambda t: (t.track_number or 999, t.title))
        return tracks

    @property
    def tracks(self) -> list[DeviceTrack]:
        return self._tracks

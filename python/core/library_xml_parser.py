import plistlib
from pathlib import Path
from urllib.parse import unquote, urlparse

from core.models import PlaylistTrack, PlaylistMetadata


class LibraryXMLError(Exception):
    pass


class LibraryXMLParser:
    """Parses Apple Music/iTunes Library XML exports."""

    def get_playlist_names(self, xml_path: Path) -> list[str]:
        """Return playlist names from the XML (excluding system playlists)."""
        library = self._load_xml(xml_path)
        names = []
        for pl in library.get("Playlists", []):
            # Skip system/special playlists
            if pl.get("Master") or pl.get("Distinguished Kind"):
                continue
            name = pl.get("Name", "")
            if name:
                names.append(name)
        return names

    def parse_single_playlist(self, xml_path: Path, playlist_name: str):
        """
        Parse one playlist from the XML.
        Returns (PlaylistMetadata, list[PlaylistTrack]).
        """
        library = self._load_xml(xml_path)
        tracks_dict = library.get("Tracks", {})

        # Find the playlist
        target_playlist = None
        for pl in library.get("Playlists", []):
            if pl.get("Name") == playlist_name:
                target_playlist = pl
                break

        if target_playlist is None:
            raise LibraryXMLError(f"Playlist '{playlist_name}' not found in library XML")

        # Build track list
        playlist_items = target_playlist.get("Playlist Items", [])
        tracks = []
        for i, item in enumerate(playlist_items):
            track_id = str(item.get("Track ID", ""))
            track_data = tracks_dict.get(track_id)
            if track_data:
                track = self._build_track(track_data, i)
                tracks.append(track)

        metadata = PlaylistMetadata(
            name=playlist_name,
            track_count=len(tracks),
            source_type="library_xml",
        )
        return metadata, tracks

    def _load_xml(self, xml_path: Path) -> dict:
        """Load and parse the plist XML file."""
        if not xml_path.exists():
            raise LibraryXMLError(f"File not found: {xml_path}")
        try:
            with open(xml_path, "rb") as f:
                return plistlib.load(f)
        except Exception as e:
            raise LibraryXMLError(f"Failed to parse library XML: {e}")

    def _build_track(self, track_dict: dict, index: int) -> PlaylistTrack:
        """Convert a plistlib track dictionary to a PlaylistTrack."""
        duration_ms = track_dict.get("Total Time")
        return PlaylistTrack(
            title=track_dict.get("Name", "Unknown"),
            artist=track_dict.get("Artist", "Unknown"),
            album=track_dict.get("Album", ""),
            duration_seconds=duration_ms / 1000.0 if duration_ms else None,
            track_number=track_dict.get("Track Number"),
            source_index=index,
        )

    def _decode_location(self, location_url: str) -> Path | None:
        """Convert a file:// URL to a local Path."""
        if not location_url or not location_url.startswith("file://"):
            return None
        parsed = urlparse(location_url)
        return Path(unquote(parsed.path))

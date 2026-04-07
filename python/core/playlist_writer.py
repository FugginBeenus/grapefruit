from pathlib import Path

from core.models import MatchResult, MatchStatus, ExportOptions, PathMode


class PlaylistWriteError(Exception):
    pass


class PlaylistWriter:
    """Generates M3U8 playlist files."""

    def write(self, matches: list[MatchResult], options: ExportOptions, playlist_name: str = "Playlist") -> Path:
        """Write an M3U8 playlist file and return the output path."""
        content = self.preview(matches, options, playlist_name)
        try:
            options.output_path.parent.mkdir(parents=True, exist_ok=True)
            with open(options.output_path, "w", encoding="utf-8") as f:
                f.write(content)
            return options.output_path
        except OSError as e:
            raise PlaylistWriteError(f"Failed to write playlist: {e}")

    def preview(self, matches: list[MatchResult], options: ExportOptions, playlist_name: str = "Playlist") -> str:
        """Return M3U8 content as a string."""
        lines = ["#EXTM3U", f"#PLAYLIST:{playlist_name}"]

        for match in matches:
            track = match.playlist_track

            # Determine which local file to use
            local_track = None
            if match.status in (MatchStatus.MATCHED, MatchStatus.CONFIRMED):
                local_track = match.best_match.local_track if match.best_match else None
            elif match.status == MatchStatus.MANUAL:
                local_track = match.user_selected

            if local_track:
                extinf = self._format_extinf(track, local_track)
                path = self._resolve_path(local_track.file_path, options)
                lines.append(extinf)
                lines.append(path)
            elif options.include_unmatched_comments:
                display = f"{track.artist} - {track.title}"
                lines.append(f"# MISSING: {display}")

        lines.append("")  # trailing newline
        return "\n".join(lines)

    def _format_extinf(self, playlist_track, local_track) -> str:
        """Format an #EXTINF line."""
        duration = -1
        if local_track.duration_seconds:
            duration = int(local_track.duration_seconds)

        artist = playlist_track.artist or local_track.artist or "Unknown"
        title = playlist_track.title or local_track.title or "Unknown"
        display = f"{artist} - {title}"

        return f"#EXTINF:{duration},{display}"

    def _resolve_path(self, file_path: Path, options: ExportOptions) -> str:
        """Convert file path to the appropriate format."""
        if options.path_mode == PathMode.RELATIVE:
            base = options.rockbox_root or options.output_path.parent
            try:
                rel = file_path.resolve().relative_to(base.resolve())
                # Use forward slashes for Rockbox compatibility
                return "/" + str(rel).replace("\\", "/")
            except ValueError:
                # Can't make relative, fall back to absolute
                return str(file_path)
        return str(file_path)

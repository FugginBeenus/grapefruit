"""Plex server configuration persistence."""

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

CONFIG_PATH = Path.home() / ".grapefruit" / "plex_config.json"


@dataclass
class PlexConfig:
    server_url: str = ""
    token: str = ""
    last_section_key: str = ""
    music_library_path: str = ""  # Local path to music library (= Plex library)
    # Map playlist name -> Plex ratingKey (for re-sync)
    playlist_map: dict[str, str] = field(default_factory=dict)


def load_plex_config() -> PlexConfig:
    """Load Plex config from disk, returning defaults if missing."""
    if not CONFIG_PATH.exists():
        return PlexConfig()
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        return PlexConfig(
            server_url=data.get("server_url", ""),
            token=data.get("token", ""),
            last_section_key=data.get("last_section_key", ""),
            music_library_path=data.get("music_library_path", ""),
            playlist_map=data.get("playlist_map", {}),
        )
    except (json.JSONDecodeError, OSError):
        return PlexConfig()


def save_plex_config(config: PlexConfig) -> None:
    """Save Plex config to disk."""
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(
        json.dumps(asdict(config), indent=2),
        encoding="utf-8",
    )

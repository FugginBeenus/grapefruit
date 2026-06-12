"""Spotify account configuration persistence.

Stores the user's Spotify Developer app Client ID plus OAuth tokens.
Tokens are encrypted at rest with the same machine-derived Fernet key
used for the Plex token (see plex_config for details).
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path

from core.plex_config import _decrypt_token, _encrypt_token

CONFIG_PATH = Path.home() / ".grapefruit" / "spotify_config.json"


@dataclass
class SpotifyConfig:
    client_id: str = ""
    access_token: str = ""
    refresh_token: str = ""
    expires_at: float = 0.0  # unix timestamp when access_token expires
    user_name: str = ""      # display name, for the UI
    user_id: str = ""


def load_spotify_config() -> SpotifyConfig:
    """Load Spotify config from disk, returning defaults if missing."""
    if not CONFIG_PATH.exists():
        return SpotifyConfig()
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        return SpotifyConfig(
            client_id=data.get("client_id", ""),
            access_token=_decrypt_token(data.get("encrypted_access_token", "")),
            refresh_token=_decrypt_token(data.get("encrypted_refresh_token", "")),
            expires_at=float(data.get("expires_at", 0.0)),
            user_name=data.get("user_name", ""),
            user_id=data.get("user_id", ""),
        )
    except (json.JSONDecodeError, OSError, ValueError):
        return SpotifyConfig()


def save_spotify_config(config: SpotifyConfig) -> None:
    """Save Spotify config with tokens encrypted at rest."""
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)

    data = asdict(config)
    data["encrypted_access_token"] = _encrypt_token(data.pop("access_token", ""))
    data["encrypted_refresh_token"] = _encrypt_token(data.pop("refresh_token", ""))

    CONFIG_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")

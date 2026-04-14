"""Plex server configuration persistence.

The Plex token is encrypted at rest using Fernet symmetric encryption
(from the ``cryptography`` library).  A machine-specific key is derived
via PBKDF2-HMAC-SHA256 from the local hostname combined with a random
salt that is persisted next to the config file.

If the ``cryptography`` package is not installed, the module falls back
to base64 obfuscation (not cryptographically secure, but still avoids
storing the token as readable plaintext).
"""

from __future__ import annotations

import base64
import json
import os
import socket
from dataclasses import asdict, dataclass, field
from pathlib import Path

CONFIG_PATH = Path.home() / ".grapefruit" / "plex_config.json"
_SALT_PATH = CONFIG_PATH.with_suffix(".salt")

# ---------------------------------------------------------------------------
# Encryption helpers
# ---------------------------------------------------------------------------

try:
    from cryptography.fernet import Fernet, InvalidToken
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    from cryptography.hazmat.primitives import hashes

    _HAS_CRYPTO = True
except ImportError:  # pragma: no cover
    _HAS_CRYPTO = False


def _get_or_create_salt() -> bytes:
    """Return a persistent 16-byte salt, creating one if it doesn't exist."""
    if _SALT_PATH.exists():
        return _SALT_PATH.read_bytes()
    salt = os.urandom(16)
    _SALT_PATH.parent.mkdir(parents=True, exist_ok=True)
    _SALT_PATH.write_bytes(salt)
    return salt


def _derive_fernet_key(salt: bytes) -> bytes:
    """Derive a Fernet key from the machine hostname + salt via PBKDF2."""
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=480_000,
    )
    key_material = kdf.derive(socket.gethostname().encode("utf-8"))
    return base64.urlsafe_b64encode(key_material)


def _encrypt_token(plaintext: str) -> str:
    """Encrypt *plaintext* and return a base64-encoded ciphertext string."""
    if not plaintext:
        return ""
    if _HAS_CRYPTO:
        salt = _get_or_create_salt()
        f = Fernet(_derive_fernet_key(salt))
        return f.encrypt(plaintext.encode("utf-8")).decode("ascii")
    # Fallback: base64 obfuscation
    return base64.urlsafe_b64encode(plaintext.encode("utf-8")).decode("ascii")


def _decrypt_token(ciphertext: str) -> str:
    """Decrypt *ciphertext* and return the plaintext token."""
    if not ciphertext:
        return ""
    if _HAS_CRYPTO:
        salt = _get_or_create_salt()
        f = Fernet(_derive_fernet_key(salt))
        try:
            return f.decrypt(ciphertext.encode("ascii")).decode("utf-8")
        except (InvalidToken, Exception):
            # If decryption fails the value may be a legacy base64 fallback.
            pass
    # Fallback: base64 de-obfuscation
    try:
        return base64.urlsafe_b64decode(ciphertext.encode("ascii")).decode("utf-8")
    except Exception:
        return ciphertext  # Last resort: return as-is


# ---------------------------------------------------------------------------
# PlexConfig dataclass (unchanged public surface)
# ---------------------------------------------------------------------------


@dataclass
class PlexConfig:
    server_url: str = ""
    token: str = ""
    last_section_key: str = ""
    music_library_path: str = ""  # Local path to music library (= Plex library)
    # Map playlist name -> Plex ratingKey (for re-sync)
    playlist_map: dict[str, str] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Load / Save
# ---------------------------------------------------------------------------


def load_plex_config() -> PlexConfig:
    """Load Plex config from disk, returning defaults if missing.

    Handles three on-disk formats transparently:
    1. ``encrypted_token`` -- current format (Fernet or base64 fallback).
    2. ``token`` (plaintext) -- legacy format; migrated on next save.
    3. Missing token fields -- returns empty string.
    """
    if not CONFIG_PATH.exists():
        return PlexConfig()
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))

        # --- token resolution ---
        if "encrypted_token" in data:
            token = _decrypt_token(data["encrypted_token"])
        elif "token" in data:
            # Legacy plaintext token -- use it directly.
            token = data["token"]
        else:
            token = ""

        return PlexConfig(
            server_url=data.get("server_url", ""),
            token=token,
            last_section_key=data.get("last_section_key", ""),
            music_library_path=data.get("music_library_path", ""),
            playlist_map=data.get("playlist_map", {}),
        )
    except (json.JSONDecodeError, OSError):
        return PlexConfig()


def save_plex_config(config: PlexConfig) -> None:
    """Save Plex config to disk with the token encrypted at rest."""
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)

    data = asdict(config)

    # Replace plaintext token with encrypted form.
    plaintext_token = data.pop("token", "")
    data["encrypted_token"] = _encrypt_token(plaintext_token)

    CONFIG_PATH.write_text(
        json.dumps(data, indent=2),
        encoding="utf-8",
    )

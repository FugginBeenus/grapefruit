"""Spotify OAuth 2.0 Authorization Code flow with PKCE.

Desktop-app flow: no client secret. The user supplies their own (free)
Spotify Developer app Client ID. We open the authorize URL in the browser
and catch the redirect on a localhost loopback server.

The Spotify app must have ``http://127.0.0.1:8721/callback`` registered
as a Redirect URI.
"""

from __future__ import annotations

import base64
import hashlib
import secrets
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer

import requests

from core.spotify_config import SpotifyConfig, load_spotify_config, save_spotify_config

AUTH_URL = "https://accounts.spotify.com/authorize"
TOKEN_URL = "https://accounts.spotify.com/api/token"
REDIRECT_PORT = 8721
REDIRECT_URI = f"http://127.0.0.1:{REDIRECT_PORT}/callback"
SCOPES = "user-library-read playlist-read-private playlist-read-collaborative"

_SUCCESS_HTML = b"""<!doctype html>
<html><head><title>Grapefruit</title><style>
body { background:#0B0B10; color:#eee; font-family: -apple-system, system-ui, sans-serif;
       display:flex; align-items:center; justify-content:center; height:100vh; margin:0; }
.card { text-align:center; padding:40px 56px; border-radius:16px; background:#16161E;
        border:1px solid rgba(255,255,255,0.08); }
h1 { font-size:20px; margin:0 0 8px; } p { color:#999; font-size:14px; margin:0; }
.dot { font-size:40px; }
</style></head><body><div class="card">
<div class="dot">&#127818;</div>
<h1>Spotify connected</h1>
<p>You can close this tab and return to Grapefruit.</p>
</div></body></html>"""

_ERROR_HTML = b"""<!doctype html>
<html><head><title>Grapefruit</title></head>
<body style="background:#0B0B10;color:#eee;font-family:system-ui;text-align:center;padding-top:20vh">
<h1>Connection failed</h1><p>Return to Grapefruit and try again.</p></body></html>"""


class SpotifyAuthError(Exception):
    pass


class SpotifyAuthFlow:
    """One in-flight PKCE authorization. Create, call start(), poll status."""

    def __init__(self, client_id: str):
        if not client_id:
            raise SpotifyAuthError("No Spotify Client ID configured")
        self._client_id = client_id
        self._verifier = ""
        self._state = ""
        self._server: HTTPServer | None = None
        self._lock = threading.Lock()
        # pending -> connected | error
        self.status = "pending"
        self.error = ""
        self.user_name = ""

    # ── Public API ───────────────────────────────────────────────────

    def start(self) -> str:
        """Start the loopback server and return the authorize URL to open."""
        self._verifier = secrets.token_urlsafe(64)[:128]
        challenge = base64.urlsafe_b64encode(
            hashlib.sha256(self._verifier.encode("ascii")).digest()
        ).rstrip(b"=").decode("ascii")
        self._state = secrets.token_urlsafe(16)

        self._start_server()

        params = {
            "client_id": self._client_id,
            "response_type": "code",
            "redirect_uri": REDIRECT_URI,
            "code_challenge_method": "S256",
            "code_challenge": challenge,
            "state": self._state,
            "scope": SCOPES,
        }
        return f"{AUTH_URL}?{urllib.parse.urlencode(params)}"

    def cancel(self):
        self._shutdown_server()
        with self._lock:
            if self.status == "pending":
                self.status = "error"
                self.error = "Cancelled"

    # ── Loopback server ──────────────────────────────────────────────

    def _start_server(self):
        flow = self

        class CallbackHandler(BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802 - http.server API
                parsed = urllib.parse.urlparse(self.path)
                if parsed.path != "/callback":
                    self.send_response(404)
                    self.end_headers()
                    return
                qs = urllib.parse.parse_qs(parsed.query)
                code = qs.get("code", [""])[0]
                state = qs.get("state", [""])[0]
                err = qs.get("error", [""])[0]

                if err or not code or state != flow._state:
                    self.send_response(400)
                    self.send_header("Content-Type", "text/html")
                    self.end_headers()
                    self.wfile.write(_ERROR_HTML)
                    with flow._lock:
                        flow.status = "error"
                        flow.error = err or "Invalid callback"
                else:
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html")
                    self.end_headers()
                    self.wfile.write(_SUCCESS_HTML)
                    # Exchange in a thread so the HTTP response isn't delayed
                    threading.Thread(
                        target=flow._exchange_code, args=(code,), daemon=True,
                    ).start()

                # One callback is all we need either way
                threading.Thread(target=flow._shutdown_server, daemon=True).start()

            def log_message(self, *args):  # silence request logging
                pass

        try:
            self._server = HTTPServer(("127.0.0.1", REDIRECT_PORT), CallbackHandler)
        except OSError as e:
            raise SpotifyAuthError(
                f"Port {REDIRECT_PORT} is busy (is another auth in progress?): {e}"
            )
        threading.Thread(target=self._server.serve_forever, daemon=True).start()

    def _shutdown_server(self):
        if self._server:
            try:
                self._server.shutdown()
                self._server.server_close()
            except Exception:
                pass
            self._server = None

    # ── Token exchange ───────────────────────────────────────────────

    def _exchange_code(self, code: str):
        try:
            resp = requests.post(TOKEN_URL, data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": REDIRECT_URI,
                "client_id": self._client_id,
                "code_verifier": self._verifier,
            }, timeout=30)
            if resp.status_code != 200:
                raise SpotifyAuthError(
                    f"Token exchange failed ({resp.status_code}): {resp.text[:200]}")
            tokens = resp.json()

            config = load_spotify_config()
            config.client_id = self._client_id
            config.access_token = tokens["access_token"]
            config.refresh_token = tokens.get("refresh_token", "")
            config.expires_at = time.time() + tokens.get("expires_in", 3600) - 60

            # Fetch profile for a friendly display name
            try:
                me = requests.get(
                    "https://api.spotify.com/v1/me",
                    headers={"Authorization": f"Bearer {config.access_token}"},
                    timeout=15,
                ).json()
                config.user_name = me.get("display_name") or me.get("id", "")
                config.user_id = me.get("id", "")
            except Exception:
                pass

            save_spotify_config(config)
            with self._lock:
                self.user_name = config.user_name
                self.status = "connected"
        except Exception as e:
            with self._lock:
                self.status = "error"
                self.error = str(e)


def ensure_fresh_token(config: SpotifyConfig) -> SpotifyConfig:
    """Refresh the access token if it has expired. Saves and returns config."""
    if not config.refresh_token:
        raise SpotifyAuthError("Not connected to Spotify")
    if config.access_token and time.time() < config.expires_at:
        return config

    resp = requests.post(TOKEN_URL, data={
        "grant_type": "refresh_token",
        "refresh_token": config.refresh_token,
        "client_id": config.client_id,
    }, timeout=30)
    if resp.status_code != 200:
        raise SpotifyAuthError(
            f"Token refresh failed ({resp.status_code}). Reconnect your account.")
    tokens = resp.json()
    config.access_token = tokens["access_token"]
    if tokens.get("refresh_token"):
        config.refresh_token = tokens["refresh_token"]
    config.expires_at = time.time() + tokens.get("expires_in", 3600) - 60
    save_spotify_config(config)
    return config

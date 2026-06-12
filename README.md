# 🍊 Grapefruit

**A music sync manager for people who own their music.**

There are plenty of great music managers out there — but very few tools focused on keeping
homelab services, physical players, and streaming accounts *in sync*. Grapefruit treats the
music library you own as the source of truth and keeps everything else in step with it:

```
  Spotify / Apple Music  ──┐
                           │   gap analysis: what am I missing?
  Your music library  ◄────┤
        (the hub)          │   one-way sync: library → devices & servers
                           ▼
            iPod / Rockbox · Plex · local folders
```

Built with Tauri (Rust) + React, with a Python engine for scraping, matching, and syncing.
Runs on **macOS, Windows, and Linux**.

## Features

### 🔍 Streaming Gap — *what am I missing?*
Compare your streaming world against the music you actually own:
- **Playlist URL** — paste any public Spotify or Apple Music playlist link (no login needed)
- **Full Spotify library** — connect your account once and analyze Liked Songs plus every
  playlist you follow, deduplicated
- Fuzzy-matched against your library, with a **"songs to find"** list you can copy to the
  clipboard or export as CSV / plain text for your downloader of choice

### 🔄 Device Sync
One-way sync from your library to an iPod (Rockbox or Apple firmware) or any folder.
Three modes: Selective (add only), Full Mirror, and Delta (changed since last sync).

### 📥 Import
Turn a streaming playlist URL into a real playlist on your device — fetch, match against
what's on the device, resolve uncertain matches by hand, save as M3U8.

### 🟠 Plex
- Push device playlists to your Plex server (filename + metadata matching)
- Pull metadata *from* Plex onto your files — field-by-field diff, then apply tags and artwork

### 📚 Library management
Browse and search your device library, edit tags and album art, find duplicates
(trash-with-undo), health check, and auto-organize into Artist/Album folders.

## Install

Grab the latest installer from [Releases](https://github.com/FugginBeenus/grapefruit/releases):
`.dmg` (macOS), `.exe` (Windows), `.AppImage` / `.deb` (Linux).

## Connecting Spotify (one-time, ~2 minutes)

Full-library analysis uses Spotify's official API with your own free developer app:

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and log in
2. **Create app** — any name, check **Web API**
3. Set the Redirect URI to `http://127.0.0.1:8721/callback`
4. Copy the **Client ID** into Grapefruit → Settings → Spotify Account → **Connect Spotify**

Tokens are encrypted at rest. Grapefruit only requests read access (library + playlists).

## Finding your Plex token

Settings → Plex Server has a built-in walkthrough, or see
[Plex's guide](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/).

## Development

Requirements: Node 18+, Rust ([rustup.rs](https://rustup.rs)), Python 3.10+

```bash
git clone https://github.com/FugginBeenus/grapefruit.git
cd grapefruit
npm install
pip install -r python/requirements.txt
npm run tauri dev      # starts frontend + Rust shell + Python sidecar together
```

### Architecture

```
src/            React + Tailwind UI (pages, stores, components)
src-tauri/      Rust shell — window, sidecar lifecycle, JSON-RPC bridge
python/         Sidecar engine — JSON-RPC over stdio
  core/         scrapers, fuzzy matcher, sync engine, Plex & Spotify clients
```

The frontend never touches the network or filesystem directly — everything goes through
`rpcCall()` → Rust → the Python sidecar.

### Release builds

```bash
npm run tauri build
```

Tagged pushes (`v*`) build installers for all three platforms via GitHub Actions
(`.github/workflows/release.yml`), bundling the sidecar as a PyInstaller binary.

## License

ISC

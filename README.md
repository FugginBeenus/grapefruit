# Grapefruit

A desktop music manager for iPod/Rockbox and Plex. Import playlists from Spotify and Apple Music, sync music to your device, and push playlists to your Plex server.

## Requirements

- **Node.js** 18+
- **Rust** (install via [rustup.rs](https://rustup.rs))
- **Python 3.10+**
- **Tauri CLI** — installed automatically via npm

## Setup

```bash
git clone https://github.com/FugginBeenus/grapefruit.git
cd grapefruit
npm install
```

## Run

```bash
npm run tauri dev
```

This starts the React frontend, Rust backend, and Python sidecar together.

## Build

```bash
npm run tauri build
```

Produces a standalone `.app` (macOS) or installer for your platform.

## What it does

- **Library** — Browse and search tracks on your iPod/Rockbox device
- **Import** — Fetch playlists from Spotify or Apple Music URLs, match against your library, and save to device
- **Sync** — Copy music from a local folder to your device
- **Duplicates** — Find and remove duplicate tracks
- **Plex Sync** — Push device playlists to your Plex server with filename + metadata matching
- **Plex Settings** — Configure your Plex server connection (URL, token, library path)

<p align="center">
  <img src="grapefruit_logo.png" alt="Grapefruit" width="110">
</p>

# Grapefruit

A desktop music sync manager. Grapefruit treats the music library you own as the source of truth and keeps everything else lined up with it: your streaming accounts, a Plex server, and your iPod.

Most music apps focus on playback or tagging. Grapefruit focuses on the syncing side. It tells you what your streaming accounts have that your library is missing, shows you where every track and playlist actually lives, and lets you edit in one place and push out to everywhere you listen.

```
  Spotify · Apple Music · Plex · your iPod
                 |
                 |   find what you are missing, and see
                 v   where each track and playlist lives
        your music library (the hub)
                 |
                 |   edit once, then sync it back out
                 v
        iPod · Plex      (Soulseek fills the gaps)
```

Built with Tauri (Rust) and React, with a Python engine for scraping, matching, and syncing. Runs on macOS, Windows, and Linux.

## What it does

- **Connect all your sources at once.** Your library folder is the hub. Alongside it you can connect your iPod, your Plex server, and your Spotify account, and they all stay connected together. The sidebar shows each one and whether it is live.

- **See where everything lives.** In the Library, every track can be tagged by location. It shows LIB, DEV, PLEX, and SPOT pills for the sources that actually hold it, pooled from all of them at once, so you can tell at a glance what is only on your iPod, only on Spotify, or already everywhere. Playlists get the same treatment.

- **Streaming Gap.** Compare a streaming source against your library and get the list of songs you still need to find. Works with any public Spotify or Apple Music playlist link (no login), or with your full Spotify library once you connect your account. Copy the missing list to the clipboard or export it as CSV or plain text.
  - Whole Apple Music library: make a playlist of all your songs, share it with a public link, and paste that. No account or API needed.
  - Spotify's API now requires a Premium account (this changed in Feb 2026). The playlist-link gap works on any account.

- **Playlists, edited once and synced anywhere.** Grapefruit pulls playlists from your library, your iPod, Plex, and Spotify into one list, each tagged by where it lives. Edit a playlist in your library, then push it out. Sync to iPod copies over any songs the iPod is missing first, so the playlist never points at tracks that are not there, and Push to Plex sends it to your server. An iPod or streaming playlist can be pulled into the library to make it editable.

- **Device Sync.** One-way sync of the actual files from your library to an iPod (Rockbox or Apple firmware) or any folder. Three modes: selective, full mirror, and delta.

- **Fill the gaps with Soulseek.** Point Grapefruit at a running slskd daemon and it can search Soulseek for the tracks your Streaming Gap says you are missing, ranked by quality, and download them. Review the downloads, fix the tags, and find the art before you bring them into your library.

- **Import.** Turn a playlist link into a real playlist on your device: fetch it, match it against what you already have, resolve the uncertain matches by hand, and save it as M3U8.

- **Plex.** Push playlists to your Plex server, or pull Plex metadata (tags and artwork) onto your files, with a field-by-field diff before anything is written.

- **Library tools.** Browse and search everything you own, edit tags and album art, find duplicates (with a "not a duplicate" option for different versions, and a trash you can undo), run a health check, and auto-organize into Artist/Album folders.

- **Light and dark.** A full redesign with matching light and dark themes, toggled from the sidebar.

## Screenshots

**Streaming Gap.** Point it at a streaming source and your library, and it tells you what you are missing.

![Streaming Gap](assets/screenshots/streaming-gap.png)

**Library.** Browse and search everything you own.

![Library](assets/screenshots/library.png)

**Connect Spotify.** A one-time, bring-your-own-app setup for full-library analysis.

![Spotify setup](assets/screenshots/spotify-setup.png)

## Install

Download the latest installer from the
[Releases page](https://github.com/FugginBeenus/grapefruit/releases):
`.dmg` (macOS), `.exe` (Windows), `.AppImage` or `.deb` (Linux).

Grapefruit is not code-signed or notarized yet, so the OS warns on first launch.

- **macOS, "Grapefruit is damaged and can't be opened":** it is not damaged. macOS quarantines un-notarized apps. Remove the flag once, then open it normally:
  ```bash
  xattr -dr com.apple.quarantine /Applications/Grapefruit.app
  ```
  (adjust the path if you installed it elsewhere).
- **Windows, "Windows protected your PC":** click **More info**, then **Run anyway**.

## Connecting Spotify

Heads up: as of February 2026 Spotify's API requires a Premium account. On a free account, library reads may be blocked. The playlist-link gap (including the Apple Music whole-library trick above) still works on any account, no login required.

Full-library analysis uses Spotify's official API through your own free developer app. It is a one-time setup, about two minutes.

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and log in with your Spotify account.
2. Create an app (any name), and check **Web API**.
3. Set the Redirect URI to `http://127.0.0.1:8721/callback`.
4. Copy the Client ID into Grapefruit, under Settings, Spotify Account, Connect.

Grapefruit only asks for read access (library and playlists), and tokens are stored encrypted.

## Connecting Soulseek (optional)

Grapefruit talks to Soulseek through [slskd](https://github.com/slskd/slskd), a headless Soulseek daemon that you run yourself. Grapefruit never joins the network directly. It only asks slskd to search and download on your behalf.

1. Install and run slskd (Docker or a binary) and sign in with your Soulseek account.
2. Turn on its web API and set an API key.
3. Put the slskd URL and that API key into Grapefruit, under Settings, Soulseek, then Test connection.

## Finding your Plex token

Settings, Plex Server has a built-in walkthrough, or see
[Plex's guide](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/).

## Development

Requirements: Node 18+, Rust ([rustup.rs](https://rustup.rs)), Python 3.10+

```bash
git clone https://github.com/FugginBeenus/grapefruit.git
cd grapefruit
npm install
pip install -r python/requirements.txt
npm run tauri dev      # frontend + Rust shell + Python sidecar together
```

### How it's put together

```
src/            React + Tailwind UI (pages, stores, components)
src-tauri/      Rust shell, window, sidecar lifecycle, JSON-RPC bridge
python/         sidecar engine, JSON-RPC over stdio
  core/         scrapers, fuzzy matcher, sync engine, Plex and Spotify clients
```

The frontend never touches the network or filesystem directly. Everything goes through `rpcCall()`, then Rust, then the Python sidecar.

### Release builds

```bash
npm run tauri build
```

Pushing a `v*` tag builds installers for all three platforms via GitHub Actions
(`.github/workflows/release.yml`), with the sidecar compiled by PyInstaller.

## License

ISC

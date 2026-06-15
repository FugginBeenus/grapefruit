# Changelog

## [2.2.3] - 2026-06-15

### Added
- **Update-available banner** — checks GitHub for a newer release on launch
  and shows a dismissible download prompt.
- **Master library path** in Settings — a dedicated source-of-truth music
  folder, separate from the Plex server path; Device Sync defaults to it.
- **Interactive Sync Plan** — click the To Copy / To Remove tiles to review the
  exact files that will change before syncing.
- **Apple Music whole-library gap** — guide to compare your entire Apple Music
  library by sharing it as a public playlist (no API or paid account).
- Progress indicators (including an indeterminate mode) for the health check,
  duplicate finder, and auto-organize.

### Changed
- App logo in the sidebar (replacing the "G"), a Plex mark in the Plex settings
  card, and a click-to-copy Spotify redirect URI.
- Warn that Spotify's API now requires Premium (Feb 2026), with a clearer 403.

### Fixed
- Search icon no longer overlaps the placeholder in the Library/Playlists
  search fields.
- Local-library storage gauge is proportional to the library's footprint
  instead of the whole disk's usage.
- macOS: bundle Info.plist usage descriptions (Local Network, Removable
  Volumes, Desktop/Documents/Downloads) so permission prompts appear with
  clear reasons instead of access silently failing; surface actionable errors
  when a Plex connection or file access is blocked.

## [2.2.2] - 2026-06-15

### Fixed
- **Playlist-URL gap reports and Import were broken** — every URL returned
  "Unsupported playlist source". `detect_playlist_source` returns a
  `(type, url)` tuple, but the fetch handler compared it to a bare string, so
  no source ever matched. Now routes on the detected type, with a clearer
  error for genuinely unrecognized links. (Same root cause class as the 2.2.1
  match fix: the sidecar handler was written against a slightly different core
  API and only became reachable once the sidecar started running in 2.2.)

### Docs
- README: added feature screenshots (Streaming Gap, Library, Spotify setup).

## [2.2.1] - 2026-06-13

### Fixed
- **Matching was completely broken** (Streaming Gap, Spotify analyze, and
  Import). `match_tracks` constructed the `Matcher` with the wrong signature
  (`Matcher()` instead of `Matcher(local_tracks)`) and never populated the
  normalized title/artist fields the matcher indexes on. The first surfaced as
  a crash (`Matcher.__init__() missing 1 required positional argument`); the
  second would have silently returned every track as "missing". Both fixed,
  with a clear error when no library is loaded.
- **Match results serialized wrong.** Enum statuses went over the wire as
  `"MatchStatus.MATCHED"` instead of `"matched"`, so the UI's filters never
  matched — the gap report would have shown nothing as missing. `_serialize`
  now emits enum `.value`.
- **Intel Macs couldn't start the sidecar.** The x86_64 `.dmg` shipped an
  arm64 sidecar binary (PyInstaller built on GitHub's now-arm64 `macos-latest`
  runner and can't cross-compile), so it failed to launch on Intel Macs —
  no device detection, errors browsing local folders. The x86_64 sidecar now
  builds on the `macos-15-intel` runner, and a CI step asserts each sidecar's
  architecture matches its target.

## [2.2.0] - 2026-06-12

### Major: Pivot to Music Sync Manager

Grapefruit refocuses on what makes it unique: keeping homelab services, physical
players, and streaming accounts in sync with the music library you own. Music
managers are everywhere; sync managers aren't.

### New: Streaming Gap
- **Gap report** (new landing page): compare a streaming source against your local
  library and get the list of songs you're missing
- **Playlist URL source**: any public Spotify / Apple Music playlist, no login
- **Full Spotify library source**: official OAuth (PKCE) — Liked Songs + all
  playlists, deduplicated; tokens encrypted at rest like the Plex token
- **Copy / Export**: missing list to clipboard, CSV, or plain text — feed it
  straight to your downloader

### New: Spotify account connection
- Settings → Spotify Account: bring-your-own (free) developer app Client ID,
  one-click browser auth on a localhost loopback, status + disconnect
- Sidecar: `spotify_*` RPC methods, `core/spotify_{config,auth,client}.py`

### Changed
- Sidebar reorganized sync-first: **Sync** (Streaming Gap, Device Sync, Import),
  **Manage** (Library, Playlists, Tools, Settings)
- App identity copy updated from "music manager" to "music sync manager"
- New `write_text_file` RPC for exports

### Fixed
- **Release packages couldn't start the Python sidecar at all** (every platform).
  The sidecar resolver checked a compile-time path (`CARGO_MANIFEST_DIR`) that
  only exists on the CI runner (e.g. `D:\a\grapefruit\grapefruit`) and bailed
  before ever looking for the bundled PyInstaller binary — so installed apps
  couldn't detect iPods or open local folders unless users recreated the CI
  workspace path by hand. Release builds now prefer the bundled sidecar binary
  and never consult compile-time paths; dev builds prefer the python/ source.
- Windows dev: sidecar now tries `python3`, `python`, and `py` interpreters
  instead of only `python3`.

### CI
- Linux release target (ubuntu-22.04): `.AppImage` + `.deb` artifacts

## [2.1.0] - 2026-04-13

### Major: Pivot to Robust Music Manager

Grapefruit is no longer a simple sync tool — it's a full-featured music manager
for iPod, Rockbox, and Plex libraries.

### Design Overhaul
- **Multi-color accent system**: Each section has its own color identity — Library (cyan), Playlists (violet), Import (pink), Tools (amber), Sync (emerald), Settings (info)
- **Icon box system**: New `.icon-box` utility classes (sm/md/lg) with per-color variants
- **Badge system**: Colored `.badge-{color}` classes for stats and labels
- **Album art placeholders**: 8 unique gradient backgrounds instead of flat gray
- **Status bar**: Track count (cyan), duration (violet), size (amber)
- **Improved sidebar**: Colored nav icons, section accent lines, playlist section with violet theme

### New Pages & Components
- **Settings page**: Consolidated Plex server config + music library path + about section
- **Playlists page**: Dedicated playlist browser with detail view and track listing
- **Tools page**: Health Check, Duplicate Finder, and Auto-Organize tabs
- **Sync page**: Device Sync (local folder → device) and Plex Sync (playlists → Plex) with metadata sync integration
- **MetadataEditor**: Inline tag editor for title, artist, album, year, genre, track number, artwork
- **TrackTable**: Sortable, selectable track table with context menu and batch operations
- **Toast notifications**: Global toast system via zustand store
- **StatusBar**: Persistent bottom bar with library stats and device connection status

### Plex Integration
- **Plex metadata diff**: Compare device file tags against Plex library and show field-by-field differences
- **Plex metadata pull**: Apply Plex metadata (title, artist, album, year, genre, track/disc number, artwork) to device files
- **Plex track details API**: Fetch full track metadata including artwork from Plex server
- **Encrypted token storage**: Plex auth token stored encrypted at `~/.grapefruit/plex_config.json`

### Sync Engine
- **One-way sync architecture**: Master library is always the source of truth; sync flows master → device only
- **Three sync modes**: Selective (add only), Full Mirror (mirror + delete from device), Delta (changed since last sync)
- **Metadata sync in Sync flow**: After file sync, optionally compare and update metadata against Plex
- **Source folder defaults to Settings path**: Music library path from Settings auto-populates everywhere

### Library Tools
- **Health Check**: Scans for missing title/artist/album, no artwork, broken files, inconsistent album artists; auto-scans library if not yet loaded
- **Duplicate Finder**: Groups tracks by normalized artist + title; handles null values safely; auto-scans if needed
- **Auto-Organize**: Reorganize files into folder structures by pattern (Artist/Album, Genre/Artist/Album, etc.) with dry-run preview
- Removed standalone "Plex Metadata" tool — metadata sync is now part of the Sync flow

### Native File Picker
- **Tauri dialog plugin** (`@tauri-apps/plugin-dialog`): Added native OS folder picker
- **Sidebar "Browse local folder"**: Opens native folder dialog instead of text input
- **Sync page "Master Library"**: Browse button opens native picker alongside manual text input
- **Library page "Use Local Folder"**: Native dialog replaces `prompt()` call

### Backend (Python Sidecar)
- **RPC handler**: 15+ new methods — metadata diff/pull, health check, duplicates, delete files, auto-organize, track metadata read/write, add files to device, Plex config management
- **Plex client**: `get_track_details()`, `get_track_artwork()`, `get_all_tracks_detailed()` for full metadata fetching
- **Local scanner**: Supports 16 audio formats with music-tag + tinytag fallback + filename parsing
- **Sync engine**: Compute plans with progress callbacks, execute with file copy tracking
- **Session management**: Thread-safe device state with lock, rockbox library caching
- **Auto-scan fallback**: Health check and duplicates auto-scan the library if tracks aren't loaded yet

### Rust / Tauri
- **Dialog plugin**: Registered `tauri-plugin-dialog` with `dialog:allow-open` permission
- **Sidecar resilience**: Auto-restart sidecar on broken pipe with retry logic
- **Progress notifications**: JSON-RPC notifications from Python forwarded to frontend as Tauri events

### Removed
- `Welcome.tsx`, `Duplicates.tsx`, `PlaylistDetail.tsx`, `PlexSettings.tsx`, `PlexSync.tsx`, `SyncMusic.tsx` — replaced by consolidated pages

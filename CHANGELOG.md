# Changelog

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

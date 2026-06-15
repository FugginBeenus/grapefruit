import { useState, useMemo, useCallback, useEffect } from "react";
import { useDeviceStore } from "../stores/deviceStore";
import { rpcCall } from "../api/sidecar";
import { open } from "@tauri-apps/plugin-dialog";
import TrackTable from "../components/TrackTable";
import type { SortField } from "../components/TrackTable";
import MetadataEditor from "../components/MetadataEditor";
import { ProgressBar } from "../components/ProgressBar";
import { useProgress } from "../hooks/useProgress";
import type { DeviceTrack, TrackMetadata, AlbumArt } from "../types/models";

type ViewMode = "table" | "albums";

/* ── Helpers ────────────────────────────────────── */

function formatTotalDuration(tracks: DeviceTrack[]): string {
  const total = tracks.reduce((s, t) => s + (t.duration_seconds ?? 0), 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatTotalSize(tracks: DeviceTrack[]): string {
  const total = tracks.reduce((s, t) => s + t.file_size, 0);
  if (total < 1024 * 1024 * 1024)
    return `${(total / (1024 * 1024)).toFixed(0)} MB`;
  return `${(total / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

const ALBUM_GRADIENTS = [
  "linear-gradient(135deg, #2D1B2E 0%, #1A1028 100%)",  // violet-plum
  "linear-gradient(135deg, #1B2D2E 0%, #0F2028 100%)",  // teal-deep
  "linear-gradient(135deg, #2D2A1B 0%, #28200F 100%)",  // amber-earth
  "linear-gradient(135deg, #1B2B2D 0%, #102028 100%)",  // cyan-marine
  "linear-gradient(135deg, #2D1B24 0%, #281018 100%)",  // pink-rose
  "linear-gradient(135deg, #1B2D1F 0%, #0F2814 100%)",  // emerald-forest
  "linear-gradient(135deg, #252040 0%, #1A1830 100%)",  // indigo-night
  "linear-gradient(135deg, #30201B 0%, #281510 100%)",  // coral-warm
];

const ALBUM_ICON_COLORS = [
  "text-violet/40", "text-cyan/40", "text-amber/40", "text-sky/40",
  "text-pink/40", "text-emerald/40", "text-info/40", "text-gf/40",
];

function albumStyleFromName(name: string): { bg: string; iconColor: string } {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const idx = Math.abs(hash) % ALBUM_GRADIENTS.length;
  return { bg: ALBUM_GRADIENTS[idx], iconColor: ALBUM_ICON_COLORS[idx] };
}

interface AlbumGroup { album: string; artist: string; tracks: DeviceTrack[] }

const MUSIC_NOTE = "M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z";
function MusicIcon({ className }: { className: string }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d={MUSIC_NOTE} /></svg>;
}

/* ================================================================ */
/*  Library                                                          */
/* ================================================================ */
export default function Library() {
  const {
    selectedDevice,
    tracks,
    playlists,
    loadingLibrary,
    refreshLibrary,
    refreshPlaylists,
    scanForDevices,
    connectLocalLibrary,
  } = useDeviceStore();

  /* ── State ──────────────────────────────────────── */
  const [view, setView] = useState<ViewMode>("table");
  const [search, setSearch] = useState("");
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [sortColumn, setSortColumn] = useState<SortField>("title");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [albumFilter, setAlbumFilter] = useState<string | null>(null);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; trackIndex: number } | null>(null);
  const [editMeta, setEditMeta] = useState<TrackMetadata | null>(null);
  const [editArt, setEditArt] = useState<AlbumArt | null>(null);
  const [editTrackPath, setEditTrackPath] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "ok" | "err" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAddInput, setShowAddInput] = useState(false);
  const [addPath, setAddPath] = useState("");
  const progress = useProgress("scan_device_library");
  const addProgress = useProgress("add_files");

  /* ── Derived data ───────────────────────────────── */
  const filteredTracks = useMemo(() => {
    let result = tracks;
    if (albumFilter) {
      result = result.filter((t) => (t.album || "Unknown Album") === albumFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.artist.toLowerCase().includes(q) ||
          t.album.toLowerCase().includes(q)
      );
    }
    return result;
  }, [tracks, search, albumFilter]);

  const sortedTracks = useMemo(() => {
    const sorted = [...filteredTracks];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortColumn) {
        case "title": cmp = (a.title || "").localeCompare(b.title || ""); break;
        case "artist": cmp = (a.artist || "").localeCompare(b.artist || ""); break;
        case "album": cmp = (a.album || "").localeCompare(b.album || ""); break;
        case "duration": cmp = (a.duration_seconds ?? 0) - (b.duration_seconds ?? 0); break;
        case "size": cmp = a.file_size - b.file_size; break;
        case "format": cmp = a.format.localeCompare(b.format); break;
        default: cmp = 0;
      }
      return sortDirection === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [filteredTracks, sortColumn, sortDirection]);

  const albumGroups = useMemo<AlbumGroup[]>(() => {
    const map = new Map<string, DeviceTrack[]>();
    const q = search.trim().toLowerCase();
    const source = q ? tracks.filter((t) => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q) || t.album.toLowerCase().includes(q)) : tracks;
    for (const t of source) { const k = t.album || "Unknown Album"; if (!map.has(k)) map.set(k, []); map.get(k)!.push(t); }
    return Array.from(map.entries())
      .map(([album, at]) => ({ album, artist: at[0]?.artist || "Unknown Artist", tracks: at.sort((a, b) => (a.track_number ?? 999) - (b.track_number ?? 999)) }))
      .sort((a, b) => a.album.localeCompare(b.album));
  }, [tracks, search]);

  const selectedTracks = useMemo(
    () => Array.from(selectedIndices).map((i) => sortedTracks[i]).filter(Boolean),
    [selectedIndices, sortedTracks]
  );

  /* ── Helpers ────────────────────────────────────── */
  const flash = useCallback((msg: string, type: "ok" | "err" = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const handleSort = useCallback((col: SortField) => {
    if (col === sortColumn) setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortColumn(col); setSortDirection("asc"); }
  }, [sortColumn]);

  /* ── Actions ────────────────────────────────────── */
  const openMetadataEditor = useCallback(async (track: DeviceTrack) => {
    try {
      const [meta, art] = await Promise.all([rpcCall<TrackMetadata>("get_track_metadata", { path: track.relative_path }), rpcCall<AlbumArt>("get_album_art", { path: track.relative_path })]);
      setEditTrackPath(track.relative_path); setEditMeta(meta); setEditArt(art);
    } catch (e) { flash(`Failed to load metadata: ${e}`, "err"); }
  }, [flash]);

  const handleSaveMetadata = useCallback(async (meta: Partial<TrackMetadata>) => {
    if (!editTrackPath) return;
    try { await rpcCall("set_track_metadata", { path: editTrackPath, metadata: meta }); setEditMeta(null); setEditArt(null); setEditTrackPath(null); flash("Metadata saved."); await refreshLibrary(); }
    catch (e) { flash(`Failed to save: ${e}`, "err"); }
  }, [editTrackPath, flash, refreshLibrary]);

  const handleArtChange = useCallback(async (base64Data: string | null) => {
    if (!editTrackPath) return;
    try {
      await rpcCall(base64Data ? "set_album_art" : "remove_album_art", base64Data ? { path: editTrackPath, data: base64Data } : { path: editTrackPath });
      setEditArt(await rpcCall<AlbumArt>("get_album_art", { path: editTrackPath }));
    } catch (e) { flash(`Art update failed: ${e}`, "err"); }
  }, [editTrackPath, flash]);

  const handleDelete = useCallback(async () => {
    if (selectedTracks.length === 0) return;
    setBusy(true);
    try {
      const res = await rpcCall<{ deleted: number; errors: string[] }>("delete_files", { paths: selectedTracks.map((t) => t.relative_path) });
      flash(`Moved ${res.deleted} file${res.deleted !== 1 ? "s" : ""} to trash.`);
      setSelectedIndices(new Set()); await refreshLibrary();
    } catch (e) { flash(String(e), "err"); } finally { setBusy(false); }
  }, [selectedTracks, flash, refreshLibrary]);

  const handleAddToPlaylist = useCallback(async (playlistName: string) => {
    setBusy(true);
    try {
      const pl = playlists.find((p) => p.name === playlistName);
      if (!pl) return;
      const existing = await rpcCall<DeviceTrack[]>("read_playlist", { path: pl.path });
      const paths = existing.map((t) => t.relative_path);
      const combined = [...paths, ...selectedTracks.map((t) => t.relative_path).filter((p) => !paths.includes(p))];
      await rpcCall("write_playlist", { name: playlistName, track_paths: combined });
      flash(`Added ${selectedTracks.length} track${selectedTracks.length !== 1 ? "s" : ""} to "${playlistName}".`);
      setSelectedIndices(new Set());
    } catch (e) { flash(String(e), "err"); } finally { setBusy(false); }
  }, [selectedTracks, playlists, flash]);

  const handleAddFiles = useCallback(async () => {
    const target = addPath.trim();
    if (!target) return;
    setShowAddInput(false); setAddPath(""); setBusy(true);
    try { const res = await rpcCall<{ copied: number; errors: string[] }>("add_files_to_device", { files: [target] }); flash(`Copied ${res.copied} file${res.copied !== 1 ? "s" : ""} to device.`); await refreshLibrary(); }
    catch (e) { flash(String(e), "err"); } finally { setBusy(false); }
  }, [addPath, flash, refreshLibrary]);

  const handleRefresh = useCallback(async () => { await Promise.all([refreshLibrary(), refreshPlaylists()]); }, [refreshLibrary, refreshPlaylists]);

  const handleContextMenu = useCallback((index: number, e: React.MouseEvent) => {
    setContextMenu({ x: e.clientX, y: e.clientY, trackIndex: index });
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
    document.addEventListener("click", dismiss);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("click", dismiss); document.removeEventListener("keydown", onKey); };
  }, [contextMenu]);

  useEffect(() => { setSelectedIndices(new Set()); }, [tracks]);

  const handleTrackDoubleClick = useCallback((index: number) => {
    const track = sortedTracks[index];
    if (track) openMetadataEditor(track);
  }, [sortedTracks, openMetadataEditor]);

  const handleAlbumClick = useCallback((albumName: string) => {
    setAlbumFilter(albumName); setView("table"); setSelectedIndices(new Set());
  }, []);

  /* ================================================================ */
  /*  Empty: no device                                                 */
  /* ================================================================ */
  if (!selectedDevice) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-120px)] text-center gap-8">
        {/* Large glowing icon */}
        <div className="relative">
          <div className="w-24 h-24 rounded-3xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(34, 211, 238, 0.15) 0%, rgba(167, 139, 250, 0.08) 100%)", boxShadow: "0 0 60px rgba(34, 211, 238, 0.1), 0 8px 32px rgba(0,0,0,0.3)" }}>
            <MusicIcon className="w-12 h-12 text-cyan/60" />
          </div>
          <div className="absolute -inset-4 rounded-[32px] opacity-50" style={{ background: "radial-gradient(circle, rgba(34, 211, 238, 0.08) 0%, transparent 70%)" }} />
        </div>

        <div className="space-y-2 max-w-sm">
          <h2 className="text-xl font-semibold text-t">Welcome to your Library</h2>
          <p className="text-sm text-t-muted leading-relaxed">
            Connect your iPod, Rockbox player, or point to a local music folder to start managing your collection.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <button onClick={() => scanForDevices()} className="btn btn-secondary px-5 py-2.5">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" /></svg>
            Scan for Devices
          </button>
          <button
            onClick={async () => {
              const selected = await open({ directory: true, multiple: false, title: "Select your music library folder" });
              if (selected) {
                try { await connectLocalLibrary(typeof selected === "string" ? selected : selected); }
                catch (e) { flash(String(e), "err"); }
              }
            }}
            className="btn btn-primary px-5 py-2.5"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" /></svg>
            Use Local Folder
          </button>
        </div>
      </div>
    );
  }

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */
  return (
    <div className="flex flex-col h-[calc(100vh-80px)]">
      {/* ── Header ──────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6 shrink-0 pt-2">
        <div>
          <h1 className="text-3xl font-bold text-t tracking-tight">Library</h1>
          <div className="flex items-center gap-2 mt-2">
            {tracks.length > 0 ? (
              <>
                <span className="badge badge-cyan">{tracks.length.toLocaleString()} tracks</span>
                <span className="badge badge-violet">{formatTotalDuration(tracks)}</span>
                <span className="badge badge-amber">{formatTotalSize(tracks)}</span>
              </>
            ) : (
              <p className="text-sm text-t-muted">Scan your device to load tracks</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-bg-surface rounded-lg p-0.5">
            <button
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                view === "table" ? "bg-bg-hover text-t" : "text-t-muted hover:text-t-secondary"
              }`}
              onClick={() => { setView("table"); setAlbumFilter(null); }}
            >
              Table
            </button>
            <button
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                view === "albums" ? "bg-bg-hover text-t" : "text-t-muted hover:text-t-secondary"
              }`}
              onClick={() => { setView("albums"); setAlbumFilter(null); }}
            >
              Albums
            </button>
          </div>
        </div>
      </div>

      {/* ── Toolbar ─────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-4 shrink-0">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-t-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            className="input input-with-icon py-2 text-sm"
            placeholder="Search tracks..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-t-muted hover:text-t transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Album filter badge */}
        {albumFilter && (
          <button
            onClick={() => setAlbumFilter(null)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-gf-glow text-gf text-xs font-medium border border-gf-border"
          >
            Album: {albumFilter}
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}

        <div className="flex-1" />

        {/* Actions */}
        <button className="btn btn-ghost text-xs" onClick={() => setShowAddInput((v) => !v)}>
          + Add Files
        </button>
        <button className="btn btn-ghost text-xs" onClick={handleRefresh} disabled={loadingLibrary}>
          {loadingLibrary ? "Scanning..." : "\u21BB Refresh"}
        </button>
      </div>

      {/* ── Add files bar ───────────────────────────── */}
      {showAddInput && (
        <div className="flex items-center gap-2 px-4 py-2.5 mb-4 rounded-xl bg-bg-surface border shrink-0">
          <input
            type="text"
            value={addPath}
            onChange={(e) => setAddPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddFiles()}
            placeholder="Path to file or folder to add..."
            className="input flex-1 text-[12px] py-1.5"
            autoFocus
          />
          <button onClick={handleAddFiles} disabled={busy || !addPath.trim()} className="btn btn-primary text-[11px] py-1 px-3">
            {busy ? "Copying..." : "Add"}
          </button>
          <button onClick={() => { setShowAddInput(false); setAddPath(""); }} className="btn btn-ghost text-[11px] py-1 px-2">
            Cancel
          </button>
        </div>
      )}

      {/* ── Progress ────────────────────────────────── */}
      {loadingLibrary && progress.total > 0 && (
        <div className="mb-4 shrink-0">
          <ProgressBar percent={progress.percent} label="Scanning device..." sublabel={`${progress.current.toLocaleString()} / ${progress.total.toLocaleString()}`} />
        </div>
      )}
      {busy && addProgress.total > 0 && (
        <div className="mb-4 shrink-0">
          <ProgressBar percent={addProgress.percent} label="Adding files..." sublabel={`${addProgress.current} / ${addProgress.total}`} />
        </div>
      )}

      {/* ── Toast ───────────────────────────────────── */}
      {toast && (
        <div className={`flex items-center justify-between p-3 mb-4 rounded-xl text-[13px] shrink-0 ${
          toast.type === "ok" ? "bg-ok-muted border border-ok/20 text-ok" : "bg-err-muted border border-err/20 text-err"
        }`}>
          <span>{toast.msg}</span>
          <button onClick={() => setToast(null)} className="ml-3 opacity-60 hover:opacity-100">&times;</button>
        </div>
      )}

      {/* ── Main content ────────────────────────────── */}
      <div className="flex-1 min-h-0">
        {/* Table view */}
        {view === "table" && tracks.length > 0 && (
          <TrackTable
            tracks={sortedTracks}
            selectedIndices={selectedIndices}
            onSelectionChange={setSelectedIndices}
            onTrackDoubleClick={handleTrackDoubleClick}
            onContextMenu={handleContextMenu}
            sortColumn={sortColumn}
            sortDirection={sortDirection}
            onSort={handleSort}
          />
        )}

        {/* Table view: empty search */}
        {view === "table" && tracks.length > 0 && sortedTracks.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-t-muted gap-3 py-20">
            <p className="text-sm">No tracks match &ldquo;{search}&rdquo;</p>
            <button onClick={() => { setSearch(""); setAlbumFilter(null); }} className="btn btn-ghost text-xs">Clear Filters</button>
          </div>
        )}

        {/* Table view: no tracks at all */}
        {view === "table" && tracks.length === 0 && !loadingLibrary && (
          <div className="flex flex-col items-center justify-center h-full text-t-muted gap-3 py-20">
            <MusicIcon className="w-10 h-10" />
            <p className="text-sm">No tracks found. Your library appears to be empty.</p>
            <button onClick={handleRefresh} className="btn btn-secondary text-xs">Scan Library</button>
          </div>
        )}

        {/* Albums view */}
        {view === "albums" && (
          <div className="grid gap-4 overflow-y-auto h-full p-1" style={{ gridTemplateColumns: "repeat(auto-fill, 160px)" }}>
            {albumGroups.length === 0 && (
              <div className="col-span-full flex items-center justify-center py-20 text-t-muted text-sm">
                No albums found
              </div>
            )}
            {albumGroups.map((group) => (
              <button
                key={group.album}
                onClick={() => handleAlbumClick(group.album)}
                className="flex flex-col text-left rounded-xl p-2.5 transition-all duration-150 hover:bg-bg-hover hover:scale-[1.02] group"
              >
                {/* Placeholder art */}
                <div className="w-full aspect-square rounded-lg flex items-center justify-center mb-2.5" style={{ background: albumStyleFromName(group.album).bg }}>
                  <MusicIcon className={`w-10 h-10 ${albumStyleFromName(group.album).iconColor}`} />
                </div>
                <p className="text-[13px] font-medium text-t truncate w-full">{group.album}</p>
                <p className="text-[11px] text-t-muted truncate w-full">{group.artist}</p>
                <p className="text-[11px] text-t-muted mt-0.5">
                  {group.tracks.length} track{group.tracks.length !== 1 ? "s" : ""}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Selection toolbar ───────────────────────── */}
      {selectedIndices.size > 0 && (
        <div
          className="flex items-center justify-between px-4 py-2.5 bg-bg-surface border-t border-b rounded-t-xl shrink-0"
          style={{ animation: "slideUp 150ms ease-out" }}
        >
          <span className="text-sm text-t-secondary">
            {selectedIndices.size} track{selectedIndices.size !== 1 ? "s" : ""} selected
          </span>
          <div className="flex items-center gap-2">
            <button className="btn btn-ghost text-xs" onClick={() => {
              if (selectedTracks.length === 1) openMetadataEditor(selectedTracks[0]);
              else if (selectedTracks.length > 1) openMetadataEditor(selectedTracks[0]);
            }}>
              Edit Info
            </button>
            {playlists.length > 0 && (
              <select
                onChange={(e) => { if (e.target.value) handleAddToPlaylist(e.target.value); e.target.value = ""; }}
                className="bg-bg-elevated text-t text-[12px] rounded-lg px-2 py-1.5 border cursor-pointer"
                defaultValue=""
              >
                <option value="" disabled>Add to Playlist...</option>
                {playlists.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
            )}
            <button className="btn btn-danger text-xs" onClick={handleDelete} disabled={busy}>Delete</button>
          </div>
        </div>
      )}

      {/* ── Context menu ────────────────────────────── */}
      {contextMenu && (
        <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(e) => e.stopPropagation()}>
          <div className="context-menu-item" onClick={() => { const t = sortedTracks[contextMenu.trackIndex]; if (t) openMetadataEditor(t); setContextMenu(null); }}>Edit Track Info</div>
          {playlists.map((p) => (
            <div key={p.name} className="context-menu-item" onClick={() => { handleAddToPlaylist(p.name); setContextMenu(null); }}>Add to &ldquo;{p.name}&rdquo;</div>
          ))}
          <div className="context-menu-divider" />
          <div className="context-menu-item danger" onClick={() => { handleDelete(); setContextMenu(null); }}>Delete</div>
        </div>
      )}

      {/* ── Metadata editor modal ───────────────────── */}
      {editMeta && (
        <MetadataEditor
          metadata={editMeta}
          albumArt={editArt}
          onSave={handleSaveMetadata}
          onClose={() => { setEditMeta(null); setEditArt(null); setEditTrackPath(null); }}
          onArtChange={handleArtChange}
        />
      )}
    </div>
  );
}

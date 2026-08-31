import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useDeviceStore } from "../stores/deviceStore";
import { usePlexStore } from "../stores/plexStore";
import { rpcCall } from "../api/sidecar";
import { readPlaylist, writePlaylist, deletePlaylist, getIpodPlaylists, readIpodPlaylist, writeIpodPlaylist } from "../api/library";
import { plexSyncPlaylists, plexListPlaylists } from "../api/plex";
import { spotifyListPlaylists } from "../api/spotify";
import { SearchInput } from "../components/SearchInput";
import type { DeviceTrack, PlaylistInfo } from "../types/models";

function fmtDur(s: number | null): string {
  if (!s) return "--:--";
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

function formatTotalDuration(tracks: DeviceTrack[]): string {
  const total = tracks.reduce((sum, t) => sum + (t.duration_seconds ?? 0), 0);
  if (total === 0) return "";
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return h > 0 ? `${h} hr ${m} min` : `${m} min`;
}

function buildM3U(name: string, tracks: DeviceTrack[]): string {
  const lines: string[] = ["#EXTM3U", `#PLAYLIST:${name}`];
  for (const t of tracks) {
    const dur = t.duration_seconds ? Math.round(t.duration_seconds) : -1;
    const display = [t.artist, t.title].filter(Boolean).join(" - ") || t.relative_path;
    lines.push(`#EXTINF:${dur},${display}`);
    lines.push(t.relative_path);
  }
  return lines.join("\n") + "\n";
}

function downloadBlob(content: string, filename: string) {
  const blob = new Blob([content], { type: "audio/x-mpegurl" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function Playlists() {
  const { name: routeName } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const { selectedDevice, ipod, tracks: libraryTracks, playlists, refreshPlaylists } = useDeviceStore();
  const plexConnected = usePlexStore((s) => s.connected);

  const [ipodPls, setIpodPls] = useState<PlaylistInfo[]>([]);
  useEffect(() => {
    if (ipod) getIpodPlaylists().then(setIpodPls).catch(() => setIpodPls([]));
    else setIpodPls([]);
  }, [ipod]);

  const decoded = routeName ? decodeURIComponent(routeName) : null;
  const activePlaylist = playlists.find((p) => p.name === decoded) ?? null;

  // Cross-reference each local playlist against Plex so we can tag its sync
  // state. name (lowercased) -> Plex track count.
  const [plexPls, setPlexPls] = useState<{ title: string; leafCount: number }[]>([]);
  const [spotPls, setSpotPls] = useState<{ name: string; track_count: number }[]>([]);
  useEffect(() => {
    if (plexConnected) plexListPlaylists().then(setPlexPls).catch(() => setPlexPls([]));
    else setPlexPls([]);
    spotifyListPlaylists().then(setSpotPls).catch(() => setSpotPls([]));
  }, [plexConnected]);
  const plexMap = useMemo(() => new Map(plexPls.map((p) => [p.title.toLowerCase(), p.leafCount])), [plexPls]);

  const plexStatus = useCallback((name: string, trackCount: number): { label: string; tone: string } | null => {
    if (!plexConnected) return null;
    const leaf = plexMap.get(name.toLowerCase());
    if (leaf === undefined) return { label: "Not on Plex", tone: "ink3" };
    return leaf === trackCount ? { label: "Synced with Plex", tone: "emer" } : { label: "Out of sync with Plex", tone: "amber" };
  }, [plexConnected, plexMap]);

  // Pool playlists from every source, deduped by name, tagged by location.
  interface Pooled { name: string; local: PlaylistInfo | null; device: PlaylistInfo | null; plex: number | null; spotify: number | null }
  const [remoteView, setRemoteView] = useState<Pooled | null>(null);
  const pooled = useMemo<Pooled[]>(() => {
    const map = new Map<string, Pooled>();
    const put = (name: string) => {
      const k = name.toLowerCase();
      let e = map.get(k);
      if (!e) { e = { name, local: null, device: null, plex: null, spotify: null }; map.set(k, e); }
      return e;
    };
    for (const p of playlists) put(p.name).local = p;
    for (const p of ipodPls) put(p.name).device = p;
    for (const p of plexPls) put(p.title).plex = p.leafCount;
    for (const p of spotPls) put(p.name).spotify = p.track_count;
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [playlists, ipodPls, plexPls, spotPls]);

  // When a device-only (iPod) playlist is opened, load its tracks read-only.
  const [remoteTracks, setRemoteTracks] = useState<DeviceTrack[]>([]);
  const [loadingRemote, setLoadingRemote] = useState(false);
  useEffect(() => {
    if (remoteView?.device) {
      setLoadingRemote(true);
      readIpodPlaylist(remoteView.device.path)
        .then(setRemoteTracks)
        .catch(() => setRemoteTracks([]))
        .finally(() => setLoadingRemote(false));
    } else {
      setRemoteTracks([]);
    }
  }, [remoteView]);

  const [detailTracks, setDetailTracks] = useState<DeviceTrack[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [orderDirty, setOrderDirty] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [sideSearch, setSideSearch] = useState("");

  useEffect(() => {
    if (!activePlaylist) { setDetailTracks([]); return; }
    setLoadingDetail(true);
    setOrderDirty(false);
    setConfirmDel(false);
    setMsg(null);
    setShowAddPanel(false);
    readPlaylist(activePlaylist.path)
      .then(setDetailTracks)
      .catch(() => setDetailTracks([]))
      .finally(() => setLoadingDetail(false));
  }, [activePlaylist?.path]);

  useEffect(() => { if (renaming) renameRef.current?.focus(); }, [renaming]);

  const filteredPooled = useMemo(() => {
    if (!sideSearch.trim()) return pooled;
    const q = sideSearch.toLowerCase();
    return pooled.filter((p) => p.name.toLowerCase().includes(q));
  }, [pooled, sideSearch]);

  const addCandidates = useMemo(() => {
    if (!addSearch.trim()) return libraryTracks;
    const q = addSearch.toLowerCase();
    return libraryTracks.filter(
      (t) => t.title?.toLowerCase().includes(q) || t.artist?.toLowerCase().includes(q) || t.album?.toLowerCase().includes(q),
    );
  }, [libraryTracks, addSearch]);

  const selectPlaylist = useCallback((p: PlaylistInfo) => {
    navigate(`/playlists/${encodeURIComponent(p.name)}`);
  }, [navigate]);

  const handleCreate = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    try {
      await rpcCall("write_playlist", { name: trimmed, track_paths: [] });
      await refreshPlaylists();
      setNewName("");
      setCreatingNew(false);
      navigate(`/playlists/${encodeURIComponent(trimmed)}`);
    } catch (e) {
      setMsg({ text: `Failed to create playlist: ${e}`, ok: false });
    }
  };

  const startRename = () => {
    if (!activePlaylist) return;
    setRenameValue(activePlaylist.name);
    setRenaming(true);
  };

  const commitRename = async () => {
    const trimmed = renameValue.trim();
    if (!trimmed || !activePlaylist || trimmed === activePlaylist.name) { setRenaming(false); return; }
    try {
      const paths = detailTracks.map((t) => t.relative_path);
      await writePlaylist(trimmed, paths);
      await deletePlaylist(activePlaylist.path);
      await refreshPlaylists();
      setRenaming(false);
      navigate(`/playlists/${encodeURIComponent(trimmed)}`, { replace: true });
    } catch (e) {
      setMsg({ text: `Rename failed: ${e}`, ok: false });
      setRenaming(false);
    }
  };

  const handleDelete = async () => {
    if (!activePlaylist) return;
    try {
      await deletePlaylist(activePlaylist.path);
      await refreshPlaylists();
      setConfirmDel(false);
      navigate("/playlists");
    } catch (e) {
      setMsg({ text: `Delete failed: ${e}`, ok: false });
    }
  };

  const handlePush = async () => {
    if (!activePlaylist) return;
    setPushing(true);
    setMsg(null);
    try {
      const res = await plexSyncPlaylists([activePlaylist.name]);
      if (res.length > 0) {
        const r = res[0];
        if (r.status === "created" || r.status === "updated") {
          setMsg({ text: `${r.status === "created" ? "Created" : "Updated"} on Plex -- ${r.matched} matched, ${r.missing} missing`, ok: true });
        } else if (r.status === "error") {
          setMsg({ text: r.error || "Unknown error", ok: false });
        } else {
          setMsg({ text: "No matching tracks found on Plex", ok: false });
        }
      }
    } catch (e) {
      setMsg({ text: String(e), ok: false });
    } finally {
      setPushing(false);
    }
  };

  const handleSyncIpod = async () => {
    if (!activePlaylist) return;
    setPushing(true);
    setMsg(null);
    try {
      const res = await writeIpodPlaylist(activePlaylist.name, detailTracks.map((t) => t.relative_path));
      setMsg({
        text: `Synced to iPod · ${res.count} tracks${res.copied ? `, ${res.copied} copied over` : ""}${res.errors.length ? `, ${res.errors.length} failed` : ""}`,
        ok: res.errors.length === 0,
      });
      getIpodPlaylists().then(setIpodPls).catch(() => {});
    } catch (e) {
      setMsg({ text: `Sync to iPod failed: ${e}`, ok: false });
    } finally {
      setPushing(false);
    }
  };

  const importRemote = async () => {
    if (!remoteView) return;
    setPushing(true);
    try {
      await writePlaylist(remoteView.name, remoteTracks.map((t) => t.relative_path));
      await refreshPlaylists();
      const name = remoteView.name;
      setRemoteView(null);
      navigate(`/playlists/${encodeURIComponent(name)}`);
    } catch (e) {
      setMsg({ text: `Import failed: ${e}`, ok: false });
    } finally {
      setPushing(false);
    }
  };

  const handleExport = () => {
    if (!activePlaylist || detailTracks.length === 0) return;
    downloadBlob(buildM3U(activePlaylist.name, detailTracks), `${activePlaylist.name}.m3u`);
  };

  const removeTrack = (index: number) => {
    setDetailTracks((prev) => prev.filter((_, i) => i !== index));
    setOrderDirty(true);
  };

  const moveTrack = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= detailTracks.length) return;
    const next = [...detailTracks];
    [next[index], next[target]] = [next[target], next[index]];
    setDetailTracks(next);
    setOrderDirty(true);
  };

  const handleSaveOrder = async () => {
    if (!activePlaylist) return;
    try {
      await writePlaylist(activePlaylist.name, detailTracks.map((t) => t.relative_path));
      await refreshPlaylists();
      setOrderDirty(false);
      setMsg({ text: "Playlist saved", ok: true });
    } catch (e) {
      setMsg({ text: `Save failed: ${e}`, ok: false });
    }
  };

  const addTrackFromLibrary = (track: DeviceTrack) => {
    if (detailTracks.some((t) => t.relative_path === track.relative_path)) return;
    setDetailTracks((prev) => [...prev, track]);
    setOrderDirty(true);
  };

  if (!selectedDevice) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-120px)] text-center gap-7">
        <div className="relative">
          <div className="w-20 h-20 rounded-3xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(167, 139, 250, 0.15) 0%, rgba(244, 114, 182, 0.06) 100%)", boxShadow: "0 0 48px rgba(167, 139, 250, 0.1), 0 8px 24px rgba(0,0,0,0.25)" }}>
            <svg className="w-10 h-10 text-violet/50" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M12 17.25h8.25" />
            </svg>
          </div>
          <div className="absolute -inset-4 rounded-[28px] opacity-40" style={{ background: "radial-gradient(circle, rgba(167, 139, 250, 0.08) 0%, transparent 70%)" }} />
        </div>
        <div className="space-y-2 max-w-xs">
          <h2 className="text-lg font-semibold text-t">Manage Your Playlists</h2>
          <p className="text-sm text-t-muted leading-relaxed">Connect a device or local folder to create, edit, and export playlists.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-[18px] h-[calc(100vh-155px)] min-h-[480px] max-w-[1600px]" style={{ gridTemplateColumns: "280px minmax(0,1fr)" }}>
      {/* Master list */}
      <div className="flex flex-col overflow-hidden rounded-2xl border border-line bg-panel" style={{ boxShadow: "var(--shadow)" }}>
        <div className="px-4 py-3.5 flex items-center justify-between border-b border-line shrink-0">
          <div className="font-mono text-[9px] tracking-[.16em] text-ink3">PLAYLISTS · {playlists.length}</div>
          <button onClick={() => setCreatingNew(true)} className="btn btn-primary text-[11px] py-1 px-3">New</button>
        </div>

        {creatingNew && (
          <div className="px-3 pt-3 shrink-0">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") { setCreatingNew(false); setNewName(""); }
              }}
              placeholder="Playlist name"
              className="input text-[12px] py-2"
              autoFocus
            />
          </div>
        )}

        <div className="px-3 pt-3 shrink-0">
          <SearchInput value={sideSearch} onChange={setSideSearch} placeholder="Filter playlists" />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto mt-2 px-2 pb-2">
          {filteredPooled.length === 0 ? (
            <p className="text-ink3 text-[12px] text-center mt-8">
              {pooled.length === 0 ? "No playlists yet" : "No matches"}
            </p>
          ) : (
            filteredPooled.map((p) => {
              const active = activePlaylist?.name === p.name || remoteView?.name === p.name;
              const count = p.local?.track_count ?? p.device?.track_count ?? p.plex ?? p.spotify ?? 0;
              const srcs: { label: string; tone: string }[] = [];
              if (p.local) srcs.push({ label: "LIB", tone: "brand" });
              if (p.device) srcs.push({ label: "DEV", tone: "cyan" });
              if (p.plex !== null) srcs.push({ label: "PLEX", tone: "amber" });
              if (p.spotify !== null) srcs.push({ label: "SPOT", tone: "emer" });
              return (
                <button
                  key={p.name}
                  onClick={() => { if (p.local) { setRemoteView(null); selectPlaylist(p.local); } else { setRemoteView(p); navigate("/playlists"); } }}
                  className="w-full text-left px-3 py-2 rounded-xl mb-0.5 flex flex-col gap-1 transition-colors hover:bg-panel2"
                  style={active ? { background: "var(--violetS)", boxShadow: "inset 2px 0 0 var(--violet)" } : undefined}
                >
                  <div className="flex items-center w-full">
                    <span className="text-[13px] font-medium truncate flex-1 min-w-0" style={{ color: active ? "var(--violet)" : "var(--ink2)" }}>{p.name}</span>
                    <span className="font-mono text-[10px] text-ink3 tabular-nums shrink-0 ml-2">{count}</span>
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
                    {srcs.map((s) => <span key={s.label} className="font-mono text-[7px] font-semibold tracking-[.06em] px-1 py-[2px] rounded" style={{ background: `var(--${s.tone}S)`, color: `var(--${s.tone})` }}>{s.label}</span>)}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Detail panel */}
      <div className="flex flex-col min-w-0 p-5 overflow-y-auto rounded-2xl border border-line bg-panel" style={{ boxShadow: "var(--shadow)" }}>
        {!activePlaylist ? (
          remoteView ? (
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="font-display text-xl font-bold text-ink">{remoteView.name}</h2>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  {remoteView.local && <span className="badge" style={{ background: "var(--brandS)", color: "var(--brand)" }}>Library</span>}
                  {remoteView.device && <span className="badge" style={{ background: "var(--cyanS)", color: "var(--cyan)" }}>iPod · {remoteView.device.track_count} tracks</span>}
                  {remoteView.plex !== null && <span className="badge" style={{ background: "var(--amberS)", color: "var(--amber)" }}>Plex · {remoteView.plex} tracks</span>}
                  {remoteView.spotify !== null && <span className="badge" style={{ background: "var(--emerS)", color: "var(--emer)" }}>Spotify · {remoteView.spotify} tracks</span>}
                </div>
              </div>

              {remoteView.device ? (
                <div className="rounded-xl border border-line overflow-hidden">
                  <div className="px-4 py-2.5 panel2 border-b border-line font-mono text-[8px] font-semibold tracking-[.14em] text-ink3">
                    ON IPOD · {loadingRemote ? "LOADING…" : `${remoteTracks.length} TRACKS`}
                  </div>
                  <div className="max-h-[52vh] overflow-y-auto">
                    {remoteTracks.map((t, i) => (
                      <div key={i} className="flex items-center gap-3 px-4 py-2 border-b border-line2 last:border-0">
                        <span className="font-mono text-[10px] text-ink3 tabular-nums w-6 text-right shrink-0">{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-[12px] text-ink truncate">{t.title || "Unknown"}</div>
                          {t.artist && <div className="font-mono text-[9px] text-ink3 truncate">{t.artist}</div>}
                        </div>
                        {t.format && <span className="font-mono text-[8px] text-ink3 uppercase shrink-0">{t.format}</span>}
                      </div>
                    ))}
                    {!loadingRemote && remoteTracks.length === 0 && <div className="px-4 py-6 text-[12px] text-ink3 text-center">Couldn't read this playlist's tracks.</div>}
                  </div>
                </div>
              ) : (
                <p className="text-[13px] text-ink2 leading-relaxed max-w-[460px]">
                  This playlist lives on {[remoteView.plex !== null ? "Plex" : null, remoteView.spotify !== null ? "Spotify" : null].filter(Boolean).join(" and ") || "another source"}, but not in your library yet. Import it to edit it and sync it everywhere.
                </p>
              )}

              <div className="flex items-center gap-2.5">
                {remoteView.device ? (
                  <button onClick={importRemote} disabled={pushing || remoteTracks.length === 0} className="btn btn-primary text-xs">{pushing ? "Importing…" : "Import to library"}</button>
                ) : (
                  <button onClick={() => navigate("/import")} className="btn btn-secondary text-xs">Import to library</button>
                )}
                <span className="font-mono text-[9px] text-ink3">Edit it in the library, then sync anywhere</span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-bg-surface flex items-center justify-center">
                <svg className="w-6 h-6 text-t-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
                </svg>
              </div>
              <p className="text-t-secondary text-sm">Select a playlist from the sidebar, or create a new one</p>
            </div>
          )
        ) : (
          <>
            {/* Playlist header */}
            <div className="flex items-start justify-between mb-6">
              <div>
                {renaming ? (
                  <input
                    ref={renameRef}
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") setRenaming(false);
                    }}
                    onBlur={commitRename}
                    className="input text-xl font-bold py-1 px-2 -ml-2"
                  />
                ) : (
                  <h2
                    className="text-xl font-bold text-t cursor-pointer hover:text-gf transition-colors"
                    onClick={startRename}
                    title="Click to rename"
                  >
                    {activePlaylist.name}
                  </h2>
                )}
                <div className="flex items-center gap-2 mt-1">
                  {loadingDetail ? (
                    <p className="text-sm text-t-muted">Loading...</p>
                  ) : (
                    <>
                      <span className="badge badge-violet">{detailTracks.length} tracks</span>
                      {formatTotalDuration(detailTracks) && <span className="badge badge-cyan">{formatTotalDuration(detailTracks)}</span>}
                      <span className="badge" style={{ background: "var(--panel2)", color: "var(--ink2)" }}>Local</span>
                      {(() => {
                        const s = plexStatus(activePlaylist.name, activePlaylist.track_count);
                        if (!s) return null;
                        return <span className="badge" style={s.tone === "ink3" ? { background: "var(--panel2)", color: "var(--ink3)" } : { background: `var(--${s.tone}S)`, color: `var(--${s.tone})` }}>{s.label}</span>;
                      })()}
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {orderDirty && (
                  <button onClick={handleSaveOrder} className="btn btn-primary text-xs">Save Changes</button>
                )}
                <button onClick={handleExport} disabled={detailTracks.length === 0} className="btn btn-secondary text-xs">Export M3U</button>
                {ipod && (
                  <button onClick={handleSyncIpod} disabled={pushing || detailTracks.length === 0} className="btn btn-secondary text-xs">
                    {pushing ? "Syncing..." : "Sync to iPod"}
                  </button>
                )}
                <button onClick={handlePush} disabled={pushing || detailTracks.length === 0} className="btn btn-secondary text-xs">
                  {pushing ? "Pushing..." : "Push to Plex"}
                </button>
                {!confirmDel ? (
                  <button onClick={() => setConfirmDel(true)} className="btn btn-danger text-xs">Delete</button>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <button onClick={handleDelete} className="btn btn-danger text-xs">Confirm</button>
                    <button onClick={() => setConfirmDel(false)} className="btn btn-ghost text-xs">Cancel</button>
                  </div>
                )}
              </div>
            </div>

            {/* Status message */}
            {msg && (
              <div className={`flex items-center justify-between p-3 rounded-xl text-[13px] border mb-4 ${
                msg.ok ? "bg-ok-muted border-ok/20 text-ok" : "bg-err-muted border-err/20 text-err"
              }`}>
                <span>{msg.text}</span>
                <button onClick={() => setMsg(null)} className={msg.ok ? "text-ok/60 hover:text-ok" : "text-err/60 hover:text-err"}>&times;</button>
              </div>
            )}

            {/* Add from Library panel */}
            {showAddPanel && (
              <div className="card p-4 mb-4 flex flex-col gap-3 max-h-72">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-t">Add from Library</p>
                  <button onClick={() => setShowAddPanel(false)} className="text-t-muted hover:text-t transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <SearchInput value={addSearch} onChange={setAddSearch} placeholder="Search library..." />
                <div className="flex-1 min-h-0 overflow-y-auto">
                  {addCandidates.length === 0 ? (
                    <p className="text-t-muted text-[12px] text-center py-6">No tracks found</p>
                  ) : (
                    addCandidates.slice(0, 50).map((t, i) => {
                      const alreadyAdded = detailTracks.some((d) => d.relative_path === t.relative_path);
                      return (
                        <div
                          key={`${t.relative_path}-${i}`}
                          className={`flex items-center gap-3 px-3 py-2 text-[12px] rounded-lg ${
                            alreadyAdded ? "opacity-40" : "hover:bg-bg-hover cursor-pointer"
                          }`}
                          onClick={() => !alreadyAdded && addTrackFromLibrary(t)}
                        >
                          <span className="flex-1 min-w-0 truncate text-t">
                            {t.title || "Unknown"}{" "}
                            <span className="text-t-muted">{t.artist ? `- ${t.artist}` : ""}</span>
                          </span>
                          <span className="text-t-muted text-[11px] tabular-nums shrink-0">{fmtDur(t.duration_seconds)}</span>
                          {alreadyAdded ? (
                            <svg className="w-4 h-4 text-ok shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                            </svg>
                          ) : (
                            <button className="text-gf hover:text-gf-light text-xs font-medium shrink-0">Add</button>
                          )}
                        </div>
                      );
                    })
                  )}
                  {addCandidates.length > 50 && (
                    <p className="text-t-muted text-[11px] text-center py-2">
                      Showing first 50 of {addCandidates.length}. Refine your search.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Track list */}
            <div className="flex-1 min-h-0">
              {loadingDetail ? (
                <div className="flex items-center justify-center h-40 text-t-secondary text-sm">Loading tracks...</div>
              ) : detailTracks.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-center gap-3">
                  <p className="text-t-muted text-sm">This playlist is empty. Add tracks from your library.</p>
                  <button onClick={() => setShowAddPanel(true)} className="btn btn-secondary text-xs">Add Tracks</button>
                </div>
              ) : (
                <div className="overflow-hidden flex flex-col rounded-xl border border-line">
                  <div className="grid gap-3 items-center px-4 py-2.5 panel2 border-b border-line font-mono text-[8px] font-semibold tracking-[.14em] text-ink3 shrink-0" style={{ gridTemplateColumns: "32px minmax(0,1.6fr) minmax(0,1fr) 56px 72px" }}>
                    <span>#</span><span>TITLE</span><span>ARTIST</span><span className="text-right">TIME</span><span />
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    {detailTracks.map((track, index) => (
                      <div
                        key={`${track.relative_path}-${index}`}
                        className="group grid gap-3 items-center px-4 py-2.5 border-b border-line2 hover:bg-panel2 transition-colors"
                        style={{ gridTemplateColumns: "32px minmax(0,1.6fr) minmax(0,1fr) 56px 72px" }}
                      >
                        <span className="font-mono text-[10px] text-ink3 tabular-nums">{index + 1}</span>
                        <div className="min-w-0"><p className="truncate text-[13px] font-medium text-ink">{track.title || "Unknown Title"}</p></div>
                        <span className="truncate text-[12px] text-ink2">{track.artist || "Unknown Artist"}{track.album ? ` \u00b7 ${track.album}` : ""}</span>
                        <span className="text-right font-mono text-[10px] text-ink2 tabular-nums">{fmtDur(track.duration_seconds)}</span>
                        <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => moveTrack(index, -1)} disabled={index === 0} className="p-1 rounded-md hover:bg-panel text-ink3 hover:text-ink disabled:opacity-20 transition-colors">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" /></svg>
                          </button>
                          <button onClick={() => moveTrack(index, 1)} disabled={index === detailTracks.length - 1} className="p-1 rounded-md hover:bg-panel text-ink3 hover:text-ink disabled:opacity-20 transition-colors">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
                          </button>
                          <button onClick={() => removeTrack(index)} className="p-1 rounded-md text-ink3 hover:text-err transition-colors">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between px-4 py-3 panel2 border-t border-line shrink-0">
                    <button onClick={() => setShowAddPanel((v) => !v)} className="text-[12px] font-bold text-brand hover:opacity-80 transition-opacity">+ Add tracks</button>
                    {orderDirty && <span className="font-mono text-[9px]" style={{ color: "var(--amber)" }}>UNSAVED ORDER</span>}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

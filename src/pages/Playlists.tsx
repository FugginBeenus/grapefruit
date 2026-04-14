import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useDeviceStore } from "../stores/deviceStore";
import { rpcCall } from "../api/sidecar";
import { readPlaylist, writePlaylist, deletePlaylist } from "../api/library";
import { plexSyncPlaylists } from "../api/plex";
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
  const { selectedDevice, tracks: libraryTracks, playlists, refreshPlaylists } = useDeviceStore();

  const decoded = routeName ? decodeURIComponent(routeName) : null;
  const activePlaylist = playlists.find((p) => p.name === decoded) ?? null;

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

  const filteredPlaylists = useMemo(() => {
    if (!sideSearch.trim()) return playlists;
    const q = sideSearch.toLowerCase();
    return playlists.filter((p) => p.name.toLowerCase().includes(q));
  }, [playlists, sideSearch]);

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
    <div className="flex h-[calc(100vh-80px)]">
      {/* Sidebar */}
      <div className="w-[260px] shrink-0 border-r flex flex-col" style={{ background: "linear-gradient(180deg, #12121A 0%, #0B0B10 100%)" }}>
        <div className="p-4 flex items-center justify-between border-b">
          <span className="text-sm font-semibold text-t">Playlists</span>
          <button onClick={() => setCreatingNew(true)} className="btn btn-primary text-[11px] py-1 px-3 rounded-full">
            New
          </button>
        </div>

        {creatingNew && (
          <div className="px-3 pt-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") { setCreatingNew(false); setNewName(""); }
              }}
              placeholder="Playlist name..."
              className="input text-[12px] py-2"
              autoFocus
            />
          </div>
        )}

        <div className="px-3 pt-3">
          <SearchInput value={sideSearch} onChange={setSideSearch} placeholder="Filter playlists..." />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto mt-2 px-1">
          {filteredPlaylists.length === 0 ? (
            <p className="text-t-muted text-[12px] text-center mt-8">
              {playlists.length === 0 ? "No playlists yet" : "No matches"}
            </p>
          ) : (
            filteredPlaylists.map((p) => {
              const active = activePlaylist?.name === p.name;
              return (
                <button
                  key={p.name}
                  onClick={() => selectPlaylist(p)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg mb-0.5 flex items-center justify-between transition-colors ${
                    active ? "bg-gf-glow border-l-[3px] border-gf" : "hover:bg-bg-hover"
                  }`}
                >
                  <span className={`text-[13px] font-medium truncate ${active ? "text-gf" : "text-t-secondary"}`}>
                    {p.name}
                  </span>
                  <span className="text-xs text-t-muted tabular-nums shrink-0 ml-2">
                    {p.track_count}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Detail panel */}
      <div className="flex-1 min-w-0 flex flex-col p-6 overflow-y-auto">
        {!activePlaylist ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-bg-surface flex items-center justify-center">
              <svg className="w-6 h-6 text-t-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
              </svg>
            </div>
            <p className="text-t-secondary text-sm">Select a playlist from the sidebar, or create a new one</p>
          </div>
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
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {orderDirty && (
                  <button onClick={handleSaveOrder} className="btn btn-primary text-xs">Save Changes</button>
                )}
                <button onClick={handleExport} disabled={detailTracks.length === 0} className="btn btn-secondary text-xs">Export M3U</button>
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
                <div className="card overflow-hidden flex flex-col">
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-bg-surface text-[11px] font-semibold text-t-muted uppercase tracking-wide shrink-0">
                    <span className="w-8 text-right">#</span>
                    <span className="flex-1">Title</span>
                    <span className="w-14 text-right">Time</span>
                    <span className="w-20" />
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    {detailTracks.map((track, index) => (
                      <div
                        key={`${track.relative_path}-${index}`}
                        className="group flex items-center gap-2 px-4 py-2.5 border-b border-b-[rgba(255,255,255,0.06)] hover:bg-bg-hover transition-colors"
                      >
                        <span className="w-8 text-right text-t-muted text-[11px] tabular-nums shrink-0">{index + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="truncate text-[13px] font-medium text-t">{track.title || "Unknown Title"}</p>
                          <p className="truncate text-[11px] text-t-muted">
                            {track.artist || "Unknown Artist"}{track.album ? ` \u2014 ${track.album}` : ""}
                          </p>
                        </div>
                        <span className="w-14 text-right text-t-muted text-[11px] tabular-nums shrink-0">{fmtDur(track.duration_seconds)}</span>
                        <div className="w-20 flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          <button
                            onClick={() => moveTrack(index, -1)}
                            disabled={index === 0}
                            className="p-1 rounded hover:bg-bg-surface text-t-muted hover:text-t disabled:opacity-20 transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                            </svg>
                          </button>
                          <button
                            onClick={() => moveTrack(index, 1)}
                            disabled={index === detailTracks.length - 1}
                            className="p-1 rounded hover:bg-bg-surface text-t-muted hover:text-t disabled:opacity-20 transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                            </svg>
                          </button>
                          <button
                            onClick={() => removeTrack(index)}
                            className="p-1 rounded hover:bg-err-muted text-t-muted hover:text-err transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Bottom bar */}
                  <div className="flex items-center justify-between px-4 py-3 border-t border-b bg-bg-surface">
                    <button onClick={() => setShowAddPanel((v) => !v)} className="btn btn-ghost text-xs text-gf">
                      + Add Tracks
                    </button>
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

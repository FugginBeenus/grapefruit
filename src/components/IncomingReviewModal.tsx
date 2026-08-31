import { useEffect, useState, useCallback } from "react";
import { rpcCall } from "../api/sidecar";
import { listIncoming, importIncoming, type IncomingFile } from "../api/incoming";
import MetadataEditor from "./MetadataEditor";
import type { TrackMetadata, AlbumArt } from "../types/models";

function fmtSize(b: number) {
  return b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export function IncomingReviewModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [files, setFiles] = useState<IncomingFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editMeta, setEditMeta] = useState<TrackMetadata | null>(null);
  const [editArt, setEditArt] = useState<AlbumArt | null>(null);
  const [editPath, setEditPath] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try { setFiles(await listIncoming()); }
    catch (e) { setError(String(e)); setFiles([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const edit = async (f: IncomingFile) => {
    try {
      const [meta, art] = await Promise.all([
        rpcCall<TrackMetadata>("get_track_metadata", { path: f.path }),
        rpcCall<AlbumArt>("get_album_art", { path: f.path }),
      ]);
      setEditMeta(meta); setEditArt(art); setEditPath(f.path);
    } catch (e) { setError(String(e)); }
  };

  const saveMeta = async (patch: Partial<TrackMetadata>) => {
    if (!editPath) return;
    await rpcCall("set_track_metadata", { path: editPath, metadata: patch });
    setEditMeta(null); setEditPath(null);
    load();
  };

  const changeArt = async (b64: string | null) => {
    if (!editPath) return;
    if (b64) await rpcCall("set_album_art", { path: editPath, data: b64 });
    else await rpcCall("remove_album_art", { path: editPath });
    try { setEditArt(await rpcCall<AlbumArt>("get_album_art", { path: editPath })); } catch { /* ignore */ }
  };

  const importFiles = async (paths: string[]) => {
    setBusy(true);
    try {
      const res = await importIncoming(paths);
      onImported();
      await load();
      if (res.errors.length) setError(res.errors.join("; "));
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,.55)", backdropFilter: "blur(2px)" }} onClick={onClose}>
        <div className="rounded-2xl border border-line bg-panel w-[680px] max-w-[92vw] max-h-[85vh] overflow-hidden flex flex-col gf-in" style={{ boxShadow: "var(--shadow)" }} onClick={(e) => e.stopPropagation()}>
          <div className="px-5 py-4 border-b border-line flex items-center gap-3">
            <div className="font-display text-[17px] font-bold text-ink">Incoming from Soulseek</div>
            <div className="flex-1" />
            {files && files.length > 0 && <button onClick={() => importFiles(files.map((f) => f.path))} disabled={busy} className="btn btn-primary text-xs">Add all to library</button>}
            <button onClick={onClose} className="text-ink3 hover:text-ink text-lg leading-none">&times;</button>
          </div>
          {error && <div className="px-5 py-2.5 text-[12px] text-err border-b border-line">{error}</div>}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {!files && <div className="px-5 py-6 font-mono text-[11px] text-ink3">Loading…</div>}
            {files && files.length === 0 && <div className="px-5 py-8 text-[12px] text-ink3 text-center">Nothing in your Soulseek download folder yet. Tracks you queue from the Streaming Gap land here for review.</div>}
            {files && files.map((f) => (
              <div key={f.path} className="flex items-center gap-3 px-5 py-2.5 border-b border-line2 hover:bg-panel2 transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-ink truncate">{f.title || f.name}</div>
                  <div className="font-mono text-[9px] text-ink3 truncate">{[f.artist, f.album].filter(Boolean).join(" · ") || "no tags"} · {f.format.toUpperCase()} · {fmtSize(f.size)}</div>
                </div>
                <button onClick={() => edit(f)} className="btn btn-secondary text-[10px] py-1 px-2.5 shrink-0">Edit tags &amp; art</button>
                <button onClick={() => importFiles([f.path])} disabled={busy} className="btn btn-secondary text-[10px] py-1 px-2.5 shrink-0">Add</button>
              </div>
            ))}
          </div>
          <div className="px-5 py-2.5 border-t border-line font-mono text-[8px] text-ink3">EDIT TAGS + ART, THEN ADD TO YOUR LIBRARY TO SYNC EVERYWHERE</div>
        </div>
      </div>
      {editMeta && editPath && (
        <MetadataEditor metadata={editMeta} albumArt={editArt} onSave={saveMeta} onClose={() => { setEditMeta(null); setEditPath(null); }} onArtChange={changeArt} />
      )}
    </>
  );
}

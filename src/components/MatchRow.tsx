import { useMemo, useState } from "react";
import type { MatchResult, MatchCandidate, DeviceTrack } from "../types/models";
import { useImportStore } from "../stores/importStore";
import { useDeviceStore } from "../stores/deviceStore";

const GRID = { gridTemplateColumns: "minmax(0,1fr) 22px minmax(0,1fr) 74px 96px" };

export function MatchRow({ result, index }: { result: MatchResult; index: number }) {
  const { playlist_track, status, candidates } = result;
  const effective = result.user_selected || result.best_match;
  const resolveMatch = useImportStore((s) => s.resolveMatch);
  const rejectMatch = useImportStore((s) => s.rejectMatch);
  const tracks = useDeviceStore((s) => s.tracks);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(`${playlist_track.artist} ${playlist_track.title}`);

  const missing = status === "missing" || status === "rejected";
  const uncertain = status === "uncertain";
  const tone = missing ? "err" : uncertain ? "amber" : "emer";
  const badge = missing ? "MISSING" : uncertain ? "UNCERTAIN" : status === "manual" ? "MANUAL" : "MATCHED";

  const searchResults = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    const words = q.split(/\s+/);
    return tracks.filter((t) => words.every((w) => `${t.artist} ${t.title} ${t.album}`.toLowerCase().includes(w))).slice(0, 20);
  }, [query, tracks]);

  const pick = (c: MatchCandidate) => { resolveMatch(index, c); setOpen(false); };
  const pickTrack = (t: DeviceTrack) => pick({ local_track: { file_path: t.file_path, title: t.title, artist: t.artist, album: t.album, duration_seconds: t.duration_seconds }, score: 100, matched_on: "manual" });

  return (
    <div className="border-b border-line2">
      <div onClick={() => setOpen((v) => !v)} className="grid gap-3 items-center px-[22px] py-[11px] cursor-pointer transition-colors hover:bg-panel2" style={GRID}>
        <div className="min-w-0">
          <div className="text-[13px] font-medium truncate text-ink">{playlist_track.title}</div>
          <div className="text-[11px] truncate text-ink3">{playlist_track.artist}</div>
        </div>
        <div className="font-mono text-[11px] text-center" style={{ color: missing ? "var(--err)" : uncertain ? "var(--amber)" : "var(--ink3)" }}>→</div>
        <div className="min-w-0">
          <div className="text-[13px] font-medium truncate" style={{ color: missing ? "var(--ink3)" : "var(--ink)" }}>{effective ? effective.local_track.title : "No local file"}</div>
          <div className="font-mono text-[9px] truncate text-ink3">{effective ? (effective.matched_on || "").toUpperCase() : `SEARCHED ${tracks.length.toLocaleString()} FILES`}</div>
        </div>
        <div className="font-mono text-[11px] font-semibold" style={{ color: uncertain ? "var(--amber)" : missing ? "var(--ink3)" : "var(--emer)" }}>{effective ? `${Math.round(effective.score)}%` : "—"}</div>
        <div className="flex justify-end"><span className={`badge badge-${tone === "emer" ? "emerald" : tone}`}>{badge}</span></div>
      </div>

      {open && (
        <div className="px-[22px] pb-[18px] pt-1 flex flex-col gap-2.5 panel2" onClick={(e) => e.stopPropagation()}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your library for a different file…"
            className="px-3.5 py-2.5 rounded-[10px] text-[12px] text-ink outline-none" style={{ background: "var(--panel)", border: "1px solid var(--line)" }} autoFocus />
          {searchResults.length > 0 && (
            <div className="max-h-44 overflow-y-auto rounded-[10px]" style={{ border: "1px solid var(--line)" }}>
              {searchResults.map((t, i) => (
                <button key={i} onClick={() => pickTrack(t)} className="w-full flex flex-col items-start px-3 py-2 border-b border-line2 last:border-0 hover:bg-panel transition-colors text-left">
                  <span className="text-[12px] text-ink truncate max-w-full">{t.title}</span>
                  <span className="font-mono text-[9px] text-ink3 truncate max-w-full">{t.artist}{t.album ? ` · ${t.album}` : ""}</span>
                </button>
              ))}
            </div>
          )}
          {candidates.length > 0 && (
            <>
              <div className="font-mono text-[9px] tracking-[.14em] text-ink3">ALTERNATE CANDIDATES</div>
              {candidates.map((c, i) => (
                <button key={i} onClick={() => pick(c)} className="flex items-center gap-3 px-3 py-2.5 rounded-[10px] transition-colors text-left" style={{ background: "var(--panel)", border: "1px solid var(--line)" }}>
                  <span className="font-mono text-[11px] flex-1 min-w-0 truncate text-ink">{c.local_track.artist} - {c.local_track.title}</span>
                  <span className="font-mono text-[10px] font-semibold shrink-0" style={{ color: "var(--amber)" }}>{Math.round(c.score)}%</span>
                  <span className="text-[11px] font-bold shrink-0 text-brand">Use this</span>
                </button>
              ))}
            </>
          )}
          {!missing && (
            <div className="flex gap-2.5">
              <button onClick={() => { rejectMatch(index); setOpen(false); }} className="px-3.5 py-2 rounded-full text-[11px] font-bold text-ink2 hover:text-ink transition-colors" style={{ border: "1px solid var(--line)" }}>Mark as missing</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { useMemo, useState } from "react";
import type { MatchResult, MatchCandidate, DeviceTrack } from "../types/models";
import { StatusBadge } from "./StatusBadge";
import { useImportStore } from "../stores/importStore";
import { useDeviceStore } from "../stores/deviceStore";

interface MatchRowProps {
  result: MatchResult;
  index: number;
}

export function MatchRow({ result, index }: MatchRowProps) {
  const { playlist_track, status, candidates } = result;
  const effective = result.user_selected || result.best_match;
  const resolveMatch = useImportStore((s) => s.resolveMatch);
  const rejectMatch = useImportStore((s) => s.rejectMatch);
  const tracks = useDeviceStore((s) => s.tracks);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(`${playlist_track.artist} ${playlist_track.title}`);

  const canResolve = status !== "matched" && status !== "confirmed";

  const searchResults = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    const words = q.split(/\s+/);
    return tracks
      .filter((t) => {
        const hay = `${t.artist} ${t.title} ${t.album}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 25);
  }, [query, tracks]);

  const pick = (candidate: MatchCandidate) => {
    resolveMatch(index, candidate);
    setOpen(false);
  };

  const pickTrack = (t: DeviceTrack) =>
    pick({
      local_track: {
        file_path: t.file_path,
        title: t.title,
        artist: t.artist,
        album: t.album,
        duration_seconds: t.duration_seconds,
      },
      score: 100,
      matched_on: "manual",
    });

  return (
    <div className="border-b border-b-[rgba(255,255,255,0.06)]">
      <div className="flex items-center gap-3 px-4 py-3 hover:bg-bg-hover transition-colors">
        <span className="w-8 text-right text-t-muted text-[11px] tabular-nums shrink-0">
          {index + 1}
        </span>

        {/* Source */}
        <div className="flex-1 min-w-0">
          <p className="truncate text-[13px] font-medium text-t">{playlist_track.title}</p>
          <p className="truncate text-[11px] text-t-muted">
            {playlist_track.artist}
            {playlist_track.album ? ` (${playlist_track.album})` : ""}
          </p>
        </div>

        <svg className="w-4 h-4 text-t-muted/50 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
        </svg>

        {/* Match */}
        <div className="flex-1 min-w-0">
          {effective ? (
            <>
              <p className="truncate text-[13px] text-t">{effective.local_track.title}</p>
              <p className="truncate text-[11px] text-t-muted">
                {effective.local_track.artist}
                {effective.matched_on ? ` (${effective.matched_on})` : ""}
              </p>
            </>
          ) : (
            <p className="text-[13px] text-t-muted italic">No match found</p>
          )}
        </div>

        {effective && (
          <span className="text-[10px] text-t-muted tabular-nums shrink-0 w-10 text-right">
            {Math.round(effective.score)}%
          </span>
        )}

        {canResolve && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="text-[11px] font-medium text-gf hover:text-gf-light transition-colors shrink-0"
          >
            {open ? "Close" : effective ? "Change" : "Find"}
          </button>
        )}

        <StatusBadge status={status} />
      </div>

      {open && (
        <div className="px-4 pb-3 pl-11 space-y-3 bg-bg-primary/40">
          {candidates.length > 0 && (
            <div>
              <p className="text-[10px] font-bold tracking-wide text-t-muted uppercase mb-1.5">Suggestions</p>
              <div className="space-y-1">
                {candidates.map((c, i) => (
                  <button
                    key={i}
                    onClick={() => pick(c)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left hover:bg-bg-hover transition-colors"
                  >
                    <span className="text-[11px] text-t-muted tabular-nums w-9 shrink-0">{Math.round(c.score)}%</span>
                    <span className="text-[12px] text-t-secondary truncate">
                      {c.local_track.artist} - {c.local_track.title}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your library..."
              className="input py-1.5 text-[12px]"
              autoFocus
            />
            {searchResults.length > 0 && (
              <div className="mt-1.5 max-h-48 overflow-y-auto rounded-lg border">
                {searchResults.map((t, i) => (
                  <button
                    key={i}
                    onClick={() => pickTrack(t)}
                    className="w-full flex flex-col items-start px-2.5 py-1.5 border-b border-b-[rgba(255,255,255,0.04)] last:border-0 hover:bg-bg-hover transition-colors text-left"
                  >
                    <span className="text-[12px] text-t truncate max-w-full">{t.title}</span>
                    <span className="text-[11px] text-t-muted truncate max-w-full">
                      {t.artist}
                      {t.album ? ` (${t.album})` : ""}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {status !== "missing" && (
            <button
              onClick={() => { rejectMatch(index); setOpen(false); }}
              className="text-[11px] text-t-muted hover:text-err transition-colors"
            >
              Mark as missing
            </button>
          )}
        </div>
      )}
    </div>
  );
}

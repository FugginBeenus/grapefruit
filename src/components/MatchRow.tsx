import type { MatchResult } from "../types/models";
import { StatusBadge } from "./StatusBadge";

interface MatchRowProps {
  result: MatchResult;
  index: number;
}

export function MatchRow({ result, index }: MatchRowProps) {
  const { playlist_track, status, best_match } = result;

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-b/50 hover:bg-bg-hover transition-colors">
      <span className="w-8 text-right text-t-muted text-[11px] tabular-nums shrink-0">
        {index + 1}
      </span>

      {/* Source */}
      <div className="flex-1 min-w-0">
        <p className="truncate text-[13px] font-medium text-t">{playlist_track.title}</p>
        <p className="truncate text-[11px] text-t-muted">
          {playlist_track.artist}
          {playlist_track.album ? ` \u2014 ${playlist_track.album}` : ""}
        </p>
      </div>

      {/* Arrow */}
      <svg className="w-4 h-4 text-t-muted/50 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
      </svg>

      {/* Match */}
      <div className="flex-1 min-w-0">
        {best_match ? (
          <>
            <p className="truncate text-[13px] text-t">{best_match.local_track.title}</p>
            <p className="truncate text-[11px] text-t-muted">
              {best_match.local_track.artist}
              {best_match.matched_on ? ` (${best_match.matched_on})` : ""}
            </p>
          </>
        ) : (
          <p className="text-[13px] text-t-muted italic">No match found</p>
        )}
      </div>

      {best_match && (
        <span className="text-[10px] text-t-muted tabular-nums shrink-0 w-10 text-right">
          {Math.round(best_match.score * 100)}%
        </span>
      )}

      <StatusBadge status={status} />
    </div>
  );
}

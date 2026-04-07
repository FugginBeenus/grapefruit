import { List, type RowComponentProps } from "react-window";
import type { DeviceTrack } from "../types/models";

interface TrackListProps {
  tracks: DeviceTrack[];
  height?: number;
  onTrackClick?: (track: DeviceTrack, index: number) => void;
  selectedIndex?: number;
}

function fmtDur(s: number | null): string {
  if (!s) return "--:--";
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

function fmtSize(b: number): string {
  if (!b) return "";
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

interface RowData {
  tracks: DeviceTrack[];
  onTrackClick?: (track: DeviceTrack, index: number) => void;
  selectedIndex?: number;
}

function TrackRow({ index, style, tracks, onTrackClick, selectedIndex }: RowComponentProps<RowData>) {
  const track = tracks[index];
  const selected = selectedIndex === index;

  return (
    <div
      style={style}
      onClick={() => onTrackClick?.(track, index)}
      className={`flex items-center gap-3 px-4 text-[13px] cursor-default select-none transition-colors border-b border-b/30 ${
        selected
          ? "bg-gf-glow"
          : index % 2 === 0
            ? "bg-bg-primary hover:bg-bg-hover"
            : "bg-bg-raised hover:bg-bg-hover"
      }`}
    >
      <span className="w-9 text-right text-t-muted text-[11px] tabular-nums shrink-0">
        {index + 1}
      </span>
      <div className="flex-1 min-w-0">
        <p className={`truncate font-medium ${selected ? "text-gf" : "text-t"}`}>
          {track.title || "Unknown Title"}
        </p>
        <p className="truncate text-t-muted text-[11px]">
          {track.artist || "Unknown Artist"}
          {track.album ? ` \u2014 ${track.album}` : ""}
        </p>
      </div>
      <span className="text-t-muted text-[11px] tabular-nums shrink-0 w-11 text-right">
        {fmtDur(track.duration_seconds)}
      </span>
      <span className="text-t-muted text-[10px] tabular-nums shrink-0 w-14 text-right">
        {fmtSize(track.file_size)}
      </span>
    </div>
  );
}

export function TrackList({ tracks, height = 500, onTrackClick, selectedIndex }: TrackListProps) {
  if (tracks.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-t-muted text-sm">
        No tracks to display
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-b bg-bg-surface text-[11px] font-semibold text-t-muted uppercase tracking-wide">
        <span className="w-9 text-right">#</span>
        <span className="flex-1">Title</span>
        <span className="w-11 text-right">Time</span>
        <span className="w-14 text-right">Size</span>
      </div>
      <List
        rowComponent={TrackRow}
        rowCount={tracks.length}
        rowHeight={52}
        rowProps={{ tracks, onTrackClick, selectedIndex }}
        style={{ height }}
      />
    </div>
  );
}

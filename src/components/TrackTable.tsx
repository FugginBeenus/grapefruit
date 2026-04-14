import { useRef, useState, useEffect, useCallback } from "react";
import { List, type RowComponentProps } from "react-window";
import type { DeviceTrack } from "../types/models";

export type SortField = "title" | "artist" | "album" | "duration" | "size" | "format";

export interface TrackTableProps {
  tracks: DeviceTrack[];
  selectedIndices: Set<number>;
  onSelectionChange: (indices: Set<number>) => void;
  onTrackDoubleClick?: (index: number) => void;
  onContextMenu?: (index: number, event: React.MouseEvent) => void;
  sortColumn: SortField;
  sortDirection: "asc" | "desc";
  onSort: (column: SortField) => void;
  compact?: boolean;
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "\u2014";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatSize(bytes: number): string {
  if (!bytes) return "\u2014";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ── Column definitions ─────────────────────────── */

const COLUMNS: { key: SortField | "#"; label: string; sortable: boolean }[] = [
  { key: "#", label: "#", sortable: false },
  { key: "title", label: "Title", sortable: true },
  { key: "album", label: "Album", sortable: true },
  { key: "duration", label: "Time", sortable: true },
  { key: "size", label: "Size", sortable: true },
];

const GRID_COLS = "44px minmax(200px, 1fr) 180px 56px 64px";

/* ── Row component (react-window v2) ────────────── */

interface RowData {
  tracks: DeviceTrack[];
  selectedIndices: Set<number>;
  anchorIndex: number | null;
  onRowClick: (index: number, e: React.MouseEvent) => void;
  onRowDoubleClick: (index: number) => void;
  onRowContextMenu: (index: number, e: React.MouseEvent) => void;
}

function TrackRow({
  index,
  style,
  tracks,
  selectedIndices,
  onRowClick,
  onRowDoubleClick,
  onRowContextMenu,
}: RowComponentProps<RowData>) {
  const track = tracks[index];
  if (!track) return null;
  const selected = selectedIndices.has(index);

  return (
    <div
      style={{ ...style, display: "grid", gridTemplateColumns: GRID_COLS, alignItems: "center" }}
      className={`px-1 cursor-default select-none transition-colors duration-100 ${
        selected
          ? "bg-gf-glow border-l-[3px] border-l-gf"
          : index % 2 === 0
            ? "bg-bg-primary hover:bg-bg-hover"
            : "bg-bg-raised hover:bg-bg-hover"
      }`}
      onClick={(e) => onRowClick(index, e)}
      onDoubleClick={() => onRowDoubleClick(index)}
      onContextMenu={(e) => onRowContextMenu(index, e)}
    >
      {/* # */}
      <span className="text-right pr-2 text-t-muted font-mono text-xs tabular-nums">
        {index + 1}
      </span>

      {/* Title + Artist */}
      <div className="min-w-0 pr-3">
        <p className={`truncate text-[13px] font-medium ${selected ? "text-gf-light" : "text-t"}`}>
          {track.title || "Unknown Title"}
        </p>
        {track.artist && (
          <p className="truncate text-[11px] text-t-secondary">
            {track.artist}
          </p>
        )}
      </div>

      {/* Album */}
      <span className="truncate text-[13px] text-t-secondary pr-3">
        {track.album || "\u2014"}
      </span>

      {/* Time */}
      <span className="text-right text-t-muted font-mono text-xs tabular-nums pr-2">
        {formatDuration(track.duration_seconds)}
      </span>

      {/* Size */}
      <span className="text-right text-t-muted text-xs tabular-nums">
        {formatSize(track.file_size)}
      </span>
    </div>
  );
}

/* ── Main component ─────────────────────────────── */

export default function TrackTable({
  tracks,
  selectedIndices,
  onSelectionChange,
  onTrackDoubleClick,
  onContextMenu,
  sortColumn,
  sortDirection,
  onSort,
}: TrackTableProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState(400);
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null);

  // Measure container for react-window
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(([entry]) => {
      setListHeight(entry.contentRect.height);
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Row click with shift/cmd multi-select
  const handleRowClick = useCallback(
    (index: number, e: React.MouseEvent) => {
      if (e.shiftKey && anchorIndex !== null) {
        const start = Math.min(anchorIndex, index);
        const end = Math.max(anchorIndex, index);
        const newSet = new Set(
          e.metaKey || e.ctrlKey ? selectedIndices : new Set<number>()
        );
        for (let i = start; i <= end; i++) newSet.add(i);
        onSelectionChange(newSet);
      } else if (e.metaKey || e.ctrlKey) {
        const newSet = new Set(selectedIndices);
        if (newSet.has(index)) newSet.delete(index);
        else newSet.add(index);
        onSelectionChange(newSet);
        setAnchorIndex(index);
      } else {
        onSelectionChange(new Set([index]));
        setAnchorIndex(index);
      }
    },
    [anchorIndex, selectedIndices, onSelectionChange]
  );

  const handleRowDoubleClick = useCallback(
    (index: number) => onTrackDoubleClick?.(index),
    [onTrackDoubleClick]
  );

  const handleRowContextMenu = useCallback(
    (index: number, e: React.MouseEvent) => {
      e.preventDefault();
      // Select the row if not already selected
      if (!selectedIndices.has(index)) {
        onSelectionChange(new Set([index]));
        setAnchorIndex(index);
      }
      onContextMenu?.(index, e);
    },
    [selectedIndices, onSelectionChange, onContextMenu]
  );

  // Keyboard: Escape clears, Cmd+A selects all
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onSelectionChange(new Set());
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "a") {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
        e.preventDefault();
        const all = new Set<number>();
        for (let i = 0; i < tracks.length; i++) all.add(i);
        onSelectionChange(all);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [tracks.length, onSelectionChange]);

  // Sort arrow indicator
  const sortArrow = (col: SortField) => {
    if (sortColumn !== col) return null;
    return (
      <span className="ml-1 text-gf">
        {sortDirection === "asc" ? "\u25B2" : "\u25BC"}
      </span>
    );
  };

  /* ── Empty state ──────────────────────────────── */
  if (tracks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-t-muted gap-3 py-20">
        <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
        </svg>
        <p className="text-sm">No tracks</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ────────────────────────────────── */}
      <div
        className="grid items-center px-1 py-2 border-b bg-bg-primary sticky top-0 z-10"
        style={{ gridTemplateColumns: GRID_COLS }}
      >
        {COLUMNS.map((col) => {
          const isSort = col.sortable && sortColumn === col.key;
          const alignRight = col.key === "#" || col.key === "duration" || col.key === "size";
          return (
            <span
              key={col.key}
              className={`text-[11px] uppercase tracking-wider font-semibold select-none ${
                alignRight ? "text-right" : ""
              } ${alignRight && col.key === "#" ? "pr-2" : ""} ${
                col.sortable
                  ? `cursor-pointer hover:text-t-secondary ${isSort ? "text-gf" : "text-t-muted"}`
                  : "text-t-muted"
              }`}
              onClick={() => col.sortable && onSort(col.key as SortField)}
            >
              {col.label}
              {col.sortable && sortArrow(col.key as SortField)}
            </span>
          );
        })}
      </div>

      {/* ── Virtualized rows ──────────────────────── */}
      <div ref={containerRef} className="flex-1 min-h-0">
        <List
          rowComponent={TrackRow}
          rowCount={tracks.length}
          rowHeight={44}
          rowProps={{
            tracks,
            selectedIndices,
            anchorIndex,
            onRowClick: handleRowClick,
            onRowDoubleClick: handleRowDoubleClick,
            onRowContextMenu: handleRowContextMenu,
          }}
          style={{ height: listHeight }}
          overscanCount={10}
        />
      </div>
    </div>
  );
}

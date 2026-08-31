import { useRef, useState, useEffect, useCallback } from "react";
import { List, type RowComponentProps } from "react-window";
import type { DeviceTrack } from "../types/models";

export type SortField = "title" | "artist" | "album" | "track" | "duration" | "size" | "format";

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
  libPaths?: Set<string>;
  devPaths?: Set<string>;
  plexPaths?: Set<string>;
  spotifyPaths?: Set<string>;
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
function formatSize(bytes: number): string {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function fmtPill(fmt: string): React.CSSProperties {
  const t = fmt === "FLAC" ? "cyan" : fmt === "MP3" ? "amber" : "violet";
  return { background: `var(--${t}S)`, color: `var(--${t})` };
}

const GRID_COLS = "44px minmax(0,1.25fr) minmax(0,0.85fr) 64px 64px minmax(0,196px)";

interface RowData {
  tracks: DeviceTrack[];
  selectedIndices: Set<number>;
  libPaths?: Set<string>;
  devPaths?: Set<string>;
  plexPaths?: Set<string>;
  spotifyPaths?: Set<string>;
  onRowClick: (index: number, e: React.MouseEvent) => void;
  onRowDoubleClick: (index: number) => void;
  onRowContextMenu: (index: number, e: React.MouseEvent) => void;
}

function TrackRow({ index, style, tracks, selectedIndices, libPaths, devPaths, plexPaths, spotifyPaths, onRowClick, onRowDoubleClick, onRowContextMenu }: RowComponentProps<RowData>) {
  const track = tracks[index];
  if (!track) return null;
  const selected = selectedIndices.has(index);
  const fmt = (track.format || "").toUpperCase();
  const rp = track.relative_path;
  const locPills: { label: string; tone: string }[] = [];
  if (libPaths?.has(rp)) locPills.push({ label: "LIB", tone: "brand" });
  if (devPaths?.has(rp)) locPills.push({ label: "DEV", tone: "cyan" });
  if (plexPaths?.has(rp)) locPills.push({ label: "PLEX", tone: "amber" });
  if (spotifyPaths?.has(rp)) locPills.push({ label: "SPOT", tone: "emer" });
  return (
    <div
      style={{ ...style, display: "grid", gridTemplateColumns: GRID_COLS, alignItems: "center", gap: 12, ...(selected ? { background: "var(--brandS)", boxShadow: "inset 2px 0 0 var(--brand)" } : {}) }}
      className={`px-5 cursor-default select-none border-b border-line2 transition-colors ${selected ? "" : "hover:bg-panel2"}`}
      onClick={(e) => onRowClick(index, e)}
      onDoubleClick={() => onRowDoubleClick(index)}
      onContextMenu={(e) => onRowContextMenu(index, e)}
    >
      <span className="font-mono text-[10px] text-ink3 tabular-nums">{index + 1}</span>
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-ink">{track.title || "Unknown Title"}</p>
        {track.artist && <p className="truncate text-[11px] text-ink3">{track.artist}</p>}
      </div>
      <span className="truncate text-[12px] text-ink2">{track.album || "—"}</span>
      <span className="text-right font-mono text-[10px] text-ink2 tabular-nums">{formatDuration(track.duration_seconds)}</span>
      <span className="text-right font-mono text-[10px] text-ink2 tabular-nums">{formatSize(track.file_size)}</span>
      <div className="flex justify-end items-center gap-1 overflow-hidden">
        {locPills.map((p) => <span key={p.label} className="font-mono text-[8px] font-semibold tracking-[.06em] px-1.5 py-[3px] rounded-md shrink-0" style={{ background: `var(--${p.tone}S)`, color: `var(--${p.tone})` }}>{p.label}</span>)}
        {fmt && <span className="font-mono text-[8px] font-semibold tracking-[.06em] px-1.5 py-[3px] rounded-md shrink-0" style={fmtPill(fmt)}>{fmt}</span>}
      </div>
    </div>
  );
}

const COLUMNS: { key: SortField | "#"; label: string; sortable: boolean; right?: boolean }[] = [
  { key: "#", label: "#", sortable: false },
  { key: "title", label: "TITLE", sortable: true },
  { key: "album", label: "ALBUM", sortable: true },
  { key: "duration", label: "TIME", sortable: true, right: true },
  { key: "size", label: "SIZE", sortable: true, right: true },
  { key: "format", label: "TAGS", sortable: false, right: true },
];

export default function TrackTable({ tracks, selectedIndices, onSelectionChange, onTrackDoubleClick, onContextMenu, sortColumn, sortDirection, onSort, libPaths, devPaths, plexPaths, spotifyPaths }: TrackTableProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState(400);
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(([entry]) => setListHeight(entry.contentRect.height));
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const handleRowClick = useCallback((index: number, e: React.MouseEvent) => {
    if (e.shiftKey && anchorIndex !== null) {
      const start = Math.min(anchorIndex, index), end = Math.max(anchorIndex, index);
      const newSet = new Set(e.metaKey || e.ctrlKey ? selectedIndices : new Set<number>());
      for (let i = start; i <= end; i++) newSet.add(i);
      onSelectionChange(newSet);
    } else if (e.metaKey || e.ctrlKey) {
      const newSet = new Set(selectedIndices);
      newSet.has(index) ? newSet.delete(index) : newSet.add(index);
      onSelectionChange(newSet); setAnchorIndex(index);
    } else { onSelectionChange(new Set([index])); setAnchorIndex(index); }
  }, [anchorIndex, selectedIndices, onSelectionChange]);

  const handleRowDoubleClick = useCallback((index: number) => onTrackDoubleClick?.(index), [onTrackDoubleClick]);
  const handleRowContextMenu = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault();
    if (!selectedIndices.has(index)) { onSelectionChange(new Set([index])); setAnchorIndex(index); }
    onContextMenu?.(index, e);
  }, [selectedIndices, onSelectionChange, onContextMenu]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSelectionChange(new Set());
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

  if (tracks.length === 0) {
    return <div className="flex flex-col items-center justify-center h-full text-ink3 gap-3 py-20"><p className="text-sm">No tracks</p></div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="grid items-center gap-3 px-5 py-3 panel2 border-b border-line font-mono text-[8px] font-semibold tracking-[.14em] text-ink3 sticky top-0 z-10" style={{ gridTemplateColumns: GRID_COLS }}>
        {COLUMNS.map((col) => {
          const isSort = col.sortable && sortColumn === col.key;
          return (
            <span key={col.key} onClick={() => col.sortable && onSort(col.key as SortField)}
              className={`select-none ${col.right ? "text-right" : ""} ${col.sortable ? "cursor-pointer" : ""}`}
              style={isSort ? { color: "var(--brand)" } : undefined}>
              {col.label}{isSort ? (sortDirection === "asc" ? " ↑" : " ↓") : ""}
            </span>
          );
        })}
      </div>
      <div ref={containerRef} className="flex-1 min-h-0">
        <List
          rowComponent={TrackRow}
          rowCount={tracks.length}
          rowHeight={44}
          rowProps={{ tracks, selectedIndices, libPaths, devPaths, plexPaths, spotifyPaths, onRowClick: handleRowClick, onRowDoubleClick: handleRowDoubleClick, onRowContextMenu: handleRowContextMenu }}
          style={{ height: listHeight }}
          overscanCount={10}
        />
      </div>
    </div>
  );
}

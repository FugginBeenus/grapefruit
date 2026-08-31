import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "../StatusBar";
import { Toast } from "../Toast";
import { UpdateBanner } from "../UpdateBanner";

const TITLES: Record<string, [string, string]> = {
  gap: ["Streaming Gap", "COMPARE · SOURCES → LOCAL LIBRARY"],
  sync: ["Device Sync", "SYNC · LOCAL LIBRARY → DEVICE"],
  import: ["Import", "IMPORT · PLAYLIST → M3U8"],
  library: ["Library", "THE HUB · YOUR OWNED FILES"],
  playlists: ["Playlists", "M3U8 · /PLAYLISTS"],
  tools: ["Tools", "HEALTH · DUPLICATES · ORGANIZE"],
  settings: ["Settings", "LIBRARY · SPOTIFY · PLEX · ABOUT"],
};

export function AppLayout() {
  const seg = useLocation().pathname.split("/")[1] || "gap";
  const [title, kicker] = TITLES[seg] || TITLES.gap;

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-bg">
      <div className="h-2 shrink-0" style={{ WebkitAppRegion: "drag" } as React.CSSProperties} />
      <UpdateBanner />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden" style={{ backgroundImage: "var(--grain)" }}>
          <div className="h-[64px] shrink-0 px-6 flex items-center gap-3.5 border-b border-line">
            <div className="min-w-0">
              <div className="font-display text-[22px] font-bold tracking-[-0.01em] leading-tight truncate text-ink">{title}</div>
              <div className="font-mono text-[9px] truncate text-ink3 mt-0.5">{kicker}</div>
            </div>
          </div>
          <main className="flex-1 min-h-0 overflow-y-auto px-8 pt-6 pb-[30px]">
            <Outlet />
          </main>
        </div>
      </div>
      <StatusBar />
      <Toast />
    </div>
  );
}

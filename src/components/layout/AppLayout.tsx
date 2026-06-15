import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "../StatusBar";
import { Toast } from "../Toast";
import { UpdateBanner } from "../UpdateBanner";

export function AppLayout() {
  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-bg-base">
      {/* Drag region */}
      <div className="h-2 shrink-0" style={{ WebkitAppRegion: "drag" } as React.CSSProperties} />
      {/* Update banner (only renders when a newer release exists) */}
      <UpdateBanner />
      {/* Main */}
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main className="flex-1 min-w-0 overflow-y-auto px-8 pb-8 relative" style={{ background: "radial-gradient(ellipse at 30% 0%, rgba(255, 99, 71, 0.04) 0%, transparent 60%), var(--color-bg-base)" }}>
          <div className="fade-in pt-2">
            <Outlet />
          </div>
        </main>
      </div>
      {/* Status bar */}
      <StatusBar />
      {/* Toast overlay */}
      <Toast />
    </div>
  );
}

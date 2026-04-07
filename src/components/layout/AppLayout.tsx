import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";

export function AppLayout() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg-base">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top chrome bar for native window drag */}
        <div className="h-8 shrink-0 bg-bg-primary" data-tauri-drag-region="" />
        <div className="flex-1 overflow-y-auto px-8 pb-8">
          <div className="fade-in">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}

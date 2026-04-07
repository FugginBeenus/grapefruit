import { NavLink, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useDeviceStore } from "../../stores/deviceStore";

const NAV_ITEMS = [
  {
    section: "Music",
    items: [
      { to: "/library", label: "Library", icon: IconLibrary },
      { to: "/import", label: "Import", icon: IconImport },
      { to: "/sync", label: "Sync", icon: IconSync },
      { to: "/duplicates", label: "Duplicates", icon: IconDuplicates },
    ],
  },
  {
    section: "Plex",
    items: [
      { to: "/plex-sync", label: "Plex Sync", icon: IconPlex },
      { to: "/plex-settings", label: "Settings", icon: IconSettings },
    ],
  },
];

export function Sidebar() {
  const navigate = useNavigate();
  const { selectedDevice, playlists, scanning, scanForDevices } = useDeviceStore();

  useEffect(() => {
    scanForDevices();
  }, [scanForDevices]);

  return (
    <aside className="flex flex-col w-[240px] min-w-[240px] bg-bg-primary border-r border-b h-full select-none">
      {/* App logo */}
      <div className="h-8 flex items-center px-5 shrink-0" data-tauri-drag-region="">
        {/* spacer for window chrome */}
      </div>

      <div className="px-4 pb-4">
        <NavLink to="/" className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 rounded-lg bg-gf flex items-center justify-center shadow-lg shadow-gf/20">
            <span className="text-white text-sm font-black">G</span>
          </div>
          <span className="text-[15px] font-bold text-t tracking-tight group-hover:text-gf transition-colors">
            Grapefruit
          </span>
        </NavLink>
      </div>

      {/* Device card */}
      <div className="px-3 mb-3">
        {selectedDevice ? (
          <div className="card p-3 space-y-2.5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-ok-muted flex items-center justify-center">
                <IconDevice className="w-4 h-4 text-ok" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold text-t truncate leading-tight">
                  {selectedDevice.label || "iPod"}
                </p>
                <p className="text-[10px] text-t-muted leading-tight">{selectedDevice.model || "Connected"}</p>
              </div>
            </div>
            <StorageIndicator used={selectedDevice.used_bytes} total={selectedDevice.capacity_bytes} />
          </div>
        ) : (
          <button
            onClick={() => scanForDevices()}
            disabled={scanning}
            className="w-full card p-3 flex items-center gap-2.5 hover:border-b-light transition-colors group"
          >
            <div className="w-8 h-8 rounded-lg bg-bg-surface flex items-center justify-center group-hover:bg-bg-elevated transition-colors">
              <IconDevice className="w-4 h-4 text-t-muted" />
            </div>
            <div className="text-left">
              <p className="text-[12px] font-medium text-t-secondary">
                {scanning ? "Scanning..." : "No device"}
              </p>
              <p className="text-[10px] text-t-secondary">Click to scan</p>
            </div>
          </button>
        )}
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto px-3 space-y-5">
        {NAV_ITEMS.map(({ section, items }) => (
          <div key={section}>
            <p className="px-2 mb-1.5 text-[10px] font-semibold tracking-[0.08em] text-t-secondary uppercase">
              {section}
            </p>
            <nav className="space-y-0.5">
              {items.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] transition-all ${
                      isActive
                        ? "bg-gf-glow text-gf font-semibold"
                        : "text-t-secondary hover:bg-bg-hover hover:text-t"
                    }`
                  }
                >
                  <Icon className="w-[18px] h-[18px]" />
                  <span>{label}</span>
                </NavLink>
              ))}
            </nav>
          </div>
        ))}

        {/* Playlists */}
        {playlists.length > 0 && (
          <div>
            <p className="px-2 mb-1.5 text-[10px] font-semibold tracking-[0.08em] text-t-secondary uppercase">
              Playlists
            </p>
            <nav className="space-y-0.5">
              {playlists.map((pl) => (
                <NavLink
                  key={pl.path}
                  to={`/playlist/${encodeURIComponent(pl.name)}`}
                  className={({ isActive }) =>
                    `flex items-center justify-between rounded-lg px-2.5 py-[7px] text-[13px] transition-all ${
                      isActive
                        ? "bg-gf-glow text-gf font-semibold"
                        : "text-t-secondary hover:bg-bg-hover hover:text-t"
                    }`
                  }
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <IconPlaylist className="w-[18px] h-[18px] shrink-0" />
                    <span className="truncate">{pl.name}</span>
                  </div>
                  <span className="text-[10px] text-t-muted ml-2 shrink-0">{pl.track_count}</span>
                </NavLink>
              ))}
            </nav>
          </div>
        )}
      </div>

      {/* Import button at bottom */}
      <div className="p-3 mt-auto">
        <button
          onClick={() => navigate("/import")}
          className="btn btn-primary w-full text-[12px] py-2"
        >
          <IconPlus className="w-4 h-4" />
          Import Playlist
        </button>
      </div>
    </aside>
  );
}

/* ── Storage indicator ─────────────────────── */

function StorageIndicator({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? (used / total) * 100 : 0;
  const free = total - used;
  const fmt = (b: number) => {
    const gb = b / 1024 ** 3;
    return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(b / 1024 ** 2).toFixed(0)} MB`;
  };

  return (
    <div>
      <div className="h-1.5 bg-bg-base rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${pct > 90 ? "bg-err" : "bg-gf"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[10px] text-t-muted mt-1">
        {fmt(free)} free of {fmt(total)}
      </p>
    </div>
  );
}

/* ── Icons ─────────────────────────────────── */

function IconDevice({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
    </svg>
  );
}

function IconLibrary({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
    </svg>
  );
}

function IconImport({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
    </svg>
  );
}

function IconSync({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M21.015 4.356v4.992" />
    </svg>
  );
}

function IconDuplicates({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" />
    </svg>
  );
}

function IconPlex({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.91 11.672a.375.375 0 010 .656l-5.603 3.113a.375.375 0 01-.557-.328V8.887c0-.286.307-.466.557-.327l5.603 3.112z" />
    </svg>
  );
}

function IconSettings({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function IconPlaylist({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M12 17.25h8.25" />
    </svg>
  );
}

function IconPlus({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

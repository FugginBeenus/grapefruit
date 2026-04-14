import { NavLink, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useDeviceStore } from "../../stores/deviceStore";
import { usePlexStore } from "../../stores/plexStore";
import { open } from "@tauri-apps/plugin-dialog";

const SAVED_PATH_KEY = "grapefruit:localLibraryPath";

const NAV_ITEMS = [
  {
    section: "Manage",
    items: [
      { to: "/library", label: "Library", icon: IconLibrary, color: "cyan" as const },
      { to: "/playlists", label: "Playlists", icon: IconPlaylist, color: "violet" as const },
      { to: "/import", label: "Import", icon: IconImport, color: "pink" as const },
      { to: "/tools", label: "Tools", icon: IconTools, color: "amber" as const },
    ],
  },
  {
    section: "Sync",
    items: [
      { to: "/sync", label: "Sync", icon: IconSync, color: "emerald" as const },
      { to: "/settings", label: "Settings", icon: IconSettings, color: "info" as const },
    ],
  },
];

export function Sidebar() {
  const navigate = useNavigate();
  const { selectedDevice, playlists, scanning, scanForDevices, connectLocalLibrary, disconnect, error } = useDeviceStore();
  const plexConfig = usePlexStore((s) => s.config);
  const loadPlexConfig = usePlexStore((s) => s.loadConfig);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    scanForDevices();
    loadPlexConfig();
  }, [scanForDevices, loadPlexConfig]);

  const handleBrowseFolder = async () => {
    setFolderError(null);
    try {
      // Default to saved path or music_library_path from Settings
      const defaultPath = localStorage.getItem(SAVED_PATH_KEY) || plexConfig?.music_library_path || undefined;
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select your music library folder",
        defaultPath,
      });
      if (!selected) return; // user cancelled
      const folderPath = typeof selected === "string" ? selected : selected;
      setConnecting(true);
      await connectLocalLibrary(folderPath);
      localStorage.setItem(SAVED_PATH_KEY, folderPath);
    } catch (e) {
      setFolderError(String(e));
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = () => {
    disconnect();
  };

  const isLocal = selectedDevice?.firmware === "local";

  return (
    <aside className="flex flex-col w-[240px] min-w-[240px] border-r border-b h-full select-none" style={{ background: "linear-gradient(180deg, #12121A 0%, #0B0B10 100%)" }}>
      {/* Drag spacer */}
      <div className="h-3 shrink-0" data-tauri-drag-region="" />

      {/* App logo */}
      <div className="px-4 pb-4">
        <NavLink to="/" className="flex items-center gap-2.5 group">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-lg" style={{ background: "linear-gradient(135deg, #FF7F66 0%, #E5503A 100%)", boxShadow: "0 4px 16px rgba(255, 99, 71, 0.3), 0 0 24px rgba(255, 99, 71, 0.15)" }}>
            <span className="text-white text-base font-black drop-shadow-sm">G</span>
          </div>
          <span className="text-[16px] font-semibold text-t tracking-tight group-hover:text-gf transition-colors">
            Grapefruit
          </span>
        </NavLink>
      </div>

      {/* Device card */}
      <div className="px-3 mb-3">
        {selectedDevice ? (
          <div className="card p-3 space-y-2.5 border-ok/30">
            <div className="flex items-center gap-2.5">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isLocal ? "bg-info-muted" : "bg-ok-muted"}`}>
                {isLocal ? <IconFolder className="w-4 h-4 text-info" /> : <IconDevice className="w-4 h-4 text-ok" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold text-t truncate leading-tight">
                  {selectedDevice.label || "iPod"}
                </p>
                <p className="text-[10px] text-t-muted leading-tight">{selectedDevice.model || "Connected"}</p>
              </div>
              <button
                onClick={handleDisconnect}
                className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-t-muted hover:text-t hover:bg-bg-hover transition-colors"
                title="Disconnect"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <StorageIndicator used={selectedDevice.used_bytes} total={selectedDevice.capacity_bytes} />
            <DeviceFormatBreakdown />
          </div>
        ) : (
          <div className="space-y-2">
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

            <button
              onClick={handleBrowseFolder}
              disabled={connecting}
              className="w-full card p-2.5 flex items-center gap-2.5 hover:border-b-light transition-colors group"
            >
              <div className="w-7 h-7 rounded-md bg-bg-surface flex items-center justify-center group-hover:bg-bg-elevated transition-colors">
                {connecting
                  ? <div className="w-3.5 h-3.5 border-2 border-t-transparent border-info rounded-full animate-spin" />
                  : <IconFolder className="w-3.5 h-3.5 text-t-muted" />}
              </div>
              <p className="text-[11px] text-t-secondary">
                {connecting ? "Connecting..." : "Browse local folder"}
              </p>
            </button>
            {folderError && (
              <p className="text-[10px] text-err px-1">{folderError}</p>
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto px-3 space-y-1">
        {NAV_ITEMS.map(({ section, items }, idx) => {
          const sectionColor = idx === 0 ? "bg-cyan" : "bg-emerald";
          return (
          <div key={section}>
            {idx > 0 && <div className="border-b border-b-[rgba(255,255,255,0.06)] mx-2 my-3" />}
            <div className="flex items-center gap-1.5 px-2 mb-1.5">
              <div className={`w-[2px] h-3 rounded-full ${sectionColor}`} />
              <p className="text-[10px] font-semibold tracking-[0.08em] text-t-secondary uppercase">
                {section}
              </p>
            </div>
            <nav className="space-y-0.5">
              {items.map(({ to, label, icon: Icon, color }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-all duration-150 ${
                      isActive
                        ? "bg-bg-hover/60 text-t font-semibold"
                        : "text-t-secondary hover:bg-bg-hover hover:text-t"
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <div className={`icon-box icon-box-sm icon-box-${color} ${isActive ? "ring-1 ring-white/10" : ""}`}>
                        <Icon className="w-[14px] h-[14px]" />
                      </div>
                      <span>{label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </nav>
          </div>
        );
        })}

        {/* Playlists */}
        {playlists.length > 0 && (
          <div>
            <div className="border-b border-b-[rgba(255,255,255,0.06)] mx-2 my-3" />
            <div className="flex items-center gap-1.5 px-2 mb-1.5">
              <div className="w-[2px] h-3 rounded-full bg-violet" />
              <p className="text-[10px] font-semibold tracking-[0.08em] text-t-secondary uppercase">
                Playlists
              </p>
              <span className="ml-auto badge badge-violet text-[9px]">
                {playlists.length}
              </span>
            </div>
            <nav className="space-y-0.5">
              {playlists.map((pl) => (
                <NavLink
                  key={pl.path}
                  to={`/playlists/${encodeURIComponent(pl.name)}`}
                  className={({ isActive }) =>
                    `flex items-center justify-between rounded-lg pl-5 pr-2.5 py-1.5 text-[12px] transition-all duration-150 ${
                      isActive
                        ? "bg-violet-glow text-violet font-semibold"
                        : "text-t-secondary hover:bg-bg-hover hover:text-t"
                    }`
                  }
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <IconPlaylist className="w-[16px] h-[16px] shrink-0" />
                    <span className="truncate">{pl.name}</span>
                  </div>
                  <span className="text-[10px] text-t-muted ml-2 shrink-0">{pl.track_count}</span>
                </NavLink>
              ))}
            </nav>
          </div>
        )}
      </div>

      {/* Bottom spacer */}
      <div className="pb-3 mt-auto" />
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
      <div className="h-1 bg-bg-base rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${pct}%`,
            background: pct > 90
              ? "var(--color-err)"
              : "linear-gradient(90deg, var(--color-gf-dark), var(--color-gf))",
          }}
        />
      </div>
      <p className="text-[10px] text-t-muted mt-1">
        {fmt(free)} free of {fmt(total)}
      </p>
    </div>
  );
}

function DeviceFormatBreakdown() {
  const tracks = useDeviceStore((s) => s.tracks);
  if (tracks.length === 0) return null;

  const formats = new Set<string>();
  for (const t of tracks) {
    if (t.format) formats.add(t.format.toUpperCase());
  }
  const formatStr = Array.from(formats).sort().join(", ");

  return (
    <p className="text-[10px] text-t-muted leading-tight">
      {tracks.length.toLocaleString()} tracks{formatStr ? ` \u00B7 ${formatStr}` : ""}
    </p>
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

function IconTools({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z" />
    </svg>
  );
}

function IconFolder({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
    </svg>
  );
}

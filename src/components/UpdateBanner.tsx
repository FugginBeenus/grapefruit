import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { getLatestRelease } from "../api/update";

const DISMISS_KEY = "grapefruit:dismissedUpdate";

function parseVersion(v: string): number[] {
  return v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
}

/** True if `latest` is a strictly higher semver than `current`. */
function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export function UpdateBanner() {
  const [info, setInfo] = useState<{ version: string; url: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [current, release] = await Promise.all([getVersion(), getLatestRelease()]);
        const latest = release.tag_name.replace(/^v/, "");
        if (cancelled || !latest) return;
        if (isNewer(latest, current) && localStorage.getItem(DISMISS_KEY) !== latest) {
          setInfo({ version: latest, url: release.html_url });
        }
      } catch {
        /* offline, rate-limited, or sidecar not ready — silently skip */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!info) return null;

  return (
    <div className="flex items-center justify-center gap-3 px-4 py-1.5 text-[12px] text-t bg-gf-glow border-b border-gf-border shrink-0">
      <span aria-hidden>🍊</span>
      <span>
        A new version <strong>v{info.version}</strong> is available.
      </span>
      <button
        onClick={() => openUrl(info.url)}
        className="font-semibold text-gf hover:text-gf-light transition-colors"
      >
        Download
      </button>
      <button
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, info.version);
          setInfo(null);
        }}
        className="text-t-muted hover:text-t transition-colors"
        title="Dismiss"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

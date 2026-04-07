import type { MatchStatus } from "../types/models";

const config: Record<MatchStatus, { label: string; cls: string }> = {
  matched: { label: "Matched", cls: "bg-ok-muted text-ok" },
  confirmed: { label: "Confirmed", cls: "bg-ok-muted text-ok" },
  uncertain: { label: "Uncertain", cls: "bg-warn-muted text-warn" },
  missing: { label: "Missing", cls: "bg-err-muted text-err" },
  manual: { label: "Manual", cls: "bg-info-muted text-info" },
  rejected: { label: "Rejected", cls: "bg-bg-surface text-t-muted" },
};

export function StatusBadge({ status }: { status: MatchStatus }) {
  const c = config[status];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide ${c.cls}`}>
      {c.label}
    </span>
  );
}

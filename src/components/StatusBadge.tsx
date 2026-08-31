import type { MatchStatus } from "../types/models";

const config: Record<MatchStatus, { label: string; tone: string }> = {
  matched: { label: "Matched", tone: "emer" },
  confirmed: { label: "Confirmed", tone: "emer" },
  uncertain: { label: "Uncertain", tone: "amber" },
  missing: { label: "Missing", tone: "err" },
  manual: { label: "Manual", tone: "cyan" },
  rejected: { label: "Rejected", tone: "muted" },
};

export function StatusBadge({ status }: { status: MatchStatus }) {
  const c = config[status];
  const style =
    c.tone === "muted"
      ? { background: "var(--panel2)", color: "var(--ink3)" }
      : { background: `var(--${c.tone}S)`, color: `var(--${c.tone})` };
  return (
    <span className="inline-flex items-center px-2 py-1 rounded-md font-mono text-[8px] font-semibold uppercase tracking-[.08em]" style={style}>
      {c.label}
    </span>
  );
}

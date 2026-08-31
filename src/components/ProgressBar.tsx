interface ProgressBarProps {
  percent?: number;
  label?: string;
  sublabel?: string;
  /** Show a looping animation instead of a measured fill (for ops with no count). */
  indeterminate?: boolean;
}

export function ProgressBar({ percent = 0, label, sublabel, indeterminate = false }: ProgressBarProps) {
  return (
    <div className="w-full">
      {(label || sublabel) && (
        <div className="flex justify-between items-baseline mb-2">
          {label && <span className="font-mono text-[10px] tracking-[.06em] text-ink2">{label}</span>}
          {sublabel && <span className="font-mono text-[10px] text-ink3 tabular-nums">{sublabel}</span>}
        </div>
      )}
      <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "var(--line)" }}>
        {indeterminate ? (
          <div className="h-full rounded-full progress-indeterminate" style={{ background: "var(--brand)" }} />
        ) : (
          <div
            className="h-full rounded-full transition-all duration-300 ease-out"
            style={{ width: `${Math.min(100, Math.max(0, percent))}%`, background: "var(--brand)" }}
          />
        )}
      </div>
    </div>
  );
}

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
          {label && <span className="text-xs font-medium text-t-secondary">{label}</span>}
          {sublabel && <span className="text-[11px] text-t-muted tabular-nums">{sublabel}</span>}
        </div>
      )}
      <div className="w-full h-2 bg-bg-surface rounded-full overflow-hidden">
        {indeterminate ? (
          <div className="h-full bg-gf rounded-full progress-indeterminate" />
        ) : (
          <div
            className="h-full bg-gf rounded-full transition-all duration-300 ease-out"
            style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
          />
        )}
      </div>
    </div>
  );
}

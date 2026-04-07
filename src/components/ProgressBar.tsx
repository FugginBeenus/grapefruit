interface ProgressBarProps {
  percent: number;
  label?: string;
  sublabel?: string;
}

export function ProgressBar({ percent, label, sublabel }: ProgressBarProps) {
  return (
    <div className="w-full">
      {(label || sublabel) && (
        <div className="flex justify-between items-baseline mb-2">
          {label && <span className="text-xs font-medium text-t-secondary">{label}</span>}
          {sublabel && <span className="text-[11px] text-t-muted tabular-nums">{sublabel}</span>}
        </div>
      )}
      <div className="w-full h-2 bg-bg-surface rounded-full overflow-hidden">
        <div
          className="h-full bg-gf rounded-full transition-all duration-300 ease-out"
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
    </div>
  );
}

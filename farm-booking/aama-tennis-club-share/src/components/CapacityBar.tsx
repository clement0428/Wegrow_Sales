type Props = {
  confirmed: number;
  capacity: number;
  waitlist?: number;
  compact?: boolean;
  className?: string;
};

export default function CapacityBar({ confirmed, capacity, waitlist = 0, compact = false, className = "" }: Props) {
  const pct = Math.min(100, capacity > 0 ? (confirmed / capacity) * 100 : 0);
  const full = confirmed >= capacity;
  return (
    <div className={className}>
      <div className={`flex items-baseline justify-between ${compact ? "mb-1" : "mb-1.5"}`}>
        <div className="flex items-baseline gap-1 font-display tabular">
          <span className="text-[var(--ink)] font-semibold text-[15px]">{confirmed}</span>
          <span className="text-[var(--ink-3)] text-[12px]">/ {capacity}</span>
        </div>
        {waitlist > 0 ? (
          <span className="text-[11px] text-[var(--ink-2)] font-medium">
            候補 <span className="tabular font-semibold text-[var(--primary)]">{waitlist}</span>
          </span>
        ) : (
          <span className="text-[11px] text-[var(--ink-3)]">{full ? "已滿" : `還缺 ${capacity - confirmed}`}</span>
        )}
      </div>
      <div className={`relative w-full rounded-full bg-[var(--surface-2)] overflow-hidden ${compact ? "h-1.5" : "h-2"}`}>
        <div
          className="cap-fill absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${pct}%`,
            background: full
              ? "var(--primary)"
              : "linear-gradient(90deg, var(--court) 0%, color-mix(in oklab, var(--court) 70%, var(--accent)) 100%)",
          }}
        />
        <div className="absolute inset-0 flex">
          {Array.from({ length: Math.max(0, capacity - 1) }).map((_, i) => (
            <div key={i} className="flex-1 border-r border-[color-mix(in_oklab,var(--ink)_8%,transparent)] last:border-r-0" />
          ))}
        </div>
      </div>
    </div>
  );
}

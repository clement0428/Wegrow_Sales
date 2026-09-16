import type { DisplayStatus } from "@/lib/domain/event-status";

const STYLES: Record<DisplayStatus, string> = {
  "接龍中":     "bg-[var(--accent)] text-[var(--accent-ink)]",
  "已截止":     "bg-[var(--surface-2)] text-[var(--ink-2)]",
  "結算中":     "bg-[color-mix(in_oklab,var(--warning)_16%,transparent)] text-[var(--warning)]",
  "結算完成":   "bg-[var(--primary-soft)] text-[var(--primary)]",
  "已取消":     "bg-[color-mix(in_oklab,var(--danger)_14%,transparent)] text-[var(--danger)]",
};

export function StatusBadge({ status, className = "" }: { status: DisplayStatus; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-[3px] rounded-full text-[11px] font-semibold tracking-wide ${STYLES[status]} ${className}`}
    >
      {status === "接龍中" ? <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-ink)] animate-pulse" /> : null}
      {status}
    </span>
  );
}

export default StatusBadge;

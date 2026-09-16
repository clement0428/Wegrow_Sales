const block = "rounded-[18px] bg-[var(--surface)] shadow-[var(--shadow-1)] animate-pulse";

export default function TabSkeleton({ hero = true, rows = 3 }: { hero?: boolean; rows?: number }) {
  return (
    <div className="px-2" aria-hidden>
      <div className="pt-1 pb-3">
        <div className="h-[11px] w-16 rounded bg-[color-mix(in_oklab,var(--primary)_35%,transparent)] animate-pulse" />
      </div>
      {hero && <div className={`${block} h-[150px] mb-3.5`} />}
      <div className="space-y-3.5">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className={`${block} h-[108px]`} />
        ))}
      </div>
    </div>
  );
}

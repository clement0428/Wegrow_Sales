"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, Check } from "lucide-react";
import { hm, dateParts } from "@/lib/time";
import type { DisplayStatus } from "@/lib/domain/event-status";

type Row = {
  id: string;
  title: string;
  event_date: string;
  start_time: string;
  venue_name: string;
  event_status: "open" | "settled" | "cancelled";
  display_status: DisplayStatus;
};

type FilterKey = "all" | DisplayStatus;

const STATUS_PRIORITY: Record<DisplayStatus, number> = {
  "接龍中": 0,
  "結算中": 1,
  "結算完成": 2,
  "已截止": 3,
  "已取消": 4,
};

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "接龍中", label: "接龍中" },
  { key: "結算中", label: "結算中" },
  { key: "結算完成", label: "結算完成" },
];

const pillCls: Record<DisplayStatus, string> = {
  "接龍中":   "bg-[var(--accent)] text-[var(--accent-ink)]",
  "已截止":   "bg-[var(--surface-2)] text-[var(--ink-2)]",
  "結算中":   "bg-[color-mix(in_oklab,var(--warning)_16%,transparent)] text-[var(--warning)]",
  "結算完成": "bg-[var(--primary-soft)] text-[var(--primary)]",
  "已取消":   "bg-[var(--surface-2)] text-[var(--ink-3)]",
};

export default function ManageEventList({ events }: { events: Row[] }) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const sorted = useMemo(() => {
    const scored = events.map((e) => ({ ...e, _p: STATUS_PRIORITY[e.display_status] }));
    scored.sort((a, b) => {
      if (a._p !== b._p) return a._p - b._p;
      // within 接龍中: soonest first; others: most recent first
      if (a.display_status === "接龍中") return a.event_date.localeCompare(b.event_date);
      return b.event_date.localeCompare(a.event_date);
    });
    return scored;
  }, [events]);

  const visible = filter === "all" ? sorted : sorted.filter((e) => e.display_status === filter);

  const counts: Record<string, number> = { all: events.length };
  for (const e of events) counts[e.display_status] = (counts[e.display_status] ?? 0) + 1;

  const current = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];

  return (
    <>
      <div ref={menuRef} className="relative mb-3 inline-block">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="press inline-flex items-center gap-1.5 rounded-full pl-3.5 pr-2.5 py-1.5 text-[12.5px] font-semibold border"
          style={{ background: "var(--primary)", color: "var(--primary-ink)", borderColor: "var(--primary)" }}
        >
          {current.label}
          <span className="tabular opacity-75">{counts[current.key] ?? 0}</span>
          <ChevronDown
            className="w-4 h-4 transition-transform"
            style={{ transform: open ? "rotate(180deg)" : undefined }}
            strokeWidth={2.4}
          />
        </button>

        {open && (
          <div
            role="listbox"
            className="absolute left-0 top-full mt-1.5 z-30 min-w-[168px] rounded-[14px] p-1.5 border border-[var(--line)]"
            style={{ background: "var(--surface)", boxShadow: "var(--shadow-2)" }}
          >
            {FILTERS.map((f) => {
              const active = f.key === filter;
              return (
                <button
                  key={f.key}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => { setFilter(f.key); setOpen(false); }}
                  className="press w-full flex items-center gap-2 rounded-[10px] px-2.5 py-2 text-[13px] font-semibold text-left"
                  style={active ? { background: "var(--primary-soft)", color: "var(--primary)" } : { color: "var(--ink)" }}
                >
                  <span className="flex-1">{f.label}</span>
                  <span className="tabular text-[11.5px]" style={{ color: active ? "var(--primary)" : "var(--ink-3)" }}>
                    {counts[f.key] ?? 0}
                  </span>
                  {active && <Check className="w-3.5 h-3.5" strokeWidth={2.6} />}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {visible.length === 0 && (
        <p className="py-16 text-center text-[var(--ink-3)] text-sm">
          {events.length === 0
            ? <>還沒有你開的場次<br />到「場次」按右下角 + 開一場</>
            : <>沒有符合的場次</>}
        </p>
      )}

      <div className="space-y-3.5">
        {visible.map((e) => {
          const d = dateParts(e.event_date);
          const dim = e.event_status === "settled" || e.event_status === "cancelled";
          return (
            <div key={e.id} className="bg-[var(--surface)] rounded-[18px] p-3.5 shadow-[var(--shadow-1)]" style={dim ? { opacity: 0.75 } : undefined}>
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <div className="text-[14.5px] font-semibold truncate">{e.title}</div>
                  <div className="text-[11.5px] text-[var(--ink-2)] mt-0.5">
                    {e.event_date.slice(5).replace("-", "/")}（{d.weekday}）{hm(e.start_time)} · {e.venue_name}
                  </div>
                </div>
                <span className={`px-2 py-[3px] rounded-full text-[10.5px] font-bold whitespace-nowrap ${pillCls[e.display_status]}`}>{e.display_status}</span>
              </div>
              <div className="flex gap-2 mt-3">
                <Link href={`/manage/${e.id}?view=edit`} className="press flex-1 rounded-[10px] py-2 text-center text-[12.5px] font-semibold border border-[var(--line)] bg-transparent text-[var(--ink)]">編輯</Link>
                <Link href={`/manage/${e.id}?view=settle`} className="press flex-1 rounded-[10px] py-2 text-center text-[12.5px] font-bold" style={{ background: "var(--primary)", color: "var(--primary-ink)" }}>結算</Link>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

"use client";
import Link from "next/link";
import type { EventWithCounts } from "@/lib/db/queries";
import { dateParts, hm } from "@/lib/time";
import HeroBanner from "./HeroBanner";

export default function HeroNextEventCard({ event }: { event: EventWithCounts; now: Date }) {
  const d = dateParts(event.event_date);
  const eyebrow = "最近一場";
  const total = event.estimated_total;
  const perPerson = total && event.capacity ? Math.ceil(total / event.capacity) : null;
  const mm = event.event_date.slice(5, 7);
  const dd = event.event_date.slice(8, 10);

  return (
    <div>
      <div className="font-display text-[15px] font-extrabold tracking-[.04em] text-[var(--primary)] mb-2">
        {eyebrow}
      </div>
      <Link href={`/?event=${event.id}`} scroll={false} className="block press">
        <HeroBanner>

          <div className="flex justify-between items-start gap-2 relative">
            <div>
              <div className="text-[11.5px] font-semibold opacity-90">{d.weekday} · {mm}/{dd}</div>
              <div className="font-display text-[22px] font-bold mt-1 leading-[1.15]">{event.title}</div>
              <div className="text-[12.5px] mt-1 opacity-90">{hm(event.start_time)} · {event.venue.name}</div>
            </div>
            <span className="bg-[var(--accent)] text-[var(--accent-ink)] px-[9px] py-1 rounded-full text-[11px] font-bold whitespace-nowrap shrink-0">
              接龍中
            </span>
          </div>
          <div className="mt-4 flex items-center gap-2 relative text-[11.5px] opacity-95">
            <span className="tabular"><b>{event.confirmed_count}</b> / {event.capacity}</span>
            {perPerson !== null && <><span>·</span><span className="tabular"><b>${perPerson}</b>/人</span></>}
          </div>
        </HeroBanner>
      </Link>
    </div>
  );
}

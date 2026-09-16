"use client";
import { MapPin, Clock, Wallet } from "lucide-react";
import Link from "next/link";
import CapacityBar from "./CapacityBar";
import StatusBadge from "./StatusBadge";
import type { EventWithCounts } from "@/lib/db/queries";
import { deriveEventStatus } from "@/lib/domain/event-status";
import { dateParts, hm } from "@/lib/time";

type Props = {
  event: EventWithCounts;
  href: string;
  now: Date;
};

export default function EventCard({ event, href, now }: Props) {
  const d = dateParts(event.event_date);
  const status = deriveEventStatus(event, now);
  const pricePerPerson = event.estimated_total && event.capacity ? Math.ceil(event.estimated_total / event.capacity) : null;
  const start = hm(event.start_time);
  const end = hm(event.end_time);
  const monthLabel = parseInt(event.event_date.slice(5, 7), 10) + "月";

  return (
    <Link href={href} scroll={false} className="block">
      <article className="press group relative overflow-hidden rounded-[var(--radius-lg)] bg-[var(--surface)] shadow-[0_2px_6px_rgba(27,26,23,.08),0_12px_28px_rgba(27,26,23,.14)] hover:shadow-[0_4px_10px_rgba(27,26,23,.12),0_18px_34px_rgba(27,26,23,.18)] transition-shadow">
        <div className="flex gap-4 p-4">
          {/* Date block */}
          <div className="shrink-0 w-[64px] text-center">
            <div
              className="rounded-[14px] py-2 px-1 font-display"
              style={{ background: "var(--court-soft)", color: "var(--court)" }}
            >
              <div className="text-[10px] font-bold tracking-widest opacity-80">{monthLabel}</div>
              <div className="text-[28px] leading-none font-bold tabular my-0.5">{d.day}</div>
              <div className="text-[10px] font-semibold opacity-80">{d.weekday}</div>
            </div>
          </div>

          {/* Body */}
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-[16px] leading-tight font-semibold text-[var(--ink)] truncate">
                {event.title}
              </h3>
              <StatusBadge status={status} />
            </div>

            <div className="mt-1.5 flex items-center gap-1 text-[12.5px] text-[var(--ink-2)] tabular">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span>{start}–{end}</span>
            </div>
            <div className="mt-0.5 flex items-center gap-1 text-[12.5px] text-[var(--ink-2)] min-w-0">
              <MapPin className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{event.venue.name}</span>
            </div>

            <div className="mt-3">
              <CapacityBar
                confirmed={event.confirmed_count}
                capacity={event.capacity}
                waitlist={event.waitlist_count}
                compact
              />
            </div>

            <div className="mt-2.5 flex items-center text-[12px]">
              <div className="flex items-center gap-1.5 text-[var(--ink-2)]">
                <Wallet className="w-3.5 h-3.5" />
                <span className="font-bold text-[var(--ink)] tabular">${pricePerPerson ?? "—"}</span>
                <span className="text-[var(--ink-3)]"> /人</span>
              </div>
            </div>
          </div>
        </div>
      </article>
    </Link>
  );
}

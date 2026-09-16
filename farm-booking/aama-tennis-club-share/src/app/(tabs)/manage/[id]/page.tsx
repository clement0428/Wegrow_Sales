import { notFound } from "next/navigation";
import BackLink from "@/components/BackLink";
import { requireMember, isAdmin } from "@/lib/auth/current-member";
import { getEvent, listRegistrations, listMembers, listActiveVenues } from "@/lib/db/queries";
import { deriveEventStatus } from "@/lib/domain/event-status";
import { hm, taipeiParts } from "@/lib/time";
import EditEventSection from "@/components/manage/EditEventSection";
import CancelEventButton from "@/components/manage/CancelEventButton";
import RosterManager from "@/components/manage/RosterManager";
import SettleView from "@/components/manage/SettleView";

export const dynamic = "force-dynamic";

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    "接龍中":   "bg-[var(--accent)] text-[var(--accent-ink)]",
    "已截止":   "bg-[var(--surface-2)] text-[var(--ink-2)]",
    "結算中":   "bg-[color-mix(in_oklab,var(--warning)_16%,transparent)] text-[var(--warning)]",
    "結算完成": "bg-[var(--primary-soft)] text-[var(--primary)]",
    "已取消":   "bg-[var(--surface-2)] text-[var(--ink-3)]",
  };
  return <span className={`px-2 py-[3px] rounded-full text-[11px] font-bold whitespace-nowrap ${map[status]}`}>{status}</span>;
}

export default async function ManageEventPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ view?: string }> }) {
  const { id } = await params;
  const { view: rawView } = await searchParams;
  const me = await requireMember();
  const event = await getEvent(id);
  if (!event) notFound();
  if (event.organizer_id !== me.id && !isAdmin(me)) notFound();
  const settled = event.status === "settled";
  const cancelled = event.status === "cancelled";
  const view = rawView === "settle" || rawView === "edit" ? rawView : (settled ? "settle" : "edit");

  const [regs, members, venues] = await Promise.all([listRegistrations(id), listMembers(), listActiveVenues()]);
  const status = deriveEventStatus(event, new Date());
  const dl = taipeiParts(new Date(event.registration_deadline));
  const initial = {
    title: event.title, event_date: event.event_date, start_time: hm(event.start_time), end_time: hm(event.end_time),
    registration_deadline: `${dl.date}T${dl.time}`, venue_id: event.venue_id, capacity: event.capacity,
    estimated_total: event.estimated_total ?? undefined, note: event.note ?? "",
  };
  const inEvent = new Set(regs.map((r) => r.member_id));
  const candidates = members.filter((m) => !inEvent.has(m.id));

  return (
    <div className="px-3">
      {/* Header */}
      <div className="flex items-center gap-3 pt-1 pb-2">
        <BackLink href="/manage" />
        <div className="text-[12.5px] font-bold text-[var(--primary)] tracking-[.06em]">管理場次</div>
        <div className="ml-auto"><StatusPill status={status} /></div>
      </div>

      <div className="mt-1">
        <h1 className="font-display text-[26px] font-extrabold leading-[1.15] text-[var(--ink)]">{event.title}</h1>
        <div className="mt-1.5 text-[12.5px] text-[var(--ink-2)]">
          {event.event_date} · {hm(event.start_time)} · {event.venue.name}
        </div>
      </div>

      <div className="mt-5 space-y-4">
        {view === "edit" && !cancelled && (
          <>
            <RosterManager eventId={id} registrations={regs} candidates={candidates} locked={settled} />
            <EditEventSection eventId={id} venues={venues} initial={initial} />
            {event.status === "open" && <CancelEventButton eventId={id} />}
          </>
        )}

        {view === "settle" && !cancelled && (
          <SettleView event={event} registrations={regs} candidates={candidates} />
        )}

        {cancelled && (
          <div className="rounded-[14px] bg-[var(--surface-2)] p-5 text-center text-[var(--ink-3)] text-[13px]">此場次已取消</div>
        )}
      </div>
    </div>
  );
}

import Link from "next/link";
import { MapPin } from "lucide-react";
import { requireMember } from "@/lib/auth/current-member";
import { listEventsByOrganizer } from "@/lib/db/queries";
import { deriveEventStatus } from "@/lib/domain/event-status";
import ManageEventList from "@/components/manage/ManageEventList";

export const dynamic = "force-dynamic";

export default async function ManagePage() {
  const me = await requireMember();
  const events = await listEventsByOrganizer(me.id);
  const now = new Date();

  const rows = events.map((e) => ({
    id: e.id,
    title: e.title,
    event_date: e.event_date,
    start_time: e.start_time,
    venue_name: e.venue.name,
    event_status: e.status,
    display_status: deriveEventStatus(e, now),
  }));

  return (
    <div className="px-2">
      <div className="pt-1 pb-2 flex items-center justify-between">
        <div className="text-[11px] font-bold tracking-[.16em] uppercase text-[var(--primary)]">我開的場</div>
        <Link href="/manage/venues"
          className="press flex items-center gap-1.5 rounded-full bg-[var(--surface)] border border-[var(--line)] px-3 py-1.5 text-[12px] font-semibold text-[var(--ink-2)]">
          <MapPin className="w-3.5 h-3.5" />場地管理
        </Link>
      </div>
      <ManageEventList events={rows} />
    </div>
  );
}

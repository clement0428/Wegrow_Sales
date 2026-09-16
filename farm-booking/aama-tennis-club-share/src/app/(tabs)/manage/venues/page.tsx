import { requireMember } from "@/lib/auth/current-member";
import { listAllVenues } from "@/lib/db/queries";
import VenueEditor from "@/components/manage/VenueEditor";
import BackLink from "@/components/BackLink";

export const dynamic = "force-dynamic";

export default async function VenuesPage() {
  await requireMember();
  const venues = await listAllVenues();
  return (
    <div className="px-2">
      <div className="pt-1 pb-2 flex items-center gap-3">
        <BackLink href="/manage" />
        <div className="text-[11px] font-bold tracking-[.16em] uppercase text-[var(--primary)]">場地管理</div>
      </div>
      <VenueEditor venues={venues} />
    </div>
  );
}

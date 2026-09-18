import FarmAdmin from "@/components/farm/FarmAdmin";
import { requireAdmin } from "@/lib/auth/current-member";

export const dynamic = "force-dynamic";

// 2026-09-18: this route previously had NO auth check at all — anyone with
// the URL could open it. requireAdmin() redirects to /login if there's no
// session, and throws if the session exists but isn't role='admin' (caught
// by Next's error boundary — acceptable for now since FarmAdmin itself is
// still static mock data with no real customer data to protect yet; this
// must be revisited with a proper "not authorized" page once real data is
// wired in, see docs/booking-calendar-implementation.md).
export default async function AdminPage() {
  const member = await requireAdmin();
  return <FarmAdmin adminDisplayName={member.display_name} />;
}

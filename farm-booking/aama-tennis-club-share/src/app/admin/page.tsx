import FarmAdmin from "@/components/farm/FarmAdmin";
import { requireStaff } from "@/lib/auth/current-member";

export const dynamic = "force-dynamic";

// requireStaff() redirects to /login if there's no session, and throws if
// the session exists but isn't one of the three staff roles (admin,
// reception, kitchen — see current-member.ts's capability checks, which
// every /api/farm/admin/* route also enforces independently, not just this
// page gate).
export default async function AdminPage() {
  const member = await requireStaff();
  return <FarmAdmin adminDisplayName={member.display_name} role={member.role} />;
}

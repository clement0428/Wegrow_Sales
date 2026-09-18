import { z } from "zod";
import { requireAdmin } from "@/lib/auth/current-member";
import { getDb } from "@/lib/db/client";

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

type SessionRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  experience: string;
  max_groups: number;
  limit_one_group: number;
  limit_two_groups: number;
  confirmed_groups: number;
  confirmed_people: number;
  requested_groups: number;
  requested_people: number;
  pending_payment_groups: number;
};

export async function GET(request: Request) {
  // Real admin-only endpoint — was entirely missing before, FarmAdmin.tsx
  // rendered a hardcoded array. requireAdmin() throws if the caller isn't
  // role='admin'; Next's error boundary turns that into a 500 for API
  // routes, which is safe-by-default (fails closed) even though it isn't a
  // clean 403 yet.
  const member = await requireAdmin();
  void member;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ from: url.searchParams.get("from"), to: url.searchParams.get("to") });
  if (!parsed.success) return Response.json({ error: "需要 from／to 日期範圍（YYYY-MM-DD）" }, { status: 400 });
  const { from, to } = parsed.data;

  const db = await getDb();
  const result = await db
    .prepare(
      `
    SELECT s.id, s.starts_at, s.ends_at, s.status, e.name AS experience,
           p.max_groups, p.limit_one_group, p.limit_two_groups,
           COALESCE(SUM(CASE WHEN b.booking_status = 'confirmed' THEN 1 ELSE 0 END), 0) AS confirmed_groups,
           COALESCE(SUM(CASE WHEN b.booking_status = 'confirmed' THEN b.total_people ELSE 0 END), 0) AS confirmed_people,
           COALESCE(SUM(CASE WHEN b.booking_status = 'requested' THEN 1 ELSE 0 END), 0) AS requested_groups,
           COALESCE(SUM(CASE WHEN b.booking_status = 'requested' THEN b.total_people ELSE 0 END), 0) AS requested_people,
           COALESCE(SUM(CASE WHEN b.booking_status = 'pending_payment' AND datetime(b.hold_expires_at) > datetime('now') THEN 1 ELSE 0 END), 0) AS pending_payment_groups
    FROM farm_slots s
    JOIN farm_experiences e ON e.id = s.experience_id
    JOIN farm_capacity_policies p ON p.id = s.capacity_policy_id
    LEFT JOIN farm_bookings b ON b.slot_id = s.id AND b.cancelled_at IS NULL
    WHERE date(s.starts_at) >= date(?) AND date(s.starts_at) <= date(?)
    GROUP BY s.id
    ORDER BY datetime(s.starts_at)
  `,
    )
    .bind(from, to)
    .all<SessionRow>();

  const sessions = (result.results ?? []).map((row) => {
    const activeGroups = row.confirmed_groups + row.requested_groups + row.pending_payment_groups;
    const activePeople = row.confirmed_people + row.requested_people; // pending_payment people intentionally excluded from the headline count; still counted in hold-capacity checks server-side
    return {
      id: row.id,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      status: row.status,
      experience: row.experience,
      maxGroups: row.max_groups,
      peopleLimit: row.limit_one_group, // flat rule: limit_one_group === limit_two_groups now, either works as "the" cap
      confirmedGroups: row.confirmed_groups,
      confirmedPeople: row.confirmed_people,
      requestedGroups: row.requested_groups,
      requestedPeople: row.requested_people,
      pendingPaymentGroups: row.pending_payment_groups,
      activeGroups,
      activePeople,
    };
  });

  return Response.json({ sessions });
}

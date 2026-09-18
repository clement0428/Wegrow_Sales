import { z } from "zod";
import { requireAdmin } from "@/lib/auth/current-member";
import { getDb } from "@/lib/db/client";
import { bucketOf, STATUS_BUCKETS, type StatusBucket } from "@/lib/farm/status";

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(STATUS_BUCKETS).optional(),
});

type BookingRow = {
  id: string;
  booking_number: string;
  lookup_code: string;
  contact_name: string;
  contact_phone: string;
  group_name: string | null;
  total_people: number;
  amount_twd: number;
  booking_status: string;
  payment_status: string;
  hold_expires_at: string | null;
  cancelled_at: string | null;
  arrived_at: string | null;
  completed_at: string | null;
  created_at: string;
  starts_at: string;
  ends_at: string;
  experience: string;
};

export async function GET(request: Request) {
  await requireAdmin();
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
  });
  if (!parsed.success) return Response.json({ error: "查詢參數錯誤" }, { status: 400 });
  const { from, to, status } = parsed.data;

  const db = await getDb();
  const now = new Date().toISOString();
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (from) {
    conditions.push("date(s.starts_at) >= date(?)");
    params.push(from);
  }
  if (to) {
    conditions.push("date(s.starts_at) <= date(?)");
    params.push(to);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await db
    .prepare(
      `
    SELECT b.id, b.booking_number, b.lookup_code, b.contact_name, b.contact_phone, b.group_name,
           b.total_people, b.amount_twd, b.booking_status, b.payment_status, b.hold_expires_at,
           b.cancelled_at, b.arrived_at, b.completed_at, b.created_at,
           s.starts_at, s.ends_at, e.name AS experience
    FROM farm_bookings b
    JOIN farm_slots s ON s.id = b.slot_id
    JOIN farm_experiences e ON e.id = s.experience_id
    ${where}
    ORDER BY datetime(s.starts_at)
    LIMIT 500
  `,
    )
    .bind(...params)
    .all<BookingRow>();

  const rows = result.results ?? [];
  const withBucket = rows.map((row) => ({ row, bucket: bucketOf(row, now) }));

  const counts: Record<StatusBucket, number> = { hold: 0, pending_payment: 0, confirmed: 0, arrived: 0, completed: 0, cancelled: 0, exception: 0 };
  for (const { bucket } of withBucket) counts[bucket] += 1;

  const filtered = status ? withBucket.filter((r) => r.bucket === status) : withBucket;
  const totalOrders = new Set(rows.map((r) => r.id)).size;
  const totalPeople = rows.filter((r) => !r.cancelled_at).reduce((sum, r) => sum + r.total_people, 0);

  return Response.json({
    counts,
    totalOrders,
    totalPeople,
    bookings: filtered.map(({ row, bucket }) => ({
      id: row.id,
      bookingNumber: row.booking_number,
      lookupCode: row.lookup_code,
      contactName: row.contact_name,
      contactPhone: row.contact_phone,
      groupName: row.group_name ?? "",
      totalPeople: row.total_people,
      amountTwd: row.amount_twd,
      bookingStatus: row.booking_status,
      paymentStatus: row.payment_status,
      statusBucket: bucket,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      experience: row.experience,
      createdAt: row.created_at,
    })),
  });
}

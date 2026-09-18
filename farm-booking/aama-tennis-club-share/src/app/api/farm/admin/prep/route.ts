import { z } from "zod";
import { requireAdmin } from "@/lib/auth/current-member";
import { getDb } from "@/lib/db/client";

const querySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

type PrepRow = {
  session_id: string;
  starts_at: string;
  ends_at: string;
  experience: string;
  booking_number: string;
  contact_name: string;
  group_name: string | null;
  total_people: number;
  plant_count: number;
  meal_count: number;
  customer_note: string;
  booking_status: string;
};

// 準備工作彙總＋工作單：只納入「當天實際會來」的訂單 — confirmed 一定算，
// requested/pending_payment（hold 期限內）也算進準備量，因為現場備料要抓
// 上限而非只抓已確認數，同一份查詢邏輯依循 sessions route 的 active 定義。
export async function GET(request: Request) {
  await requireAdmin();

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ date: url.searchParams.get("date") });
  if (!parsed.success) return Response.json({ error: "需要 date（YYYY-MM-DD）" }, { status: 400 });
  const { date } = parsed.data;

  const db = await getDb();
  const result = await db
    .prepare(
      `
    SELECT s.id AS session_id, s.starts_at, s.ends_at, e.name AS experience,
           b.booking_number, b.contact_name, b.group_name, b.total_people,
           b.plant_count, b.meal_count, b.customer_note, b.booking_status
    FROM farm_slots s
    JOIN farm_experiences e ON e.id = s.experience_id
    JOIN farm_bookings b ON b.slot_id = s.id
    WHERE date(s.starts_at) = date(?)
      AND b.cancelled_at IS NULL
      AND (
        b.booking_status IN ('requested', 'confirmed') OR
        (b.booking_status = 'pending_payment' AND datetime(b.hold_expires_at) > datetime('now'))
      )
    ORDER BY datetime(s.starts_at), b.created_at
  `,
    )
    .bind(date)
    .all<PrepRow>();

  const rows = result.results ?? [];
  const bySession = new Map<string, { startsAt: string; endsAt: string; experience: string; bookings: typeof rows }>();
  for (const row of rows) {
    if (!bySession.has(row.session_id)) {
      bySession.set(row.session_id, { startsAt: row.starts_at, endsAt: row.ends_at, experience: row.experience, bookings: [] });
    }
    bySession.get(row.session_id)!.bookings.push(row);
  }

  const sessions = Array.from(bySession.entries()).map(([id, s]) => ({
    id,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    experience: s.experience,
    bookings: s.bookings.map((b) => ({
      bookingNumber: b.booking_number,
      contactName: b.contact_name,
      groupName: b.group_name ?? "",
      totalPeople: b.total_people,
      plantCount: b.plant_count,
      mealCount: b.meal_count,
      note: b.customer_note,
      confirmed: b.booking_status === "confirmed",
    })),
  }));

  const totals = rows.reduce(
    (acc, r) => ({
      groups: acc.groups + 1,
      people: acc.people + r.total_people,
      plant: acc.plant + r.plant_count,
      meal: acc.meal + r.meal_count,
    }),
    { groups: 0, people: 0, plant: 0, meal: 0 },
  );

  return Response.json({ date, sessions, totals });
}

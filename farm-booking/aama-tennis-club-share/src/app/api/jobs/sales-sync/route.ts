import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db/client";
import { env } from "@/lib/env";
import { sendSalesSync } from "@/lib/sales/sync-client";
import { MAX_SEND_ATTEMPTS, nextAttemptDelayMinutes } from "@/lib/outbox/backoff";

function sameSecret(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

type DueRow = {
  id: string;
  booking_id: string;
  event_type: "booking_created" | "booking_confirmed" | "booking_cancelled";
  attempt_count: number;
  booking_number: string;
  contact_name: string;
  contact_phone: string;
  group_name: string | null;
  total_people: number;
  starts_at: string;
  experience: string;
};

// Same shape as /api/jobs/reminders: runs its full query/compose/retry logic
// regardless of whether Sales has an API to receive it yet; only the actual
// network call is gated on SALES_SYNC_API_URL/KEY, and its absence is a real
// recorded per-row failure (blockedNotConfigured), never a silent skip or a
// faked "synced" status — 規格：「不得宣告已同步」.
export async function POST(request: Request) {
  const expected = process.env.JOB_SECRET;
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!expected || !sameSecret(actual, expected)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const db = await getDb();
  const now = new Date().toISOString();
  const due = await db
    .prepare(
      `
    SELECT o.id, o.booking_id, o.event_type, o.attempt_count,
           b.booking_number, b.contact_name, b.contact_phone, b.group_name, b.total_people,
           s.starts_at, e.name AS experience
    FROM farm_sales_sync_outbox o
    JOIN farm_bookings b ON b.id = o.booking_id
    JOIN farm_slots s ON s.id = b.slot_id
    JOIN farm_experiences e ON e.id = s.experience_id
    WHERE o.status = 'queued' AND datetime(o.next_attempt_at) <= datetime(?)
    ORDER BY datetime(o.next_attempt_at)
    LIMIT 50
  `,
    )
    .bind(now)
    .all<DueRow>();

  const rows = due.results ?? [];
  const apiUrl = env.SALES_SYNC_API_URL;
  const apiKey = env.SALES_SYNC_API_KEY;
  const configured = !!(apiUrl && apiKey);

  let sent = 0;
  let blockedNotConfigured = 0;
  let failed = 0;

  for (const row of rows) {
    if (!configured) {
      const delayMinutes = nextAttemptDelayMinutes(row.attempt_count);
      const next = new Date(Date.now() + delayMinutes * 60_000).toISOString();
      await db
        .prepare("UPDATE farm_sales_sync_outbox SET attempt_count = attempt_count + 1, last_error = ?, next_attempt_at = ? WHERE id = ?")
        .bind("sales_sync_api_not_configured", next, row.id)
        .run();
      blockedNotConfigured += 1;
      continue;
    }

    const result = await sendSalesSync(apiUrl, apiKey, {
      eventType: row.event_type,
      bookingId: row.booking_id,
      bookingNumber: row.booking_number,
      contactName: row.contact_name,
      contactPhone: row.contact_phone,
      groupName: row.group_name ?? "",
      totalPeople: row.total_people,
      startsAt: row.starts_at,
      experience: row.experience,
    });
    if (result.ok) {
      await db
        .prepare("UPDATE farm_sales_sync_outbox SET status = 'sent', accepted_at = ?, attempt_count = attempt_count + 1 WHERE id = ?")
        .bind(new Date().toISOString(), row.id)
        .run();
      sent += 1;
    } else {
      const attemptsAfter = row.attempt_count + 1;
      const permanentlyFailed = attemptsAfter >= MAX_SEND_ATTEMPTS;
      const delayMinutes = nextAttemptDelayMinutes(row.attempt_count);
      const next = new Date(Date.now() + delayMinutes * 60_000).toISOString();
      await db
        .prepare(
          `UPDATE farm_sales_sync_outbox
           SET attempt_count = ?, last_error = ?, next_attempt_at = ?, status = ?
           WHERE id = ?`,
        )
        .bind(attemptsAfter, `${result.status}: ${result.error}`, next, permanentlyFailed ? "failed" : "queued", row.id)
        .run();
      failed += 1;
    }
  }

  return Response.json({
    mode: configured ? "processing" : "not_configured",
    dueCount: rows.length,
    sent, blockedNotConfigured, failed,
  });
}

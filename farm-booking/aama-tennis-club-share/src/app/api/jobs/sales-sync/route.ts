import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db/client";
import { env } from "@/lib/env";
import { sendSalesSync } from "@/lib/sales/sync-client";
import { MAX_SEND_ATTEMPTS, nextAttemptDelayMinutes } from "@/lib/outbox/backoff";
import { claimRow } from "@/lib/outbox/claim";
import { startJobRun, completeJobRun } from "@/lib/outbox/job-run";

function sameSecret(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// 400/401＝永久設定錯誤（payload格式錯或key錯），不得無限重試；其餘視為暫時性。
function isPermanentSyncError(status: number): boolean {
  return status === 400 || status === 401;
}

type DueRow = {
  id: string;
  booking_id: string;
  event_type: "booking_created" | "booking_confirmed" | "booking_cancelled";
  attempt_count: number;
  created_at: string;
  booking_number: string;
  booking_version: number;
  contact_name: string;
  contact_phone: string;
  group_name: string | null;
  total_people: number;
  starts_at: string;
  experience: string;
};

// Same shape as /api/jobs/reminders: claim/lease against concurrent
// invocations, persistent run log, full contract fields (eventId=this
// outbox row's own id, schemaVersion, occurredAt, monotonic
// bookingVersion) — see lib/sales/sync-client.ts for the full contract.
export async function POST(request: Request) {
  const expected = process.env.JOB_SECRET;
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!expected || !sameSecret(actual, expected)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const triggerSource = request.headers.get("x-trigger-source") === "cron" ? "cron" : "manual";

  const db = await getDb();
  const runId = await startJobRun(db, "sales-sync", triggerSource);
  const now = new Date().toISOString();
  const due = await db
    .prepare(
      `
    SELECT o.id, o.booking_id, o.event_type, o.attempt_count, o.created_at,
           b.booking_number, b.version AS booking_version, b.contact_name, b.contact_phone, b.group_name, b.total_people,
           s.starts_at, e.name AS experience
    FROM farm_sales_sync_outbox o
    JOIN farm_bookings b ON b.id = o.booking_id
    JOIN farm_slots s ON s.id = b.slot_id
    JOIN farm_experiences e ON e.id = s.experience_id
    WHERE o.status = 'queued' AND datetime(o.next_attempt_at) <= datetime(?)
      AND (o.leased_until IS NULL OR datetime(o.leased_until) < datetime(?))
    ORDER BY datetime(o.next_attempt_at)
    LIMIT 50
  `,
    )
    .bind(now, now)
    .all<DueRow>();

  const rows = due.results ?? [];
  const apiUrl = env.SALES_SYNC_API_URL;
  const apiKey = env.SALES_SYNC_API_KEY;
  const configured = !!(apiUrl && apiKey);
  const leaseOwner = runId;

  let sent = 0;
  let blockedNotConfigured = 0;
  let failed = 0;
  const errorCodes = new Set<string>();

  for (const row of rows) {
    const claimed = await claimRow(db, "farm_sales_sync_outbox", row.id, leaseOwner);
    if (!claimed) continue;

    if (!configured) {
      const delayMinutes = nextAttemptDelayMinutes(row.attempt_count);
      const next = new Date(Date.now() + delayMinutes * 60_000).toISOString();
      await db
        .prepare("UPDATE farm_sales_sync_outbox SET attempt_count = attempt_count + 1, last_error = ?, next_attempt_at = ?, leased_until = NULL WHERE id = ?")
        .bind("sales_sync_api_not_configured", next, row.id)
        .run();
      blockedNotConfigured += 1;
      errorCodes.add("not_configured");
      continue;
    }

    const result = await sendSalesSync(apiUrl, apiKey, {
      eventId: row.id,
      schemaVersion: 1,
      eventType: row.event_type,
      occurredAt: row.created_at,
      bookingId: row.booking_id,
      bookingVersion: row.booking_version,
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
        .prepare("UPDATE farm_sales_sync_outbox SET status = 'sent', accepted_at = ?, attempt_count = attempt_count + 1, leased_until = NULL WHERE id = ?")
        .bind(new Date().toISOString(), row.id)
        .run();
      sent += 1;
    } else {
      const attemptsAfter = row.attempt_count + 1;
      const permanentlyFailed = isPermanentSyncError(result.status) || attemptsAfter >= MAX_SEND_ATTEMPTS;
      const delayMinutes = nextAttemptDelayMinutes(row.attempt_count);
      const next = new Date(Date.now() + delayMinutes * 60_000).toISOString();
      await db
        .prepare(
          `UPDATE farm_sales_sync_outbox
           SET attempt_count = ?, last_error = ?, next_attempt_at = ?, status = ?, leased_until = NULL
           WHERE id = ?`,
        )
        .bind(attemptsAfter, `${result.status}: ${result.error}`, next, permanentlyFailed ? "failed" : "queued", row.id)
        .run();
      failed += 1;
      errorCodes.add(`${result.status}`);
    }
  }

  const oldestPending = await db
    .prepare("SELECT MIN(datetime(next_attempt_at)) AS oldest FROM farm_sales_sync_outbox WHERE status = 'queued'")
    .first<{ oldest: string | null }>();
  const oldestPendingSeconds = oldestPending?.oldest
    ? Math.max(0, Math.floor((Date.now() - new Date(oldestPending.oldest).getTime()) / 1000))
    : null;

  await completeJobRun(db, runId, { dueCount: rows.length, sent, failed, blocked: blockedNotConfigured }, oldestPendingSeconds, errorCodes.size ? Array.from(errorCodes).join(",") : null);

  return Response.json({
    mode: configured ? "processing" : "not_configured",
    dueCount: rows.length,
    sent, blockedNotConfigured, failed,
    runId,
  });
}

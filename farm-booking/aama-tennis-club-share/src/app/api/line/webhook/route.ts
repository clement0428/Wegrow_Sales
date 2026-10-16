import { getDb } from "@/lib/db/client";
import { newId } from "@/lib/db/uuid";
import { env } from "@/lib/env";
import { claimBooking } from "@/lib/farm/claim";
import { composePrepDetailText } from "@/lib/line/madou-group-text";
import { sendLineReplyMessage } from "@/lib/line/messaging";
import { verifyLineWebhookSignature } from "@/lib/line/webhook-signature";

// 麻豆現場群 webhook：這個repo目前唯一的LINE Messaging API webhook接收端
// （既有程式只有送出，見messaging.ts）。驗簽、事件去重、群組/來源白名單、
// 成員身分解析——不信任前端或postback payload本身帶的任何身分宣稱，一律用
// members.line_user_id反查，跟既有LIFF登入走的是同一套member識別，不另建身分系統。
export async function POST(request: Request) {
  const channelSecret = env.LINE_MESSAGING_CHANNEL_SECRET;
  const rawBody = await request.text();
  if (!channelSecret || !verifyLineWebhookSignature(rawBody, request.headers.get("x-line-signature"), channelSecret)) {
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: { events?: unknown[] };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const db = await getDb();
  const madouGroupId = env.MADOU_GROUP_ID;
  const accessToken = env.LINE_MESSAGING_ACCESS_TOKEN;
  let handled = 0;

  for (const rawEvent of payload.events ?? []) {
    const event = rawEvent as {
      type?: string;
      webhookEventId?: string;
      replyToken?: string;
      source?: { type?: string; groupId?: string; userId?: string };
      postback?: { data?: string };
    };
    const eventId = event.webhookEventId;
    if (!eventId) continue; // can't dedupe an event with no id — drop rather than risk double-processing

    const dedup = await db.prepare("INSERT OR IGNORE INTO farm_line_webhook_events (id) VALUES (?)").bind(eventId).run();
    if (!dedup.meta.changes) continue; // already processed this exact event

    if (event.type !== "postback") continue;
    const source = event.source ?? {};
    if (source.type !== "group" || !madouGroupId || source.groupId !== madouGroupId) continue; // only the Madou group, and only once configured
    if (!source.userId) continue;

    const fields = new URLSearchParams(event.postback?.data ?? "");
    const action = fields.get("action");
    const bookingId = fields.get("bookingId");
    if (!action || !bookingId) continue;

    const member = await db.prepare("SELECT id, display_name, role FROM members WHERE line_user_id = ?").bind(source.userId).first<{ id: string; display_name: string; role: string }>();
    if (!member) continue; // unrecognized LINE account — never trust a bare userId as staff

    try {
      if (action === "claim") {
        if (member.role !== "admin" && member.role !== "reception") {
          await replyIfPossible(accessToken, event.replyToken, "此角色無法接單，請聯絡管理員。");
        } else {
          const result = await claimBooking(db, bookingId, member.id, "line_webhook");
          const text = result.ok
            ? `已由 ${member.display_name} 接單。`
            : result.reason === "already_claimed"
              ? `已有人接單：${result.claimedByName ?? "未知"}`
              : result.reason === "cancelled"
                ? "這筆預約已取消，無法接單。"
                : "找不到這筆預約。";
          await replyIfPossible(accessToken, event.replyToken, text);
        }
      } else if (action === "view_prep") {
        const booking = await fetchWorkCardBooking(db, bookingId);
        await replyIfPossible(accessToken, event.replyToken, booking ? composePrepDetailText(booking) : "找不到這筆預約。");
      } else if (action === "report_issue") {
        await db
          .prepare(
            `INSERT INTO farm_audit_log (id, entity_type, entity_id, actor_type, actor_id, action, from_state, to_state, reason, created_at)
             VALUES (?, 'farm_booking', ?, 'line_webhook', ?, 'report_issue', NULL, NULL, '現場透過麻豆群回報問題', ?)`,
          )
          .bind(newId(), bookingId, member.id, new Date().toISOString())
          .run();
        await replyIfPossible(accessToken, event.replyToken, "已記錄，將由管理員確認處理。");
      }
    } catch (error) {
      // Webhook must still ack 200 — LINE doesn't retry a 200'd event, so a bug here
      // becomes a silently-missed action, not a loud one. Acceptable residual risk
      // for this first pass (see docs/implementation note): the claim action itself
      // is idempotent/safe to re-trigger manually if a staff member notices nothing
      // happened; this is not the deep retry-worker infrastructure built for the
      // wegrow-orbit-src LINE channel.
      console.error("madou webhook event failed", error);
    }
    handled += 1;
  }

  return Response.json({ handled });
}

async function replyIfPossible(accessToken: string | undefined, replyToken: string | undefined, text: string): Promise<void> {
  if (!accessToken || !replyToken) return;
  await sendLineReplyMessage(accessToken, replyToken, [{ type: "text", text }]);
}

async function fetchWorkCardBooking(db: D1Database, bookingId: string) {
  return db
    .prepare(
      `SELECT b.id AS booking_id, b.booking_number, b.group_name, b.adult_count, b.child_count, b.infant_count,
              b.total_people, b.plant_count, b.meal_count, b.vegetarian_meal_count,
              s.starts_at, s.ends_at, e.name AS experience_name
       FROM farm_bookings b
       JOIN farm_slots s ON s.id = b.slot_id
       JOIN farm_experiences e ON e.id = s.experience_id
       WHERE b.id = ?`,
    )
    .bind(bookingId)
    .first<{
      booking_id: string; booking_number: string; group_name: string | null;
      adult_count: number; child_count: number; infant_count: number; total_people: number;
      plant_count: number; meal_count: number; vegetarian_meal_count: number;
      starts_at: string; ends_at: string; experience_name: string;
    }>()
    .then((row) =>
      row
        ? {
            bookingId: row.booking_id, bookingNumber: row.booking_number, groupName: row.group_name,
            experience: row.experience_name, startsAt: row.starts_at, endsAt: row.ends_at,
            adultCount: row.adult_count, childCount: row.child_count, infantCount: row.infant_count,
            totalPeople: row.total_people, plantCount: row.plant_count, mealCount: row.meal_count,
            vegetarianMealCount: row.vegetarian_meal_count,
          }
        : null,
    );
}

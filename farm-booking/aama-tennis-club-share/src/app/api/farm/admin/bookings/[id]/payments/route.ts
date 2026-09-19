import { z } from "zod";
import { canHandlePayment, canViewFullOrders, requireStaff } from "@/lib/auth/current-member";
import { getDb } from "@/lib/db/client";
import { newId } from "@/lib/db/uuid";
import { computePaymentSummary } from "@/lib/farm/payment-summary";

const PAYMENT_METHODS = ["cash", "transfer", "other"] as const;
const METHOD_LABELS: Record<(typeof PAYMENT_METHODS)[number], string> = { cash: "現金", transfer: "轉帳", other: "其他" };

const bodySchema = z.object({
  type: z.enum(["payment", "refund"]),
  amountTwd: z.number().int().min(1).max(1_000_000),
  method: z.enum(PAYMENT_METHODS),
  referenceNote: z.string().trim().max(200).default(""),
  note: z.string().trim().max(500).default(""),
  idempotencyKey: z.string().uuid(),
});

type RecordRow = {
  id: string; record_type: string; amount_twd: number; method: string;
  reference_note: string; recorded_by_name: string; note: string; recorded_at: string;
};

// Field definitions (應收／累計收款／累計退款／淨收款／未收／超收) live as
// comments in lib/farm/payment-summary.ts next to the pure function that
// actually computes them.
async function summarize(bookingId: string) {
  const db = await getDb();
  const booking = await db.prepare("SELECT amount_twd, cancelled_at FROM farm_bookings WHERE id = ?").bind(bookingId).first<{ amount_twd: number; cancelled_at: string | null }>();
  if (!booking) return null;
  const result = await db
    .prepare("SELECT id, record_type, amount_twd, method, reference_note, recorded_by_name, note, recorded_at FROM farm_payment_records WHERE booking_id = ? ORDER BY recorded_at")
    .bind(bookingId)
    .all<RecordRow>();
  const records = result.results ?? [];
  const summary = computePaymentSummary(
    booking.amount_twd,
    !!booking.cancelled_at,
    records.map((r) => ({ recordType: r.record_type as "payment" | "refund", amountTwd: r.amount_twd })),
  );
  return {
    ...summary,
    records: records.map((r) => ({
      id: r.id, type: r.record_type, amountTwd: r.amount_twd,
      method: r.method, methodLabel: METHOD_LABELS[r.method as (typeof PAYMENT_METHODS)[number]] ?? r.method,
      referenceNote: r.reference_note, recordedByName: r.recorded_by_name, note: r.note, recordedAt: r.recorded_at,
    })),
  };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  // 讀取收款紀錄：管理員＋接待員（「所需資訊」的一部分）；餐飲／備料不可見。
  const member = await requireStaff();
  if (!canViewFullOrders(member)) return Response.json({ error: "此角色無法檢視收款紀錄" }, { status: 403 });
  const { id } = await params;
  const summary = await summarize(id);
  if (!summary) return Response.json({ error: "找不到這筆預約" }, { status: 404 });
  return Response.json(summary);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // 登記收款／退款：僅管理員（規格第4節「管理員可排場次與處理收款」）。
  const member = await requireStaff();
  if (!canHandlePayment(member)) return Response.json({ error: "此角色無法登記收款" }, { status: 403 });
  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "請求格式錯誤", issues: parsed.error.issues }, { status: 400 });
  const { type, amountTwd, method, referenceNote, note, idempotencyKey } = parsed.data;

  const db = await getDb();
  const booking = await db.prepare("SELECT id FROM farm_bookings WHERE id = ?").bind(id).first<{ id: string }>();
  if (!booking) return Response.json({ error: "找不到這筆預約" }, { status: 404 });

  // 防重複點擊：同一個 idempotency key 已經處理過就直接回現況，不再新增一筆。
  const existing = await db.prepare("SELECT id FROM farm_payment_records WHERE idempotency_key = ?").bind(idempotencyKey).first<{ id: string }>();
  if (existing) {
    const summary = await summarize(id);
    return Response.json({ ok: true, duplicate: true, ...summary });
  }

  if (type === "refund") {
    // 退款不可超過可退金額（淨收款）——退款前重新從資料庫算一次，不信任前端顯示的數字。
    const before = await summarize(id);
    if (!before || amountTwd > before.refundableAmount) {
      return Response.json({ error: `退款金額不可超過可退金額 NT$ ${before?.refundableAmount ?? 0}`, code: "refund_exceeds_refundable" }, { status: 400 });
    }
  }

  await db
    .prepare(
      `INSERT INTO farm_payment_records
       (id, booking_id, record_type, amount_twd, method, reference_note, recorded_by_member_id, recorded_by_name, note, idempotency_key, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(newId(), id, type, amountTwd, method, referenceNote, member.id, member.display_name, note, idempotencyKey, new Date().toISOString())
    .run();

  await db
    .prepare(
      `INSERT INTO farm_audit_log (id, entity_type, entity_id, actor_type, actor_id, action, from_state, to_state, reason, created_at)
       VALUES (?, 'farm_booking', ?, 'staff', ?, ?, NULL, ?, ?, ?)`,
    )
    .bind(newId(), id, member.id, type === "payment" ? "record_payment" : "record_refund", `${amountTwd}`, note, new Date().toISOString())
    .run();

  const summary = await summarize(id);
  return Response.json({ ok: true, ...summary }, { status: 201 });
}

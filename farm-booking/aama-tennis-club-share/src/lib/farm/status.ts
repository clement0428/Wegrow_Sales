// Status bucket mapping against the ACTUAL columns this schema has today
// (booking_status: requested|confirmed|pending_payment, plus the point-in-time
// cancelled_at/arrived_at/completed_at markers) — not a separate status enum,
// since none exists in the DB. See docs/booking-calendar-implementation.md.
//
// Shared by the admin bookings API and the customer-facing order status bar
// so both sides always agree on what state a booking is in.
export const STATUS_BUCKETS = ["hold", "pending_payment", "confirmed", "arrived", "completed", "cancelled", "exception"] as const;
export type StatusBucket = (typeof STATUS_BUCKETS)[number];

export type BucketInput = {
  booking_status: string;
  payment_status: string;
  hold_expires_at: string | null;
  cancelled_at: string | null;
  arrived_at: string | null;
  completed_at: string | null;
};

export function bucketOf(row: BucketInput, nowIso: string): StatusBucket {
  if (row.cancelled_at) return "cancelled";
  if (row.completed_at) return "completed";
  if (row.arrived_at) return "arrived";
  if (row.payment_status === "failed" || row.payment_status === "refund_pending") return "exception";
  if (row.booking_status === "pending_payment") {
    if (row.hold_expires_at && row.hold_expires_at < nowIso) return "exception"; // expired hold nobody cleaned up
    return "pending_payment";
  }
  if (row.booking_status === "confirmed") return "confirmed";
  if (row.booking_status === "requested") return "hold";
  return "exception";
}

// Customer-facing order-progress steps (spec section 2A 訂單狀態列):
// 選日期 → 填資料 → 確認/付款 → 預約成立 → 已到場 → 已完成.
// The first two steps are always "done" by the time a booking record exists
// (they happen before submission), so the bar's job is placing steps 3-6.
export const ORDER_STEPS = ["選日期", "填資料", "確認/付款", "預約成立", "已到場", "已完成"] as const;

export function stepIndexOf(bucket: StatusBucket): number {
  switch (bucket) {
    case "hold":
    case "pending_payment":
    case "exception":
      return 2; // 確認/付款 in progress
    case "confirmed":
      return 3; // 預約成立 done
    case "arrived":
      return 4; // 已到場 done
    case "completed":
      return 5; // 已完成 done
    case "cancelled":
      return -1; // not on the normal track
  }
}

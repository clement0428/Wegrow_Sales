// 跨「重新整理」的預約意圖保存——瀏覽器重新整理會清空所有React state，包含
// idempotencyKey（原本只在submitBooking()第一次送出時才產生，純記憶體
// useRef，重新整理就永久遺失）。沒有這份持久化，Orbit已經兌換成功但本機
// booking建立失敗後，客戶重新整理頁面重試送出的就是一把全新的idempotencyKey
// ——跟原本那次失敗的嘗試變成兩個不相干的請求，既有的redemption_id冪等重試
// 機制（見adoption-eligibility.ts/eligibility-session.ts）完全派不上用場。
const BOOKING_DRAFT_KEY = "tc-booking-draft";
const DRAFT_TTL_MS = 60 * 60 * 1000; // 1小時，比對應nonce的20分鐘保留期更長一些，避免nonce都還沒過期draft卻先被當過期丟棄

export type BookingDraft = {
  idempotencyKey: string;
  slotId: string | null;
  adult: number;
  child: number;
  infant: number;
  plantCount: number;
  mealCount: number;
  vegetarianMealCount: number;
  contactName: string;
  phone: string;
  groupName: string;
  note: string;
  savedAt: string;
};

export function saveBookingDraft(draft: Omit<BookingDraft, "savedAt">) {
  try {
    sessionStorage.setItem(BOOKING_DRAFT_KEY, JSON.stringify({ ...draft, savedAt: new Date().toISOString() }));
  } catch { /* sessionStorage不可用（隱私模式等）就放棄持久化，不影響本次流程 */ }
}

export function restoreBookingDraft(): BookingDraft | null {
  try {
    const raw = sessionStorage.getItem(BOOKING_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BookingDraft;
    if (Date.now() - new Date(parsed.savedAt).getTime() > DRAFT_TTL_MS) {
      sessionStorage.removeItem(BOOKING_DRAFT_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearBookingDraft() {
  try { sessionStorage.removeItem(BOOKING_DRAFT_KEY); } catch { /* ignore */ }
}

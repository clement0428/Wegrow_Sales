import "server-only";

// farm-booking端的nonce bookkeeping + session binding。真正的身分驗證在Orbit那端
// （booking-eligibility.claim/redeem，見adoption-eligibility.ts）——這裡的本機
// 紀錄是防禦性的第二層：
// 1. session_token：只存在HttpOnly cookie，從不出現在任何URL/nonce裡——防止
//    nonce本身（會出現在轉址URL、Referer header、伺服器日誌）被攔截後拿去別的
//    瀏覽器兌換。跟OAuth的state參數同樣用途，不要求LINE登入，可以綁在匿名流程上。
// 2. redemption_id：farm-booking這端的idempotencyKey——booking建立失敗後用同一把
//    key重試，必須視為同一次請求（放行），不是被永久擋死也不是重新發一次資格。
const NONCE_TTL_MINUTES = 20;
export const ELIGIBILITY_SESSION_COOKIE = "tc_eligibility_session";
export const ELIGIBILITY_SESSION_MAX_AGE_SECONDS = NONCE_TTL_MINUTES * 60;

export function generateEligibilityNonce(): string {
  return `${crypto.randomUUID()}-${crypto.randomUUID()}`.replaceAll("-", "");
}

export function generateSessionToken(): string {
  return `${crypto.randomUUID()}-${crypto.randomUUID()}`.replaceAll("-", "");
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function startEligibilitySession(
  db: D1Database, visitDateIso: string,
): Promise<{ nonce: string; sessionToken: string; expiresAt: string }> {
  const nonce = generateEligibilityNonce();
  const sessionToken = generateSessionToken();
  const sessionTokenHash = await sha256Hex(sessionToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + NONCE_TTL_MINUTES * 60_000).toISOString();
  await db
    .prepare("INSERT INTO farm_eligibility_requests (id, nonce, visit_date, session_token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), nonce, visitDateIso, sessionTokenHash, now.toISOString(), expiresAt)
    .run();
  return { nonce, sessionToken, expiresAt };
}

export type EligibilitySessionCheck =
  | { ok: true }
  | { ok: false; reason: "not_found" | "expired" | "session_mismatch" | "already_used" };

// 唯讀檢查——真正消耗（Orbit端redeem API的一次性兌換）在呼叫端另外處理，這裡只是
// 本機這一層自己的session綁定/過期/使用狀態把關，不負責跟Orbit核對資格本身。
export async function checkEligibilitySession(
  db: D1Database, nonce: string, visitDateIso: string, presentedSessionToken: string | null, redemptionId: string,
): Promise<EligibilitySessionCheck> {
  const row = await db
    .prepare("SELECT visit_date, session_token_hash, expires_at, used_at, redemption_id FROM farm_eligibility_requests WHERE nonce = ?")
    .bind(nonce)
    .first<{ visit_date: string; session_token_hash: string; expires_at: string; used_at: string | null; redemption_id: string | null }>();
  if (!row || row.visit_date !== visitDateIso) return { ok: false, reason: "not_found" };
  if (!presentedSessionToken || (await sha256Hex(presentedSessionToken)) !== row.session_token_hash) {
    // 沒帶cookie或雜湊不符——不是「這個nonce本身無效」，是「不是同一個瀏覽器/
    // session發起的這次請求」，跨瀏覽器拿到nonce字串也兌換不了。
    return { ok: false, reason: "session_mismatch" };
  }
  if (row.used_at) {
    // 同一個redemption_id＝同一次booking建立嘗試的retry，放行；不同才是真正
    // 已經用過。
    if (row.redemption_id === redemptionId) return { ok: true };
    return { ok: false, reason: "already_used" };
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) return { ok: false, reason: "expired" };
  return { ok: true };
}

// 只在booking真正建立成功之後才呼叫——讓失敗的嘗試（Orbit已兌換但本機booking
// INSERT失敗）可以用同一個redemption_id安全地重試，不會被這裡卡死。
export async function markEligibilitySessionUsed(db: D1Database, nonce: string, redemptionId: string): Promise<boolean> {
  const result = await db
    .prepare("UPDATE farm_eligibility_requests SET used_at = ?, redemption_id = ? WHERE nonce = ? AND (used_at IS NULL OR redemption_id = ?)")
    .bind(new Date().toISOString(), redemptionId, nonce, redemptionId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

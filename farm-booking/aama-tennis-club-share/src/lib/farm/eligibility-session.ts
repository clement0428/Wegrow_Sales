import "server-only";

// farm-booking端的nonce bookkeeping。真正的身分驗證跟一次性消耗邊界在Orbit那端
// （booking-eligibility.claim/status，見adoption-eligibility.ts）——這裡的本機
// 紀錄是防禦性的第二層：確保拿到booking創建端的nonce，是這次請求本身先發起過的
// （不是任意字串），且在本機也有過期時間跟一次性使用標記，不是只信任對方服務。
const NONCE_TTL_MINUTES = 20;

export function generateEligibilityNonce(): string {
  return `${crypto.randomUUID()}-${crypto.randomUUID()}`.replaceAll("-", "");
}

export async function startEligibilitySession(db: D1Database, visitDateIso: string): Promise<{ nonce: string; expiresAt: string }> {
  const nonce = generateEligibilityNonce();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + NONCE_TTL_MINUTES * 60_000).toISOString();
  await db
    .prepare("INSERT INTO farm_eligibility_requests (id, nonce, visit_date, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), nonce, visitDateIso, now.toISOString(), expiresAt)
    .run();
  return { nonce, expiresAt };
}

export type EligibilitySessionCheck =
  | { ok: true }
  | { ok: false; reason: "not_found" | "expired" | "already_used" };

// 唯讀檢查——真正消耗（Orbit端status API的一次性兌換）在呼叫端另外處理，這裡只是
// 本機這一層自己的過期/使用狀態把關，不負責跟Orbit核對資格本身。
export async function checkEligibilitySession(db: D1Database, nonce: string, visitDateIso: string): Promise<EligibilitySessionCheck> {
  const row = await db
    .prepare("SELECT visit_date, expires_at, used_at FROM farm_eligibility_requests WHERE nonce = ?")
    .bind(nonce)
    .first<{ visit_date: string; expires_at: string; used_at: string | null }>();
  if (!row || row.visit_date !== visitDateIso) return { ok: false, reason: "not_found" };
  if (row.used_at) return { ok: false, reason: "already_used" };
  if (new Date(row.expires_at).getTime() <= Date.now()) return { ok: false, reason: "expired" };
  return { ok: true };
}

export async function markEligibilitySessionUsed(db: D1Database, nonce: string): Promise<boolean> {
  const result = await db
    .prepare("UPDATE farm_eligibility_requests SET used_at = ? WHERE nonce = ? AND used_at IS NULL")
    .bind(new Date().toISOString(), nonce)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

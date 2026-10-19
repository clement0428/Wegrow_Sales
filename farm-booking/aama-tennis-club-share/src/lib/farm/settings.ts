import "server-only";

const UNCLAIMED_ESCALATION_KEY = "unclaimed_escalation_minutes";

// null／未設定＝停用自動升級——不是「用PDF建議的30分鐘當預設」，Clement還沒定案
// 這個數字，程式不能自己先假設一個值當成「已確認的規則」在跑。
export async function getUnclaimedEscalationMinutes(db: D1Database): Promise<number | null> {
  const row = await db.prepare("SELECT value FROM farm_settings WHERE key = ?").bind(UNCLAIMED_ESCALATION_KEY).first<{ value: string }>();
  if (!row) return null;
  const n = Number(row.value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function setUnclaimedEscalationMinutes(db: D1Database, minutes: number | null, updatedBy: string): Promise<void> {
  const now = new Date().toISOString();
  if (minutes === null) {
    await db.prepare("DELETE FROM farm_settings WHERE key = ?").bind(UNCLAIMED_ESCALATION_KEY).run();
    return;
  }
  await db
    .prepare(
      `INSERT INTO farm_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    )
    .bind(UNCLAIMED_ESCALATION_KEY, String(minutes), updatedBy, now)
    .run();
}

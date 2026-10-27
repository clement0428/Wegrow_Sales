import { requireAdmin } from "@/lib/auth/current-member";
import { getDb } from "@/lib/db/client";
import { isHealthyRun } from "@/lib/outbox/health";

// 告警門檻可調整——這裡先給合理預設值，之後要做成設定畫面再抽出來。
// 2026-10-26 ZD-003修正：真正負責觸發的是獨立repo farm-booking-cron
// (Cloudflare Cron Trigger，見該repo的wrangler.jsonc：triggers.crons =
// "*/15 * * * *")，排程間隔是15分鐘，不是這裡原本假設的「更短」。門檻訂
// 5分鐘的結果是：就算cron完全正常運作，兩次tick之間一定會有一段時間顯示
// 「超過5分鐘沒有任何一次啟動」的假警報，管理頁因此把正常運作的排程誤判
// 成「排程可能沒有正確觸發」。改成15分鐘週期+5分鐘緩衝，正常週期內不報警，
// 真的漏跳一次(超過20分鐘沒有任何啟動)才報警。
const HEARTBEAT_MISSED_MINUTES = 20; // 對應farm-booking-cron的15分鐘排程週期+5分鐘緩衝，不是任意值
const BACKLOG_TOO_OLD_SECONDS = 600; // 最舊待處理事件等待超過10分鐘

type JobName = "reminders" | "sales-sync";
type RunRow = {
  id: string; trigger_source: string; started_at: string; completed_at: string | null;
  due_count: number; sent_count: number; failed_count: number; blocked_count: number;
  oldest_pending_seconds: number | null; error_summary: string | null;
};

// 2026-10-27 ZD-003再修正：只看「最後一次有啟動」(lastRun.started_at)不夠——
// 一個每次都因為憑證錯誤(401)而整批失敗的tick，一樣會更新started_at，heartbeat
// 因此會一直顯示「正常」，把真正結構性失敗的狀態誤判成健康。改成追蹤「最後一次
// 健康執行」：completed_at有值、且該次執行failed_count=0(不論due_count是0或
// 多筆全部成功)才算健康。due_count=0的空佳也是健康執行，必須能正確更新這個時間，
// 不能因為queue是空的就被當成「沒有真正執行過」。反過來，一次failed_count>0的
// tick不會推進lastHealthyRun，讓heartbeatMissed能在門檻時間後正確報警，不會被
// 「cron本身還在固定每15分鐘打」這件事掩蓋掉。hasCredentialErrors維持獨立判斷，
// 讓「結構性401」跟「單純逾時沒心跳」是兩個可以同時成立、各自代表不同根因的警示。
// (isHealthyRun實作見 lib/outbox/health.ts，獨立出去才能在route.ts以外被單元測試)

async function statusFor(db: D1Database, jobName: JobName, outboxTable: "farm_notification_outbox" | "farm_sales_sync_outbox") {
  const runs = await db
    .prepare("SELECT id, trigger_source, started_at, completed_at, due_count, sent_count, failed_count, blocked_count, oldest_pending_seconds, error_summary FROM farm_job_runs WHERE job_name = ? ORDER BY started_at DESC LIMIT 10")
    .bind(jobName)
    .all<RunRow>();
  const recentRuns = runs.results ?? [];
  const lastRun = recentRuns[0] ?? null;
  const lastHealthyRun = recentRuns.find(isHealthyRun) ?? null;

  const deadLetter = await db.prepare(`SELECT COUNT(*) AS n FROM ${outboxTable} WHERE status = 'failed'`).first<{ n: number }>();
  const oldestQueued = await db.prepare(`SELECT MIN(datetime(next_attempt_at)) AS oldest FROM ${outboxTable} WHERE status = 'queued'`).first<{ oldest: string | null }>();
  const oldestPendingSeconds = oldestQueued?.oldest ? Math.max(0, Math.floor((Date.now() - new Date(oldestQueued.oldest).getTime()) / 1000)) : null;

  const minutesSinceLastHealthyRun = lastHealthyRun ? (Date.now() - new Date(lastHealthyRun.started_at).getTime()) / 60_000 : null;
  const heartbeatMissed = minutesSinceLastHealthyRun === null || minutesSinceLastHealthyRun > HEARTBEAT_MISSED_MINUTES;
  const backlogTooOld = (oldestPendingSeconds ?? 0) > BACKLOG_TOO_OLD_SECONDS;
  const hasCredentialErrors = recentRuns.some((r) => r.error_summary?.includes("credential") || r.error_summary?.includes("401"));
  const deadLetterCount = deadLetter?.n ?? 0;

  return {
    jobName,
    lastRunAt: lastRun?.started_at ?? null,
    lastRunTriggerSource: lastRun?.trigger_source ?? null,
    lastRunCompletedAt: lastRun?.completed_at ?? null,
    lastHealthyRunAt: lastHealthyRun?.started_at ?? null,
    oldestPendingSeconds,
    deadLetterCount,
    recentRuns: recentRuns.map((r) => ({
      id: r.id, triggerSource: r.trigger_source, startedAt: r.started_at, completedAt: r.completed_at,
      dueCount: r.due_count, sentCount: r.sent_count, failedCount: r.failed_count, blockedCount: r.blocked_count,
      oldestPendingSeconds: r.oldest_pending_seconds, errorSummary: r.error_summary,
    })),
    alerts: {
      heartbeatMissed,
      backlogTooOld,
      hasCredentialErrors,
      hasDeadLetters: deadLetterCount > 0,
      thresholds: { heartbeatMissedMinutes: HEARTBEAT_MISSED_MINUTES, backlogTooOldSeconds: BACKLOG_TOO_OLD_SECONDS },
    },
  };
}

export async function GET() {
  // 員工查詢畫面：管理員專用（沿用現有管理監測入口，不另開新畫面框架）。
  await requireAdmin();
  const db = await getDb();
  const [reminders, salesSync] = await Promise.all([
    statusFor(db, "reminders", "farm_notification_outbox"),
    statusFor(db, "sales-sync", "farm_sales_sync_outbox"),
  ]);
  return Response.json({ reminders, salesSync });
}

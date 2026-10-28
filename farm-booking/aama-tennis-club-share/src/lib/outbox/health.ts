// 2026-10-27 ZD-003：判斷一次job執行是否「健康」，供 /api/farm/admin/job-status
// 的heartbeat計算用。只看「有沒有啟動過」(completed_at/started_at)不夠——一個
// 每次都因為憑證錯誤而整批失敗的tick一樣會有started_at，heartbeat因此會一直
// 顯示正常，把結構性失敗誤判成健康。這裡的規則：completed_at有值、且
// failed_count=0才算健康。due_count=0的空queue tick也算健康(failed_count本來
// 就是0)，不能因為queue是空的就被當成「沒有真正執行過」。
export type JobRunHealthFields = {
  completed_at: string | null;
  failed_count: number;
};

export function isHealthyRun(run: JobRunHealthFields): boolean {
  return run.completed_at !== null && run.failed_count === 0;
}

// 2026-10-28 D-20261028-01：營運設定頁原本寫死「LINE提醒憑證未設定」「Sales
// 接收API未部署」這兩句文案，從ZD-001/ZD-004修好之後就沒人改過，跟同一頁下面
// JobStatusPanel顯示的真實狀態互相矛盾(Codex報告D-20261028-01)。這裡把「設定
// 存在與否」跟「跑起來到底健不健康」拆成四個互斥狀態，給UI直接顯示，不是把
// 文案字面從「未設定」改成「已啟用」就交差——沒有判斷依據的狀態寧可顯示「待
// 驗證」，不能宣稱成功。
//
// not_configured：最近一次執行本身就是「完全沒設定，跳過不處理」(sales-sync/
//   reminders兩支route在這種情況下會把error_summary寫成下面這兩個固定字串，
//   見jobs/sales-sync/route.ts跟jobs/reminders/route.ts各自的not-configured分支)。
// unverified：目前還沒有任何執行紀錄(例如剛啟用、還沒輪到第一次cron tick)，
//   無法判斷設定是否正確，不能預設樂觀。
// healthy：最近一次執行本身就是健康的(completed且failed_count=0)。
// failing：有執行紀錄、不是「沒設定」，但最近一次不健康——這才是真正需要人工
//   介入的狀態，跟「正常運作但queue是空的」不能混在一起顯示。
export type CredentialState = "not_configured" | "unverified" | "healthy" | "failing";

const NOT_CONFIGURED_ERROR_SUMMARIES = new Set(["no_credentials_skipped_entirely", "not_configured_skipped_entirely"]);

export type RunForCredentialState = JobRunHealthFields & { error_summary: string | null };

export function deriveCredentialState(mostRecentRunsDesc: RunForCredentialState[]): CredentialState {
  if (mostRecentRunsDesc.length === 0) return "unverified";
  const mostRecent = mostRecentRunsDesc[0];
  if (mostRecent.error_summary !== null && NOT_CONFIGURED_ERROR_SUMMARIES.has(mostRecent.error_summary)) {
    return "not_configured";
  }
  return isHealthyRun(mostRecent) ? "healthy" : "failing";
}

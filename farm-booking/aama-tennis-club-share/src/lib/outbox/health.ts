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

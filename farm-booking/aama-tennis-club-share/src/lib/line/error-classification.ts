// 依 LINE 官方文件分類錯誤（https://developers.line.biz/en/reference/messaging-api/#status-codes）：
// 401＝憑證錯誤，重試永遠不會成功，需要人工换新token，不再排入backoff。
// 400＝永久性請求錯誤（收件者無效、內容格式錯誤等），重試也不會成功。
// 429／5xx＝限流或暫時性服務錯誤，值得用既有backoff有限重試。
// 其餘狀態碼視為暫時性錯誤，同樣走有限重試（保守：預設可重試優於預設不可重試，
// 避免因為未知狀態碼永久放棄一則其實可補送的提醒）。
export type LineErrorClass = "credential" | "permanent" | "transient";

export function classifyLineError(status: number): LineErrorClass {
  if (status === 401) return "credential";
  if (status === 400) return "permanent";
  if (status === 429 || status >= 500) return "transient";
  return "transient";
}

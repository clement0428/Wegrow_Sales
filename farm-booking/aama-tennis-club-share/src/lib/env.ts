function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`缺少環境變數 ${name}`);
  return v;
}
export const env = {
  get LINE_CHANNEL_ID() { return req("LINE_CHANNEL_ID"); },
  get SESSION_SECRET() { return req("SESSION_SECRET"); },
  get DEV_FAKE_LOGIN() { return process.env.DEV_FAKE_LOGIN === "1"; },
  // Messaging API push credentials — distinct from LINE_CHANNEL_ID (that's
  // the LIFF/Login channel used for customer sign-in). Optional/non-throwing:
  // its absence is a real, expected state (not configured yet), not a bug —
  // callers must check for undefined and report "not configured", never crash.
  get LINE_MESSAGING_ACCESS_TOKEN(): string | undefined { return process.env.LINE_MESSAGING_ACCESS_TOKEN || undefined; },
  // Sales CRM's /api/contacts requires a human session login — there is no
  // service-account/API-key path today. These two stay undefined until the
  // Sales app grows one (see docs/booking-calendar-implementation.md).
  get SALES_SYNC_API_URL(): string | undefined { return process.env.SALES_SYNC_API_URL || undefined; },
  get SALES_SYNC_API_KEY(): string | undefined { return process.env.SALES_SYNC_API_KEY || undefined; },
  // 麻豆現場群：webhook驗簽用的channel secret（跟LINE_MESSAGING_ACCESS_TOKEN同一個
  // Messaging API channel，但是不同的憑證種類）；群組本身的ID。兩者未設定前，
  // webhook一律401、工作卡一律不發送——不是故障，是安全預設。
  get LINE_MESSAGING_CHANNEL_SECRET(): string | undefined { return process.env.LINE_MESSAGING_CHANNEL_SECRET || undefined; },
  get MADOU_GROUP_ID(): string | undefined { return process.env.MADOU_GROUP_ID || undefined; },
  // 認養資格查詢（wegrow-orbit-src，另一個repo/身分系統）——service-to-service
  // bearer secret，未設定前一律回報"not_configured"，免費參訪路徑直接拒絕，不會
  // 誤判成一般付費訂單（見adoption-eligibility.ts）。
  get FARM_BOOKING_ELIGIBILITY_SECRET(): string | undefined { return process.env.FARM_BOOKING_ELIGIBILITY_SECRET || undefined; },
  get ORBIT_API_BASE_URL(): string | undefined { return process.env.ORBIT_API_BASE_URL || "https://api.wegrow-orbit.com"; },
  // 客戶瀏覽器端要導向的Orbit企業認養入口頁面（不是service-to-service API base），
  // 客戶在這裡用真實帳密登入後，由該頁面前端呼叫claim API——跟上面的ORBIT_API_
  // BASE_URL是兩個不同用途的URL，不能共用。
  get ORBIT_CUSTOMER_PORTAL_URL(): string { return process.env.ORBIT_CUSTOMER_PORTAL_URL || "https://wegrow-orbit.com/sol-wegrow-farm/farm-portal.html"; },
};

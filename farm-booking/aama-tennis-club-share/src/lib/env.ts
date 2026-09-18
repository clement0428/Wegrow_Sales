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
};

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`缺少環境變數 ${name}`);
  return v;
}
export const env = {
  get LINE_CHANNEL_ID() { return req("LINE_CHANNEL_ID"); },
  get SESSION_SECRET() { return req("SESSION_SECRET"); },
  get DEV_FAKE_LOGIN() { return process.env.DEV_FAKE_LOGIN === "1"; },
};

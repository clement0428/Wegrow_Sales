# 部署到 Cloudflare Workers（第一次）

## 前置

- Node **22 或以上**（wrangler 4.x 要求）。本機 default 是 20 → `nvm install 22 && nvm use 22`。
- 已安裝 wrangler：`npm ls wrangler` 應顯示 4.x。
- Cloudflare 帳號已開好，account id `<CLOUDFLARE_ACCOUNT_ID>`。

## 1) wrangler 登入

```bash
cd "$HOME/Documents/Other Projects/aama-tennis-club-member-system"
nvm use 22
npx wrangler login
```
瀏覽器會開一個授權頁，按 Allow。回終端機看到 `Successfully logged in`。

驗證：`npx wrangler whoami` 顯示帳號 email。

## 2) LINE Developers 建 channel + LIFF app（**尚未做**）

1. 到 https://developers.line.biz/console/ 用 LINE 帳號登入。
2. Create a new provider（名稱：AAMA 網球社）。
3. 進 provider → Create a channel → **LINE Login** channel。填：Channel name「AAMA 網球社」、Region Taiwan、App types 勾 Web app。
4. 進 channel → 分頁 **LIFF** → Add：
   - LIFF app name：網球社
   - Size：Full
   - Endpoint URL：先隨便填 `https://aama-tennis-club.<你的-cloudflare-account-subdomain>.workers.dev`（第一次 deploy 完會知道真正網址，回來改）
   - Scopes：勾 `profile` 與 `openid`
   - Bot link feature：Off
5. **記下** LIFF ID（形如 `2010340767-xxxxxxxx`）與 Basic settings 的 **Channel ID**（純數字）。
6. Basic settings 把 status 從 Developing 改成 **Published**。

## 3) 填入 LIFF ID + 部署 secrets

在 `wrangler.jsonc` 找到 `"env": { "production": { ..., "vars": { "NEXT_PUBLIC_LIFF_ID": "" } } }`，填入 LIFF ID：
```jsonc
"vars": { "NEXT_PUBLIC_LIFF_ID": "2010340767-xxxxxxxx" }
```

生 SESSION_SECRET（每個環境獨立、只你本機知道）：
```bash
openssl rand -base64 32
```

設定 wrangler secrets（互動式，會問你貼值）：
```bash
npx wrangler secret put SESSION_SECRET --env production
# 貼上剛剛 openssl 的輸出

npx wrangler secret put LINE_CHANNEL_ID --env production
# 貼上 LINE Developers 的 Channel ID
```

## 4) 第一次部署

```bash
nvm use 22
npm run deploy -- --env production
```
輸出會告訴你網址，例如 `https://aama-tennis-club.<subdomain>.workers.dev`。

## 5) 回 LINE Developers 改 Endpoint URL

到 LIFF app → Endpoint URL 改成剛剛得到的網址（把 `<subdomain>` 換成真的），存檔。

## 6) 手機測試

用 LINE 開 `https://liff.line.me/<LIFF ID>`：
1. 自動登入 → 看到「網球社」的場次頁
2. 開一場、接龍、分享到群組、另一個 LINE 帳號點連結接龍
3. 結束報名時間過後，開場者到管理頁結算 → 標記已付 → 我的頁看待付款

## 7) 把你自己設為管理員

用瀏覽器打開 `https://<your-worker>.workers.dev`，先登入一次（讓 members 表有你的 record），然後：

```bash
npx wrangler d1 execute DB --remote --env production \
  --command "UPDATE members SET role='admin' WHERE display_name='<你的 LINE 顯示名>'"
```

之後 `/manage` 頁就有「全部場次」與「場地維護」按鈕。

## D1 migration 現況

`tennis-club-prod`（<D1_PROD_DATABASE_ID>）已透過 Cloudflare API 建好完整 schema，`d1_migrations` 表也記錄了 `0001_schema.sql`。之後如果要加新 migration（`0002_*.sql`、`0003_*.sql`...），推上去：
```bash
npx wrangler d1 migrations apply DB --remote --env production
```

## 本機開發

```bash
cd "$HOME/Documents/Other Projects/aama-tennis-club-member-system"
cp .env.example .env.local
# 編輯 .env.local 填 LINE_CHANNEL_ID / SESSION_SECRET
# NEXT_PUBLIC_LIFF_ID 也填一下（沒填就沒 LIFF SDK；DEV_FAKE_LOGIN=1 就可以用假登入）
cp .dev.vars.example .dev.vars
# 填一樣的值 + NEXTJS_ENV=development
npm run cf:dev    # 套用 migrations 到 local D1
npm run dev       # http://localhost:3000
```
開發用假登入按鈕（DEV_FAKE_LOGIN=1）：
- `http://localhost:3000/api/auth/dev-login?name=Ken` → 一般成員
- `http://localhost:3000/api/auth/dev-login?name=Admin&admin=1` → 管理員

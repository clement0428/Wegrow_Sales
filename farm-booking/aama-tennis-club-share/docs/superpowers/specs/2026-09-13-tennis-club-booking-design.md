# AAMA 網球社預約系統 設計規格

- 日期：2026-09-13
- 狀態：草案，待用戶確認
- 參考：AAMA 匹克球社 LIFF 預約系統（功能與介面對照）

## 1. 目標與範圍

讓 AAMA 網球社成員用 LINE 登入後，自行開場、接龍報名、看自己的參與紀錄與待付款，並提供出席統計與排行榜。開場者可以管理自己開的場次、結算分帳、記錄收款。

**範圍決定**

- 單一球社，不做多球社（不設 club 層）。
- 登入只用 LINE（LIFF）。
- 角色：一般成員、開場者（相對於自己開的場次）、管理員（少數人）。
- 沒有線上金流，收款由開場者手動標記。
- Phase 1 涵蓋本文件所有功能；Phase 2 候選見第 9 節。

## 2. 技術架構

| 層 | 選擇 | 說明 |
|---|---|---|
| 前端 | Next.js 15（App Router、TypeScript、Tailwind CSS） | 手機優先，底部四分頁，在 LINE 內建瀏覽器與一般瀏覽器都可用 |
| 登入 | LIFF SDK + 伺服器端驗證 id_token | 見第 5 節 |
| 資料庫 | Supabase Postgres（Bridge org，Tokyo） | 全表 RLS 開啟，前端不直連 |
| 資料存取 | Server Components 讀取、Server Actions 寫入，皆用 Supabase secret key | 邏輯集中在伺服器 |
| 併發 | 報名／取消／遞補寫成 Postgres function，交易內對 events 列加鎖 | 避免搶最後一個名額的競態 |
| 部署 | Cloudflare Workers（用戶個人帳號），以 OpenNext Cloudflare 轉接器建置，wrangler 部署；LIFF Endpoint URL 指向 workers.dev 網址 | LINE 不提供主機，LIFF 只是指向外部網站的設定。需開 nodejs_compat；環境變數用 wrangler secret 設定 |
| 版本控制 | GitHub private repo `aama-tennis-club-member-system`，分支 main | 部署以本機 wrangler deploy 為主，之後可加 GitHub Actions 自動部署 |

**為什麼不用 Supabase Auth 自簽 JWT 讓前端直連**：新專案已採非對稱金鑰，自簽 token 要走 legacy 路徑且 RLS 規則難測；省下的只是一層 API，不值得。

## 3. 資料模型

所有時間欄位存 timestamptz，顯示與輸入一律以 Asia/Taipei 解讀。

### members

| 欄位 | 型別 | 說明 |
|---|---|---|
| id | uuid PK | |
| line_user_id | text unique | LINE 的 sub |
| display_name | text | 登入時同步 |
| picture_url | text null | 登入時同步 |
| role | enum member / admin | 預設 member；初始管理員由 SQL 設定 |
| created_at / last_login_at | timestamptz | |

### venues

| 欄位 | 型別 | 說明 |
|---|---|---|
| id | uuid PK | |
| name | text | |
| address | text null | |
| is_active | boolean | 停用後不出現在下拉 |
| created_by | uuid FK members | |

### events

| 欄位 | 型別 | 說明 |
|---|---|---|
| id | uuid PK | |
| title | text | |
| event_date | date | |
| start_time / end_time | time | |
| venue_id | uuid FK venues | |
| capacity | int | 預設 8，必須 ≥ 1 |
| registration_deadline | timestamptz | 預設活動前一天同時刻 |
| estimated_total | int null | 預計總金額，選填 |
| final_total | int null | 結算時填入 |
| status | enum open / settled / cancelled | |
| organizer_id | uuid FK members | |
| settled_at | timestamptz null | |
| note | text null | |
| created_at / updated_at | timestamptz | |

### registrations

| 欄位 | 型別 | 說明 |
|---|---|---|
| id | uuid PK | |
| event_id | uuid FK events | |
| member_id | uuid FK members | |
| status | enum confirmed / waitlisted | |
| waitlist_position | int null | 候補順序 |
| attended | boolean null | 結算時填入 |
| amount_due | int null | 結算時計算 |
| paid_at | timestamptz null | |
| paid_amount | int null | 標記已付時記錄當時金額 |
| paid_marked_by | uuid FK members null | |
| created_at | timestamptz | |
| unique(event_id, member_id) | | 取消即刪除該列 |

## 4. 業務規則

### 4.1 場次顯示狀態（由資料推導，不另外儲存）

| 顯示狀態 | 條件 |
|---|---|
| 接龍中 | status = open 且 now < registration_deadline |
| 已截止 | status = open 且 now ≥ registration_deadline |
| 已結算 | status = settled |
| 已取消 | status = cancelled |

### 4.2 開場

- 任何登入成員都可以開場。
- 開場者自動成為第一位正取（自動 +1）。
- 場地從下拉選；沒有的可在表單直接新增一筆 venue。
- 結束報名時間預設為活動日期前一天的開始時間，可自行調整，必須早於活動開始。

### 4.3 接龍與候補

- 接龍：若正取人數 < capacity 則進正取，否則進候補，waitlist_position = 目前候補最大值 + 1。
- 取消：刪除該列。若取消的是正取，候補中 position 最小者升為正取並清空 position。
- 已截止後成員不能接龍或取消；開場者與管理員仍可代加、代刪。
- 開場者調高 capacity 時，候補依序自動遞補；調低時不動已正取者。
- 以上皆在 Postgres function 內以交易處理，函式開頭對該 event 列 SELECT FOR UPDATE。

### 4.4 結算與重算

- 開場者或管理員可隨時進入結算頁，通常在場次結束後。
- 名單列出正取與候補，逐人勾「實際到場」。預設：正取已勾、候補未勾。
- 輸入實際總金額，預設帶入 estimated_total。
- 每人應付 = ceil(final_total ÷ 到場人數)，無條件進位到整數元。未到場者 amount_due = 0。
- 頁面顯示「應收合計」（每人應付 × 到場人數）與「實際總金額」的差額。
- 確認後 status = settled、settled_at 填入。
- 可重新結算：重新勾人或改總額後重算所有人的 amount_due。已標記已付且 paid_amount ≠ 新 amount_due 的列標示「已付金額與應付不符」，系統不自動更動已付狀態。
- 到場人數為 0 時不可結算。

### 4.5 收款紀錄

- 結算後，開場者或管理員在收款紀錄逐人標記已付／取消已付。標記已付時寫入 paid_at、paid_amount（= 當時 amount_due）、paid_marked_by。
- 成員在「我的」看到待付款總額 = 所有已結算場次中 attended 為真且 paid_at 為空的 amount_due 加總。

### 4.6 取消場次

- 開場者或管理員可取消，status = cancelled，保留報名資料但不計統計、不出現在待付款。
- 已結算的場次不可取消（要先重新結算或直接調整）。

### 4.7 統計

- 出席一場：該場 status = settled 且 attended = true；或該場 status = open、活動時間已過、該人為正取（暫計，結算後以實際為準）。
- 總場次：status ≠ cancelled 且活動時間已過的場次數。
- 總出席人次：上述出席的總和。
- 已收款金額：所有 paid_amount 加總。
- 排行榜依出席場數降序，同分依 display_name。
- 預設範圍本年度（Asia/Taipei），可切換全部期間。

## 5. 登入與安全

### 5.1 登入流程

1. 頁面載入，前端呼叫 liff.init。未登入則 liff.login（LINE 內直接授權，外部瀏覽器跳 LINE 登入頁）。
2. 前端取得 id_token，POST 到 /api/auth/line。
3. 伺服器向 LINE 驗證端點（oauth2/v2.1/verify）送出 id_token 與 channel id，確認簽章、aud、exp。
4. 依 sub 對 members 做 upsert（display_name、picture_url、last_login_at）。
5. 發 httpOnly、Secure、SameSite=Lax 的簽章 cookie，內容為 member id，30 天有效。
6. 之後 Server Components 與 Server Actions 從 cookie 取得成員。cookie 失效時回到步驟 1。

### 5.2 授權

| 操作 | 允許者 |
|---|---|
| 瀏覽場次、統計、我的 | 任何登入成員 |
| 開場、接龍、取消自己的報名 | 任何登入成員 |
| 編輯場次、代加代刪、結算、收款標記、取消場次 | 該場 organizer 或 admin |
| 場地維護（編輯、停用） | admin；新增場地任何成員可在開場表單做 |
| 設定 admin | 只能由資料庫直接改，不做介面 |

### 5.3 防護

- 每個 Server Action 先取 cookie 成員，再檢查授權，輸入以 zod 驗證。
- Supabase secret key 與 SESSION_SECRET 只以 wrangler secret 存放，不進 repo。
- 全表 RLS 開啟，對 anon 與 authenticated 不設任何 policy。
- LIFF ID 與 LINE channel id 為公開值；channel secret 不需要用到（驗證 id_token 只需 channel id）。
- 開發期假登入：環境變數 DEV_FAKE_LOGIN=1 時，登入頁提供「以測試成員登入」按鈕，正式環境不啟用。

## 6. 頁面規格

底部分頁：場次、我的、統計、管理。頂部顯示球社名稱與登入者頭像。

### 6.1 場次（/）

- 「即將舉行」列表：活動時間未過且未取消，依日期升序。卡片：日期方塊、標題、時間、地點、名額進度條（正取／上限）、候補數、狀態標籤。
- 「已結束」區塊：可摺疊，顯示已結算與待結算，並標示待付款人數。
- 右下角 + 按鈕開啟開場表單。

### 6.2 場次詳情（/events/[id]）

- 完整資訊、開場者。
- 正取名單與候補名單（頭像、名稱）。
- 主按鈕：接龍／取消接龍／已截止／已額滿排候補。
- 分享：LIFF 內用 liff.shareTargetPicker 送出場次卡片（Flex Message）；外部瀏覽器則複製連結。
- 已結算後顯示每人金額、我的付款狀態。

### 6.3 我的（/me）

- 待付款總額卡片，下方列出待付場次。
- 即將參加（正取與候補分別標示）。
- 歷史紀錄（已結束場次，含已付／待付／未出席標籤）。

### 6.4 統計（/stats）

- 四張卡：總場次、總出席人次、我的出席場數、已收款金額。
- 出席排行榜：前三名領獎台 + 第 4 名起列表（顯示前 8，可展開全部）。
- 期間切換：本年度／全部。

### 6.5 管理（/manage）

- 我開的場次列表；admin 看到全部並可篩選。
- 單場管理頁（/manage/[id]）分區：
  - 場次資訊編輯（同開場表單）。
  - 名單：代加成員（從成員清單搜尋）、代刪。
  - 結算：到場勾選、實際總金額、每人應付預覽、確認。
  - 收款紀錄：逐人已付切換、不符警示。
  - 取消場次。
- admin 另有場地維護頁（/manage/venues）。

### 6.6 開場表單（底部抽屜）

欄位：場次名稱、日期、開始時間、結束時間、結束報名時間（預設前一天）、地點（下拉 + 新增）、名額上限（預設 8）、預計總金額（選填，填了顯示預估每人）。送出即建立並自動 +1。

## 7. 專案結構

```
src/
  app/                 頁面與 route handlers
    (tabs)/            四分頁 layout
    events/[id]/
    manage/
    api/auth/line/
  components/          UI 元件
  lib/
    auth/              LIFF 驗證、session cookie
    db/                Supabase admin client、查詢函式
    domain/            純函式：狀態推導、結算計算、統計
    actions/           Server Actions
  supabase/migrations/ schema、functions、RLS
```

## 8. 測試

- Vitest 單元測試：結算計算（進位、差額、未到場為 0）、狀態推導、統計計數規則。
- 整合測試：register / cancel / promote 的 Postgres function 對 dev 專案執行，驗證候補遞補與容量調整。
- 手動驗收：LIFF 在 LINE 內與外部瀏覽器各跑一次完整流程（開場、接龍到額滿、候補遞補、截止、結算、收款）。

## 9. 分期

- Phase 1：本文件全部。
- Phase 2 候選：LINE 推播提醒（需 Messaging API channel）、帶朋友 +N、月曆檢視、匯出收款表、成員自訂暱稱。

## 10. 用戶需準備的外部設定

1. LINE Developers：Provider → LINE Login channel → 新增 LIFF app（scope: profile、openid；Endpoint URL 先填 workers.dev 網址）。取得 LIFF ID 與 Channel ID。
2. Supabase：Bridge org 新建專案（Tokyo），取得 project URL、publishable key、secret key。
3. Cloudflare：個人帳號（免費方案即可），本機 wrangler login；首次部署後取得 `<name>.<account>.workers.dev` 網址回填 LIFF Endpoint URL。

環境變數：NEXT_PUBLIC_LIFF_ID、LINE_CHANNEL_ID、SUPABASE_URL、SUPABASE_SECRET_KEY、SESSION_SECRET、DEV_FAKE_LOGIN（僅本機）。

---

## Architecture revision — 2026-09-13 (mid-implementation)

This section supersedes §2 Technical architecture and §10 External setup for later work. Sections §3 資料模型, §4 業務規則, §5 登入安全, §6 頁面規格, §7 專案結構, §8 測試, §9 分期 still stand, with the mechanical difference that all storage runs on Cloudflare D1 (SQLite) instead of Supabase Postgres.

### Why the pivot

The pickleball club system (the visual reference) runs entirely on Cloudflare Workers with (almost certainly) D1 backing it. Following the same path gets us $0/月 and single-vendor operations for the same functionality.

### New technology stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4 (unchanged) |
| Login | LIFF SDK on client + server verification of id_token (unchanged) |
| Session | Signed cookie via `jose` (unchanged) |
| Runtime | Cloudflare Workers via @opennextjs/cloudflare (unchanged) |
| **Database** | **Cloudflare D1 (SQLite), APAC region** |
| **DB access** | **D1 binding via getCloudflareContext(); dev uses next dev with `initOpenNextCloudflareForDev()`** |
| Migrations | `d1/migrations/*.sql` applied via `wrangler d1 migrations apply --local` (dev) / `--remote` (prod) |
| Concurrency | Seat number pattern + UNIQUE constraint + optimistic retry (see below); no Durable Object in Phase 1 |
| Version control | GitHub private repo `aama-tennis-club-member-system` (unchanged) |

### D1 schema differences from §3

- All primary keys are TEXT holding `crypto.randomUUID()` values (SQLite has no `uuid` type; we generate in app code).
- All timestamps are TEXT holding ISO 8601 strings (`new Date().toISOString()`). Dates are TEXT `YYYY-MM-DD`; times are TEXT `HH:mm`.
- All enums are TEXT with `CHECK (col IN (...))` constraints.
- Booleans are INTEGER 0/1; app layer converts.
- Foreign keys: enable per-connection with `PRAGMA foreign_keys = ON;` — D1 does not honor them by default.
- **RLS is dropped**: D1 has no roles other than the worker itself. The security model is «the worker is the only thing that can talk to D1», already assumed. §5 stays valid.

### Concurrency model (replaces §4.3's Postgres function)

Instead of `SELECT FOR UPDATE + stored procedure`, D1 uses a seat-number pattern:

- `registrations` gets `seat_no INTEGER NOT NULL` and `UNIQUE(event_id, seat_no)`.
- On register:
  1. Read event `capacity` and current `MAX(seat_no)` for that event.
  2. `INSERT` a row with `seat_no = max + 1` and `status = seat_no <= capacity ? 'confirmed' : 'waitlisted'`.
  3. If insert fails with UNIQUE conflict on `(event_id, seat_no)` (two concurrent registers picked the same seat), the app catches the error and retries once with a re-read max. This is fine for a 8-person tennis club with ~1 request/sec peak.
- On cancel:
  1. `DELETE` the row.
  2. Close the gap: `UPDATE registrations SET seat_no = seat_no - 1 WHERE event_id=? AND seat_no > deleted_seat`.
  3. Recompute status of affected rows: `UPDATE ... SET status = seat_no <= capacity ? 'confirmed' : 'waitlisted'` (or equivalent CASE).
- On capacity change: `UPDATE events SET capacity=?`; then re-run the status recompute on all rows for that event.
- Multiple D1 statements run under `db.batch([...])` which is atomic within a single request; combined with the retry-on-conflict this gives correctness for our load. If load ever climbs, a Durable Object per event turns the whole path serial with the same schema.

### New external setup steps (replaces §10)

1. **LINE Developers** — unchanged (LINE Login channel + LIFF app).
2. **Cloudflare** — sign up, `wrangler login`; note account id (already: `<CLOUDFLARE_ACCOUNT_ID>`).
3. **Cloudflare D1** — created via MCP for dev: `tennis-club-dev` id `<D1_DEV_DATABASE_ID>`. Prod DB created at deploy time.
4. **Supabase** — no longer used.

Environment variables:
- Build/runtime: `NEXT_PUBLIC_LIFF_ID`, `LINE_CHANNEL_ID`.
- Secrets: `SESSION_SECRET` (wrangler secret in prod, `.dev.vars` in local).
- D1: bound via wrangler.jsonc, not env var (`env.DB`).


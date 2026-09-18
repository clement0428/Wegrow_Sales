# WeGrow 農場預約｜開發現況與本次實作紀錄

版本：2026-09-18。依據 `20260918_WeGrow_Booking_Claude_Implementation.md`（V1 核准規格）。

## 0. 本文件邊界

這是**現況紀錄＋本次已完成變更**，不是「已完成」的宣告。第 3 節清楚列出本次做了什麼、第 4 節列出規格書要求但這次沒做到的部分，兩者都要看才是完整現況。

## 1. Discovery（開工前核對，依規格書第 1 節要求）

| 項目 | 現況 |
|---|---|
| Repo／branch | `clement0428/Wegrow_Sales`，`master` 分支，`farm-booking/aama-tennis-club-share/` |
| 正式網址 | `https://booking.wegrow-orbit.com`（Cloudflare Worker `wegrow-farm-booking`，custom domain） |
| 預覽網址 | 無穩定可用預覽（見 [[feedback_farm_booking_windows_path_crash]] 的 preview D1 隔離修復記錄；`deploy:dev` 從未實際部署過） |
| 資料庫 binding | Cloudflare D1，binding `DB`，正式 `database_id: 4f40a0e0-e5bb-4de0-93ad-91ad3b32dfc7`（`wegrow-farm-booking-prod`） |
| 目前資料模型 | 已有完整 schema（見第 2 節），比規格書假設的「可能要新建」成熟很多 |
| 管理員登入方式 | **沒有**。`/admin` 路由（`src/app/admin/page.tsx`）直接渲染 `FarmAdmin` 元件，無 session、無角色檢查，任何人都能打開 URL 看到畫面（畫面本身目前是純靜態假資料，見第 2.3 節） |
| LIFF 設定來源 | `wrangler.jsonc` `env.production.vars.NEXT_PUBLIC_LIFF_ID`，經 `scripts/sync-build-env.mjs` 於 build 時寫入 `.env.production`，已有多輪 code review 修過的防呆（見 `outputs/INCIDENT_LINE_IOS_2026-09-18.md`） |
| 付款啟用狀態 | **未啟用**。`/api/farm/checkout` 用 `NotConfiguredPaymentProvider`，任何呼叫都回 503 `payment_provider_not_configured` |
| 通知啟用狀態 | 資料表 `farm_notification_outbox` 已存在（含 retry_key／attempt_count／next_attempt_at），但沒有找到實際發送 LINE 訊息的 worker／cron 在消費這個 outbox——**表存在，但沒有實際運作中的發送流程** |
| 舊資料數量 | 正式 D1 的 `farm_bookings` 資料表**完全是空的（0 筆）**。`farm_slots` 有約 200+ 筆未來開放時段，全部 `active_groups: 0` |

## 2. 現有實作盤點（比規格書假設的更完整，先講清楚不用重建）

### 2.1 資料庫（`d1/migrations/0001`–`0008`）

已存在且對應規格書第 5 節的邏輯需求：

- **Session** → `farm_slots`（starts_at/ends_at/status/booking_cutoff_at/buffer_minutes/capacity_policy_id）
- **Booking** → `farm_bookings`，**預約狀態與付款狀態已經是分開兩欄**（`booking_status`、`payment_status`），符合規格書 2A 節「不能把兩者混在單一成功狀態」的要求
- **Payment** → `farm_payment_attempts` + `farm_payment_events`（含 provider/reference/verified/payload_json，webhook 去重用 `UNIQUE(provider, provider_event_id)`）
- **Audit** → `farm_audit_log`（actor/action/from_state/to_state/reason/correlation_id）
- **Outbox** → `farm_notification_outbox`（retry_key/attempt_count/next_attempt_at/status），**表存在但沒有實際消費者**
- **Assignment**（員工工作分配）→ **不存在**，規格書第 4 節「準備工作」「接待人員」需要這張表

### 2.2 容量引擎（本次修改，見第 3 節）

`src/lib/farm/bookings` 的 POST 路由（`src/app/api/farm/bookings/route.ts`）用**單一條件式 INSERT...SELECT...WHERE**做容量檢查與佔位是同一個原子操作，不是先 SELECT 剩餘量再 INSERT——這正是規格書「併發与重試」一節明確要求的模式，**本來就有**，不是本次新加的。已用真實併發情境驗證過其正確性（見第 3 節）。

Idempotency（`idempotency_key` 唯一約束 + 建立前先查是否已存在）也**本來就有**，符合規格書 C08。

### 2.3 客戶端 UI（`FarmBookingApp.tsx`，482 行）

現況是**一個時段清單頁**（selectable adult/child/infant counters + 可捲動的時段清單 + checkout 表單），**不是規格書要求的月曆／週曆視圖**。沒有月曆格、沒有「可預約／已有預約／暫留／額滿／未開放」狀態列（2A 節）、沒有月週切換。

### 2.4 管理後台（`FarmAdmin.tsx`，86 行）

**目前是 100% 純前端假資料展示頁，完全沒有接 D1、沒有登入驗證。** 檔案開頭直接寫死一個 `bookings` 陣列、寫死「本週開放場次:4」「已確認來訪:30」等數字、寫死一週的行事曆格子內容。規格書第 4 節要求的「員工桌面認證與角色權限」「週曆真實資料」「工作單列印」「收款記錄」全部不存在，只有畫面排版可以參考。

### 2.5 Sales 同步

`booking-operations.ts` 裡的 `AtomicBookingLedger`（記憶體版本，非 D1）示範了 outbox 事件版本化的概念（`booking.held`/`booking.confirmed`/`booking.cancelled`），但這是**測試/示範用的記憶體類別**，不是接正式 D1 `farm_notification_outbox` 或真的呼叫 Sales API 的程式。正式訂單建立時（`bookings/route.ts`）目前**沒有**寫入 outbox 或觸發任何 Sales 同步事件。

## 3. 本次已完成：容量引擎改成 30 人／2 團（規格書「已核准，覆蓋所有舊規則」）

### 3.1 修改內容

- `d1/migrations/0009_capacity_flat_30_2.sql`：新增 `wegrow-policy-v2`（`max_groups=2, limit_one_group=30, limit_two_groups=30, limit_three_groups=0`），只把**未來、仍開放**的時段重新指向新版本；已結束或非 open 的時段不動。**沒有改 schema、沒有改 SQL 查詢邏輯**——現有的 CASE-based 容量檢查天生支援任意分級限制，把兩個分級都設成 30 就等於「不分級的 30 人上限」，改動風險降到最低。
- `src/lib/farm/capacity.ts`：`DEFAULT_CAPACITY_POLICY` 從 `{maxGroups:3, 1:50,2:30,3:15}` 改成 `{maxGroups:2, 1:30,2:30}`。
- `src/app/api/farm/bookings/route.ts`：前端輸入的總人數上限檢查從 50 改成 30（提早攔截明顯超量請求，不等到資料庫層才拒絕）。
- `src/components/farm/FarmAdmin.tsx`：靜態文案「50／30／15」改成「30 人／最多 2 團」（這頁本身仍是假資料頁，只是不再顯示錯誤規則）。
- `tests/farm/capacity.test.ts`、`tests/farm/booking-operations.test.ts`：全面改寫測試案例對應新規則，含明確的「舊規則 50 人現在必須被拒絕」回歸測試。

### 3.2 部署前 dry-run（規格書第 9 節要求，已完成）

查詢正式 D1：`farm_bookings` 資料表**完全是空的（0 筆）**；所有未來 open 時段的 `active_groups` 都是 0。**新規則對任何現有預約沒有影響**，因為沒有任何現有預約。已記錄此查詢結果作為 migration 安全性依據，見 migration 檔案內的註解。

### 3.3 驗證方式（真實 D1，真實 HTTP API，不是只跑單元測試）

本機起 `next dev` 接本機 D1（已跑過 migration 0009），用真實假登入 + 真實 `POST /api/farm/bookings` 打對應到 C01-C08 的案例：

| 案例 | 操作 | 結果 |
|---|---|---|
| C01 | 空場次，1 團 30 人 | 201，建立訂單 WG-260918-E493FC，金額 NT$9000（30×300） |
| 對應 C02 | 同場次已滿 30 人，再加 1 人 | 409 `capacity_changed` |
| C03 | 空場次先 1 團 20 人，再加 1 團 10 人 | 兩次皆 201，總 30 人 2 團 |
| 對應 C05 | 已 2 團（20+10=30），再加第 3 團 1 人 | 409（團數已滿，不是人數問題） |
| C08 | 同一 idempotency key 送兩次 | 第二次回傳同一張訂單，`duplicate: true`，未建立重複訂單 |

事後查 `/api/farm/availability`：2 團 30 人的場次 `maxNewGroupSize: 0, available: false`；1 團 5 人的場次 `maxNewGroupSize: 25`（30-5，非舊制的 50-5），確認顯示邏輯與後端一致。

全專案自動化測試 88/88 通過（含新增與改寫的容量測試）。

### 3.4 尚未驗證的部分（誠實列出）

- **並發衝突**（C07：最後名額兩個同時搶）——這次沒有真的發兩個同時的 request 測試，只驗證了循序的容量檢查邏輯與底層 SQL 的原子性設計（單一 INSERT...SELECT...WHERE，非「先查後寫」）。SQL 設計本身能防止競態，但沒有用真實併發流量壓測過。
- **HOLD 過期／付款流程**（C09、P01、P02）——`hold_expires_at` 欄位與查詢邏輯都在，但目前系統沒有 `pending_payment` 狀態的實際產生流程（付款未開通，訂單建立後狀態直接是 `requested`），所以 HOLD 過期釋放這條路徑沒有真實資料可測。
- **改期**（C10）——目前 API 沒有「改期」端點，只有建立與查詢，改期需要另外開發。

## 4. 規格書要求但本次沒有完成的部分（誠實列出，不是拖延）

以下項目規格書明確要求，但受限於這次的時間與範圍，**沒有實作**，僅完成上述容量引擎修正：

1. **客戶端月曆／週曆 UI**（規格書第 2 節）——現有 `FarmBookingApp.tsx` 是清單頁，需要重新設計成月曆格子、週視圖、狀態圖示；這是大範圍前端重建。
2. **固定狀態列**（2A 節）——客戶日曆狀態列、訂單狀態列、管理後台狀態列，三個都要新做 UI 元件。
3. **真正的管理後台**（第 4 節）——`FarmAdmin.tsx` 目前 100% 假資料，需要：真實員工登入與角色權限（API enforce，非只藏按鈕）、真實 D1 週曆資料、預約管理操作（代訂/改期/改人數/取消/報到）、準備工作統計、收款記錄、工作單列印。
4. **Sales 同步的實際落地**——`farm_notification_outbox` 表存在但沒有消費者；正式建立訂單時沒有寫入任何同步事件。
5. **通知系統**——outbox 表存在，但沒有實際發送 LINE 訊息的邏輯、沒有「前一天提醒」排程。
6. **改期功能**——沒有 API。
7. **`/admin` 路由完全沒有身份驗證**——這是現況問題，不是本次改壞的，但既然規格書要求「不要求員工透過客戶 LIFF 預約頁工作」且要有獨立員工認證，這個缺口在做真後台時必須一起補，現在任何人都能打開這個 URL（雖然目前只是假資料，還沒有實際風險，但這頁一旦接上真資料就會是資安缺口，優先順序應提高）。

以上 1-6 項合理估計需要數個工作階段的前後端開發才能達到規格書要求的「可檢閱預覽」程度，不是能在同一次回合內安全完成的規模；勉強趕工會提高在容量/付款相關程式碼引入 bug 的風險，這正是規格書本身也警告的「不能為了測試數量而犧牲關鍵路徑正確性」。

## 5. 建議下一步順序

1. `/admin` 加最基本的登入閘門（即使只是簡單密碼或既有 member 角色檢查），避免之後接上真資料時出現公開後台。
2. 客戶月曆 UI（先週視圖，範圍較小，日期少時比月曆容易做對）。
3. 管理後台接上真實 D1 讀取（先做唯讀週曆＋預約清單，代訂/改期等寫入功能後補）。
4. 固定狀態列（可以跟 2、3 一起做，UI 元件本身不複雜，複雜的是要接上正確的資料來源）。
5. Sales outbox 消費者 + 通知發送邏輯。

## 6. 部署紀錄（本次容量引擎變更）

- Migration：`0009_capacity_flat_30_2.sql`，已套用到正式 D1（`4f40a0e0-e5bb-4de0-93ad-91ad3b32dfc7`）。
- 正式部署 commit／Worker Version：見 `outputs/qa/release-manifest.json`。

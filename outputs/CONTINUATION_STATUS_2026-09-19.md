# WeGrow 農場預約｜接續工作驗收狀態

日期：2026-09-19。依據：`20260918_WeGrow_Claude_Continue_Integration.md`。

狀態標示定義：
- **IMPLEMENTED**：程式碼已完成，通過 tsc/eslint/vitest 與本機真實 D1（或 Sales 端 Flask test client + sqlite3）整合測試。
- **DEPLOYED**：已部署到正式站（含 migration），curl／headless browser 驗證正式站行為與程式碼一致。
- **E2E_VERIFIED**：已用真實外部服務（LINE 正式 API、真機、真實排程）驗證，不是本機模擬。
- **BLOCKED**：需要 Clement 操作或外部資源才能繼續，具體列出缺什麼。

一個項目可以同時是 IMPLEMENTED + DEPLOYED，但 E2E_VERIFIED 沒過之前，不宣告「整套完成」。

---

## 1. Sales 同步

| 子項 | 狀態 |
|---|---|
| farm-booking 端 outbox＋job（排隊、claim/lease、重試、run log） | IMPLEMENTED, DEPLOYED |
| Sales 接收端 v1 contract（sqlite3、event_id去重、booking_version防亂序、衝突偵測、員工查詢畫面） | IMPLEMENTED（本地 commit `f449c59`，`clement0428/wegrow-sales` repo，**未 push、未部署**） |
| 跨系統實際同步 | **BLOCKED** |

**為什麼還是 BLOCKED，具體缺什麼：**
1. `clement0428/wegrow-sales` 的部署是 `workflow_dispatch`（手動觸發）GitHub Actions，SSH 到 Contabo VPS `185.227.134.38`（跟 wegrow-orbit 後端同一台主機）跑 Docker blue-green 部署。我沒有這個 repo 的 push 權限，也沒有 `SERVER_PASSWORD` 等 GitHub Actions secrets 存取權，無法自己觸發部署。
2. `FARM_SYNC_API_KEY` 尚未以 GitHub Actions repo secret 的形式存在——我已經把 `.github/workflows/deploy-server.yml` 改好（env passthrough＋docker run `-e FARM_SYNC_API_KEY`），部署管線已經準備好接這個 key，但 key 本身還沒被建立。
3. farm-booking 這邊的 `SALES_SYNC_API_URL`／`SALES_SYNC_API_KEY` 也還沒設定（同一把 key，兩邊都要設定一致）。

**Clement 需要做的具體操作：**
1. 在 GitHub `clement0428/wegrow-sales` → Settings → Secrets and variables → Actions，新增 `FARM_SYNC_API_KEY`（建議用 `openssl rand -hex 32` 或類似方式產生一組高強度亂數字串）。
2. `cd C:\Users\cowle\dev\projects\wegrow-sales && git push origin master`（把我本地的 commit `f449c59` 推上去）。
3. 到 GitHub Actions 頁面手動 dispatch「Deploy WeGrow Sales to Server」workflow。
4. 用同一把 key 值，在 farm-booking 正式站設定：
   `npx wrangler secret put SALES_SYNC_API_URL --env production`（值：`https://sales.wegrow-orbit.com/api/farm-visitors/sync`，需先核對這是否是 Sales 正式站實際網域）
   `npx wrangler secret put SALES_SYNC_API_KEY --env production`（值：跟步驟1同一把 key）
5. 之後我可以立刻驗證 SY01/SY02/SY03（真實訂單建立→confirm→cancel，核對 Sales 端 `/api/farm-visitors` 投影是否一致、重複/亂序事件、Sales 斷線恢復）。

---

## 2. LINE 通知

| 子項 | 狀態 |
|---|---|
| 發送介面、backoff、dead-letter、X-Line-Retry-Key去重、錯誤分類 | IMPLEMENTED, DEPLOYED |
| 排程自動觸發（Cloudflare Cron Trigger，每分鐘） | IMPLEMENTED, DEPLOYED, **E2E_VERIFIED**（見第4節真實證據） |
| 正式帳號 Messaging API channel 核對 | **BLOCKED** |
| 正向發送（指定測試好友） | **BLOCKED** |

**為什麼還是 BLOCKED：**
- 正式站目前只有 `LINE_CHANNEL_ID`（LIFF／登入用的 Login channel）跟 `SESSION_SECRET` 兩個 secret，沒有 `LINE_MESSAGING_ACCESS_TOKEN`。我沒有 LINE Developers Console 的存取權，無法自己核對 `@647hlrhw` 底下是否已有 Messaging API channel、channel 是否為 Published 狀態。
- 就算有 token，正式發送測試需要「Clement 指定且同意接收測試的帳號」——目前沒有這樣的帳號，所以就算憑證到位，LN01 仍應保持 BLOCKED，不會自己找一般好友帳號硬測。

**Clement 需要做的具體操作：**
1. 登入 LINE Developers Console (https://developers.line.biz/console/)，確認 `@647hlrhw` 底下是否已有一個 **Messaging API channel**（跟 LIFF 用的 Login channel 是兩個不同東西，即使歸在同一個 Provider 底下）。
2. 若沒有，需要新建一個 Messaging API channel（沿用同一個官方帳號，不要開新帳號）。
3. 在該 channel 的「Messaging API」分頁取得 **Channel access token (long-lived)**。
4. `npx wrangler secret put LINE_MESSAGING_ACCESS_TOKEN --env production`（值貼上，不要貼在對話裡）。
5. 提供一個您本人或您同意接收測試訊息的 LINE 帳號（需要先加 `@647hlrhw` 好友），我才能做 LN01（確認/改期/取消/前一天提醒）的正向發送驗證。

---

## 3. 人工收款／素食統計／三種員工角色（第7節回歸）

全部 **IMPLEMENTED, DEPLOYED**，無外部阻塞。詳細驗證證據見 commit `6bfcf24` 訊息：
- 收款：idempotency key 防雙擊重複記錄、退款上限不可超過可退金額（伺服器重新計算，不信任前端）、超收顯示為獨立「超收」欄位而非負的未收、取消預約後「應收」顯示層歸零但不自動產生退款紀錄。
- 素食：`vegetarian_meal_count` NULL＝未確認，工作單明確標示「未確認」而非併入0；餐飲0份不強制填素食；日/場次合計只算有效（未取消）訂單。
- 三角色：403矩陣（sessions/orders/status動作/reschedule/payments 逐一測過）＋ **欄位層級**驗證（直接檢查 kitchen 角色 API 回傳的 JSON keys，確認沒有 phone/lineUserId/金額欄位，不是只測路由擋不擋）＋ 正式站3筆真實會員的 row identity 與 FK 關聯在 migration 後逐筆核對（不只筆數）。

---

## 4. Job 排程（第4節）

| 案例 | 狀態 | 證據 |
|---|---|---|
| JB01 自動排程兩次執行 | **E2E_VERIFIED** | 正式站 `farm_job_runs` 表真實記錄：兩次自動觸發 `2026-09-19T01:13:32.854Z` 與 `2026-09-19T01:14:44.067Z`（間隔約72秒，Cloudflare 排程非精確到毫秒但明顯是無人觸發的自動執行），`reminders`／`sales-sync` 兩個 job 都在同一輪觸發、都在1秒內完成。驗證過程中抓到一個真實標記錯誤：手動測試端點 `/trigger-now` 原本也把自己標成 `trigger_source=cron`，跟真正的自動排程無法區分；已修正為標 `manual`，清空舊資料重新驗證後才拿到上述乾淨證據。 |
| JB02 job無/錯secret | **E2E_VERIFIED** | 正式站 curl 驗證：缺 header 或錯誤 secret 一律 401，且是這支路由自己的驗證邏輯在擋（不是被 middleware 導去 `/login`——這是驗證過程中發現並修好的第二個真實 bug：`/api/jobs/*` 原本會被全站的登入檢查攔截，導致這支路由的 JOB_SECRET 驗證邏輯從寫出來那天起從未真正被呼叫到）。 |
| JB03 並發job/crash | **IMPLEMENTED**，本機D1驗證，**未在正式站故意製造並發情境** | 本機直接操作 lease 欄位驗證兩個方向：(1) 手動把一列的 `leased_until` 設到未來 → 該列正確被下一次呼叫排除在外；(2) 把同一列的 `leased_until` 設到過去（模擬crash後過期）→ 下一次呼叫正確重新撿起處理。這是決定性測試（deterministic），比單純同時發兩個請求靠競速時機更可靠。 |
| 告警門檻 | **IMPLEMENTED**，計算邏輯已完成並在 `/api/farm/admin/job-status` 回傳 | heartbeat超過5分鐘未執行、積壓超過10分鐘、憑證錯誤、有dead-letter，四種告警狀態都已算好且在後台「排程與同步狀態」面板顯示。**告警「通知」本身（推播給人）沒有做**——因為唯一現成的推播管道是 LINE，而 LINE 憑證本身還沒設定（見第2節），這是連鎖阻塞，不是獨立缺工。目前只能靠人工去看後台面板。 |
| 6次重試定義 | **IMPLEMENTED** | 明確是「第1次失敗 + 最多5次重試 = 總共6次嘗試後永久失敗」，`MAX_SEND_ATTEMPTS=6`，程式與此文件用詞一致。 |

新增獨立 Worker：`farm-booking-cron`（本地 `C:\Users\cowle\dev\farm-booking-cron`，已部署至 `https://farm-booking-cron.clement0428.workers.dev`，Cloudflare Cron Trigger `* * * * *`）。原因：opennextjs-cloudflare 產生的主要 Worker 只有 `fetch`、沒有 `scheduled` handler，目前沒有官方支援的方式在產生的 bundle 上加 cron handler；這是沿用 Cloudflare 官方 Cron Trigger 機制的最小專用觸發器，不是另一套自建排程。**只有本地 git commit，未推上任何遠端**（目前沒有為它建立 GitHub repo）。

---

## 5. 週五六日特別配色

**IMPLEMENTED, DEPLOYED, 已截圖供審查**（正式站 headless browser 截圖，見對話紀錄）。只加在 available／has_group 狀態，額滿/未開放的鎖定灰色樣式完全不受影響。**沒有**自動把週末預約改成待審查或不占位——這個決定仍待 Clement 澄清（是「設計待審查」還是「週末預約需人工審核」），目前系統保持原有行為不變。

**驗證過程中發現一個既有缺口，本輪沒有動它**：`isAllowedBookingSlot()` 目前寫死只允許週二三四的時段通過公開查詢 API，代表就算管理員手動開一個週末時段，客戶端也完全看不到——「農場開放專屬時段」這條動線目前是不通的。這跟配色無關，是容量/開放規則的既有邏輯，需要 Clement 決定是否要做。

---

## 6. 付款金流準備清單（第8節）

**現況（已確認的程式碼層）：**
- `PaymentProvider` 介面已經設計好（`src/lib/farm/payments.ts`），涵蓋 createCheckout／webhook驗簽解析／查詢／退款，LINE Pay 與信用卡都走同一份介面。
- `NotConfiguredPaymentProvider` 是安全的預設實作：任何呼叫一律拋錯，`/api/farm/checkout` 接住後回傳 `503` + `charged:false`，已在正式站 curl 驗證，不會假裝扣款成功。

**尚未確認、需要 Clement 提供的資訊（無法從程式碼推導）：**
1. WeGrow 目前商業上簽的是哪家金流／LINE Pay 商戶（若有）？「Oen 平台有收款」不等於這個獨立的 farm-booking 網站能直接沿用同一組商戶 API 憑證——這兩者通常是分開的商戶申請。
2. 若尚未申請：LINE Pay／信用卡收單行的商戶申請通常需要網站上已有「退款政策」「隱私權政策」「聯絡資訊」等頁面作為審核材料——**目前 booking.wegrow-orbit.com 沒有這些頁面**，需要先補上才能送件申請。
3. 測試（sandbox）與正式的 callback／webhook 網址需要先定案（例如 `https://booking.wegrow-orbit.com/api/farm/checkout/callback`，目前未實作）。
4. 簽章驗證方式依各金流商官方文件而定（LINE Pay 用 HMAC-SHA256 簽名、信用卡收單行各家不同），需要拿到商戶密鑰後才能實作 `verifyAndParseCallback`。
5. 對帳設計：目前沒有任何「金流訂單」與「farm_bookings」的對帳報表，需要先定義對帳頻率（即時／每日）與比對欄位。

**本輪未做，因為沒有這些前提就無法產生真實可用的程式碼**：sandbox下單/失敗/退款/重複通知測試（沒有商戶就沒有sandbox可測）；LINE Pay／信用卡實際串接程式碼（`PaymentProvider` 介面已就緒，等有真實憑證即可實作一個新的 class，不需要改動呼叫端）。

---

## 7. 真機驗收（UI02）

**BLOCKED**——跟先前回報一致，沒有變化：需要 Clement 指定的真實 LINE 好友帳號＋實體 iPhone／Android，且 LINE 正向登入本身也卡在第2節的 Messaging API 憑證核對（雖然 UI02 測的是 LIFF Login channel 而非 Messaging API channel，兩者是分開的，LIFF 登入理論上可以獨立驗證——但仍需要一支真機與一個真實好友帳號，不是我能自己完成的）。

---

## 8. 給 Clement 的總表

| 項目 | 現在能用嗎 | 還缺什麼 | 誰要做 |
|---|---|---|---|
| 週末配色 | ✅ 已上線 | 無 | — |
| 收款/素食/角色 | ✅ 已上線 | 無 | — |
| Job 自動排程 | ✅ 已上線且真的在跑 | 無 | — |
| LINE 提醒排隊/重試邏輯 | ✅ 已上線 | 缺 Messaging API 憑證才能真的送出 | Clement：LINE Developers Console 申請憑證 |
| Sales 同步（farm-booking端） | ✅ 已上線 | 無 | — |
| Sales 同步（接收端） | ⛔ 未部署 | 需 push commit＋設定 secret＋手動 dispatch workflow | Clement：見第1節4個步驟 |
| 線上刷卡/LINE Pay | ⛔ 未啟用（設計已就緒） | 需先確認商戶＋補網站政策頁面 | Clement：見第6節 |
| 真機驗收 | ⛔ 未做 | 需真機＋測試帳號 | Clement：提供測試帳號與真機 |

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

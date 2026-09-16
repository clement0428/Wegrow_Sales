# WeGrow 農場預約正式部署證據（2026-09-16）

## 正式入口

- 正式 HTTPS：https://booking.wegrow-orbit.com/
- LINE LIFF：https://liff.line.me/2011633158-ZdAj8eJh
- LINE Provider：WeGrow 威果農業（Provider ID `2005546174`）
- LINE Login Channel：WeGrow 農場預約（Channel ID `2011633158`）
- LIFF App：WeGrow 農場參訪預約（LIFF ID `2011633158-ZdAj8eJh`）
- Cloudflare Worker：`wegrow-farm-booking`
- Worker Version ID：`99a984c1-daaa-438c-8a0c-03dbdd9ddbaf`
- Cloudflare D1：`wegrow-farm-booking-prod`
- D1 Database ID：`4f40a0e0-e5bb-4de0-93ad-91ad3b32dfc7`
- QR Code：`qa/wegrow-farm-booking-production-qr.png`（內容為 LIFF URL）

## 正式環境查核

- `booking.wegrow-orbit.com`：HTTP 200，標題為「WeGrow 威果農場｜參訪預約」。
- 場次 API：`mode=live`、`source=d1_farm_slots`，讀到 4 個農場場次。
- LINE 驗證 API：無效 ID token 回傳 401，未因缺少正式環境設定而 500。
- LIFF URL 實際導向 `https://booking.wegrow-orbit.com/`，頁面、Logo、科技溫室照片、方案試算與正式 D1 場次均載入。
- 生產環境沒有 `DEV_FAKE_LOGIN`；`LINE_CHANNEL_ID` 與 `SESSION_SECRET` 使用 Cloudflare secrets，沒有寫入 Git 或本報告。

## LINE 官方帳號

- 官方帳號：`@647hlrhw`
- 圖文選單：`WeGrow 官方圖文選單 20260916`（ID `20215954`）
- Manager 顯示此選單為「目前顯示的選單」。
- A 區「預約農場參訪」已從舊 Workers.dev 網址改為 `https://liff.line.me/2011633158-ZdAj8eJh`。
- B 至 F 的既有動作保持不變。
- 後台畫面證據：`qa/line-rich-menu-liff-linked.png`。

## 功能與資料

- LIFF 初始化後以 LINE ID token 向後端驗證，建立安全的 HttpOnly session。
- 已登入 LINE 的新預約會寫入 `customer_member_id`。
- 「我的預約」可依 LINE member ID 自動列出本人預約。
- 未登入 LINE 時仍保留手機號碼加 8 碼查詢碼的備援流程。
- 付款維持停用，畫面與 API 均明確顯示「尚未開放付款」，不會產生假付款成功。

## 自動驗收

- Vitest：11 個測試檔、66 項全部通過。
- TypeScript：`tsc --noEmit` 通過。
- Next.js production build：通過。
- OpenNext Cloudflare build／deploy：通過。
- 正式網址 Playwright E2E：
  - 390px 手機建立與查詢預約：PASS
  - 1440px 桌面與後台權限邊界：PASS
  - 360／430／650／768／1024px 無水平溢出：PASS
  - `/booking`、`/my-bookings`、`/visit-info`、`/contact`：PASS
  - D1 場次 API：PASS
  - 未設定付款必須回傳阻擋：PASS
  - ICS 行事曆：PASS
- E2E 建立的測試預約已刪除，電話 `0912345678` 的剩餘測試列為 0。
- 證據：`qa/e2e-result.json`、`qa/farm-mobile-home.png`、`qa/farm-mobile-booking-created.png`、`qa/farm-mobile-booking-lookup.png`。

## 尚待真機驗收

- 可控瀏覽器已證明 LIFF URL 與正式端點相連，但它不是手機 LINE App，不能冒稱已完成「LINE App 內本人身分」真機驗收。
- 唯一剩餘人工驗收：用手機開啟 `@647hlrhw`，點「預約農場參訪」，確認頁首顯示「LINE 已連結：姓名」，建立一筆預約後到「我的預約」看到同一筆。
- LINE Pay／信用卡、取消後釋放名額、前一天訊息提醒與外部 Google Calendar 寫入仍未開放；目前只有安全的付款阻擋與 ICS 下載能力。

# WeGrow 農場預約正式部署證據（2026-09-16）

## 正式入口

- HTTPS：<https://wegrow-farm-booking.clement0428.workers.dev>
- Cloudflare Worker：`wegrow-farm-booking`
- Worker Version ID：`d9f09756-4c95-4112-881f-98292d8fedee`
- Cloudflare D1：`wegrow-farm-booking-prod`
- D1 Database ID：`4f40a0e0-e5bb-4de0-93ad-91ad3b32dfc7`
- 已套用 migration：`0001` 至 `0007`
- 手機 QR Code：`qa/wegrow-farm-booking-production-qr.png`

## 正式環境實測

- 手機建立預約並以手機號碼＋8 碼查詢碼查回：PASS
- 桌面版面及正式環境管理頁權限邊界：PASS
- 360、430、650、768、1024、1440 px 響應式：PASS
- LINE 穩定入口路由：PASS
- D1 開放日期／容量 API：PASS（`mode=live`、`source=d1_farm_slots`）
- 付款安全邊界：PASS（固定顯示「尚未開放付款」，不建立假付款）
- 行事曆 ICS：PASS
- 冪等：同一 `idempotencyKey` 第一次回 201，第二次回 200、`duplicate=true`，且為同一預約。
- 併發容量：同時送出兩筆 30 人預約，僅一筆成功；另一筆回 409 `capacity_changed`。
- 測試資料清理：正式 D1 中測試預約剩餘筆數為 0。

自動化結果：`qa/e2e-result.json`。手機建立與查詢畫面：`qa/farm-mobile-booking-created.png`、`qa/farm-mobile-booking-lookup.png`。

## LINE 官方帳號

- 帳號：`@647hlrhw`
- 圖文選單：`WeGrow 官方圖文選單 20260916`（ID `20215954`）
- LINE Official Account Manager 回讀狀態：列於「目前顯示的選單」。
- A 區「預約農場參訪」已由舊靜態 QA 頁改為正式 Cloudflare HTTPS 入口：
  `https://wegrow-farm-booking.clement0428.workers.dev`
- B 至 F 原動作保持不變。

## 尚未宣告完成

- LINE Pay 與信用卡尚未串接，頁面明確標示「尚未開放付款」。
- LIFF ID 尚未設定；目前從圖文選單開啟一般 HTTPS 預約頁。
- 前一天 LINE/Gmail 提醒及顧客 Google Calendar 寫入尚未完成真實外部串接。
- 場次目前已存於 D1，但農場人員可視化新增／關閉場次的正式管理介面仍待完成。
- 價格在正式核准前仍標示為參考，不能視為已啟用正式收款報價。

## 驗收界線

本輪可宣告：手機可從官方 LINE 圖文選單進入正式 HTTPS 頁，讀取 D1 開放場次、選人數、試算門票／盆栽／餐飲、送出不收款的預約申請，並查回該預約。不可宣告：正式收款、真實提醒、LIFF 身分綁定或完整後台營運已完成。

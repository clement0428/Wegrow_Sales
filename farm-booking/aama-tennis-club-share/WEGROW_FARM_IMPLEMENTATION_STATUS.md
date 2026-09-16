# WeGrow LINE 農場預約系統｜實作狀態

## 已完成

- 從 AAMA 球場專案隔離建立農場版，不修改原 ZIP。
- 2026-09-16 依 VIS 重做顧客端：主黃 `#E2CF35`、冷灰 `#808080` 與白色；移除深綠宣傳頁與顧客頁的管理入口。
- 首屏直接提供體驗、日期及人數選擇；固定底部入口為「預約來訪／我的預約／行前資訊／聯繫農夫」。
- WeGrow 手機優先客戶端：人數、時段、聯絡資料、LINE Pay／信用卡選擇與確認。
- 動態容量規則：1 團總上限 50、2 團總上限 30、3 團總上限 15。
- 依來訪總人數篩選時段，顯示「可新增一團，該團最多 X 人」。
- 預約與付款狀態分離，取消申請未核准前仍占名額。
- D1 migration：容量、活動、時段、票種、訂單、付款事件、通知 outbox、日曆同步與稽核紀錄。
- LINE Pay／信用卡 `PaymentProvider` adapter 與未設定時的阻擋回應。
- 前一天 Asia/Taipei 18:00 提醒時間、版本化去重鍵。
- 客戶 ICS 下載端點。
- 管理後台：接待日曆、預約訂單、容量規則與待核定設定。
- 開發模式醒目顯示，不假裝真實扣款、LINE 通知或 Google Calendar 已串接。
- 預約日期改由 `/api/farm/availability` 提供農場已建立的開放場次，顧客不能自行填一個「希望日期」冒充可預約日期。
- 新增穩定客戶入口：`/booking`、`/my-bookings`、`/visit-info`、`/contact`，供 LINE 圖文選單日後核准後綁定。
- 採用目前核定的試算規則：門票 NT$300／人、盆栽 NT$250／盆、餐飲 NT$350／人；門票可折抵同日現場選購，折抵不超過加購小計。
- 價格、時段與付款均有載入、錯誤、無場次及未設定供應商狀態；不再建立假成功訂單。

## 最新驗證

- `npm test`：11 個測試檔、66 項測試通過。
- `npm run build`：Next.js production build 通過。
- 新增程式範圍 ESLint：通過。
- Production-mode E2E：手機完整預約流程、四個固定入口、桌面與 360–1024px 響應式、正式環境管理權限、availability API、金流未設定阻擋及 ICS 全部通過。
- 本機預覽：http://localhost:3217/
- GitHub Pages HTTPS 驗收站：發布後使用 `outputs/line-farm-booking-qa/`。

## 外部 BLOCKED

- WeGrow LINE Login／LIFF／Messaging API 正式設定與憑證。
- LINE Pay 商家 sandbox／正式憑證。
- 信用卡收單商選定及 sandbox／正式憑證。
- 農場 Google Calendar 授權。
- 正式 D1、部署網域及 Cloudflare 帳號設定。
- 正式地址、電話、服務時間、雨天、取消與退款政策。
- 票券折抵的持久核銷紀錄、使用期限、適用品項、退票撤銷與財務對帳規則。
- Sales 事件同步端點與 production login。

## 重要限制

- 畫面內場次是明確標示的隔離預覽資料，不是農場正式開放日期。
- 金流未設定時結帳會停止並顯示原因，不扣款、不占正式名額、不送 LINE。
- 正式上線前必須完成 sandbox 金流成功／失敗／中斷／回調重送與退款驗收。
- 本輪未獲授權修改 LINE 商業簡介、發布圖文選單或對外部署。

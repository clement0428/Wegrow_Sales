# WeGrow LINE 農場預約修復結果

日期：2026-09-16

## 結論

已完成可操作的本機審查版本，但未發布到 WeGrow 官方 LINE，也未宣稱正式金流、LIFF、提醒或 Sales 同步完成。正式發布仍需 Clement 核准預覽與提供外部服務設定。

## 可審查入口

- 本機預覽：http://localhost:3217/
- 正式建置驗證：http://localhost:3218/（僅本機 E2E 使用）
- 預約參訪：`/booking`
- 我的預約：`/my-bookings`
- 交通與須知：`/visit-info`
- 聯絡農場：`/contact`
- 當季果物：https://wegrow.oen.tw/
- HTTPS 驗收站：`https://wegrow-orbit.com/Wegrow_Sales/outputs/line-farm-booking-qa/`（推送後由既有 GitHub Pages 發布）
- 正式預約後端網址：尚未部署；驗收站不收款、不占正式名額

## 本輪實作

1. 預約日期改為讀取農場建立的 availability，不再讓客戶輸入希望日期。
2. 顯示預覽資料來源與未發布邊界；載入失敗、無場次、超額與網路錯誤均有明確狀態。
3. 試算規則為門票 NT$300／人、盆栽 NT$250／盆、餐飲 NT$350／人；門票抵同日現場選購，最高不超過加購小計。
4. 結帳送往 `/api/farm/checkout`；LINE Pay／信用卡未配置時阻擋，不建立假成功訂單。
5. 新增四個穩定客戶路由，並保留顧客頁與管理頁的權限邊界。

## LINE 圖文選單待核准映射

|格|名稱|核准後動作|
|---|---|---|
|A|預約參訪|公開 HTTPS `/booking`|
|B|我的預約|公開 HTTPS `/my-bookings`，正式版需 LIFF 身分驗證|
|C|交通與須知|公開 HTTPS `/visit-info`|
|D|當季果物|`https://wegrow.oen.tw/`|
|E|企業合作|尚缺核准的公開合作頁，不得使用 `#admin`|
|F|聯絡農場|公開 HTTPS `/contact` 或 LINE 一對一客服|

本輪沒有修改 LINE Manager、API default rich menu 或 per-user rich menu。

## 驗證證據

- ESLint（本輪新增範圍）：PASS。
- Vitest：11 個測試檔、66 項 PASS。
- Next.js production build：PASS。
- Production-mode E2E：7 組 PASS。
- E2E 結果：`qa/e2e-result.json`
- 手機截圖：`qa/farm-mobile-home.png`、`qa/farm-mobile-payment-blocked.png`

## E01-E16 驗收狀態

|ID|狀態|證據或缺口|
|---|---|---|
|E01|BLOCKED|尚無核准的公開 HTTPS 網址，未改正式 LINE 首頁。|
|E02|BLOCKED|未獲授權修改 LINE 圖文選單，亦未核對 API／per-user 覆蓋。|
|E03|VERIFIED|匿名本機預覽可用，顧客頁不顯示 CRM 或管理入口。|
|E04|BLOCKED|缺正式 LIFF ID、LINE Login channel 與 HTTPS callback。|
|E05|VERIFIED|`tests/farm/capacity.test.ts` 與 `booking-operations.test.ts` 覆蓋 1 團 50、2 團 30、3 團 15，以及新增團體使上限下降的情況。|
|E06|PARTIAL|原子帳本模擬兩筆同時搶位，只允許一筆成功；正式 D1 transaction 與供應商防重扣仍待驗收。|
|E07|BLOCKED|LINE Pay 與信用卡商家 sandbox 憑證未配置。|
|E08|PARTIAL|未設定供應商時會阻擋；遲到回調與對帳待 sandbox。|
|E09|PARTIAL|顧客與管理路由分離；本人訂單仍需 LIFF 身分串接。|
|E10|PARTIAL|前一天 18:00 Asia/Taipei、改期版本去重與未確認不排提醒已有測試；真實 LINE 發送未配置。|
|E11|BLOCKED|折抵試算已完成，持久核銷、撤銷與財務對帳尚未實作。|
|E12|PARTIAL|模擬事件有穩定 eventId 且取消建立新版本；缺 Sales production ingest／login，尚未做真實重播驗收。|
|E13|VERIFIED|360–1024px E2E 通過，無橫向溢出與主要操作遮擋。|
|E14|PARTIAL|正式建置匿名本機驗證通過；公開網址尚未部署。|
|E15|VERIFIED|所有日期均標示 preview seed，金流未配置不顯示付款成功。|
|E16|BLOCKED|尚未公開部署，無正式選單版本與 rollback 證據。|

## 外部阻擋

- LIFF、LINE Login、Messaging API 與 rich menu 治理來源。
- LINE Pay 商家 sandbox／production 憑證。
- 信用卡收單商及 sandbox／production 憑證。
- Google Calendar 授權。
- 正式 D1、部署網域及 Cloudflare 設定。
- 核准的地址、電話、服務時間、退改／雨天／折抵政策與企業合作公開入口。
- Sales production 同步端點與登入權限。

## BLOCKED 設定查核與解除方式

|項目|已檢查位置|確切缺少|解除方式|需要 Clement|
|---|---|---|---|---|
|Cloudflare Workers／D1|本機 `wrangler whoami`、`wrangler.jsonc`、`DEPLOY.md`|Wrangler 登入已過期；D1 ID 仍是佔位值；設定仍沿用球場名稱|重新完成 `wrangler login` 後，由 Codex 建立 WeGrow QA Worker／D1、寫回非秘密 ID、migration、deploy|是，只需在 Cloudflare 授權頁按 Allow|
|Vercel 備援|本機 `vercel whoami`|儲存登入已失效，沒有 `VERCEL_TOKEN`|完成 `vercel login` 後可由 Codex部署；目前不需兩套平台並行|否，Cloudflare 授權後可不做|
|LINE LIFF／Login|`.env.example`、`wrangler.jsonc`、LINE 開發需求|沒有 WeGrow LIFF ID、Login Channel ID／callback 已核對證據|在既有 WeGrow provider 建立或確認 LIFF，將公開 ID 寫入 vars，secret 用 Worker secret|是，若既有 LINE 開發後台未授權給 CLI，需提供非秘密 Channel／LIFF ID 或完成後台操作|
|LINE Messaging／提醒|`/api/jobs/reminders`、D1 outbox schema|Messaging channel token 未配置|以 Worker secret 設定 token，執行 sandbox push、封鎖與重試測試|是，需要在 LINE 後台核發 token；不得貼入報告或 Git|
|LINE Pay|`payments.ts`、checkout API、環境變數名稱|商家 sandbox channel ID／secret 未配置|取得 sandbox 商家憑證後存 Worker secrets，補 callback 查核與退款測試|是，需要 LINE Pay 商家 sandbox 資格|
|信用卡|PaymentProvider 契約、checkout API|尚未選定收單商，無 merchant／sandbox 憑證|先選收單商，再實作 adapter 並把憑證放 Worker secrets|是，需要選定收單商並取得 sandbox 帳號|
|Google Calendar|`farm_calendar_sync` schema、ICS route|無 OAuth client／refresh token／calendar ID|可先使用 ICS；要伺服器同步則建立 OAuth client 並以 secret 保存 token|是，只有需要伺服器自動同步時才要授權|
|Sales 回寫|事件格式測試、Sales 專案現有 production login|沒有正式 ingest URL／服務憑證的可用證據|確認既有 ingest API 後以穩定 eventId 寫入，重播驗證不重複|可能，需要提供或核准服務帳號；若既有部署已有可沿用憑證則不需|
|正式政策|預約規格與目前 UI|地址、電話、服務時間、雨天、退改、折抵期限／品項未核准|後台設定後重新產生政策快照；未核准前不公開成承諾|是，需一次核定營運政策|

密鑰只進 Cloudflare／部署平台 secret store，不寫入報告、Git、畫面或測試附件。

## 模擬驗證與真實串接邊界

|流程|模擬／本機證據|真實串接證據|
|---|---|---|
|付款|未配置時回 503、`charged:false`；訂單金額不一致會拒絕|待 LINE Pay／信用卡 sandbox|
|取消與名額|確認訂單取消後釋放容量，替代 50 人團可成功|待正式 D1 transaction|
|前一天提醒|時間、版本化 retry key、未確認不排程均通過|待 LINE Messaging sandbox|
|行事曆|ICS 含 Asia/Taipei、正確中文與唯一 booking UID|ICS 可下載；Google Calendar 伺服器同步待 OAuth|
|Sales 回寫|held／confirmed／cancelled 事件有穩定 ID，重複 ID 去重|待 production ingest 與登入|

## 發布底線

正式發布前必須以手機從官方帳號逐格點擊，完成匿名與 LINE 內瀏覽器、本人查單、兩種金流 sandbox、付款中斷／偽造回跳、提醒、折抵與 Sales 同步驗收。未通過前僅能稱為「本機預覽完成」。

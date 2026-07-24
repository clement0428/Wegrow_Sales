# WeGrow Sales V0 Website 開發交接文件

版本：2026-07-24
狀態：本機 V0 已可跑，尚未部署到 `sales.wegrow-orbit.com`
核心原則：台灣先賣得動、V0 唯讀、商譯 AI 主導銷售循環

## 1. 目前成果

已完成一個靜態版 WeGrow Sales V0 dashboard，位置：

`outputs/wegrow_sales_v0/`

本機測試網址：

`http://127.0.0.1:8787/`

目前 V0.4 畫面已依 Clement 修正，改成「兩個大工作區 + 區內小分類 tab」。

設計概念：

1. 左側只保留兩個大項，代表兩條銷售戰線，不再拆成一堆互相搶注意力的小頁。
2. 每個大項內部保留 Orbit 式橫向小 tab，讓 Clement 可以快速跳到分類，不用一直滾動畫面。
3. 小 tab 是定位錨點，不是新產品模組；新增小 tab 前要先判斷它是否能推進銷售。
4. 版型參考 `wegrow-orbit.com` 的操作系統概念：灰色頂欄、黃色左側模組列、上方情境選擇列、橫向功能 tab、白色工作區。

左側大項：

1. 銷售作戰台：每天推進台灣草莓銷售、內容發布、留言名單、B2B Gate、證據包與商譯覆盤。
2. 農業黑客松 / 認養農場：針對想體驗、承租、企業認養、通路聯名 pilot 的客戶，管理客戶類型、Offer 階梯、成交前必問問題、認養證據 Gate 與下一步。

銷售作戰台小 tab：

1. 今日作業。
2. 內容發布。
3. 留言名單。
4. 買家 Gate。
5. 證據包。
6. 商譯覆盤。
7. 系統限制。

農業黑客松 / 認養農場小 tab：

1. 認養指北針。
2. 客戶類型。
3. Offer 階梯。
4. 必問問題。
5. 證據 Gate。
6. 下一步。

首屏摘要保留五個 widget：

1. 今日 3 件事。
2. 待回 / 未整理紀錄。
3. 最高優先動作。
4. 商譯阻塞。
5. 缺證據。

## 1.1 入口分權

目前沒有做登入權限，V0 先做操作分權與入口分流。

| 入口 | URL / File | 使用者 | 用途 |
| --- | --- | --- | --- |
| 總入口 | `start.html` | Clement / 行銷 / Agent | 分流到 Sales V0、發布作戰台、素材、帳密、交接文件 |
| 每日銷售作戰桌 | `http://127.0.0.1:8787/` | Clement | 兩個大工作區：銷售作戰台、農業黑客松 / 認養農場；區內用小 tab 快速定位 |
| 檔案備援 | `outputs/wegrow_sales_v0/index.html` | 開發者 | 只作檔案檢視；直接用 `file://` 開可能讀不到 JSON |
| 發布作戰台 | `start.html#publish` | 行銷 / Codex | 填 EP1 影片、標題、描述、CTA、產生 manifest |
| 開發交接 | `outputs/wegrow_sales_v0/WEGROW_SALES_V0_WEBSITE_DEV_HANDOFF.md` | Codex / Claude | 接手前必讀，不要重做 |

連結關係：

- `start.html` hero 區有三個角色入口。
- `start.html` 策略區有 Sales V0 local server 與 file fallback 兩張卡。
- Sales V0 右上角有「回總入口」連回 `start.html`。

## 2. 檔案結構

| File | 用途 | 狀態 |
| --- | --- | --- |
| `index.html` | Dashboard 主頁、兩個大工作區、區內小 tab 錨點 | 已重建乾淨版 |
| `style.css` | Orbit 式灰色頂欄、黃色側邊欄、首屏五卡、區內小 tab、表格與商譯區樣式 | 已重建乾淨版 |
| `app.js` | 讀取 JSON、切換大工作區、區內小 tab 跳轉、勾選今日任務、更新進度條 | 已通過 syntax check |
| `sales_dashboard_data.json` | V0 手動資料源 | 已通過 JSON parse |
| `design_options/SALES_V0_TAB_ARCHITECTURE_A_PLUS_C.md` | A+C 融合版 Tab 架構與 CRM 功能建議 | 已完成 |
| `qa-desktop-shangyi.png` | 商譯版 QA 截圖 | 已產生 |
| `DEPLOY_WEGROW_SALES_V0_TO_SALES_ORBIT_v0_1.md` | 部署交接文件 | 已完成 |

## 3. 重要修正紀錄

Claude 原始產出的四個檔案不能直接使用，原因：

1. `index.html` 中文亂碼。
2. `app.js` 有字串斷裂。
3. `sales_dashboard_data.json` 有亂碼與字串斷裂。
4. 雖然宣稱測過，但實際檢查不可直接信任。

Codex 已重新建立乾淨版本，請後續開發以目前 `outputs/wegrow_sales_v0/` 內最新版為準。

## 4. 命名與產品定位

原本頁面有 `PDCA`，已改名為：

`商譯`

商譯定位：

像耕譯一樣，由 AI 主動觀察市場訊號、判斷銷售瓶頸、指定下一步行動、追問缺資料。

商譯四段式：

| 模組 | 目的 |
| --- | --- |
| 觀察 | 看 EP1 是否發布、留言是否出現購買意圖、B2B Gate 是否卡住、證據包是否缺資料 |
| 判斷 | 把留言、名單、買家 gate、缺證據翻成銷售瓶頸 |
| 行動 | 指定今天最多三件事 |
| 追問 | 主動問 Clement 缺什麼資料才能往下一步 |

後續不得再把這個區塊叫 `PDCA`。

## 5. V0 功能限制

V0 只做唯讀 dashboard，不做以下功能：

1. 不接 Notion API。
2. 不做自動發布。
3. 不寫入正式 CRM。
4. 不做登入與角色權限。
5. 不把 WeGrow Orbit 農場管理功能搬進來。

V0 目標不是漂亮，而是讓 Clement 每天知道最該做哪三件事，優先推進台灣草莓銷售。

## 5.1 10 個銷售系統功能映射

V0.4 不把 10 個功能拆成 10 個主分頁，而是收斂到兩個大工作區內。原因：Clement 每天要快速做事，不需要被功能名稱拉走注意力。

| 功能 | V0.4 對應 | 目的 |
| --- | --- | --- |
| Activity Timeline | 銷售作戰台 / 留言名單；V1 再擴成完整紀錄流 | 所有客戶、競品、新聞、市場訊息先進同一條事件流 |
| Next Best Action | 銷售作戰台 / 今日作業 + 商譯行動 | AI 每天只推三件最該做的事 |
| Lead / Account Pipeline | 銷售作戰台 / 買家 Gate；認養農場 / 客戶類型 | 先分清楚通路買家與認養客戶 |
| Evidence Gate | 銷售作戰台 / 證據包；認養農場 / 證據 Gate | 防止沒有規格、檢驗、產量、方案邊界就對外承諾 |
| Content Calendar | 銷售作戰台 / 內容發布 | EP 影片、發布、查證、收單節奏可見 |
| Scenario Planning | 認養農場 / Offer 階梯；V1 再做試算 | 比較等待名單、體驗日、家庭認養、企業認養 |
| Conversation Intelligence | 銷售作戰台 / 留言名單；V1 再接 LINE / Email | 有真實留言後才做自動分類 |
| Forecast View | V1 再接真實產量、成本、訂單後做預估 | V0 不編假 forecast |
| Automation Guardrail | 商譯追問 + 系統限制 | 缺資料時不硬做假自動化 |
| Role-based Workspace | start.html 分流 + 兩個大工作區 | V0 先做入口分工，V1/V2 再做登入權限 |

## 6. 本機啟動方式

在 PowerShell 執行：

```powershell
cd "C:\Users\cowle\OneDrive\文件\Wegrow_Sales\outputs\wegrow_sales_v0"
python -m http.server 8787 --bind 127.0.0.1
```

然後打開：

`http://127.0.0.1:8787/`

如果直接雙擊 `index.html`，瀏覽器可能因為本機 `fetch()` 限制而讀不到 `sales_dashboard_data.json`，所以建議用本機伺服器。

## 7. 已驗證項目

已完成：

1. `app.js` 通過 Node syntax check。
2. `sales_dashboard_data.json` 可解析。
3. `outputs/wegrow_sales_v0/` 亂碼掃描通過。
4. Edge headless 已產生畫面截圖。
5. `PDCA/pdca` 已從 V0 dashboard 檔案移除。
6. `start.html` 已新增 Sales V0 Dashboard 入口。
7. 左側已收斂為兩個大工作區，區內小 tab 可跳到對應分類。

QA 截圖：

`outputs/wegrow_sales_v0/qa-desktop-shangyi.png`

最新兩工作區截圖：

`outputs/wegrow_sales_v0/qa-sales-v0-two-big-tabs-v5-fixed.png`

`outputs/wegrow_sales_v0/qa-sales-v0-adoption-tab-v5.png`

Orbit 式骨架截圖：

`outputs/wegrow_sales_v0/qa-sales-v0-orbit-shell-sales.png`

`outputs/wegrow_sales_v0/qa-sales-v0-orbit-shell-adoption.png`

## 8. 目前資料內容

目前 `sales_dashboard_data.json` 是手動 seed data。

核心資料：

| 區塊 | 目前內容 |
| --- | --- |
| 今日 3 件事 | 確認 EP1、補產季量、查 Carrefour 台灣 |
| 待回留言 | 尚無真實留言資料 |
| B2B Gate | Carrefour 台灣、City'Super、Isetan Mitsukoshi 皆為 G0 |
| 發布佇列 | EP1 製作中 |
| 缺證據 | 產季量、B2C 收單、單盒規格、檢驗 claim、冷鏈 SOP |
| 商譯 | 觀察、判斷、行動、追問 |

價格 benchmark 已補一版 Codex 修正：

`outputs/sales_strategy_agents/CODEX_RESPONSE_TO_CLAUDE_PRICE_BENCHMARK_v0_1.md`

目前可用對標是台灣大湖高端草莓 1kg 約 NT$950-1,300；但 WeGrow 售價仍不能定，因為缺 Clement 的產季量、每週可售盒數、成本、包材與冷鏈成本。

## 9. 目前真正卡住的事

不是 UI 卡住，而是資料與銷售流程卡住：

1. Clement 尚未提供草莓產季與週產量 range。
2. 尚未確認 B2C 收單入口：LINE、Google 表單、網站表單或其他。
3. 尚未確認 EP1 是否有最終影片檔。
4. 尚未有真實留言 / 私訊資料。
5. 尚未找到 Carrefour 台灣、City'Super、Isetan 的具名採購窗口。

在這些補齊前，EP3 不能正式預購，只能做等待名單。

## 10. 部署判斷

目前不能宣稱已部署到：

`https://sales.wegrow-orbit.com/`

原因：

1. 尚未確認 `Wegrow_Sales` GitHub repo 是否就是該網域來源。
2. 尚未確認 GitHub Pages / DNS / hosting provider。
3. 尚未做正式網域驗證。

若 `Wegrow_Sales` repo 是正式來源，最小部署路徑：

1. commit `outputs/wegrow_sales_v0/`。
2. commit `start.html` 入口更新。
3. push 到 GitHub。
4. 測試 `https://sales.wegrow-orbit.com/outputs/wegrow_sales_v0/`。
5. 若可開，再決定是否改成正式首頁入口。

## 11. 下一步開發建議

### V0.1

1. 在 `start.html` 增加更明顯的 Sales V0 入口。
2. 將 `sales_dashboard_data.json` 補上 Clement 實際填寫的產季量與收單入口。
3. 新增 `ep1_comment_log_v0_1.csv` 匯入顯示。
4. B2B Gate 表加入查證日期與下一步 deadline。

### V0.2

1. 把商譯區變成真正的 AI 行動建議卡。
2. 依留言類型自動產生「今天三件事」。
3. 增加等待名單 / 預購 CTA 狀態。
4. 增加台灣通路查證 checklist。

### V1

只有當 V0 手動資料連續使用 7 天仍有價值，才接：

1. Notion API。
2. LINE / 表單資料。
3. 社群平台成效。
4. 自動發布或半自動發布。

## 12. 給下一位 Agent 的硬規則

1. 不要重做命名，已定名 `商譯`。
2. 不要把 V0 做成全球買家研究工具，台灣先賣得動。
3. 不要承諾已部署 production，除非正式網域驗證完成。
4. 不要使用未驗證 claim，例如 100% 無毒、child-safe、荷蘭驗證、專利等，除非 Clement 提供證據並核准。
5. 不要把缺資料用假資料補滿，缺就是缺，交給商譯追問。
6. 不要 Clement 說加什麼就直接加什麼。每次新增或移除功能前，先用「商譯指北針」判斷：它是否能讓威果本週更接近真實留言、等待名單、買家 Gate 推進、發布完成或證據補齊。不能推進這五件事的功能，先不要放進 V0。
7. 不要再把左側拆回多個主分頁。左側只有兩個大工作區；需要快速分類時，在大工作區內加小 tab 錨點。
8. 不要把農業黑客松 / 認養農場和 B2B 通路採購混在同一張 pipeline。認養客戶看 Offer 階梯與交付 Gate；通路買家看 G0-G4 與證據包。

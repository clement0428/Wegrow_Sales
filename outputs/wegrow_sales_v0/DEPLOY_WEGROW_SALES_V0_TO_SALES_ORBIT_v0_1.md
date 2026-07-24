# 部署交接：WeGrow Sales V0 Dashboard 到 sales.wegrow-orbit.com

版本：2026-07-24
狀態：本機靜態頁已可跑，尚未確認正式網域部署權限。

## 1. 目前可用成果

V0 dashboard 位置：

`outputs/wegrow_sales_v0/`

檔案：

| File | 用途 |
| --- | --- |
| `index.html` | V0 dashboard 主頁 |
| `style.css` | 深色側邊欄與台灣銷售作戰桌樣式 |
| `app.js` | 讀取 JSON、切換分頁、今日作業單勾選與進度條 |
| `sales_dashboard_data.json` | V0 手動資料源 |

已驗證：

- `app.js` 通過 Node syntax check。
- `sales_dashboard_data.json` 可解析。
- 四個檔案已轉 UTF-8 BOM，Windows 讀取中文正常。
- 本機伺服器 `http://127.0.0.1:8787/` 可開。
- Edge headless 已產生 QA 截圖：`qa-desktop.png`。

## 2. V0 功能範圍

V0 是唯讀、手動資料、台灣銷售優先，不做以下功能：

- 不接 Notion API。
- 不做自動發布。
- 不做角色權限。
- 不做寫入正式 CRM。
- 不把 WeGrow Orbit 農場管理系統搬進來。

首屏只留五個 widget：

1. 今日 3 件事。
2. 待回留言。
3. B2B 買家 Gate。
4. 發布佇列。
5. 缺證據提醒。

另有「商譯」分頁，取代傳統週覆盤。商譯像耕譯一樣由 AI 主動觀察市場訊號、判斷銷售瓶頸、指定下一步行動、追問缺資料。

## 3. 部署選項

### Option A：如果 `Wegrow_Sales` repo 就是 `sales.wegrow-orbit.com` 的 GitHub Pages 來源

最省事做法：

1. 保留目前資料夾：`outputs/wegrow_sales_v0/`。
2. 推到 GitHub。
3. 測試 URL：
   `https://sales.wegrow-orbit.com/outputs/wegrow_sales_v0/`
4. 若確認可開，再把 `start.html` 或首頁加上正式入口。

### Option B：如果正式網站只允許根目錄入口

做法：

1. 新增根目錄入口檔，例如 `sales-v0.html`。
2. 讓它載入 `outputs/wegrow_sales_v0/` 的 CSS / JS / JSON。
3. 測試：
   `https://sales.wegrow-orbit.com/sales-v0.html`

### Option C：如果 `sales.wegrow-orbit.com` 是另一個主機或另一個 repo

需要 Clement 或 Codex 提供：

1. 該網域對應的 repo 或 hosting provider。
2. DNS / GitHub Pages / Cloudflare Pages / Vercel / Netlify 設定。
3. 部署權限或 CI token。

在沒有這些前，不能宣稱已部署到正式網域。

## 4. 不可部署舊版原因

Claude 原始版本不能直接部署，原因：

- `index.html` 中文顯示亂碼。
- `app.js` 有字串斷裂，實際上不是可靠可執行版本。
- `sales_dashboard_data.json` 有亂碼與字串斷裂，不能被 JSON parser 直接信任。

Codex 已重建乾淨版，部署時請使用目前資料夾內最新版四檔。

## 5. 下一步

Codex 下一步應做：

1. 確認 `Wegrow_Sales` GitHub Pages 是否就是 `sales.wegrow-orbit.com` 來源。
2. 若是，建立精準 commit，只包含 `outputs/wegrow_sales_v0/` 與 `start.html` 的入口更新。
3. 推送後用正式 URL 驗證。
4. 若不是，向 Clement 要正式 hosting / repo 權限，不猜。

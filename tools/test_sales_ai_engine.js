const assert = require("assert");
const { analyzeMeeting } = require("../outputs/wegrow_sales_v0/ai_engine.js");

const empty = analyzeMeeting({ customerName: "Mia Cbon 南紡店", note: "" });
assert.equal(empty.ok, false);
assert.equal(empty.nextBestAction, "貼上原始會議紀錄後重新分析");

const note = [
  "Mia Cbon 南紡店店長想先了解草莓禮盒試吃與冷鏈配送。",
  "對方在意價格、包裝規格、檢驗資料與春節檔期。",
  "採購流程需要先看樣品，再由採購核准是否試賣。"
].join("\n");
const result = analyzeMeeting({ customerName: "Mia Cbon 南紡店", note });
assert.equal(result.ok, true);
assert(result.fitScore > 50);
assert(result.meddic.some((item) => item.key === "decisionCriteria" && item.status === "partial"));
assert(result.meddic.some((item) => item.key === "decisionProcess" && item.status === "partial"));
assert(!/Error/i.test(result.summary));

console.log("sales_ai_engine tests passed");

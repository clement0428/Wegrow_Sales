(function (root) {
  const MEDDIC = [
    ["metrics", "M", "Metrics", ["營收", "毛利", "客單", "坪效", "採購量", "盒", "金額", "預算", "KPI"]],
    ["economicBuyer", "E", "Economic Buyer", ["老闆", "店長", "採購", "總經理", "決策", "核准", "買主"]],
    ["decisionCriteria", "D", "Decision Criteria", ["價格", "包裝", "規格", "冷鏈", "檢驗", "品質", "產地", "交期", "物流"]],
    ["decisionProcess", "D", "Decision Process", ["流程", "報價", "試吃", "樣品", "審核", "合約", "下單", "付款"]],
    ["identifyPain", "I", "Identify Pain", ["痛點", "缺", "擔心", "風險", "退貨", "損耗", "不穩", "賣相", "保存"]],
    ["champion", "C", "Champion", ["窗口", "支持", "幫忙", "推薦", "介紹", "champion", "內部"]]
  ];

  function normalize(text) {
    return String(text || "").replace(/\r\n/g, "\n").trim();
  }

  function hasAny(text, words) {
    const lower = text.toLowerCase();
    return words.some((word) => lower.includes(String(word).toLowerCase()));
  }

  function extractSentences(text) {
    return normalize(text)
      .split(/[\n。；;.!?？]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 12);
  }

  function meddicFromText(text) {
    return MEDDIC.map(([key, letter, label, keywords]) => {
      const hit = hasAny(text, keywords);
      return {
        key,
        letter,
        label,
        status: hit ? "partial" : "missing",
        text: hit ? `會議紀錄提到 ${keywords.filter((word) => hasAny(text, [word])).slice(0, 3).join("、")}，可先列為部分證據。` : `缺 ${label}：需要補具名資訊或量化條件。`
      };
    });
  }

  function detectIntent(text) {
    if (hasAny(text, ["樣品", "試吃", "試賣", "寄樣"])) return "安排樣品 / 試吃後確認採購條件";
    if (hasAny(text, ["報價", "價格", "預算"])) return "補齊規格與冷鏈後送初版報價";
    if (hasAny(text, ["會議", "電話", "call", "拜訪"])) return "安排 15 分鐘 discovery call";
    return "補一次快速確認：窗口、需求、規格、時間";
  }

  function missingFields(meddic) {
    return meddic.filter((item) => item.status === "missing").map((item) => item.label);
  }

  function analyzeMeeting({ customerName, note, now }) {
    const text = normalize(note);
    const name = normalize(customerName) || "未命名客戶";
    const generatedAt = now || new Date().toISOString();

    if (!text) {
      return {
        ok: false,
        customerName: name,
        generatedAt,
        fitScore: 0,
        summary: "尚未貼上會議紀錄。請先貼原始文字；不用先填完整 AI memory。",
        meddic: meddicFromText(""),
        nextBestAction: "貼上原始會議紀錄後重新分析",
        dailyLearning: "沒有原始紀錄時不產生假摘要。",
        gaps: MEDDIC.map((item) => item[2])
      };
    }

    const meddic = meddicFromText(text);
    const covered = meddic.filter((item) => item.status !== "missing").length;
    const sentences = extractSentences(text);
    const gaps = missingFields(meddic);
    const intent = detectIntent(text);
    const fitScore = Math.min(100, 35 + covered * 9 + Math.min(sentences.length, 6) * 2);

    return {
      ok: true,
      customerName: name,
      generatedAt,
      fitScore,
      summary: `${name} 已有可分析的原始紀錄；先用文字抽取出 ${covered}/6 MEDDIC 線索。`,
      meddic,
      nextBestAction: intent,
      dailyLearning: sentences.length
        ? `今日學習：${sentences.slice(0, 3).join("；")}。`
        : "今日學習：紀錄太短，只能建立待補欄位。",
      gaps
    };
  }

  root.SalesAI = { analyzeMeeting };
  if (typeof module !== "undefined" && module.exports) module.exports = root.SalesAI;
})(typeof window !== "undefined" ? window : globalThis);

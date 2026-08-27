let dashboardData = null;
const $ = (selector) => document.querySelector(selector);
const SalesAIEngine = window.SalesAI || (function () {
  const MEDDIC = [
    ["metrics", "M", "Metrics", ["營收", "毛利", "客單", "坪效", "採購量", "盒", "金額", "預算", "KPI"]],
    ["economicBuyer", "E", "Economic Buyer", ["老闆", "店長", "採購", "總經理", "決策", "核准", "買主"]],
    ["decisionCriteria", "D", "Decision Criteria", ["價格", "包裝", "規格", "冷鏈", "檢驗", "品質", "產地", "交期", "物流"]],
    ["decisionProcess", "D", "Decision Process", ["流程", "報價", "試吃", "樣品", "審核", "合約", "下單", "付款"]],
    ["identifyPain", "I", "Identify Pain", ["痛點", "缺", "擔心", "風險", "退貨", "損耗", "不穩", "賣相", "保存"]],
    ["champion", "C", "Champion", ["窗口", "支持", "幫忙", "推薦", "介紹", "champion", "內部"]]
  ];
  const normalize = (text) => String(text || "").replace(/\r\n/g, "\n").trim();
  const hasAny = (text, words) => {
    const lower = text.toLowerCase();
    return words.some((word) => lower.includes(String(word).toLowerCase()));
  };
  const extractSentences = (text) => normalize(text).split(/[\n。；;.!?？]+/).map((item) => item.trim()).filter(Boolean).slice(0, 12);
  const meddicFromText = (text) => MEDDIC.map(([key, letter, label, keywords]) => {
    const hits = keywords.filter((word) => hasAny(text, [word]));
    return {
      key,
      letter,
      label,
      status: hits.length ? "partial" : "missing",
      text: hits.length ? `會議紀錄提到 ${hits.slice(0, 3).join("、")}，可先列為部分證據。` : `缺 ${label}：需要補具名資訊或量化條件。`
    };
  });
  const detectIntent = (text) => {
    if (hasAny(text, ["樣品", "試吃", "試賣", "寄樣"])) return "安排樣品 / 試吃後確認採購條件";
    if (hasAny(text, ["報價", "價格", "預算"])) return "補齊規格與冷鏈後送初版報價";
    if (hasAny(text, ["會議", "電話", "call", "拜訪"])) return "安排 15 分鐘 discovery call";
    return "補一次快速確認：窗口、需求、規格、時間";
  };
  return {
    analyzeMeeting({ customerName, note, now }) {
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
      return {
        ok: true,
        customerName: name,
        generatedAt,
        fitScore: Math.min(100, 35 + covered * 9 + Math.min(sentences.length, 6) * 2),
        summary: `${name} 已有可分析的原始紀錄；先用文字抽取出 ${covered}/6 MEDDIC 線索。`,
        meddic,
        nextBestAction: detectIntent(text),
        dailyLearning: sentences.length ? `今日學習：${sentences.slice(0, 3).join("；")}。` : "今日學習：紀錄太短，只能建立待補欄位。",
        gaps: meddic.filter((item) => item.status === "missing").map((item) => item.label)
      };
    }
  };
})();
function setupNav() {
  function activate(panelName) {
    document.querySelectorAll(".nav-item").forEach((nav) => nav.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((panel) => panel.classList.remove("active"));
    const nav = document.querySelector(`.nav-item[data-panel="${panelName}"]`);
    const target = panelName === "adoption" ? "#panel-adoption" : "#panel-workbench";
    if (nav) nav.classList.add("active");
    $(target).classList.add("active");
    $("#panel-title").textContent = nav ? nav.textContent : "銷售作戰台";
    resetPanelSubtabs(target);
  }

  document.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", () => {
      const panelName = item.dataset.panel === "adoption" ? "adoption" : "sales";
      activate(panelName);
      window.location.hash = panelName === "adoption" ? "adoption" : "sales";
    });
  });

  activate(window.location.hash === "#adoption" ? "adoption" : "sales");
}

function resetPanelSubtabs(panelSelector) {
  const panel = $(panelSelector);
  if (!panel) return;
  const subtabs = panel.querySelectorAll(".subtab");
  subtabs.forEach((tab) => tab.classList.remove("active"));
  panel.querySelectorAll(".subpanel-section").forEach((section) => section.classList.remove("active"));
  if (subtabs[0]) {
    subtabs[0].classList.add("active");
    const firstPanel = document.getElementById(subtabs[0].dataset.subpanel);
    if (firstPanel) firstPanel.classList.add("active");
  }
}

function setupSubtabs() {
  document.querySelectorAll(".subtab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const panel = tab.closest(".panel");
      const target = document.getElementById(tab.dataset.subpanel);
      if (!panel || !target) return;
      panel.querySelectorAll(".subtab").forEach((item) => item.classList.remove("active"));
      panel.querySelectorAll(".subpanel-section").forEach((section) => section.classList.remove("active"));
      tab.classList.add("active");
      target.classList.add("active");
      panel.scrollIntoView({ behavior: "auto", block: "start" });
    });
  });
}

function getStoredTaskState(taskId, fallback) {
  const value = localStorage.getItem(`wegrow_v0_task_${taskId}`);
  if (value === null) return fallback;
  return value === "true";
}

function setStoredTaskState(taskId, done) {
  localStorage.setItem(`wegrow_v0_task_${taskId}`, String(done));
}

function updateProgress() {
  const tasks = allTodayTasks();
  const done = tasks.filter((task) => task.done).length;
  const total = tasks.length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  $("#today-progress").style.width = `${pct}%`;
  $("#progress-label").textContent = `${pct}%`;
  $("#task-summary").textContent = `${done} / ${total}`;
}

function renderSummary(data) {
  $("#reply-summary").textContent = data.reply_queue.count_label;
  $("#buyer-summary").textContent = data.buyer_gate_summary;
  $("#publish-summary").textContent = String(data.publish_queue.length);
  $("#gap-summary").textContent = String(data.evidence_pack_status.filter((item) => item.status === "missing" || item.status === "pending").length);
}

function renderTasks(data) {
  $("#today-meta").textContent = `${data.generated_at}｜每天只做三件最重要的銷售動作。`;
  const list = $("#task-list");
  list.innerHTML = "";

  allTodayTasks().forEach((task) => {
    task.done = getStoredTaskState(task.id, task.done);
    const row = document.createElement("label");
    row.className = `task-row ${task.urgency}`;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.done;
    checkbox.addEventListener("change", () => {
      task.done = checkbox.checked;
      setStoredTaskState(task.id, task.done);
      updateProgress();
    });

    const body = document.createElement("span");
    body.className = "task-body";
    body.innerHTML = `
      <span class="task-title">${task.title}</span>
      <span class="task-meta">${task.widget}｜${task.owner}｜${task.estimated_minutes} 分鐘</span>
      <span class="task-loss">不做的銷售損失：${task.sales_loss_if_not_done}</span>
    `;

    row.append(checkbox, body);
    list.appendChild(row);
  });
  updateProgress();
}

function renderRisks(data) {
  $("#risk-list").innerHTML = data.risk_alerts.map((risk) => `
    <article class="risk-box ${risk.level}">
      <strong>${risk.title}</strong>
      <p>${risk.text}</p>
    </article>
  `).join("");
}

function renderCompass(data) {
  $("#compass-grid").innerHTML = data.sales_compass.map((item) => `
    <article class="compass-card">
      <span>${item.label}</span>
      <strong>${item.rule}</strong>
      <p>${item.reason}</p>
    </article>
  `).join("");
}

function renderContentTable(data) {
  const rows = data.content_calendar.map((item) => `
    <tr>
      <td>${item.ep}</td>
      <td>${item.topic}</td>
      <td><span class="badge">${item.status}</span></td>
      <td>${item.cta}</td>
      <td>${item.metric}</td>
    </tr>
  `).join("");
  $("#content-table").innerHTML = `
    <thead><tr><th>集數</th><th>主題</th><th>狀態</th><th>CTA</th><th>衡量方式</th></tr></thead>
    <tbody>${rows}</tbody>
  `;
}

function renderPublishTable(data) {
  const rows = data.publish_queue.map((item) => `
    <tr>
      <td>${item.item}</td>
      <td>${item.platform}</td>
      <td><span class="badge">${item.status}</span></td>
      <td>${item.next_action}</td>
    </tr>
  `).join("");
  $("#publish-table").innerHTML = `
    <thead><tr><th>項目</th><th>平台</th><th>狀態</th><th>下一步</th></tr></thead>
    <tbody>${rows}</tbody>
  `;
}

function renderLeadTable(data) {
  const rows = data.reply_queue.rows.map((item) => `
    <tr>
      <td>${item.source}</td>
      <td>${item.status}</td>
      <td>${item.evidence}</td>
      <td>${item.next_action}</td>
    </tr>
  `).join("");
  $("#lead-table").innerHTML = `
    <thead><tr><th>來源</th><th>狀態</th><th>依據</th><th>下一步</th></tr></thead>
    <tbody>${rows}</tbody>
  `;
}

function renderBuyerTable(data) {
  const rows = data.buyer_pipeline.map((buyer) => `
    <tr>
      <td>${buyer.buyer_id}</td>
      <td>${buyer.company}</td>
      <td>${buyer.market}</td>
      <td><span class="badge">${buyer.gate}</span></td>
      <td>${buyer.priority}</td>
      <td>${buyer.next_action}</td>
    </tr>
  `).join("");
  $("#buyer-table").innerHTML = `
    <thead><tr><th>ID</th><th>買家</th><th>市場</th><th>Gate</th><th>用途</th><th>下一步</th></tr></thead>
    <tbody>${rows}</tbody>
  `;
}

function renderEvidenceTable(data) {
  const rows = data.evidence_pack_status.map((item) => `
    <tr>
      <td>${item.name}</td>
      <td><span class="badge ${item.status}">${item.status_label}</span></td>
      <td>${item.why_it_matters}</td>
      <td>${item.blocks}</td>
    </tr>
  `).join("");
  $("#evidence-table").innerHTML = `
    <thead><tr><th>項目</th><th>狀態</th><th>為什麼重要</th><th>阻擋什麼</th></tr></thead>
    <tbody>${rows}</tbody>
  `;
}

function renderShangyi(data) {
  const s = data.shangyi_review;
  $("#shangyi-summary").innerHTML = `
    <article><span>觀察</span><p>${s.observe}</p></article>
    <article><span>判斷</span><p>${s.interpret}</p></article>
    <article><span>行動</span><p>${s.act}</p></article>
    <article><span>追問</span><p>${s.ask_next}</p></article>
  `;

  const rows = data.price_benchmark.map((item) => `
    <tr>
      <td>${item.source}</td>
      <td>${item.spec}</td>
      <td>${item.price}</td>
      <td>${item.note}</td>
    </tr>
  `).join("");
  $("#price-table").innerHTML = `
    <thead><tr><th>來源</th><th>規格</th><th>價格</th><th>備註</th></tr></thead>
    <tbody>${rows}</tbody>
  `;
}

function renderLimits(data) {
  $("#limits-list").innerHTML = data.v0_notes.map((note) => `<p>${note}</p>`).join("");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderAiHealthResult(result) {
  const meddicRows = result.meddic.map((item) => `
    <article class="meddic-card ${item.status}">
      <span>${item.letter} · ${item.label}</span>
      <p>${escapeHtml(item.text)}</p>
    </article>
  `).join("");
  const gaps = result.gaps.length ? result.gaps.map((gap) => `<span class="gap-chip">${escapeHtml(gap)}</span>`).join("") : `<span class="gap-chip good">暫無重大缺口</span>`;

  $("#ai-health-output").innerHTML = `
    <div class="ai-result-head ${result.ok ? "ok" : "blocked"}">
      <div>
        <span>${result.ok ? "AI 可分析" : "待補紀錄"}</span>
        <strong>${escapeHtml(result.customerName)}</strong>
      </div>
      <div class="fit-score">${result.fitScore}</div>
    </div>
    <section class="ai-result-section">
      <h3>Daily Learning</h3>
      <p>${escapeHtml(result.dailyLearning)}</p>
    </section>
    <section class="ai-result-section">
      <h3>Next Best Action</h3>
      <p>${escapeHtml(result.nextBestAction)}</p>
    </section>
    <section class="ai-result-section">
      <h3>MEDDIC 健檢</h3>
      <div class="meddic-grid">${meddicRows}</div>
    </section>
    <section class="ai-result-section">
      <h3>待補欄位</h3>
      <div class="gap-list">${gaps}</div>
    </section>
  `;
}

function setupAiHealth() {
  const sample = [
    "Mia Cbon 南紡店店長想先了解草莓禮盒試吃與冷鏈配送。",
    "對方在意價格、包裝規格、檢驗資料與春節檔期。",
    "採購流程需要先看樣品，再由採購核准是否試賣。",
    "下一步安排一次 15 分鐘 discovery call，確認預算、採購量與可收貨時間。"
  ].join("\n");
  const noteInput = $("#ai-meeting-note");
  const nameInput = $("#ai-customer-name");
  if (noteInput && !noteInput.value.trim()) noteInput.value = sample;

  function run() {
    const result = SalesAIEngine.analyzeMeeting({
      customerName: nameInput.value,
      note: noteInput.value,
      now: new Date().toISOString()
    });
    renderAiHealthResult(result);
  }

  const button = $("#run-ai-health");
  if (button) button.addEventListener("click", run);
  if (noteInput) noteInput.addEventListener("input", run);
  run();
}

// ── Local Action Queue / Approval / Timeline ────────────────────────────
// Works even when /api/sales-agent/chat or /api/sales-agent/actions are
// unreachable: intent detection + action creation happen entirely client
// side against localStorage, independent of what the backend returns.
const ACTION_QUEUE_KEY = "wegrow_sales_action_queue";
const TIMELINE_KEY = "wegrow_sales_timeline_events";
const LOCAL_TODAY_TASKS_KEY = "wegrow_sales_today_tasks_local";

// email / social / quote / form submission must never look externally sent —
// approving these moves them to draft_ready, not approved/done.
const EXTERNAL_ACTION_TYPES = new Set(["draft_email", "draft_social_reply", "quote", "publish", "send", "submit_form", "share_file"]);

const ACTION_STATUS_LABELS = {
  pending_approval: "待審核",
  approved: "已核准",
  rejected: "已拒絕",
  exported_to_codex: "已匯出",
  done: "完成",
  blocked_missing_data: "缺資料鎖定",
  draft_ready: "草稿待寄（人工）",
};
const RISK_LABELS = {
  customer_data_change: "客戶資料變更",
  approval_required: "需人工核准",
  missing_delivery_date: "缺交期",
  missing_quantity: "缺數量",
  missing_cost: "缺成本",
  external_send: "對外動作",
};
const MISSING_FIELD_LABELS = { delivery_date: "交期", quantity: "數量", unit_cost: "單位成本" };

function readJsonList(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
function writeJsonList(key, list) {
  localStorage.setItem(key, JSON.stringify(list));
}
function getActionQueue() { return readJsonList(ACTION_QUEUE_KEY); }
function saveActionQueue(actions) { writeJsonList(ACTION_QUEUE_KEY, actions); }
function getActionById(id) { return getActionQueue().find((a) => a.id === id) || null; }
function getTimelineEvents() { return readJsonList(TIMELINE_KEY); }
function saveTimelineEvents(events) { writeJsonList(TIMELINE_KEY, events); }
function getLocalTodayTasks() { return readJsonList(LOCAL_TODAY_TASKS_KEY); }
function saveLocalTodayTasks(tasks) { writeJsonList(LOCAL_TODAY_TASKS_KEY, tasks); }
function allTodayTasks() { return [...((dashboardData && dashboardData.today_tasks) || []), ...getLocalTodayTasks()]; }

function nowIso() { return new Date().toISOString(); }
function newActionId() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `act_${stamp}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Intent detection ─────────────────────────────────────────────────
const INTENT_PATTERNS = [
  ["change_deal_stage", /(改|change|更新).*(階段|stage)/i],
  ["quote", /報價|quote/i],
  ["publish", /發布|publish/i],
  ["submit_form", /提交表單|submit.*form/i],
  ["share_file", /分享.*(檔案|文件|file)|share.*file/i],
  ["draft_social_reply", /(社群|social|留言).*(回覆|reply|草稿)/i],
  ["draft_email", /(草擬|draft|寫|寄).*(信|email|mail)|開發信/i],
  ["handoff_to_codex", /\bcodex\b/i],
  ["add_customer", /新增客戶|add customer/i],
  ["create_follow_up", /(建立|create).*(跟進|follow.?up)|D\+?\s?(3|7|14)\b/i],
  ["update_customer_progress", /(更新|update).*(進度|progress)|進度更新|packaging|包裝/i],
];

function detectActionType(text) {
  for (const [type, pattern] of INTENT_PATTERNS) {
    if (pattern.test(text)) return type;
  }
  return null;
}

const KNOWN_COMPANIES = ["Mia Cbon", "Mia C'bon", "Carrefour", "City'Super", "Isetan"];
function detectCompanyName(text) {
  const lower = text.toLowerCase();
  for (const name of KNOWN_COMPANIES) {
    if (lower.includes(name.toLowerCase())) return name === "Mia C'bon" ? "Mia Cbon" : name;
  }
  return null;
}

function detectMissingFields(text) {
  const missing = [];
  if (!/\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}|下週|明天|後天|next week|tomorrow/i.test(text)) missing.push("delivery_date");
  if (!/(\d+)\s*(盒|箱|份|kg|公斤|units?|pcs)/i.test(text)) missing.push("quantity");
  if (!/成本|cost|單價|NT\$|\$\d/i.test(text)) missing.push("unit_cost");
  return missing;
}

const ACTION_TITLE_BUILDERS = {
  update_customer_progress: (c) => `Update ${c || "customer"} progress`,
  draft_email: (c) => `Draft email — ${c || "customer"}`,
  draft_social_reply: (c) => `Draft social reply — ${c || "customer"}`,
  handoff_to_codex: () => "Codex handoff",
  quote: (c) => `Quote — ${c || "customer"}`,
  change_deal_stage: (c) => `Change deal stage — ${c || "customer"}`,
  publish: () => "Publish content",
  send: (c) => `Send — ${c || "customer"}`,
  submit_form: () => "Submit form",
  share_file: () => "Share file",
  add_customer: (c) => `Add customer — ${c || "new customer"}`,
  create_follow_up: (c) => `Create follow-up — ${c || "customer"}`,
};

function buildMiaCbonNextPlan() {
  return [
    "1. Confirm delivery date, item, and quantity.",
    "2. Create D+3 follow-up to confirm receipt and feedback.",
    "3. If feedback is positive, create buyer meeting / sample review task.",
    "4. Do not create a formal quote until cost and supply are confirmed.",
  ].join("\n");
}

function createActionFromAgentMessage(message, agentMode) {
  const text = String(message || "").trim();
  if (!text) return null;
  const type = detectActionType(text);
  if (!type) return null;

  const company = detectCompanyName(text);
  const missingFields = (type === "update_customer_progress" || type === "quote") ? detectMissingFields(text) : [];
  const riskFlags = [];
  if (missingFields.includes("delivery_date")) riskFlags.push("missing_delivery_date");
  if (missingFields.includes("quantity")) riskFlags.push("missing_quantity");
  if (missingFields.includes("unit_cost")) riskFlags.push("missing_cost");
  if (EXTERNAL_ACTION_TYPES.has(type) || type === "change_deal_stage") riskFlags.push("approval_required", "external_send");
  riskFlags.push("customer_data_change");

  const titleFn = ACTION_TITLE_BUILDERS[type] || ((c) => `${type} — ${c || "customer"}`);
  const isMiaCbon = company === "Mia Cbon";
  const followUpNote = (type === "create_follow_up" || type === "update_customer_progress") ? " and create a follow-up task" : "";
  const nextStep = (type === "update_customer_progress" && isMiaCbon)
    ? `After Clement approval, write to company timeline and create a D+3 follow-up task.\n\nNext plan:\n${buildMiaCbonNextPlan()}`
    : `After Clement approval, write to company timeline${followUpNote}.`;

  const action = {
    id: newActionId(),
    created_at: nowIso(),
    source: "agent_chat",
    source_message: text,
    type,
    title: titleFn(company),
    target: company ? { entity_type: "company", name: company } : { entity_type: "unknown", name: "" },
    // Missing data blocks types that cannot safely proceed without it (a
    // quote with no cost data). update_customer_progress / create_follow_up
    // stay pending_approval even with gaps — the whole point of approving
    // them is to kick off the follow-up that chases the missing data down.
    status: (missingFields.length && type === "quote") ? "blocked_missing_data" : "pending_approval",
    requires_approval: true,
    risk_flags: Array.from(new Set(riskFlags)),
    missing_fields: missingFields,
    proposed_change: { field: "next_action", before: null, after: text },
    next_step: nextStep,
    audit_note: agentMode === "local_rule_engine"
      ? "Created by local fallback because backend API is unavailable."
      : `Created by local Action Queue (browser localStorage). Chat reply source: ${agentMode || "unknown"}.`,
  };

  const queue = getActionQueue();
  queue.unshift(action);
  saveActionQueue(queue);
  renderActionQueue();
  return action;
}

function updateActionStatus(id, status) {
  const queue = getActionQueue();
  const idx = queue.findIndex((a) => a.id === id);
  if (idx === -1) return null;
  queue[idx].status = status;
  queue[idx].updated_at = nowIso();
  saveActionQueue(queue);
  renderActionQueue();
  return queue[idx];
}

function createTimelineEventFromAction(action, note) {
  const events = getTimelineEvents();
  events.unshift({
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    at: nowIso(),
    entity: (action.target && action.target.name) || "unknown",
    action_id: action.id,
    action_type: action.type,
    status: action.status,
    note: note || action.title,
  });
  saveTimelineEvents(events);
  renderTimeline();
}

function addTodayTaskFromAction(action, label) {
  const tasks = getLocalTodayTasks();
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 3);
  tasks.unshift({
    id: `local_task_${action.id}_${Date.now()}`,
    title: label || `D+3 follow-up — ${(action.target && action.target.name) || action.title}`,
    widget: "本機新增（Action Queue）",
    owner: "Clement",
    estimated_minutes: 10,
    sales_loss_if_not_done: "客戶進度會停滯，錯過 D+3 跟進窗口。",
    urgency: "medium",
    done: false,
    due_date: dueDate.toISOString().slice(0, 10),
  });
  saveLocalTodayTasks(tasks);
  if (dashboardData) renderTasks(dashboardData);
}

function approveAction(id) {
  const existing = getActionById(id);
  if (!existing) return;
  const nextStatus = EXTERNAL_ACTION_TYPES.has(existing.type) ? "draft_ready" : "approved";
  const action = updateActionStatus(id, nextStatus);
  if (!action) return;
  createTimelineEventFromAction(action, `Approved: ${action.title} (status -> ${nextStatus})`);
  if (action.type === "update_customer_progress" || action.type === "create_follow_up") {
    addTodayTaskFromAction(action);
  }
}

function rejectAction(id) {
  const action = updateActionStatus(id, "rejected");
  if (!action) return;
  createTimelineEventFromAction(action, `Rejected: ${action.title}`);
}

function createFollowUpFromAction(id) {
  const action = getActionById(id);
  if (!action) return;
  addTodayTaskFromAction(action, `D+3 follow-up — ${(action.target && action.target.name) || action.title}`);
  createTimelineEventFromAction(action, `D+3 follow-up created for ${(action.target && action.target.name) || action.title}`);
}

function buildActionMarkdown(action) {
  return [
    "# WeGrow Sales Action Handoff",
    "",
    "Source message:",
    action.source_message,
    "",
    "Proposed action:",
    `${action.title} (type: ${action.type}, target: ${(action.target && action.target.name) || "unknown"})`,
    action.next_step || "",
    "",
    "Required approval:",
    action.requires_approval ? "Yes — Clement must approve before any external action." : "No",
    "",
    "Missing data:",
    action.missing_fields && action.missing_fields.length
      ? action.missing_fields.map((f) => MISSING_FIELD_LABELS[f] || f).join(", ")
      : "None",
    "",
    "Risk flags:",
    (action.risk_flags || []).map((r) => RISK_LABELS[r] || r).join(", ") || "None",
    "",
    "Files to inspect:",
    "outputs/wegrow_sales_v0/index.html, app.js, style.css, sales_dashboard_data.json, SALES_AGENT_GATEWAY_SPEC.md",
    "",
    "Acceptance test:",
    `Action ${action.id} should move from pending_approval to approved/rejected only via explicit Clement action in the Action Queue UI, and must create a timeline event.`,
    "",
    `Action id: ${action.id}`,
    `Status: ${action.status}`,
    `Created at: ${action.created_at}`,
  ].join("\n");
}

function exportActionToMarkdown(id, mode) {
  const action = getActionById(id);
  if (!action) return;
  const md = buildActionMarkdown(action);
  if (action.status === "pending_approval" || action.status === "blocked_missing_data") {
    updateActionStatus(id, "exported_to_codex");
  }
  openMdExportModal(md, action.title);
  if (mode === "copy") copyMdToClipboard(md);
}

function openMdExportModal(md, title) {
  const modal = $("#md-export-modal");
  if (!modal) return;
  $("#md-export-title").textContent = title ? `Export — ${title}` : "Export Codex MD";
  $("#md-export-text").value = md;
  modal.classList.add("open");
}

function copyMdToClipboard(text) {
  const done = () => flashCopyState(true);
  const fail = () => flashCopyState(false);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(fail);
  } else {
    fail();
  }
}

function flashCopyState(ok) {
  const btn = $("#md-export-copy");
  if (!btn) return;
  const original = btn.textContent;
  btn.textContent = ok ? "已複製 Copied" : "複製失敗，請手動選取文字";
  setTimeout(() => { btn.textContent = original; }, 1600);
}

function downloadMd(text, title) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safeName = (title || "wegrow-sales-action").replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
  a.download = `${safeName}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function setupMdExportModal() {
  $("#md-export-close")?.addEventListener("click", () => $("#md-export-modal").classList.remove("open"));
  $("#md-export-copy")?.addEventListener("click", () => copyMdToClipboard($("#md-export-text").value));
  $("#md-export-download")?.addEventListener("click", () => downloadMd($("#md-export-text").value, $("#md-export-title").textContent));
}

let actionQueueFilter = "all";

function renderActionFilters() {
  const el = $("#action-filter-row");
  if (!el) return;
  const queue = getActionQueue();
  const counts = { all: queue.length };
  queue.forEach((a) => { counts[a.status] = (counts[a.status] || 0) + 1; });
  const chips = [
    ["all", `全部 (${counts.all})`],
    ["pending_approval", `待審核 (${counts.pending_approval || 0})`],
    ["blocked_missing_data", `缺資料鎖定 (${counts.blocked_missing_data || 0})`],
    ["approved", `已核准 (${counts.approved || 0})`],
    ["draft_ready", `草稿待寄 (${counts.draft_ready || 0})`],
    ["rejected", `已拒絕 (${counts.rejected || 0})`],
    ["exported_to_codex", `已匯出 (${counts.exported_to_codex || 0})`],
  ];
  el.innerHTML = chips.map(([key, label]) => `<button type="button" class="action-filter-chip ${actionQueueFilter === key ? "active" : ""}" data-filter="${key}">${label}</button>`).join("");
  el.querySelectorAll("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => { actionQueueFilter = btn.dataset.filter; renderActionQueue(); });
  });
}

function renderActionQueue() {
  renderActionFilters();
  const table = $("#action-queue-table");
  if (!table) return;
  let queue = getActionQueue();
  if (actionQueueFilter !== "all") queue = queue.filter((a) => a.status === actionQueueFilter);
  const rows = queue.map((a) => {
    const riskHtml = (a.risk_flags || []).map((r) => `<span class="risk-chip">${escapeHtml(RISK_LABELS[r] || r)}</span>`).join("");
    const missingHtml = (a.missing_fields || []).map((m) => `<span class="missing-chip">${escapeHtml(MISSING_FIELD_LABELS[m] || m)}</span>`).join("");
    const canApprove = a.status === "pending_approval";
    const canReject = a.status === "pending_approval" || a.status === "blocked_missing_data";
    return `
      <tr data-action-id="${a.id}">
        <td>${new Date(a.created_at).toLocaleString("zh-TW", { hour12: false })}</td>
        <td>${escapeHtml(a.type)}</td>
        <td>${escapeHtml((a.target && a.target.name) || "—")}</td>
        <td>${escapeHtml(a.title)}</td>
        <td>${riskHtml || "—"}</td>
        <td>${missingHtml || "—"}</td>
        <td><span class="status-badge ${a.status}">${escapeHtml(ACTION_STATUS_LABELS[a.status] || a.status)}</span></td>
        <td class="action-row-buttons">
          <button data-act="approve" ${canApprove ? "" : "disabled"}>核准</button>
          <button data-act="reject" ${canReject ? "" : "disabled"}>拒絕</button>
          <button data-act="followup">建立D+3</button>
          <button data-act="export">匯出MD</button>
          <button data-act="copy">複製</button>
        </td>
      </tr>`;
  }).join("");
  table.innerHTML = `
    <thead><tr><th>建立時間</th><th>類型</th><th>對象</th><th>提議動作</th><th>風險</th><th>缺資料</th><th>狀態</th><th>操作</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="8">目前沒有待處理 action。從聊天窗輸入指令會自動建立，例如點下方「Mia Cbon 進度更新（測試）」。</td></tr>`}</tbody>
  `;
  table.querySelectorAll("button[data-act]").forEach((btn) => {
    const row = btn.closest("tr");
    const id = row && row.dataset.actionId;
    if (!id) return;
    btn.addEventListener("click", () => {
      const act = btn.dataset.act;
      if (act === "approve") approveAction(id);
      else if (act === "reject") rejectAction(id);
      else if (act === "followup") createFollowUpFromAction(id);
      else if (act === "export") exportActionToMarkdown(id, "download");
      else if (act === "copy") exportActionToMarkdown(id, "copy");
    });
  });
}

function renderTimeline() {
  const el = $("#timeline-list");
  if (!el) return;
  const events = getTimelineEvents();
  el.innerHTML = events.length ? events.slice(0, 30).map((e) => `
    <article class="timeline-item">
      <time>${new Date(e.at).toLocaleString("zh-TW", { hour12: false })}</time>
      <div><strong>${escapeHtml(e.entity)}</strong> — ${escapeHtml(e.note)}</div>
    </article>
  `).join("") : `<p class="note">尚無 timeline 事件。核准/拒絕 action 後會自動出現在這裡。</p>`;
}

function getAgentLog() {
  try {
    return JSON.parse(localStorage.getItem("wegrow_sales_agent_log") || "[]");
  } catch {
    return [];
  }
}

function saveAgentLog(entry) {
  const log = getAgentLog();
  log.unshift(entry);
  localStorage.setItem("wegrow_sales_agent_log", JSON.stringify(log.slice(0, 50)));
}

function dashboardSnapshot() {
  if (!dashboardData) return {};
  return {
    generated_at: dashboardData.generated_at,
    market_priority: dashboardData.market_priority,
    today_tasks: dashboardData.today_tasks || [],
    risk_alerts: dashboardData.risk_alerts || [],
    reply_queue: dashboardData.reply_queue || {},
    buyer_pipeline: dashboardData.buyer_pipeline || [],
    evidence_pack_status: dashboardData.evidence_pack_status || [],
    shangyi_review: dashboardData.shangyi_review || {}
  };
}

function summarizeTasks() {
  const tasks = dashboardSnapshot().today_tasks || [];
  if (!tasks.length) return "目前沒有今日任務資料。";
  return tasks.map((task, index) => `${index + 1}. ${task.title}
   Owner: ${task.owner}｜急迫性: ${task.urgency}｜不做損失: ${task.sales_loss_if_not_done}`).join("\n");
}

function summarizeEvidence() {
  const gaps = (dashboardSnapshot().evidence_pack_status || []).filter((item) => item.status === "missing" || item.status === "pending");
  if (!gaps.length) return "目前證據包沒有 missing / pending 項目。";
  return gaps.map((item, index) => `${index + 1}. ${item.name}｜${item.status_label}
   阻擋: ${item.blocks}
   原因: ${item.why_it_matters}`).join("\n");
}

function summarizeBuyers() {
  const buyers = dashboardSnapshot().buyer_pipeline || [];
  if (!buyers.length) return "目前沒有買家 Gate 資料。";
  return buyers.map((buyer) => `${buyer.buyer_id}｜${buyer.company}｜${buyer.gate}｜${buyer.priority}
下一步: ${buyer.next_action}`).join("\n\n");
}

function buildCodexHandoff(userMessage) {
  return [
    "給 Codex 的 Sales Agent 代辦包：",
    "",
    `使用者指令：${userMessage}`,
    "",
    "硬規則：",
    "- AI 可找資料、讀資料、計算、起草、分類、提醒、摘要。",
    "- AI 不可自動寄信、送表單、報價、發布內容、分享證據檔、改 deal stage，除非 Clement 核准。",
    "- 所有更新都要有 action_log：誰、何時、來源、前後差異、是否需審核。",
    "",
    "目前 Sales snapshot：",
    `- generated_at: ${dashboardSnapshot().generated_at || "unknown"}`,
    `- market_priority: ${dashboardSnapshot().market_priority || "unknown"}`,
    `- today_tasks: ${(dashboardSnapshot().today_tasks || []).length}`,
    `- buyer_pipeline: ${(dashboardSnapshot().buyer_pipeline || []).length}`,
    `- evidence_gaps: ${(dashboardSnapshot().evidence_pack_status || []).filter((item) => item.status === "missing" || item.status === "pending").length}`,
    "",
    "需要後端 Agent Gateway：",
    "- POST /api/sales-agent/chat：聊天與資料查詢",
    "- POST /api/sales-agent/actions：建立待審核 action",
    "- GET /api/sales-agent/audit-log：追溯所有 AI 建議與人為核准",
    "- destructive / external actions 必須 draft_only + approval_required"
  ].join("\n");
}

function localAgentReply(message) {
  const text = String(message || "").trim();
  const lower = text.toLowerCase();
  const wantsTask = /今日|三件|待辦|task|todo|做哪/.test(text);
  const wantsEvidence = /證據|缺|claim|檢驗|冷鏈|規格|成本/.test(text);
  const wantsBuyer = /買家|buyer|gate|carrefour|city|isetan|通路|採購/.test(lower);
  const wantsCodex = /codex|這邊|代辦|更新|部署|repo|系統|可追溯/.test(lower);
  const wantsAction = /建立|新增|更新|改|寄|發|送|報價|提醒|請款|草稿/.test(text);
  const blocks = [];

  if (wantsTask) blocks.push(`今日最該看的三件事：\n${summarizeTasks()}`);
  if (wantsEvidence) blocks.push(`缺證據 / 阻擋清單：\n${summarizeEvidence()}`);
  if (wantsBuyer) blocks.push(`買家 Gate：\n${summarizeBuyers()}`);
  if (wantsCodex) blocks.push(buildCodexHandoff(text));
  if (!blocks.length) {
    blocks.push([
      "我可以先做四類事：",
      "1. 整理今日三件事與銷售阻塞。",
      "2. 查 buyer gate / evidence gate / 商譯覆盤。",
      "3. 把你的指令轉成待審核 action，不直接對外發送。",
      "4. 產生給 Codex 的代辦包，讓這邊接手 repo / deploy / 外部工具工作。"
    ].join("\n"));
  }

  if (wantsAction) {
    blocks.push("我已把這句判定為「可能改資料或對外動作」。目前先建立待審核 action，不自動寄信、不自動報價、不自動改 deal stage。");
  }

  return {
    ok: true,
    mode: "local_rule_engine",
    requiresApproval: wantsAction,
    answer: blocks.join("\n\n---\n\n")
  };
}

async function requestAgentReply(message) {
  const payload = {
    message,
    page: "wegrow_sales_v0",
    snapshot: dashboardSnapshot(),
    client_time: new Date().toISOString()
  };
  try {
    const response = await fetch("/api/sales-agent/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    $("#agent-mode").textContent = "後端 Agent API";
    return data;
  } catch {
    $("#agent-mode").textContent = "本機規則引擎 / 待接 Agent API";
    return localAgentReply(message);
  }
}

function appendAgentMessage(role, content, meta = "", action = null) {
  const body = $("#agent-chat-body");
  if (!body) return;
  const item = document.createElement("article");
  item.className = `agent-message ${role}`;
  let actionHtml = "";
  if (action) {
    const riskHtml = (action.risk_flags || []).map((r) => `<span class="risk-chip">${escapeHtml(RISK_LABELS[r] || r)}</span>`).join("");
    const missingHtml = (action.missing_fields || []).map((m) => `<span class="missing-chip">${escapeHtml(MISSING_FIELD_LABELS[m] || m)}</span>`).join("");
    actionHtml = `
      <div class="agent-action-card" data-action-id="${action.id}">
        <h4>已建立 Action：${escapeHtml(action.title)}</h4>
        <div class="aac-row"><span class="aac-label">狀態</span><span class="status-badge ${action.status}">${escapeHtml(ACTION_STATUS_LABELS[action.status] || action.status)}</span></div>
        ${riskHtml ? `<div class="aac-row"><span class="aac-label">風險</span>${riskHtml}</div>` : ""}
        ${missingHtml ? `<div class="aac-row"><span class="aac-label">缺資料</span>${missingHtml}</div>` : ""}
        <div class="aac-row"><span class="aac-label">下一步</span><span>${escapeHtml(action.next_step || "")}</span></div>
        <div class="action-row-buttons" data-chat-action="${action.id}">
          <button data-act="approve" ${action.status === "pending_approval" ? "" : "disabled"}>核准 Approve</button>
          <button data-act="reject" ${(action.status === "pending_approval" || action.status === "blocked_missing_data") ? "" : "disabled"}>拒絕 Reject</button>
          <button data-act="followup">建立D+3 Follow-up</button>
          <button data-act="export">匯出 Codex MD</button>
          <button data-act="copy">複製 Copy for Claude</button>
          <button data-act="cancel">取消 Cancel</button>
        </div>
      </div>
    `;
  }
  item.innerHTML = `
    <div class="agent-message-role">${role === "user" ? "Clement" : "商譯 Agent"}${meta ? ` · ${escapeHtml(meta)}` : ""}</div>
    <pre>${escapeHtml(content)}</pre>
    ${actionHtml}
  `;
  body.appendChild(item);
  if (action) {
    const card = item.querySelector(".agent-action-card");
    card?.querySelectorAll("button[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const act = btn.dataset.act;
        if (act === "approve") approveAction(action.id);
        else if (act === "reject") rejectAction(action.id);
        else if (act === "followup") createFollowUpFromAction(action.id);
        else if (act === "export") exportActionToMarkdown(action.id, "download");
        else if (act === "copy") exportActionToMarkdown(action.id, "copy");
        else if (act === "cancel") updateActionStatus(action.id, "rejected");
        refreshInlineActionCard(card, action.id);
      });
    });
  }
  body.scrollTop = body.scrollHeight;
}

function refreshInlineActionCard(card, id) {
  const action = getActionById(id);
  if (!action || !card) return;
  const badge = card.querySelector(".status-badge");
  if (badge) {
    badge.className = `status-badge ${action.status}`;
    badge.textContent = ACTION_STATUS_LABELS[action.status] || action.status;
  }
  const approveBtn = card.querySelector('[data-act="approve"]');
  const rejectBtn = card.querySelector('[data-act="reject"]');
  if (approveBtn) approveBtn.disabled = action.status !== "pending_approval";
  if (rejectBtn) rejectBtn.disabled = !(action.status === "pending_approval" || action.status === "blocked_missing_data");
}

async function sendAgentMessage(message) {
  const text = String(message || "").trim();
  if (!text) return;
  appendAgentMessage("user", text);
  const pendingId = `agent-${Date.now()}`;
  appendAgentMessage("assistant", "處理中：讀取目前 Sales dashboard 狀態，判斷是否需要審核或交給 Codex。", pendingId);
  const result = await requestAgentReply(text);
  const body = $("#agent-chat-body");
  const pending = body?.querySelector(".agent-message.assistant:last-child");
  if (pending) pending.remove();

  const action = createActionFromAgentMessage(text, result.mode);
  appendAgentMessage("assistant", result.answer || "沒有回傳內容。", result.mode || "agent", action);

  saveAgentLog({
    id: pendingId,
    at: new Date().toISOString(),
    user_message: text,
    agent_mode: result.mode || "unknown",
    requires_approval: Boolean(result.requiresApproval) || Boolean(action),
    answer: result.answer || "",
    action_id: action ? action.id : null
  });
}

function setupAgentChat() {
  const shell = $("#agent-chat");
  if (!shell) return;
  const toggle = $("#agent-chat-toggle");
  const close = $("#agent-chat-close");
  const form = $("#agent-chat-form");
  const input = $("#agent-chat-text");

  const open = () => shell.classList.add("open");
  const closePanel = () => shell.classList.remove("open");
  toggle?.addEventListener("click", open);
  close?.addEventListener("click", closePanel);

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value;
    input.value = "";
    sendAgentMessage(text);
  });

  document.querySelectorAll("[data-agent-prompt]").forEach((button) => {
    button.addEventListener("click", () => {
      open();
      sendAgentMessage(button.dataset.agentPrompt);
    });
  });

  appendAgentMessage("assistant", "我已接上目前 Sales dashboard 狀態。現在可查今日任務、缺證據、買家 Gate，也能把你的指令轉成待審核 action 或 Codex 代辦包。");
}


function renderAdoption(data) {
  const adoption = data.adoption_farm;
  $("#adoption-compass-grid").innerHTML = adoption.compass.map((item) => `
    <article class="compass-card">
      <span>${item.label}</span>
      <strong>${item.rule}</strong>
      <p>${item.reason}</p>
    </article>
  `).join("");

  $("#adoption-segment-table").innerHTML = `
    <thead><tr><th>客戶</th><th>需求</th><th>可給的入口</th><th>不可承諾</th></tr></thead>
    <tbody>${adoption.segments.map((item) => `
      <tr><td>${item.segment}</td><td>${item.need}</td><td>${item.entry}</td><td>${item.do_not_promise}</td></tr>
    `).join("")}</tbody>
  `;

  $("#adoption-offer-table").innerHTML = `
    <thead><tr><th>階段</th><th>Offer</th><th>目的</th><th>Gate</th></tr></thead>
    <tbody>${adoption.offer_ladder.map((item) => `
      <tr><td>${item.stage}</td><td>${item.offer}</td><td>${item.purpose}</td><td>${item.gate}</td></tr>
    `).join("")}</tbody>
  `;

  $("#adoption-question-table").innerHTML = `
    <thead><tr><th>問題</th><th>用來判斷</th><th>下一步</th></tr></thead>
    <tbody>${adoption.qualifying_questions.map((item) => `
      <tr><td>${item.question}</td><td>${item.judges}</td><td>${item.next_action}</td></tr>
    `).join("")}</tbody>
  `;

  $("#adoption-evidence-table").innerHTML = `
    <thead><tr><th>項目</th><th>狀態</th><th>阻擋</th></tr></thead>
    <tbody>${adoption.evidence_gate.map((item) => `
      <tr><td>${item.item}</td><td><span class="badge ${item.status}">${item.status_label}</span></td><td>${item.blocks}</td></tr>
    `).join("")}</tbody>
  `;

  $("#adoption-next-list").innerHTML = adoption.next_steps.map((item) => `<p>${item}</p>`).join("");
}
function renderDashboard(data) {
  dashboardData = data;
  setupNav();
  setupSubtabs();
  renderSummary(data);
  renderTasks(data);
  renderCompass(data);
  renderRisks(data);
  renderContentTable(data);
  renderPublishTable(data);
  renderLeadTable(data);
  renderBuyerTable(data);
  renderEvidenceTable(data);
  renderShangyi(data);
  renderLimits(data);
  renderAdoption(data);
  setupAiHealth();
  setupAgentChat();
  renderActionQueue();
  renderTimeline();
  setupMdExportModal();
  $("#action-queue-refresh")?.addEventListener("click", () => { renderActionQueue(); renderTimeline(); });
}

fetch("sales_dashboard_data.json")
  .then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  })
  .then((text) => JSON.parse(text.replace(/^\uFEFF/, "")))
  .then(renderDashboard)
  .catch((error) => {
    $("#task-list").innerHTML = `
      <div class="risk-box high">
        <strong>資料讀取失敗</strong>
        <p>請用本機伺服器開啟此頁，例如在資料夾執行 <code>python -m http.server 8787</code>，再打開 <code>http://localhost:8787/</code>。錯誤：${error.message}</p>
      </div>
    `;
  });

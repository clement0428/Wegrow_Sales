let dashboardData = null;
const $ = (selector) => document.querySelector(selector);
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
  const tasks = dashboardData.today_tasks;
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

  data.today_tasks.forEach((task) => {
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

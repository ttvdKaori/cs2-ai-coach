const state = {
  upload: null,
  match: null,
  report: null,
  selectedIds: new Set(),
  activeTab: "overview",
  parseTimer: null
};

const els = {
  fileInput: document.querySelector("#fileInput"),
  dropZone: document.querySelector("#dropZone"),
  uploadStatus: document.querySelector("#uploadStatus"),
  uploadPercent: document.querySelector("#uploadPercent"),
  uploadProgress: document.querySelector("#uploadProgress"),
  sampleButton: document.querySelector("#sampleButton"),
  refreshHistory: document.querySelector("#refreshHistory"),
  historyList: document.querySelector("#historyList"),
  pageTitle: document.querySelector("#pageTitle"),
  copyShareLink: document.querySelector("#copyShareLink"),
  exportLink: document.querySelector("#exportLink"),
  parserBadge: document.querySelector("#parserBadge"),
  matchSummary: document.querySelector("#matchSummary"),
  playerList: document.querySelector("#playerList"),
  selectedCount: document.querySelector("#selectedCount"),
  focusPlayer: document.querySelector("#focusPlayer"),
  targetRole: document.querySelector("#targetRole"),
  createReport: document.querySelector("#createReport"),
  selectionHint: document.querySelector("#selectionHint"),
  setupSection: document.querySelector("#setupSection"),
  reportSection: document.querySelector("#reportSection"),
  reportContent: document.querySelector("#reportContent")
};

els.fileInput.addEventListener("change", () => {
  const file = els.fileInput.files?.[0];
  if (file) uploadFile(file);
});

["dragenter", "dragover"].forEach((eventName) => {
  els.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.dropZone.classList.add("drag-over");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  els.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.dropZone.classList.remove("drag-over");
  });
});

els.dropZone.addEventListener("drop", (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (file) uploadFile(file);
});

els.sampleButton.addEventListener("click", async () => {
  const sample = new File([buildSampleDemoBytes()], `sample-mirage-${Date.now()}.dem`, {
    type: "application/octet-stream"
  });
  await uploadFile(sample);
  autoSelectTeam();
  await createReport();
});

els.refreshHistory.addEventListener("click", loadHistory);
els.createReport.addEventListener("click", createReport);
els.focusPlayer.addEventListener("change", updateCreateButton);
els.copyShareLink.addEventListener("click", copyShareLink);
els.reportContent.addEventListener("click", (event) => {
  const button = event.target.closest("[data-feedback-rating]");
  if (button) submitFeedback(button);
});

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    state.activeTab = tab.dataset.tab;
    document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item === tab));
    renderReport();
  });
});

await loadHistory();
await loadReportFromUrl();

async function uploadFile(file) {
  if (!file.name.toLowerCase().endsWith(".dem")) {
    setStatus("只支持 .dem 文件", "error");
    return;
  }

  state.report = null;
  state.selectedIds = new Set();
  setProgress(0);
  setStatus(`上传 ${file.name}`, "ok");
  els.createReport.disabled = true;
  els.reportSection.classList.add("hidden");
  els.exportLink.classList.add("disabled");
  els.exportLink.setAttribute("aria-disabled", "true");
  els.exportLink.href = "#";
  els.copyShareLink.classList.add("disabled");
  els.copyShareLink.disabled = true;
  els.targetRole.disabled = false;

  try {
    const response = await uploadWithProgress(file);
    stopParseProgress();
    state.upload = response.upload;
    state.match = {
      ...response.match,
      parserNote: parserNote(response.parser)
    };
    els.pageTitle.textContent = `${response.match.map} ${response.match.score.team_a}-${response.match.score.team_b}`;
    els.parserBadge.textContent = response.parser.mode;
    els.parserBadge.classList.toggle("muted", Boolean(response.parser.fallback));
    setStatus("解析完成", "ok");
    setProgress(100);
    renderMatch();
    renderPlayers();
    if (response.match.supportedMap === false) {
      els.selectionHint.textContent = `当前 MVP 只支持 Mirage，无法为 ${response.match.map} 生成报告。`;
      els.selectionHint.classList.add("status-error");
    }
  } catch (error) {
    stopParseProgress();
    setStatus(error.message, "error");
  }
}

function uploadWithProgress(file) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/uploads?filename=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader("x-file-name", file.name);
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        setProgress(Math.round((event.loaded / event.total) * 95));
      }
    });
    xhr.upload.addEventListener("load", () => {
      setProgress(95);
      setStatus("上传完成，解析中", "ok");
      startParseProgress();
    });
    xhr.addEventListener("load", () => {
      const payload = parseJson(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload);
      } else {
        reject(new Error(payload.error || `上传失败：${xhr.status}`));
      }
    });
    xhr.addEventListener("error", () => reject(new Error("网络错误，上传失败")));
    xhr.send(file);
  });
}

async function createReport() {
  if (!state.upload || state.selectedIds.size !== 5 || !els.focusPlayer.value) {
    updateCreateButton();
    return;
  }

  els.createReport.disabled = true;
  els.createReport.textContent = "生成中...";
  try {
    const report = await api("/api/reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        uploadId: state.upload.id,
        teamPlayerIds: [...state.selectedIds],
        focusPlayerId: els.focusPlayer.value,
        targetRole: els.targetRole.value
      })
    });
    showReport(report);
    await loadHistory();
  } catch (error) {
    els.selectionHint.textContent = error.message;
    els.selectionHint.classList.add("status-error");
  } finally {
    els.createReport.textContent = "生成复盘报告";
    updateCreateButton();
  }
}

async function loadHistory() {
  try {
    const data = await api("/api/reports");
    if (!data.reports.length) {
      els.historyList.className = "history-list empty-state";
      els.historyList.textContent = "暂无报告";
      return;
    }
    els.historyList.className = "history-list";
    els.historyList.innerHTML = data.reports
      .map(
        (report) => `
          <button class="history-item" type="button" data-report-id="${escapeHtml(report.id)}">
            <strong>${escapeHtml(report.map)} ${escapeHtml(report.score)} · ${escapeHtml(report.focusPlayer)}</strong>
            <span>${escapeHtml(report.selectedTeam.join(" / "))}</span>
          </button>
        `
      )
      .join("");
    els.historyList.querySelectorAll("[data-report-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        const report = await api(`/api/reports/${button.dataset.reportId}`);
        showReport(report);
      });
    });
  } catch (error) {
    els.historyList.className = "history-list empty-state status-error";
    els.historyList.textContent = error.message;
  }
}

async function loadReportFromUrl() {
  const reportId = new URLSearchParams(window.location.search).get("report");
  if (!reportId) return;
  try {
    const report = await api(`/api/reports/${encodeURIComponent(reportId)}`);
    showReport(report);
  } catch (error) {
    els.pageTitle.textContent = "报告链接不可用";
    setStatus(error.message, "error");
  }
}

function showReport(report) {
  state.report = report;
  state.match = null;
  state.upload = { id: report.uploadId };
  state.selectedIds = new Set(report.selectedTeam.map((player) => player.id));
  state.activeTab = "overview";
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === "overview"));
  els.reportSection.classList.remove("hidden");
  els.exportLink.classList.remove("disabled");
  els.exportLink.setAttribute("aria-disabled", "false");
  els.exportLink.href = `/api/reports/${report.id}/export`;
  els.copyShareLink.classList.remove("disabled");
  els.copyShareLink.disabled = false;
  els.pageTitle.textContent = `${report.match.map} 复盘报告`;
  renderLoadedReportSetup(report);
  renderReport();
}

function renderMatch() {
  const match = state.match;
  if (!match) return;
  const stats = [
    ["地图", match.map],
    ["比分", `${match.score.team_a}-${match.score.team_b}`],
    ["回合", match.roundsPlayed],
    ["时长", `${match.durationMinutes} min`],
    ["T 胜率", match.sideWinRates.T],
    ["CT 胜率", match.sideWinRates.CT],
    ["玩家", match.players.length],
    ["证据", match.evidence.length]
  ];
  els.matchSummary.className = "";
  els.matchSummary.innerHTML = `
    <div class="match-grid">${stats.map(([label, value]) => statHtml(label, value)).join("")}</div>
    ${match.parserNote ? `<p class="meta">${escapeHtml(match.parserNote)}</p>` : ""}
    <div class="round-strip">
      ${match.rounds
        .map(
          (round) => `<span class="round-pill ${round.winnerTeamId === "team_a" ? "win-a" : "win-b"}" title="${escapeHtml(round.economyType)}">${round.number}</span>`
        )
        .join("")}
    </div>
  `;
}

function renderLoadedReportSetup(report) {
  els.parserBadge.textContent = report.analysisMode;
  els.parserBadge.classList.toggle("muted", Boolean(report.parser?.fallback));
  els.matchSummary.className = "";
  els.matchSummary.innerHTML = `
    <div class="match-grid">
      ${statHtml("地图", report.match.map)}
      ${statHtml("比分", report.overview.score)}
      ${statHtml("回合", report.match.roundsPlayed)}
      ${statHtml("证据", report.evidenceCount)}
    </div>
    <p class="meta">${escapeHtml(report.caveat)}</p>
  `;
  els.playerList.className = "player-list";
  els.playerList.innerHTML = report.selectedTeam
    .map(
      (player) => `
        <div class="player-row">
          <input type="checkbox" checked disabled>
          <div>
            <div class="player-name">${escapeHtml(player.name)}</div>
            <div class="player-meta">${escapeHtml(player.profile)}</div>
          </div>
          <span class="badge">${escapeHtml(player.teamId)}</span>
        </div>
      `
    )
    .join("");
  els.selectedCount.textContent = "5 / 5";
  els.focusPlayer.innerHTML = `<option>${escapeHtml(report.focusPlayer.name)}</option>`;
  els.focusPlayer.disabled = true;
  els.targetRole.value = report.targetRole || "Auto";
  els.targetRole.disabled = true;
  els.createReport.disabled = true;
}

function renderPlayers() {
  const match = state.match;
  if (!match) return;
  els.playerList.className = "player-list";
  els.playerList.innerHTML = match.players
    .map(
      (player) => `
        <label class="player-row">
          <input type="checkbox" value="${escapeHtml(player.id)}">
          <div>
            <div class="player-name">${escapeHtml(player.name)}</div>
            <div class="player-meta">${escapeHtml(player.profile)} · ${escapeHtml(player.steamId)}</div>
          </div>
          <span class="badge ${player.teamId === "team_a" ? "" : "muted"}">${escapeHtml(player.teamId)}</span>
        </label>
      `
    )
    .join("");

  els.playerList.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      if (checkbox.checked && state.selectedIds.size >= 5) {
        checkbox.checked = false;
        return;
      }
      if (checkbox.checked) state.selectedIds.add(checkbox.value);
      else state.selectedIds.delete(checkbox.value);
      updateSelectionUi();
    });
  });
  updateSelectionUi();
}

function autoSelectTeam() {
  if (!state.match) return;
  state.selectedIds = new Set(state.match.players.filter((player) => player.teamId === "team_a").slice(0, 5).map((player) => player.id));
  els.playerList.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
    checkbox.checked = state.selectedIds.has(checkbox.value);
  });
  updateSelectionUi();
}

function updateSelectionUi() {
  els.selectedCount.textContent = `${state.selectedIds.size} / 5`;
  const selectedPlayers = (state.match?.players || []).filter((player) => state.selectedIds.has(player.id));
  const selectedTeams = new Set(selectedPlayers.map((player) => player.teamId));
  els.focusPlayer.disabled = selectedPlayers.length !== 5;
  els.focusPlayer.innerHTML = selectedPlayers.length
    ? selectedPlayers.map((player) => `<option value="${escapeHtml(player.id)}">${escapeHtml(player.name)}</option>`).join("")
    : "<option>先选择五名队员</option>";
  if (selectedPlayers.length === 5 && selectedTeams.size === 1) {
    els.selectionHint.textContent = "可以生成包含证据链的复盘报告。";
    els.selectionHint.classList.remove("status-error");
    els.selectionHint.classList.add("status-ok");
  } else if (selectedPlayers.length === 5) {
    els.selectionHint.textContent = "五名玩家需要来自同一队伍。";
    els.selectionHint.classList.remove("status-ok");
    els.selectionHint.classList.add("status-error");
  } else {
    els.selectionHint.textContent = "需要选择己方五名玩家和一个重点分析对象。";
    els.selectionHint.classList.remove("status-ok");
  }
  updateCreateButton();
}

function updateCreateButton() {
  const selectedPlayers = (state.match?.players || []).filter((player) => state.selectedIds.has(player.id));
  const selectedTeams = new Set(selectedPlayers.map((player) => player.teamId));
  els.createReport.disabled =
    !state.upload ||
    state.match?.supportedMap === false ||
    state.selectedIds.size !== 5 ||
    selectedTeams.size !== 1 ||
    !els.focusPlayer.value ||
    els.createReport.textContent === "生成中...";
}

function renderReport() {
  if (!state.report) return;
  const renderers = {
    overview: renderOverview,
    personal: renderPersonal,
    team: renderTeam,
    rounds: renderRounds,
    tactics: renderTactics,
    training: renderTraining
  };
  els.reportContent.innerHTML = renderers[state.activeTab](state.report);
}

function renderOverview(report) {
  return `
    <div class="section-grid">
      <article class="report-card">
        <h3>本场总结</h3>
        <p>${escapeHtml(report.overview.summary)}</p>
        <div class="chip-row">
          <span class="chip">地图 ${escapeHtml(report.match.map)}</span>
          <span class="chip">比分 ${escapeHtml(report.overview.score)}</span>
          <span class="chip">证据 ${report.evidenceCount}</span>
        </div>
        <p><strong>最大问题：</strong>${escapeHtml(report.overview.biggestProblem)}</p>
        <p><strong>最大优势：</strong>${escapeHtml(report.overview.biggestStrength)}</p>
      </article>
      <article class="report-card">
        <h3>三次转折</h3>
        <ul class="plain-list">
          ${report.overview.turningRounds
            .map((round) => `<li><strong>第 ${round.round} 回合</strong><br>${escapeHtml(round.reason)}<br><span class="evidence">${escapeHtml(round.tags.join(" / "))}</span></li>`)
            .join("")}
        </ul>
      </article>
    </div>
    <article class="report-card">
      <h3>回合结果</h3>
      <div class="round-strip">
        ${report.overview.roundResults
          .map((round) => `<span class="round-pill ${round.winner === "team_a" ? "win-a" : "win-b"}" title="${escapeHtml(round.economy)}">${round.round}</span>`)
          .join("")}
      </div>
    </article>
      <article class="report-card">
        <h3>解析说明</h3>
        <p class="meta">${escapeHtml(report.caveat)}</p>
        <p class="meta">${escapeHtml(aiCoachText(report.aiCoach))}</p>
      </article>
  `;
}

function renderPersonal(report) {
  return `
    <div class="section-grid">
      ${report.personalReports
        .map(
          (personal) => `
            <article class="report-card">
              <h3>${escapeHtml(personal.player.name)}</h3>
              <div class="chip-row">
                ${personal.recommendedRoles.map((role) => `<span class="chip">${escapeHtml(role)}</span>`).join("")}
              </div>
              <p>${escapeHtml(personal.roleReason)}</p>
              <p>${escapeHtml(personal.targetRoleFit)}</p>
              <div class="match-grid">
                ${statHtml("K/D", personal.stats.kd)}
                ${statHtml("ADR", personal.stats.adr)}
                ${statHtml("KAST", personal.stats.kast)}
                ${statHtml("补枪率", personal.stats.tradeKillRate)}
              </div>
              ${personal.habits
                .map(
                  (habit) => `
                    <h4>${escapeHtml(habit.title)} <span class="badge severity ${severityClass(habit.severity)}">${escapeHtml(habit.severity)}</span></h4>
                    <ul class="evidence-list">
                      ${habit.evidence
                        .map((item) => `<li><span class="evidence">第 ${item.round} 回合 ${escapeHtml(item.time)} · ${escapeHtml(item.location)}</span><br>${escapeHtml(item.event)}</li>`)
                        .join("")}
                    </ul>
                    <p><strong>改法：</strong>${escapeHtml(habit.specificFix)}</p>
                    <p><strong>训练：</strong>${escapeHtml(habit.training)}</p>
                    ${feedbackControls("habit", habit.id)}
                  `
                )
                .join("")}
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderTeam(report) {
  const team = report.teamReport;
  return `
    <div class="section-grid">
      <article class="report-card">
        <h3>团队风格</h3>
        <p>${escapeHtml(team.style)}</p>
        <p><strong>T 方依赖：</strong>${escapeHtml(team.tSideDependency)}</p>
        <p><strong>CT 转点：</strong>${escapeHtml(team.ctRotation)}</p>
        <p><strong>薄弱区域：</strong>${escapeHtml(team.weakArea)}</p>
        <p><strong>最容易输的局势：</strong>${escapeHtml(team.fragileSituation)}</p>
      </article>
      <article class="report-card">
        <h3>角色分配</h3>
        <ul class="assignment-list">
          ${team.roleAllocation
            .map((role) => `<li><strong>${escapeHtml(role.player)}</strong> · ${escapeHtml(role.primaryRole)} / ${escapeHtml(role.secondaryRole)}<br><span class="evidence">${escapeHtml(role.basis)}</span></li>`)
            .join("")}
        </ul>
      </article>
      <article class="report-card">
        <h3>强项与短板</h3>
        <h4>强项</h4>
        <ul class="plain-list">${team.strengths.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        <h4>短板</h4>
        <ul class="plain-list">${team.weaknesses.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </article>
      <article class="report-card">
        <h3>局势胜率</h3>
        <div class="match-grid">
          ${Object.entries(team.situationWinRates)
            .map(([label, value]) => statHtml(label, value))
            .join("")}
        </div>
      </article>
    </div>
  `;
}

function renderRounds(report) {
  return `
    <div class="section-grid">
      ${report.keyRounds
        .map(
          (round) => `
            <article class="report-card">
              <h3>${escapeHtml(round.title)}</h3>
              <div class="chip-row">${round.tags.map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join("")}</div>
              <p><strong>结果：</strong>${escapeHtml(round.result)}</p>
              <p><strong>主要失误：</strong>${escapeHtml(round.mainMistake)}</p>
              <p><strong>更好打法：</strong>${escapeHtml(round.betterPlay)}</p>
              <ul class="timeline">
                ${round.timeline
                  .map((event) => `<li><span class="evidence">${escapeHtml(event.time)} · ${escapeHtml(event.location)} · ${escapeHtml(event.player)}</span><br>${escapeHtml(event.event)}</li>`)
                  .join("")}
              </ul>
              ${feedbackControls("key_round", round.id)}
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderTactics(report) {
  return `
    <div class="section-grid">
      ${report.tactics
        .map(
          (tactic) => `
            <article class="report-card">
              <div class="tactic-header">
                <h3>${escapeHtml(tactic.name)}</h3>
                <span class="badge">${escapeHtml(tactic.side)}</span>
              </div>
              <p class="meta">${escapeHtml(tactic.map)} · ${escapeHtml(tactic.economyCondition)}</p>
              <p><strong>目标：</strong>${escapeHtml(tactic.objective)}</p>
              <p><strong>适合原因：</strong>${escapeHtml(tactic.whyFits)}</p>
              <h4>五人分工</h4>
              <ul class="assignment-list">
                ${tactic.assignments
                  .map((item) => `<li><strong>${escapeHtml(item.player)}</strong> · ${escapeHtml(item.role)}<br>${escapeHtml(item.duty)}</li>`)
                  .join("")}
              </ul>
              <p><strong>开局站位：</strong>${escapeHtml(tactic.openingSetup)}</p>
              <p><strong>道具：</strong>${escapeHtml(tactic.utility.join(" / "))}</p>
              <p><strong>执行时机：</strong>${escapeHtml(tactic.timing)}</p>
              <p><strong>失败预案：</strong>${escapeHtml(tactic.contingency)}</p>
              <h4>证据绑定</h4>
              <ul class="evidence-list">
                ${tactic.evidence
                  .map((item) => `<li>第 ${item.round} 回合 ${escapeHtml(item.time)} · ${escapeHtml(item.location)}<br>${escapeHtml(item.event)}</li>`)
                  .join("")}
              </ul>
              ${feedbackControls("tactic", tactic.id)}
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderTraining(report) {
  return `
    <article class="report-card">
      <h3>本周训练重点</h3>
      <p><strong>优先局势：</strong>${escapeHtml(report.trainingPlan.focus)}</p>
      <ul class="plain-list">
        ${report.trainingPlan.weekPlan
          .map(
            (task) => `
              <li>
                <strong>${escapeHtml(task.title)}</strong><br>
                目标：${escapeHtml(task.objective)}<br>
                练法：${escapeHtml(task.drill)}<br>
                <span class="evidence">验收：${escapeHtml(task.successMetric)}</span>
                ${feedbackControls("training", task.id)}
              </li>
            `
          )
          .join("")}
      </ul>
    </article>
  `;
}

function feedbackControls(targetType, targetId) {
  return `
    <div class="feedback-row" data-feedback-target="${escapeHtml(targetType)}:${escapeHtml(targetId)}">
      <button class="feedback-button" type="button" data-feedback-rating="useful" data-target-type="${escapeHtml(targetType)}" data-target-id="${escapeHtml(targetId)}">有用</button>
      <button class="feedback-button" type="button" data-feedback-rating="inaccurate" data-target-type="${escapeHtml(targetType)}" data-target-id="${escapeHtml(targetId)}">不准</button>
    </div>
  `;
}

function severityClass(severity) {
  if (severity === "高") return "";
  if (severity === "低") return "low";
  return "mid";
}

async function submitFeedback(button) {
  if (!state.report) return;
  button.disabled = true;
  try {
    await api("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reportId: state.report.id,
        targetType: button.dataset.targetType,
        targetId: button.dataset.targetId,
        rating: button.dataset.feedbackRating
      })
    });
    const row = button.closest(".feedback-row");
    row?.querySelectorAll(".feedback-button").forEach((item) => item.classList.remove("selected"));
    button.classList.add("selected");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

async function copyShareLink() {
  if (!state.report) return;
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("report", state.report.id);
  try {
    await navigator.clipboard.writeText(url.toString());
    els.copyShareLink.textContent = "已复制";
    setTimeout(() => {
      els.copyShareLink.textContent = "复制分享链接";
    }, 1200);
  } catch {
    window.history.replaceState({}, "", url);
    els.copyShareLink.textContent = "链接已写入地址栏";
    setTimeout(() => {
      els.copyShareLink.textContent = "复制分享链接";
    }, 1400);
  }
}

function setProgress(value) {
  const safe = Math.max(0, Math.min(100, value));
  els.uploadProgress.style.width = `${safe}%`;
  els.uploadPercent.textContent = `${safe}%`;
}

function startParseProgress() {
  stopParseProgress();
  state.parseTimer = setInterval(() => {
    const current = Number.parseInt(els.uploadPercent.textContent, 10) || 95;
    if (current < 99) {
      setProgress(current + 1);
    }
  }, 900);
}

function stopParseProgress() {
  if (state.parseTimer) {
    clearInterval(state.parseTimer);
    state.parseTimer = null;
  }
}

function setStatus(message, type = "") {
  els.uploadStatus.textContent = message;
  els.uploadStatus.classList.toggle("status-error", type === "error");
  els.uploadStatus.classList.toggle("status-ok", type === "ok");
}

function parserNote(parser) {
  if (parser?.fallback) {
    return `真实解析器不可用，已降级到 deterministic Mirage fallback：${parser.fallbackReason}`;
  }
  return `解析器：${parser?.name || "external"} (${parser?.mode || "unknown"})`;
}

function aiCoachText(aiCoach) {
  if (!aiCoach) return "AI coach: not configured";
  if (aiCoach.mode === "external-ai") {
    return `AI coach: ${aiCoach.provider} - ${aiCoach.summary}`;
  }
  return `AI coach: rules-only - ${aiCoach.status || "external AI not configured"}`;
}

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `请求失败：${response.status}`);
  }
  return data;
}

function parseJson(text) {
  try {
    return JSON.parse(text || "{}");
  } catch {
    return {};
  }
}

function statHtml(label, value) {
  return `
    <div class="stat">
      <span class="stat-label">${escapeHtml(label)}</span>
      <strong class="stat-value">${escapeHtml(String(value))}</strong>
    </div>
  `;
}

function buildSampleDemoBytes() {
  const lines = [
    "CS2 DEMO PLACEHOLDER",
    "map=de_mirage",
    "players=10",
    `seed=${Date.now()}`,
    "This local MVP validates upload, parsing, evidence selection, and report generation."
  ];
  return lines.join("\n");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

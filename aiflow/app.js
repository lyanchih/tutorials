// ============================================================================
// AI Agent, Skills & MCP 互動式教學網站 — 前端互動邏輯 (app.js)
// ============================================================================

(function () {
  const data = window.TUTORIAL_DATA;

  // Token 區塊配色與標籤定義
  const SEGMENT_META = [
    { key: "system", label: "📜 System Rules", color: "var(--seg-system)" },
    { key: "skillMeta", label: "🏷️ Skills 目錄索引", color: "var(--seg-skill-meta)" },
    { key: "skillBody", label: "📚 已載入 SKILL.md", color: "var(--seg-skill-body)" },
    { key: "mcpSchema", label: "🔌 MCP 工具 Schema", color: "var(--seg-mcp)" },
    { key: "user", label: "👤 使用者提問", color: "var(--seg-user)" },
    { key: "thinking", label: "💭 Thinking 思考", color: "var(--seg-thinking)" },
    { key: "toolIo", label: "🛠️ 工具/Subagent 回傳", color: "var(--seg-tool-io)" },
    { key: "assistant", label: "🤖 Agent 正式回覆", color: "var(--seg-assistant)" }
  ];

  function formatNum(n) {
    return Number(n || 0).toLocaleString("en-US");
  }

  // --------------------------------------------------------------------------
  // 1. 深淺色主題切換
  // --------------------------------------------------------------------------
  const themeToggleBtn = document.getElementById("themeToggle");
  themeToggleBtn.addEventListener("click", () => {
    const htmlEl = document.documentElement;
    const current = htmlEl.getAttribute("data-theme") || "dark";
    const next = current === "dark" ? "light" : "dark";
    htmlEl.setAttribute("data-theme", next);
    themeToggleBtn.textContent = next === "dark" ? "🌙 淺色模式" : "☀️ 深色模式";
  });

  // --------------------------------------------------------------------------
  // 2. 互動式架構圖 (Architecture Explorer)
  // --------------------------------------------------------------------------
  const archDetailPanel = document.getElementById("archDetailPanel");
  const archNodes = document.querySelectorAll(".arch-node");

  function renderArchNode(nodeId) {
    const info = data.architectureNodes[nodeId];
    if (!info) return;

    archNodes.forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-node") === nodeId);
    });

    const impactClass =
      info.tokenLevel === "low"
        ? "impact-low"
        : info.tokenLevel === "medium"
        ? "impact-medium"
        : "impact-high";

    const bulletsHtml = info.details.map((d) => `<li>${d}</li>`).join("");

    archDetailPanel.innerHTML = `
      <div class="detail-header">
        <h3>${info.title}</h3>
        <span class="impact-pill ${impactClass}">Token 影響：${info.tokenImpact}</span>
      </div>
      <div class="detail-metaphor-box">
        <strong>💡 白話比喻：</strong>${info.metaphor}<br/>
        <span>${info.summary}</span>
      </div>
      <ul class="detail-bullets">
        ${bulletsHtml}
      </ul>
      <div class="code-preview-box">
        <div class="code-preview-header">📄 ${info.codeTitle}</div>
        <pre><code>${escapeHtml(info.codeExample)}</code></pre>
      </div>
    `;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  archNodes.forEach((btn) => {
    btn.addEventListener("click", () => {
      renderArchNode(btn.getAttribute("data-node"));
    });
  });

  // 點擊上方比喻卡可直接跳轉並高亮對應架構節點
  document.querySelectorAll(".metaphor-card").forEach((card) => {
    card.addEventListener("click", () => {
      const targetNode = card.getAttribute("data-jump-arch");
      if (targetNode) {
        renderArchNode(targetNode);
        document.getElementById("architecture").scrollIntoView({ behavior: "smooth" });
      }
    });
  });

  // 預設顯示 agent 節點
  renderArchNode("agent");

  // --------------------------------------------------------------------------
  // 3. 核心重頭戲：Token 變化與 Context Window 互動模擬器
  // --------------------------------------------------------------------------
  let currentScenarioIdx = 0;
  let currentStepIdx = 0;
  let isAltComparisonMode = false;
  let autoPlayTimer = null;

  const scenarioTabsEl = document.getElementById("scenarioTabs");
  const simTitleEl = document.getElementById("simTitle");
  const simSubtitleEl = document.getElementById("simSubtitle");
  const comparisonToggleWrapper = document.getElementById("comparisonToggleWrapper");
  const comparisonModeToggle = document.getElementById("comparisonModeToggle");
  const comparisonToggleText = document.getElementById("comparisonToggleText");

  const prevStepBtn = document.getElementById("prevStepBtn");
  const nextStepBtn = document.getElementById("nextStepBtn");
  const autoPlayBtn = document.getElementById("autoPlayBtn");
  const stepIndicatorsEl = document.getElementById("stepIndicators");
  const stepCounterBadgeEl = document.getElementById("stepCounterBadge");

  const modeStatusPill = document.getElementById("modeStatusPill");
  const currentContextTotalEl = document.getElementById("currentContextTotal");
  const contextLimitSpanEl = document.getElementById("contextLimitSpan");
  const contextUsagePercentEl = document.getElementById("contextUsagePercent");
  const stackedBarContainerEl = document.getElementById("stackedBarContainer");
  const segmentLegendEl = document.getElementById("segmentLegend");

  const stepActorBadgeEl = document.getElementById("stepActorBadge");
  const stepPhaseNameEl = document.getElementById("stepPhaseName");
  const stepDetailTitleEl = document.getElementById("stepDetailTitle");
  const stepDetailDescEl = document.getElementById("stepDetailDesc");
  const simChatBubbleEl = document.getElementById("simChatBubble");
  const simInsightBoxEl = document.getElementById("simInsightBox");

  const turnInputValEl = document.getElementById("turnInputVal");
  const turnOutputValEl = document.getElementById("turnOutputVal");
  const cumulativeTotalValEl = document.getElementById("cumulativeTotalVal");
  const savingsComparisonBadgeEl = document.getElementById("savingsComparisonBadge");
  const bestPracticeCumValEl = document.getElementById("bestPracticeCumVal");
  const altPracticeCumValEl = document.getElementById("altPracticeCumVal");
  const altPracticeCumLabelEl = document.getElementById("altPracticeCumLabel");
  const bestCumBarEl = document.getElementById("bestCumBar");
  const altCumBarEl = document.getElementById("altCumBar");
  const altCumTrackEl = document.getElementById("altCumTrack");

  function stopAutoPlay() {
    if (autoPlayTimer) {
      clearInterval(autoPlayTimer);
      autoPlayTimer = null;
      autoPlayBtn.textContent = "▶ 自動播放";
    }
  }

  function renderScenarioTabs() {
    scenarioTabsEl.innerHTML = data.scenarios
      .map(
        (sc, idx) => `
        <button class="scenario-tab-btn ${idx === currentScenarioIdx ? "active" : ""}" data-sc-idx="${idx}">
          <strong>${sc.title}</strong>
          <span>${sc.subtitle}</span>
        </button>
      `
      )
      .join("");

    scenarioTabsEl.querySelectorAll(".scenario-tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        stopAutoPlay();
        currentScenarioIdx = Number(btn.getAttribute("data-sc-idx"));
        currentStepIdx = 0;
        isAltComparisonMode = false;
        comparisonModeToggle.checked = false;
        renderScenarioTabs();
        renderSimulator();
      });
    });
  }

  function renderSimulator() {
    const scenario = data.scenarios[currentScenarioIdx];
    const step = scenario.steps[currentStepIdx];

    simTitleEl.textContent = scenario.title;
    simSubtitleEl.textContent = scenario.subtitle;
    contextLimitSpanEl.textContent = formatNum(scenario.contextLimit);

    if (scenario.hasComparisonMode) {
      comparisonToggleWrapper.style.display = "block";
      comparisonToggleText.textContent = scenario.comparisonLabel;
    } else {
      comparisonToggleWrapper.style.display = "none";
      isAltComparisonMode = false;
    }

    // 更新模式標籤
    if (isAltComparisonMode && scenario.hasComparisonMode) {
      modeStatusPill.textContent = "💥 反面教材模式 (Token 暴增)";
      modeStatusPill.className = "mode-pill pill-bad";
    } else {
      modeStatusPill.textContent = "✨ 最佳實踐模式";
      modeStatusPill.className = "mode-pill pill-good";
    }

    // 步驟圓點
    stepIndicatorsEl.innerHTML = scenario.steps
      .map(
        (s, idx) => `
        <button class="step-dot ${idx === currentStepIdx ? "active" : idx < currentStepIdx ? "completed" : ""}" data-step-idx="${idx}" title="${s.title}">
          ${s.stepNumber}
        </button>
      `
      )
      .join("");

    stepIndicatorsEl.querySelectorAll(".step-dot").forEach((dot) => {
      dot.addEventListener("click", () => {
        stopAutoPlay();
        currentStepIdx = Number(dot.getAttribute("data-step-idx"));
        renderSimulator();
      });
    });

    stepCounterBadgeEl.textContent = `Step ${currentStepIdx + 1} / ${scenario.steps.length}`;
    prevStepBtn.disabled = currentStepIdx === 0;
    nextStepBtn.disabled = currentStepIdx === scenario.steps.length - 1;

    // 計算當前步驟各色塊數值
    const activeSegments =
      isAltComparisonMode && step.altSegments ? step.altSegments : step.segments;

    let totalContextNow = 0;
    SEGMENT_META.forEach((m) => {
      totalContextNow += activeSegments[m.key] || 0;
    });

    const usagePct = Math.min(100, Math.round((totalContextNow / scenario.contextLimit) * 100));
    currentContextTotalEl.textContent = formatNum(totalContextNow);
    contextUsagePercentEl.textContent = `${usagePct}%`;

    // 渲染堆疊色塊條
    stackedBarContainerEl.innerHTML = SEGMENT_META.map((m) => {
      const val = activeSegments[m.key] || 0;
      const widthPct = (val / scenario.contextLimit) * 100;
      const showLabel = widthPct > 6 ? `${formatNum(val)}` : "";
      return `<div class="bar-segment" style="width: ${widthPct}%; background: ${m.color};" title="${m.label}: ${formatNum(val)} tokens">${showLabel}</div>`;
    }).join("");

    // 渲染圖例
    segmentLegendEl.innerHTML = SEGMENT_META.map((m) => {
      const val = activeSegments[m.key] || 0;
      return `
        <div class="legend-item ${val > 0 ? "active-seg" : ""}">
          <div class="legend-left">
            <span class="legend-color" style="background: ${m.color};"></span>
            <span>${m.label}</span>
          </div>
          <strong>${formatNum(val)}</strong>
        </div>
      `;
    }).join("");

    // 左下：步驟對話與思考詳情
    stepActorBadgeEl.textContent = step.actor;
    stepPhaseNameEl.textContent = step.phase;
    stepDetailTitleEl.textContent = step.title;
    stepDetailDescEl.textContent = step.description;

    const roleMap = {
      user: { label: "👤 User Input", cls: "role-user" },
      thinking: { label: "💭 LLM Internal Thinking (計入 Output Token)", cls: "role-thinking" },
      tool: { label: "🛠️ Tool / Skill / Subagent 互動", cls: "role-tool" },
      assistant: { label: "🤖 Assistant Final Answer", cls: "role-assistant" }
    };
    const rInfo = roleMap[step.chatBubble.role] || roleMap.assistant;

    simChatBubbleEl.innerHTML = `
      <span class="bubble-role-tag ${rInfo.cls}">${rInfo.label}</span>
      <div style="white-space: pre-line;">${escapeHtml(step.chatBubble.text)}</div>
      ${
        step.chatBubble.toolCall
          ? `<div class="bubble-tool-call">⚡ Tool Call: ${escapeHtml(step.chatBubble.toolCall)}</div>`
          : ""
      }
    `;

    simInsightBoxEl.innerHTML = step.insight;

    // 右下：計算本輪與截至目前的累計 Tokens
    const turnIn =
      isAltComparisonMode && step.altTurnInputTokens !== undefined
        ? step.altTurnInputTokens
        : step.turnInputTokens;
    const turnOut =
      isAltComparisonMode && step.altTurnOutputTokens !== undefined
        ? step.altTurnOutputTokens
        : step.turnOutputTokens;

    turnInputValEl.textContent = formatNum(turnIn);
    turnOutputValEl.textContent = formatNum(turnOut);

    // 累計計算 (Step 0 ~ currentStepIdx)
    let bestCum = 0;
    let altCum = 0;
    for (let i = 0; i <= currentStepIdx; i++) {
      const s = scenario.steps[i];
      bestCum += (s.turnInputTokens || 0) + (s.turnOutputTokens || 0);
      altCum +=
        (s.altTurnInputTokens !== undefined ? s.altTurnInputTokens : s.turnInputTokens || 0) +
        (s.altTurnOutputTokens !== undefined ? s.altTurnOutputTokens : s.turnOutputTokens || 0);
    }

    const displayedCum = isAltComparisonMode ? altCum : bestCum;
    cumulativeTotalValEl.textContent = `${formatNum(displayedCum)} tokens`;

    bestPracticeCumValEl.textContent = `${formatNum(bestCum)} tokens`;
    altPracticeCumValEl.textContent = `${formatNum(altCum)} tokens`;

    if (scenario.hasComparisonMode) {
      altPracticeCumLabelEl.style.display = "inline";
      altCumTrackEl.style.display = "block";
      const maxVal = Math.max(altCum, bestCum, 1);
      bestCumBarEl.style.width = `${Math.max(6, Math.round((bestCum / maxVal) * 100))}%`;
      altCumBarEl.style.width = `${Math.max(6, Math.round((altCum / maxVal) * 100))}%`;

      const saved = altCum - bestCum;
      const savedPct = altCum > 0 ? Math.round((saved / altCum) * 100) : 0;
      if (saved > 0) {
        savingsComparisonBadgeEl.style.display = "inline-block";
        savingsComparisonBadgeEl.textContent = `✨ 最佳實踐省下 ${formatNum(saved)} tokens (-${savedPct}%)`;
      } else {
        savingsComparisonBadgeEl.style.display = "none";
      }
    } else {
      altPracticeCumLabelEl.style.display = "none";
      altCumTrackEl.style.display = "none";
      savingsComparisonBadgeEl.style.display = "none";
      bestCumBarEl.style.width = "100%";
    }
  }

  prevStepBtn.addEventListener("click", () => {
    stopAutoPlay();
    if (currentStepIdx > 0) {
      currentStepIdx--;
      renderSimulator();
    }
  });

  nextStepBtn.addEventListener("click", () => {
    stopAutoPlay();
    const scenario = data.scenarios[currentScenarioIdx];
    if (currentStepIdx < scenario.steps.length - 1) {
      currentStepIdx++;
      renderSimulator();
    }
  });

  autoPlayBtn.addEventListener("click", () => {
    if (autoPlayTimer) {
      stopAutoPlay();
      return;
    }
    const scenario = data.scenarios[currentScenarioIdx];
    if (currentStepIdx >= scenario.steps.length - 1) {
      currentStepIdx = 0;
      renderSimulator();
    }
    autoPlayBtn.textContent = "⏸ 暫停播放";
    autoPlayTimer = setInterval(() => {
      const sc = data.scenarios[currentScenarioIdx];
      if (currentStepIdx < sc.steps.length - 1) {
        currentStepIdx++;
        renderSimulator();
      } else {
        stopAutoPlay();
      }
    }, 2600);
  });

  comparisonModeToggle.addEventListener("change", (e) => {
    isAltComparisonMode = e.target.checked;
    renderSimulator();
  });

  renderScenarioTabs();
  renderSimulator();

  // --------------------------------------------------------------------------
  // 4. 動手組裝你的 AI Agent 實驗室 (Sandbox Calculator)
  // --------------------------------------------------------------------------
  const sandboxMcpListEl = document.getElementById("sandboxMcpList");
  const sandboxSkillsListEl = document.getElementById("sandboxSkillsList");
  const mcpSelectedSummaryEl = document.getElementById("mcpSelectedSummary");
  const skillsSelectedSummaryEl = document.getElementById("skillsSelectedSummary");
  const strategySkillCard = document.getElementById("strategySkillCard");
  const strategyPromptCard = document.getElementById("strategyPromptCard");
  const thinkingDepthSelect = document.getElementById("thinkingDepthSelect");
  const loopStepsRange = document.getElementById("loopStepsRange");
  const loopStepsValEl = document.getElementById("loopStepsVal");

  const healthScoreBanner = document.getElementById("healthScoreBanner");
  const healthScoreCircle = document.getElementById("healthScoreCircle");
  const healthTitle = document.getElementById("healthTitle");
  const healthAdvice = document.getElementById("healthAdvice");

  const sbBaseTokensEl = document.getElementById("sbBaseTokens");
  const sbTotalTaskTokensEl = document.getElementById("sbTotalTaskTokens");
  const sbSavedTokensEl = document.getElementById("sbSavedTokens");
  const sbSavedPercentEl = document.getElementById("sbSavedPercent");
  const sandboxTurnBarsEl = document.getElementById("sandboxTurnBars");

  function initSandboxLists() {
    sandboxMcpListEl.innerHTML = data.sandboxItems.mcpServers
      .map(
        (mcp) => `
        <label class="check-item">
          <div class="check-left">
            <input type="checkbox" class="sb-mcp-check" value="${mcp.id}" ${
          mcp.recommended ? "checked" : ""
        } />
            <span>${mcp.name}</span>
          </div>
          <span class="check-tokens-tag">${mcp.toolsCount} tools · +${formatNum(
          mcp.schemaTokens
        )} tokens</span>
        </label>
      `
      )
      .join("");

    sandboxSkillsListEl.innerHTML = data.sandboxItems.skillsList
      .map(
        (sk) => `
        <label class="check-item">
          <div class="check-left">
            <input type="checkbox" class="sb-skill-check" value="${sk.id}" ${
          sk.defaultSelected ? "checked" : ""
        } />
            <span>${sk.name}</span>
          </div>
          <span class="check-tokens-tag">全文 ${formatNum(sk.fullTokens)}t</span>
        </label>
      `
      )
      .join("");

    document.querySelectorAll(".sb-mcp-check, .sb-skill-check").forEach((el) => {
      el.addEventListener("change", updateSandboxCalculation);
    });

    document.querySelectorAll('input[name="skillStrategy"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        strategySkillCard.classList.toggle("active", radio.value === "skills" && radio.checked);
        strategyPromptCard.classList.toggle("active", radio.value === "prompt" && radio.checked);
        updateSandboxCalculation();
      });
    });

    thinkingDepthSelect.addEventListener("change", updateSandboxCalculation);
    loopStepsRange.addEventListener("input", updateSandboxCalculation);
  }

  function updateSandboxCalculation() {
    const selectedMcpIds = Array.from(document.querySelectorAll(".sb-mcp-check:checked")).map(
      (el) => el.value
    );
    const selectedSkillIds = Array.from(document.querySelectorAll(".sb-skill-check:checked")).map(
      (el) => el.value
    );
    const strategy = document.querySelector('input[name="skillStrategy"]:checked').value;
    const thinkingPerStep = Number(thinkingDepthSelect.value);
    const stepsCount = Number(loopStepsRange.value);

    loopStepsValEl.textContent = `${stepsCount} 步`;

    const selectedMcps = data.sandboxItems.mcpServers.filter((m) => selectedMcpIds.includes(m.id));
    const selectedSkills = data.sandboxItems.skillsList.filter((s) =>
      selectedSkillIds.includes(s.id)
    );

    const totalMcpTools = selectedMcps.reduce((acc, m) => acc + m.toolsCount, 0);
    const mcpSchemaTokens = selectedMcps.reduce((acc, m) => acc + m.schemaTokens, 0);
    mcpSelectedSummaryEl.textContent = `已選 ${selectedMcps.length} 個 (${totalMcpTools} tools)`;
    skillsSelectedSummaryEl.textContent = `已選 ${selectedSkills.length} 套`;

    const coreSystemTokens = 750; // 基礎 System Prompt
    const skillsMetaTokens = selectedSkills.reduce((acc, s) => acc + s.metaTokens, 0);
    const skillsAllFullTokens = selectedSkills.reduce((acc, s) => acc + s.fullTokens, 0);
    // 若使用按需 Skills，假設在第 2 步載入其中 1 套平均大小的 Skill
    const singleTriggeredSkillTokens =
      selectedSkills.length > 0 ? selectedSkills[0].fullTokens : 0;

    // 計算兩種策略在 stepsCount 步下的總消耗
    let currentStrategyTotal = 0;
    let promptBloatedTotal = 0;
    const stepBreakdowns = [];

    for (let step = 1; step <= stepsCount; step++) {
      const sysAndMcp = coreSystemTokens + mcpSchemaTokens;
      const skillTokensInThisStep =
        strategy === "skills"
          ? skillsMetaTokens + (step >= 2 ? singleTriggeredSkillTokens : 0)
          : skillsAllFullTokens;

      const bloatedSkillTokens = skillsAllFullTokens;

      // 每一步累積的歷史對話與工具回傳 (Step 1 只有 User 120t，之後每步增加約 650t 工具結果與回應)
      const historyIoTokens = 120 + (step - 1) * 680;
      // 本步 Output = Thinking + 240t 回應/Tool Call
      const outputTokens = thinkingPerStep + 240;

      const stepTotal = sysAndMcp + skillTokensInThisStep + historyIoTokens + outputTokens;
      const bloatedStepTotal = sysAndMcp + bloatedSkillTokens + historyIoTokens + outputTokens;

      currentStrategyTotal += stepTotal;
      promptBloatedTotal += bloatedStepTotal;

      stepBreakdowns.push({
        step,
        sysAndMcp,
        skillTokensInThisStep,
        historyIoTokens,
        outputTokens,
        stepTotal
      });
    }

    const baseContextNow =
      coreSystemTokens +
      mcpSchemaTokens +
      (strategy === "skills" ? skillsMetaTokens : skillsAllFullTokens);

    sbBaseTokensEl.textContent = `${formatNum(baseContextNow)} t`;
    sbTotalTaskTokensEl.textContent = `${formatNum(currentStrategyTotal)} t`;

    const saved = Math.max(0, promptBloatedTotal - currentStrategyTotal);
    const savedPct =
      promptBloatedTotal > 0 ? Math.round((saved / promptBloatedTotal) * 100) : 0;
    sbSavedTokensEl.textContent = `${formatNum(saved)} t`;
    sbSavedPercentEl.textContent =
      strategy === "skills"
        ? `比全塞 Prompt 節省 ${savedPct}%`
        : "目前為全塞模式 (0% 節省)";

    // 繪製每一步的長條圖
    const maxStepTokens = Math.max(...stepBreakdowns.map((b) => b.stepTotal), 10000);
    sandboxTurnBarsEl.innerHTML = stepBreakdowns
      .map((b) => {
        const pSys = (b.sysAndMcp / maxStepTokens) * 100;
        const pSkill = (b.skillTokensInThisStep / maxStepTokens) * 100;
        const pIo = (b.historyIoTokens / maxStepTokens) * 100;
        const pOut = (b.outputTokens / maxStepTokens) * 100;
        return `
          <div class="turn-bar-row">
            <strong>Step ${b.step}</strong>
            <div class="turn-bar-track">
              <div class="turn-seg" style="width:${pSys}%; background:var(--seg-system);" title="常駐與 MCP Schema: ${formatNum(b.sysAndMcp)}"></div>
              <div class="turn-seg" style="width:${pSkill}%; background:var(--seg-skill-body);" title="Skills 佔用: ${formatNum(b.skillTokensInThisStep)}"></div>
              <div class="turn-seg" style="width:${pIo}%; background:var(--seg-tool-io);" title="歷史對話與工具累加: ${formatNum(b.historyIoTokens)}"></div>
              <div class="turn-seg" style="width:${pOut}%; background:var(--seg-thinking);" title="Thinking 與 Output: ${formatNum(b.outputTokens)}"></div>
            </div>
            <span style="text-align:right; font-weight:700;">${formatNum(b.stepTotal)} t</span>
          </div>
        `;
      })
      .join("");

    // 計算架構健康度評分
    let score = 96;
    const warnings = [];
    if (strategy === "prompt" && selectedSkills.length >= 2) {
      score -= 32;
      warnings.push("將多份 SOP 全塞進 System Prompt 導致每一輪重複消耗大量基礎 Token");
    }
    if (totalMcpTools > 35) {
      score -= 28;
      warnings.push(`掛載了 ${totalMcpTools} 個 MCP 工具，Schema 常駐成本過高 (${formatNum(mcpSchemaTokens)} tokens/輪)`);
    } else if (totalMcpTools > 20) {
      score -= 12;
      warnings.push("MCP 工具偏多，建議只開啟當前任務需要的 Server");
    }
    if (stepsCount >= 7 && thinkingPerStep >= 1800) {
      score -= 10;
      warnings.push("長迴圈搭配深度思考會產生可觀 Output 成本，建議將繁重搜尋拆給 Subagent");
    }

    score = Math.max(25, score);
    healthScoreCircle.textContent = score;

    if (score >= 85) {
      healthScoreCircle.style.background = "var(--accent-green)";
      healthScoreBanner.style.borderColor = "rgba(16, 185, 129, 0.4)";
      healthScoreBanner.style.background = "rgba(16, 185, 129, 0.12)";
      healthTitle.textContent = "架構健康度：優良 (精實高效 ✨)";
      healthAdvice.textContent =
        "完美配置！善用 Skills 按需載入並控制 MCP 工具數量，讓 Agent 保持高準確率與超低 Token 成本。";
    } else if (score >= 60) {
      healthScoreCircle.style.background = "var(--accent-amber)";
      healthScoreBanner.style.borderColor = "rgba(245, 158, 11, 0.4)";
      healthScoreBanner.style.background = "rgba(245, 158, 11, 0.12)";
      healthTitle.textContent = "架構健康度：尚可 (有瘦身空間 ⚠️)";
      healthAdvice.textContent = warnings.join("；") + "。";
    } else {
      healthScoreCircle.style.background = "var(--accent-rose)";
      healthScoreBanner.style.borderColor = "rgba(244, 63, 94, 0.4)";
      healthScoreBanner.style.background = "rgba(244, 63, 94, 0.12)";
      healthTitle.textContent = "架構健康度：肥胖警告 (Token 燃燒中 🔥)";
      healthAdvice.textContent = warnings.join("；") + "！請立即切換為「Skills 按需載入」並精簡 MCP。";
    }
  }

  initSandboxLists();
  updateSandboxCalculation();

  // --------------------------------------------------------------------------
  // 5. 對照表篩選與隨堂小測驗
  // --------------------------------------------------------------------------
  const comparisonTableBody = document.getElementById("comparisonTableBody");
  const filterChips = document.querySelectorAll(".filter-chip");

  function renderComparisonTable(filterTag) {
    comparisonTableBody.innerHTML = data.comparisonItems
      .map((item) => {
        const isMatched = filterTag !== "all" && item.tags.includes(filterTag);
        return `
          <tr class="${isMatched ? "highlighted-row" : ""}">
            <td><strong>${item.category}</strong></td>
            <td>${item.role}<br/><small style="color:var(--accent-amber);">比喻：${item.analogy}</small></td>
            <td>${item.whenLoaded}</td>
            <td>${item.tokenBehavior}</td>
            <td>${item.bestFor}</td>
          </tr>
        `;
      })
      .join("");
  }

  filterChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      filterChips.forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      renderComparisonTable(chip.getAttribute("data-filter"));
    });
  });

  renderComparisonTable("all");

  // 隨堂測驗渲染
  const quizListEl = document.getElementById("quizList");
  const quizScorePillEl = document.getElementById("quizScorePill");
  const answeredState = {};

  function renderQuiz() {
    quizListEl.innerHTML = data.quizQuestions
      .map(
        (q, qIdx) => `
        <div class="quiz-card" id="quiz-card-${qIdx}">
          <div class="quiz-q">${q.question}</div>
          <div class="quiz-options">
            ${q.options
              .map(
                (opt, optIdx) => `
              <button class="quiz-opt-btn" data-q="${qIdx}" data-opt="${optIdx}">
                ${String.fromCharCode(65 + optIdx)}. ${opt}
              </button>
            `
              )
              .join("")}
          </div>
          <div class="quiz-explanation" id="quiz-exp-${qIdx}">
            ${q.explanation}
          </div>
        </div>
      `
      )
      .join("");

    quizListEl.querySelectorAll(".quiz-opt-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const qIdx = Number(btn.getAttribute("data-q"));
        const optIdx = Number(btn.getAttribute("data-opt"));
        const qObj = data.quizQuestions[qIdx];

        const cardEl = document.getElementById(`quiz-card-${qIdx}`);
        const allBtns = cardEl.querySelectorAll(".quiz-opt-btn");
        allBtns.forEach((b) => {
          b.disabled = true;
          const bOpt = Number(b.getAttribute("data-opt"));
          if (bOpt === qObj.correctIndex) {
            b.classList.add("correct");
          } else if (bOpt === optIdx) {
            b.classList.add("wrong");
          }
        });

        answeredState[qIdx] = optIdx === qObj.correctIndex ? 1 : 0;
        const totalScore = Object.values(answeredState).reduce((a, b) => a + b, 0);
        quizScorePillEl.textContent = `目前得分：${totalScore} / ${data.quizQuestions.length}`;

        const expEl = document.getElementById(`quiz-exp-${qIdx}`);
        expEl.classList.add("visible");
      });
    });
  }

  renderQuiz();
})();

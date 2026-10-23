// ============================================================================
// AI Agent, Skills & MCP 互動式教學網站 — 核心教材與模擬資料
// ============================================================================

window.TUTORIAL_DATA = {
  // 1. 架構探索器節點資料
  architectureNodes: {
    user: {
      id: "user",
      title: "👤 使用者 (User Prompt)",
      badge: "起點",
      tokenImpact: "低 (依輸入長度而定，約 20 ~ 500 tokens)",
      tokenLevel: "low",
      metaphor: "餐廳裡的點餐客人",
      summary: "向 AI 提出目標或問題的人。在 Agent 時代，你不再需要一步步微操，而是給出「高層次目標」（例如：幫我修復登入頁面的 Bug 並補上測試）。",
      details: [
        "每次你發送訊息，這段文字就會被轉換成 Tokens 放進 Context Window。",
        "精確的目標描述可以減少 Agent 走冤枉路（減少無效的思考與工具呼叫迴圈），間接省下大量 Token！"
      ],
      codeTitle: "使用者輸入範例",
      codeExample: `請幫我檢查 src/auth/login.ts 為什麼會發生 Token 過期錯誤，
依照團隊的錯誤處理規範修復它，並執行單元測試確認通過。`
    },
    system: {
      id: "system",
      title: "📜 System Prompt & 全域記憶 (Rules / CLAUDE.md)",
      badge: "常駐記憶",
      tokenImpact: "中～高 (每一輪對話都固定載入，約 1,000 ~ 10,000+ tokens)",
      tokenLevel: "medium",
      metaphor: "員工入職手冊與基本守則（永遠貼在辦公桌前）",
      summary: "定義 Agent 的身份、安全邊界、專案基本架構與全天候都要遵守的鐵則（例如 CLAUDE.md、GEMINI.md、.cursorrules）。",
      details: [
        "⚠️ 永遠常駐：無論你問什麼問題，System Prompt 都會在「每一輪請求」中作為基礎 Input Tokens 送出。",
        "💡 最佳實踐：只放「所有任務都必須知道」的精簡規則（控制在 500~2,000 tokens 內）。特定領域的長篇教學請改放進 Skills！"
      ],
      codeTitle: "GEMINI.md / CLAUDE.md 精簡範例",
      codeExample: `# Project Guidelines
- Tech Stack: TypeScript, React 19, Vite, Vitest
- 執行測試指令: \`npm run test:unit\`
- 程式碼風格: 一律使用 Functional Component 與 Named Export
- 進階規範請按需查閱 \`.agents/skills/\` 目錄下的專業技能包`
    },
    agent: {
      id: "agent",
      title: "🤖 Agent 核心迴圈 (ReAct Loop: 感知→思考→行動→觀察)",
      badge: "指揮官",
      tokenImpact: "核心乘數 (每多跑一圈 Loop，歷史 Context 就重新計費一次)",
      tokenLevel: "high",
      metaphor: "有自主規劃能力的專案主廚",
      summary: "Agent 不是單純的問答機器，而是一個包裹著 LLM 的「自主控制迴圈」。它會先思考計畫、決定呼叫哪個工具或讀取哪個 Skill、觀察執行結果，直到達成目標。",
      details: [
        "🔄 多步推理迴圈：User 提問 → LLM 思考 → 發出 Tool Call → 執行工具拿到結果 → 把結果塞回 Context 再請 LLM 思考下一步。",
        "📈 Token 累加效應：如果一個任務讓 Agent 連續呼叫了 8 次工具，前面的對話與工具結果會像滾雪球一樣疊加送給模型 8 次（幸好現代 API 有 Prompt Caching 可折抵重複前綴成本）！"
      ],
      codeTitle: "Agent ReAct 迴圈概念偽代碼",
      codeExample: `while (!taskCompleted && steps < MAX_STEPS) {
  // 每次呼叫都會把整個 contextHistory 送給 LLM！
  const response = await llm.generate(contextHistory);
  if (response.thinking) recordThinkingTokens(response.thinking);
  
  if (response.toolCalls.length > 0) {
    const toolResults = await executeToolsOrMCP(response.toolCalls);
    contextHistory.push(response, toolResults); // Context 持續長大！
  } else {
    return response.finalAnswer;
  }
}`
    },
    llm: {
      id: "llm",
      title: "🧠 大語言模型與深度思考 (LLM & Extended Thinking)",
      badge: "推理大腦",
      tokenImpact: "依思考深度而定 (Thinking 產生約 200 ~ 8,000 Output tokens)",
      tokenLevel: "medium",
      metaphor: "在草稿紙上快速推演的智囊",
      summary: "負責理解語意、邏輯推演與決策的大腦。現代推理模型（如 Claude Sonnet/Opus、Gemini Pro、o3）在正式回答或呼叫工具前，會先在隱藏的草稿區進行「思考 (Thinking)」。",
      details: [
        "💭 Thinking Tokens 計費方式：模型的內部思考屬於模型生成的內容，因此算在 **Output Tokens**（通常單價較高）。",
        "🧹 歷史清理機制：為了不讓長篇大論的內心戲塞爆後續的 Context Window，大多數 Agent 框架在進入下一輪使用者對話時，會自動省略或壓縮上一輪的 Thinking 區塊！"
      ],
      codeTitle: "模型內部思考 (Thinking Block) 結構",
      codeExample: `<thought>
使用者想修復 login.ts 的 Token 過期問題。
1. 我目前還不知道 login.ts 的內容，應該先用 view_file 讀取它。
2. 看到 Skills 目錄裡有一個 "auth-security" 技能包，描述提到處理 JWT 刷新規範。
3. 我應該先載入該 Skill 的 SKILL.md，確保修法符合團隊標準。
</thought>
[Tool Call]: view_file(path=" .agents/skills/auth-security/SKILL.md")`
    },
    skills: {
      id: "skills",
      title: "📚 Skills 技能包 (漸進式載入的專業秘笈)",
      badge: "省 Token 神器",
      tokenImpact: "極省！待機僅 ~30 tokens/個；啟用時才載入 500~3,000 tokens",
      tokenLevel: "low",
      metaphor: "書架上的專業食譜（看目錄找書，要煮那道菜時才翻開內頁）",
      summary: "Skill 是模組化的領域知識、SOP 流程與輔助腳本（通常以 SKILL.md 為核心）。它解決了「把所有教學都塞進 System Prompt 導致 Token 爆炸」的痛點！",
      details: [
        "✨ 階段一（目錄索引 Metadata）：對話開始時，Agent 只會看到每個 Skill 的 `name` 和 `description`（每個僅約 30~50 tokens）。",
        "✨ 階段二（按需載入 On-Demand Load）：當 Agent 判斷當前任務需要某項技能時，才會主動讀取完整的 `SKILL.md` 進入 Context。",
        "✨ 階段三（附帶腳本與資源）：Skill 資料夾內還能放 Python/Bash 腳本或範本檔，Agent 可直接執行腳本而不必把整份程式碼讀進大腦！"
      ],
      codeTitle: ".agents/skills/pdf-processor/SKILL.md 範例",
      codeExample: `---
name: pdf-processor
description: 當需要解析、合併或從 PDF 擷取表格與文字時使用此技能。
---
# PDF 處理標準作業流程 (SOP)
1. 請優先使用本目錄下的 \`scripts/extract_tables.py\` 腳本，不要自己重寫解析器。
2. 執行指令：\`python3 .agents/skills/pdf-processor/scripts/extract_tables.py <input.pdf>\`
3. 若遇到掃描檔，請改用 OCR 參數 \`--ocr-lang chi_tra\`。`
    },
    mcp: {
      id: "mcp",
      title: "🔌 MCP (Model Context Protocol 模型上下文協定)",
      badge: "萬用轉接頭",
      tokenImpact: "中～高 (每個 MCP 工具的 JSON Schema 會常駐，回傳資料視大小而定)",
      tokenLevel: "high",
      metaphor: "AI 界的 USB-C 標準介面（插上就能連資料庫、GitHub、Figma、瀏覽器）",
      summary: "由 Anthropic 提出的開放標準協定。以前每個 AI 工具都要自己寫一套 API 串接；現在只要服務端提供 MCP Server，任何支援 MCP 的 Agent 都能即插即用！",
      details: [
        "🛠️ 三大核心能力：Tools（讓 AI 執行動作，如查 DB、發 PR）、Resources（讓 AI 讀取外部檔案/資料）、Prompts（預設模板）。",
        "⚠️ 隱藏的 Token 成本：每連接一個 MCP Server，它底下所有 Tools 的名稱、說明與參數 Schema 都會放進 System Context！如果一次掛載 10 個大型 MCP Server（共 100+ 個工具），光是什麼事都還沒做就會先消耗 15,000+ tokens！"
      ],
      codeTitle: "mcp_config.json 設定與 Tool Schema 範例",
      codeExample: `{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost/mydb"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"]
    }
  }
}`
    },
    subagent: {
      id: "subagent",
      title: "🕵️ Subagents 子代理 (獨立 Context 分工小隊)",
      badge: "Context 隔離",
      tokenImpact: "主對話極省！(子代理的大量搜尋過程完全隔離，只回傳精簡結論)",
      tokenLevel: "low",
      metaphor: "派出實習生去圖書館翻 50 本書，最後只拿一張 300 字重點便利貼回來給你",
      summary: "當主 Agent 遇到需要大量翻找程式碼、閱讀幾十個檔案或平行處理的子任務時，可以喚醒 Subagent 在「全新的獨立 Context Window」中工作。",
      details: [
        "🛡️ 保護主 Context：Subagent 讀取了 30 個檔案消耗的 50,000 tokens 會在子代理結束時直接銷毀，不會留在主對話歷史裡拖慢後續每一輪的計費。",
        "⚡ 平行處理：主 Agent 可以同時派出 3 個 Subagent 分別檢查前端、後端與資料庫，再匯總結果。"
      ],
      codeTitle: "主 Agent 委派 Subagent 的 Token 隔離效果",
      codeExample: `[Main Agent Context: 3,500 tokens]
  ├─> 呼叫 Subagent("搜尋全專案所有 API 路由並整理權限漏洞")
        │
        ▼ (獨立 Context Window，不污染主對話)
      [Subagent 讀取 25 個檔案... 消耗 42,000 tokens]
      [Subagent 整理出 3 點結論 (400 tokens)]
        │
  ◀─────┘ (只把 400 tokens 的結論傳回 Main Agent！)
[Main Agent Context 僅增加至 3,900 tokens！]`
    }
  },

  // 2. 四大核心觀念比較表
  comparisonItems: [
    {
      category: "System Rules (CLAUDE.md / GEMINI.md)",
      role: "全域守則與專案背景",
      analogy: "貼在牆上的公司憲法",
      whenLoaded: "每次對話啟動時 100% 完整載入",
      tokenBehavior: "固定常駐成本（每一輪都會重複作為 Input 送出）",
      bestFor: "專案技術棧、建置指令、核心命名規範、絕對禁止事項",
      tags: ["style", "global"]
    },
    {
      category: "Skills (技能包 / SKILL.md)",
      role: "專業 SOP、領域知識與腳本套件",
      analogy: "書架上的專業食譜與工具箱",
      whenLoaded: "平時只載入 1 行簡介；需要時才讀入完整內文",
      tokenBehavior: "極致省 Token！按需動態載入 (Progressive Disclosure)",
      bestFor: "特定工作流（如 PDF 處理、部署流程、撰寫特定測試、資料庫遷移規範）",
      tags: ["workflow", "style", "script"]
    },
    {
      category: "MCP (Model Context Protocol)",
      role: "連接外部系統與即時資料的標準協定",
      analogy: "USB-C 萬用硬體擴充塢",
      whenLoaded: "連線時載入所有 Tool Schemas；呼叫時載入回傳資料",
      tokenBehavior: "Tool 定義常駐（工具越多越耗 Token）；回傳結果依資料量變動",
      bestFor: "查詢資料庫、操作 GitHub PR/Issue、讀取 Notion/Slack、控制瀏覽器",
      tags: ["external", "data", "action"]
    },
    {
      category: "Subagents (子代理)",
      role: "獨立執行繁重或平行子任務的分身",
      analogy: "外派調查小隊",
      whenLoaded: "由主 Agent 動態指派啟動，用完即銷毀",
      tokenBehavior: "擁有獨立 Context Window！大量探索過程不進入主對話歷史",
      bestFor: "大規模程式碼搜尋、多模組平行重構、長篇文件閱讀與摘要",
      tags: ["search", "scale", "parallel"]
    }
  ],

  // 3. 重頭戲：Agent 對話、思考、Skills 與 MCP 的 Token 變化模擬劇本
  scenarios: [
    {
      id: "skills-vs-bloated",
      title: "劇本 1：使用 Skills 按需載入 vs 傳統塞爆 System Prompt",
      subtitle: "觀察 Skill 的「目錄索引 → 按需讀取」如何省下 75% 以上的累計 Token",
      contextLimit: 32000,
      hasComparisonMode: true,
      comparisonLabel: "切換對比：如果不用 Skills，把 15 個規範全塞進 System Prompt？",
      steps: [
        {
          stepNumber: 1,
          phase: "初始化與使用者提問",
          actor: "User",
          title: "對話啟動：只載入精簡 System Prompt 與 Skills 目錄摘要",
          description: "使用者要求：「幫我將這份財報 PDF 裡的資產負債表轉成 CSV，並檢查欄位是否平衡。」此時系統並未載入全部 15 個技能的長篇教學，每個 Skill 只放了 35 tokens 的名稱與描述！",
          chatBubble: {
            role: "user",
            text: "請幫我把 quarterly_report.pdf 裡的資產負債表擷取出來轉成 CSV，並驗證會計恆等式是否平衡。"
          },
          segments: {
            system: 800,
            skillMeta: 520,   // 15 個 skills 的簡短索引
            skillBody: 0,
            mcpSchema: 600,
            user: 65,
            thinking: 0,
            toolIo: 0,
            assistant: 0
          },
          altSegments: {
            system: 18500,    // 傳統作法：把 15 份長篇 SOP 全塞在 System Prompt
            skillMeta: 0,
            skillBody: 0,
            mcpSchema: 600,
            user: 65,
            thinking: 0,
            toolIo: 0,
            assistant: 0
          },
          turnInputTokens: 1985,
          turnOutputTokens: 0,
          altTurnInputTokens: 19165,
          altTurnOutputTokens: 0,
          insight: "💡 關鍵差異：使用 Skills 架構時，起手 Context 只有 1,985 tokens；若把 15 個領域的 SOP 全寫在 System Prompt，第一句話還沒開始處理就先噴了 19,165 tokens！"
        },
        {
          stepNumber: 2,
          phase: "Agent 思考與技能匹配",
          actor: "Agent (Thinking)",
          title: "內部思考 (Thinking)：從目錄中鎖定 `pdf-financial-extractor` 技能",
          description: "模型進行推理（產生 Thinking Tokens，計入本次 Output）。它掃描了 520 tokens 的 Skills 索引，發現 `pdf-financial-extractor` 剛好符合需求，於是決定呼叫 `view_file` 讀取該技能的 `SKILL.md`。",
          chatBubble: {
            role: "thinking",
            text: "思考中 (310 tokens)：使用者需要從財報 PDF 擷取表格並驗證會計恆等式。我看見 Skills 索引中有 `pdf-financial-extractor`（專門處理財報 PDF 表格擷取與會計驗證）。我應該先讀取 `.agents/skills/pdf-financial-extractor/SKILL.md` 取得標準腳本用法，避免自己瞎猜寫出錯誤的解析程式。",
            toolCall: "view_file(path=\".agents/skills/pdf-financial-extractor/SKILL.md\")"
          },
          segments: {
            system: 800,
            skillMeta: 520,
            skillBody: 0,
            mcpSchema: 600,
            user: 65,
            thinking: 310,
            toolIo: 45,
            assistant: 0
          },
          altSegments: {
            system: 18500,
            skillMeta: 0,
            skillBody: 0,
            mcpSchema: 600,
            user: 65,
            thinking: 420,
            toolIo: 45,
            assistant: 0
          },
          turnInputTokens: 1985,
          turnOutputTokens: 355,
          altTurnInputTokens: 19165,
          altTurnOutputTokens: 465,
          insight: "🧠 Thinking Tokens 解密：模型思考過程產生了 310 個 Output Tokens。注意看，它精準決定去翻開需要的「那一本食譜」，其他 14 本無關的食譜（如前端設計、K8s 部署）完全不會佔用空間！"
        },
        {
          stepNumber: 3,
          phase: "動態載入 Skill 秘笈",
          actor: "Skill Loaded",
          title: "按需載入 `SKILL.md` 進 Context，並呼叫內附 Python 腳本",
          description: "`SKILL.md` 的完整內容（1,150 tokens）進入 Context！裡面清楚寫著：「直接執行 scripts/parse_balance_sheet.py 即可輸出 CSV 並自動驗證資產=負債+權益」。Agent 立刻照做！",
          chatBubble: {
            role: "tool",
            text: "📚 已載入 Skill: pdf-financial-extractor/SKILL.md (+1,150 tokens)\n內含指令：執行 `python3 .agents/skills/pdf-financial-extractor/scripts/parse_balance_sheet.py quarterly_report.pdf --verify`",
            toolCall: "run_command(\"python3 .agents/skills/.../parse_balance_sheet.py quarterly_report.pdf --verify\")"
          },
          segments: {
            system: 800,
            skillMeta: 520,
            skillBody: 1150,  // 只有這一個被用到的 Skill 載入進來！
            mcpSchema: 600,
            user: 65,
            thinking: 180,
            toolIo: 90,
            assistant: 0
          },
          altSegments: {
            system: 18500,
            skillMeta: 0,
            skillBody: 0,
            mcpSchema: 600,
            user: 65,
            thinking: 290,
            toolIo: 90,
            assistant: 0
          },
          turnInputTokens: 3225,
          turnOutputTokens: 270,
          altTurnInputTokens: 19630,
          altTurnOutputTokens: 380,
          insight: "🚀 腳本外掛的威力：因為 Skill 裡直接附帶了寫好的 `parse_balance_sheet.py`，Agent 不需要花 2,000 個 Output Tokens 自己當場寫一支解析程式，也不用把 PDF 原始亂碼讀進 Context！"
        },
        {
          stepNumber: 4,
          phase: "觀察結果與最終回覆",
          actor: "Agent (Response)",
          title: "收到腳本精簡結果，完成回覆（自動清理中繼 Thinking）",
          description: "腳本執行完畢，回傳 180 tokens 的驗證報告與 CSV 路徑。Agent 整理結果回覆給使用者。完成這 3 輪互動，使用 Skills 的總 Input Token 消耗僅為 8,690，而傳統全塞法高達 58,885！",
          chatBubble: {
            role: "assistant",
            text: "✅ 已透過 `pdf-financial-extractor` 技能完成處理！\n- 輸出檔案：`balance_sheet_2026Q3.csv` (共 42 列)\n- 會計恆等式驗證：**通過**（總資產 $14,250,000 = 總負債 $5,100,000 + 股東權益 $9,150,000）。"
          },
          segments: {
            system: 800,
            skillMeta: 520,
            skillBody: 1150,
            mcpSchema: 600,
            user: 65,
            thinking: 120,    // 舊輪次的 thinking 被壓縮或捨棄，只留本輪輕量思考
            toolIo: 270,
            assistant: 190
          },
          altSegments: {
            system: 18500,
            skillMeta: 0,
            skillBody: 0,
            mcpSchema: 600,
            user: 65,
            thinking: 160,
            toolIo: 270,
            assistant: 190
          },
          turnInputTokens: 3480,
          turnOutputTokens: 310,
          altTurnInputTokens: 20090,
          altTurnOutputTokens: 350,
          insight: "📊 總結算：因為 Agent 每走一步都要重送一次 Context，傳統塞爆 System Prompt 的作法在 3 個步驟中被重複收了 3 次 18,500 tokens（累計近 6 萬 tokens）；而 Skills 按需載入累計僅花費不到 9,500 tokens，省下超過 83% 成本！"
        }
      ]
    },
    {
      id: "thinking-lifecycle",
      title: "劇本 2：Agent 對話與深度思考 (Thinking Tokens) 的生命週期",
      subtitle: "揭開模型「內心獨白」如何消耗 Output Token，以及多輪對話時為什麼不會撐爆 Context",
      contextLimit: 16000,
      hasComparisonMode: false,
      steps: [
        {
          stepNumber: 1,
          phase: "第一輪：複雜演算法除錯提問",
          actor: "User",
          title: "使用者提出需要深度邏輯推演的問題",
          description: "使用者給出一段有 Race Condition（競態條件）的非同步購物車扣庫存程式碼，請 Agent 找出為什麼高併發時會超賣。",
          chatBubble: {
            role: "user",
            text: "我們的 checkoutService.ts 在雙十一壓測時會發生庫存變成負數的超賣問題，這是一段 80 行的交易邏輯，請幫我找出根本原因與修正方案。"
          },
          segments: {
            system: 900,
            skillMeta: 300,
            skillBody: 0,
            mcpSchema: 400,
            user: 650,
            thinking: 0,
            toolIo: 0,
            assistant: 0
          },
          turnInputTokens: 2250,
          turnOutputTokens: 0,
          insight: "📥 Input 階段：此時只有基礎設定 (1,600 tokens) 與使用者貼上的程式碼 (650 tokens)，總計 2,250 tokens。"
        },
        {
          stepNumber: 2,
          phase: "第一輪：深度思考 (Extended Thinking)",
          actor: "Agent (Thinking)",
          title: "模型啟動深度思考：在隱藏草稿紙上推演 3 種併發時序",
          description: "為了確保答案正確，模型在輸出正式文字前，先生成了 2,400 tokens 的 `<thought>` 區塊，模擬 Thread A 與 Thread B 同時讀取 `SELECT stock FROM items` 的時間差。",
          chatBubble: {
            role: "thinking",
            text: "💭 深度思考中 (2,400 tokens)...\n[推演時序 1]: Request A 在 t=1ms 執行 SELECT stock 得到 1；Request B 在 t=2ms 也執行 SELECT stock 得到 1...\n[檢查隔離等級]: 目前使用的是 READ COMMITTED，且沒有加上 FOR UPDATE 悲觀鎖或 CAS 樂觀鎖...\n[評估解法]: 方案一用 SELECT ... FOR UPDATE；方案二用 UPDATE items SET stock = stock - 1 WHERE id = ? AND stock >= 1。方案二在無長事務時效能更好！"
          },
          segments: {
            system: 900,
            skillMeta: 300,
            skillBody: 0,
            mcpSchema: 400,
            user: 650,
            thinking: 2400,
            toolIo: 0,
            assistant: 580
          },
          turnInputTokens: 2250,
          turnOutputTokens: 2980,
          insight: "💰 計費重點：這 2,400 個 Thinking Tokens 加上 580 個正式回覆 Tokens，合計 2,980 tokens 全部算作本輪的 **Output Tokens**！"
        },
        {
          stepNumber: 3,
          phase: "第二輪：使用者追問 (Thinking 自動修剪！)",
          actor: "User -> Agent",
          title: "進入下一輪對話時：上一輪的 2,400 Thinking Tokens 被自動移除！",
          description: "使用者接著問：「那如果我們改用 Redis 預扣庫存要怎麼寫？」請注意看上方的黃色區塊：第一輪長達 2,400 tokens 的思考草稿**不會**被帶進第二輪的 Input History 中，只保留第一輪的 580 tokens 正式回答！",
          chatBubble: {
            role: "user",
            text: "講得很清楚！那如果我們想在進資料庫前，先用 Redis Lua Script 做預扣庫存，可以幫我寫出對應的實現嗎？"
          },
          segments: {
            system: 900,
            skillMeta: 300,
            skillBody: 0,
            mcpSchema: 400,
            user: 820,       // 第一輪 650 + 第二輪 170
            thinking: 650,   // 只有第二輪新產生的思考！第一輪的 2,400 已清除！
            toolIo: 0,
            assistant: 1120  // 第一輪 580 + 第二輪 540
          },
          turnInputTokens: 3000,
          turnOutputTokens: 1190,
          insight: "✨ 為什麼要清除舊的 Thinking？因為「結論」已經寫在第一輪的正式回覆 (580 tokens) 裡了！把舊的思考草稿丟掉，第二輪的 Input Tokens 就只有 3,000（而不是 5,400），這就是現代推理模型既聰明又不會瞬間塞爆 Context Window 的秘密！"
        }
      ]
    },
    {
      id: "mcp-and-subagent",
      title: "劇本 3：MCP 工具風暴 vs Subagent 子代理隔離術",
      subtitle: "當 Agent 透過 MCP 查詢大量資料與翻找程式碼時，如何避免 Context 爆炸",
      contextLimit: 40000,
      hasComparisonMode: true,
      comparisonLabel: "切換對比：不用 Subagent，讓主 Agent 自己硬讀 20 個檔案？",
      steps: [
        {
          stepNumber: 1,
          phase: "掛載 MCP Servers",
          actor: "System + MCP",
          title: "啟動時載入 GitHub 與 PostgreSQL MCP 工具定義",
          description: "我們為 Agent 接上了 `github` 與 `postgres` 兩個 MCP Server（共提供 18 個 Tools）。注意看綠色區塊：光是把這 18 個工具的 JSON Schema 告訴模型，就固定佔用了 3,200 tokens。",
          chatBubble: {
            role: "user",
            text: "請幫我從 Postgres MCP 撈出過去 24 小時失敗率最高的 API endpoint，然後在專案裡找出所有呼叫該 endpoint 的前端元件並分析原因。"
          },
          segments: {
            system: 850,
            skillMeta: 400,
            skillBody: 0,
            mcpSchema: 3200,
            user: 95,
            thinking: 0,
            toolIo: 0,
            assistant: 0
          },
          altSegments: {
            system: 850,
            skillMeta: 400,
            skillBody: 0,
            mcpSchema: 3200,
            user: 95,
            thinking: 0,
            toolIo: 0,
            assistant: 0
          },
          turnInputTokens: 4545,
          turnOutputTokens: 0,
          altTurnInputTokens: 4545,
          altTurnOutputTokens: 0,
          insight: "🔌 MCP Schema 成本：每個 MCP 工具大約需要 150~250 tokens 描述參數格式。只開需要的 MCP Server 是保持 Context 輕盈的第一步！"
        },
        {
          stepNumber: 2,
          phase: "呼叫 MCP 查詢資料庫",
          actor: "MCP Tool Call",
          title: "透過 Postgres MCP 執行 SQL，取得異常 API 統計",
          description: "Agent 呼叫 `mcp__postgres__query` 執行聚合查詢（注意：好的 Agent 會用 `GROUP BY` 與 `LIMIT 5`，而不是 `SELECT *` 把幾萬筆 Log 全塞進 Context）。",
          chatBubble: {
            role: "tool",
            text: "🔌 呼叫 MCP: `mcp__postgres__query`\nSQL: `SELECT endpoint, count(*) as err_cnt FROM api_logs WHERE status >= 500 GROUP BY 1 ORDER BY 2 DESC LIMIT 3;`\n回傳結果：`/api/v2/orders/sync` (錯誤 1,420 次, Timeout)",
            toolCall: "mcp__postgres__query(sql=\"SELECT endpoint, count(*) ... LIMIT 3\")"
          },
          segments: {
            system: 850,
            skillMeta: 400,
            skillBody: 0,
            mcpSchema: 3200,
            user: 95,
            thinking: 240,
            toolIo: 480,
            assistant: 0
          },
          altSegments: {
            system: 850,
            skillMeta: 400,
            skillBody: 0,
            mcpSchema: 3200,
            user: 95,
            thinking: 240,
            toolIo: 480,
            assistant: 0
          },
          turnInputTokens: 4545,
          turnOutputTokens: 310,
          altTurnInputTokens: 4545,
          altTurnOutputTokens: 310,
          insight: "✅ 精準查詢：透過 SQL 聚合只回傳了 480 tokens 的統計結果，鎖定罪魁禍首是 `/api/v2/orders/sync`。"
        },
        {
          stepNumber: 3,
          phase: "大規模程式碼調查 (Subagent 登場)",
          actor: "Subagent",
          title: "派出 Research Subagent 在獨立空間搜尋 18 個前端檔案",
          description: "接下來要找出全專案哪些地方呼叫了 `/api/v2/orders/sync`。主 Agent 派出 `Research Subagent` 去翻閱 18 個元件檔（子代理內部消耗了 22,000 tokens），但最後**只把 450 tokens 的調查摘要傳回主對話**！",
          chatBubble: {
            role: "tool",
            text: "🕵️ Subagent 執行完畢（內部獨立消耗 22,000 tokens 已銷毀）\n📩 回傳主 Agent 摘要 (+450 tokens)：\n「共發現 2 處呼叫：1. `OrderDashboard.tsx` (第 88 行) 使用 `setInterval` 每 500ms 輪詢一次且未設 cleanup，導致連線池耗盡！」",
            toolCall: "invoke_subagent(type=\"research\", prompt=\"找出所有呼叫 /api/v2/orders/sync 的前端檔案與呼叫頻率\")"
          },
          segments: {
            system: 850,
            skillMeta: 400,
            skillBody: 0,
            mcpSchema: 3200,
            user: 95,
            thinking: 310,
            toolIo: 930,      // 原本 480 + Subagent 精簡摘要 450
            assistant: 420
          },
          altSegments: {
            system: 850,
            skillMeta: 400,
            skillBody: 0,
            mcpSchema: 3200,
            user: 95,
            thinking: 1100,
            toolIo: 22480,    // 不用 Subagent：18 個檔案的原始碼全部塞在主 Context 裡！
            assistant: 420
          },
          turnInputTokens: 5785,
          turnOutputTokens: 730,
          altTurnInputTokens: 27425,
          altTurnOutputTokens: 1520,
          insight: "🛡️ Subagent 隔離奇蹟：右上角切換對比按鈕看看！如果主 Agent 自己把 18 個檔案讀進來，主對話 Context 會瞬間暴衝到 28,500+ tokens，而且接下來你跟它聊的每一句話，都要背著這 22,000 tokens 的廢棄程式碼負重前行！"
        }
      ]
    }
  ],

  // 4. 沙盒組裝實驗室預設項目
  sandboxItems: {
    mcpServers: [
      { id: "fs", name: "Filesystem MCP (本地檔案讀寫)", toolsCount: 6, schemaTokens: 750, avgResultTokens: 600, recommended: true },
      { id: "github", name: "GitHub MCP (PR / Issue / Commit 管理)", toolsCount: 14, schemaTokens: 2100, avgResultTokens: 850, recommended: true },
      { id: "postgres", name: "PostgreSQL MCP (資料庫查詢與 Schema)", toolsCount: 5, schemaTokens: 680, avgResultTokens: 500, recommended: false },
      { id: "playwright", name: "Playwright Browser MCP (自動化網頁操作)", toolsCount: 18, schemaTokens: 2900, avgResultTokens: 1400, recommended: false },
      { id: "slack", name: "Slack & Notion MCP (團隊通訊與文件)", toolsCount: 16, schemaTokens: 2400, avgResultTokens: 900, recommended: false },
      { id: "cloud", name: "AWS / Kubernetes 全家桶 MCP (巨型工具包)", toolsCount: 45, schemaTokens: 7200, avgResultTokens: 1200, recommended: false }
    ],
    skillsList: [
      { id: "react-ui", name: "React 設計系統與元件規範", metaTokens: 40, fullTokens: 1800, defaultSelected: true },
      { id: "api-security", name: "API 資安與 JWT 驗證 SOP", metaTokens: 35, fullTokens: 1450, defaultSelected: true },
      { id: "db-migration", name: "資料庫零停機 Migration 指南", metaTokens: 45, fullTokens: 2100, defaultSelected: true },
      { id: "e2e-testing", name: "Playwright E2E 測試撰寫秘笈", metaTokens: 40, fullTokens: 1650, defaultSelected: true },
      { id: "pdf-report", name: "PDF 財報解析與圖表生成套件", metaTokens: 40, fullTokens: 1300, defaultSelected: false },
      { id: "git-release", name: "Semantic Release 與 Changelog 自動化", metaTokens: 35, fullTokens: 950, defaultSelected: false },
      { id: "perf-audit", name: "前端 Web Vitals 效能調校手冊", metaTokens: 40, fullTokens: 2400, defaultSelected: false },
      { id: "i18n-flow", name: "多語系 i18n 詞條檢查與翻譯腳本", metaTokens: 35, fullTokens: 1100, defaultSelected: false }
    ]
  },

  // 5. 隨堂闖關小測驗
  quizQuestions: [
    {
      question: "1. 你的團隊有 12 份不同領域的開發手冊（如：部署流程、PDF 處理、圖表規範、資料庫遷移，共約 20,000 字）。為了讓 AI 隨時能遵循這些規範，同時最節省 Token，你應該怎麼配置？",
      options: [
        "全部複製貼上到 CLAUDE.md / GEMINI.md 裡，確保 AI 每一輪都看得見",
        "拆分成 12 個 Skills 放在 .agents/skills/，平時只載入簡短 description，用到時才讓 Agent 讀取對應的 SKILL.md",
        "把 12 份手冊全部寫成 12 個 MCP Server",
        "每次提問時手動把 20,000 字貼在對話框最後面"
      ],
      correctIndex: 1,
      explanation: "正確！Skills 採用「漸進式揭露 (Progressive Disclosure)」，平時 12 個 Skills 的索引加起來不到 500 tokens；只有當任務真正需要某項技能時，Agent 才會動態載入該份 SKILL.md，省下超過 90% 的常駐 Token！"
    },
    {
      question: "2. 當 Agent 在解決一個複雜任務，連續執行了「思考 → 呼叫工具 A → 觀察結果 → 思考 → 呼叫工具 B → 觀察結果」共 5 個步驟時，Input Tokens 是如何計算的？",
      options: [
        "只計算使用者第一句話的字數，中間工具回傳的資料完全免費",
        "每走一步迴圈，整包累積的 Context History（含 System Prompt、所有先前工具回傳結果）都會重新作為 Input 送給模型一次",
        "只有最後一步才會把所有資料加總計費一次",
        "呼叫 MCP 工具會自動清空先前的對話紀錄"
      ],
      correctIndex: 1,
      explanation: "正確！LLM 本質上是無狀態 (Stateless) 的，所以 Agent 迴圈的每一步 API 呼叫，都必須把從頭到尾累積的 Context 重新傳送一次。這也是為什麼「減少無效步數」與「控制工具回傳大小」對節省 Token 如此重要！"
    },
    {
      question: "3. 關於模型開啟「深度思考 (Extended Thinking / Reasoning)」時的 Token 變化，下列敘述何者正確？",
      options: [
        "思考過程是由使用者輸入的，所以算在 Input Tokens",
        "思考過程不會消耗任何 Token，也不會花錢",
        "思考過程由模型生成，計入該輪的 Output Tokens；但在進入後續新對話輪次時，舊的思考草稿通常會被修剪移除以保護 Context 空間",
        "思考過程會永久保留在每一輪對話的 System Prompt 裡"
      ],
      correctIndex: 2,
      explanation: "正確！Thinking Tokens 是模型產生的推理草稿，屬於 Output Tokens。為了避免長篇推理草稿把後續對話的 Context Window 塞爆，現代架構在完成該回合後，下一輪只會保留最終結論與工具紀錄，自動捨棄中繼的思考區塊。"
    },
    {
      question: "4. 為什麼我們不應該把市面上找得到的 30 個 MCP Servers 全部同時掛載到同一個 Agent 上？",
      options: [
        "因為 MCP 規定最多只能連 1 個 Server",
        "因為每個啟用的 MCP Server 都會把旗下所有 Tools 的 JSON Schema 塞進常駐 Context，掛載 30 個 Server 可能讓你還沒開始聊天就先噴掉 20,000+ tokens，還會降低模型選對工具的準確率",
        "因為 MCP 會把你的硬碟格式化",
        "因為 MCP 與 Skills 無法同時存在"
      ],
      correctIndex: 1,
      explanation: "完全正確！這稱為「Tool Bloat (工具膨脹)」。過多的 MCP 工具定義不僅在每一輪都白白消耗大量常駐 Input Tokens，還會干擾模型的注意力。只開啟專案真正需要的 MCP 工具才是行家作法！"
    },
    {
      question: "5. 當你需要 Agent 在擁有 500 個檔案的專案中，地毯式搜尋某個舊版 API 的所有使用位置並整理成清單，哪種做法最能避免主對話 Context Window 爆炸？",
      options: [
        "請主 Agent 直接在主對話裡連續呼叫 40 次 view_file 把檔案全讀進來",
        "委派一個 Research Subagent（子代理），讓它在獨立的 Context Window 中翻閱檔案，最後只將整理好的 300 字清單回傳給主 Agent",
        "把 500 個檔案全部貼進 System Prompt",
        "關閉所有工具，請 AI 憑空猜測檔案位置"
      ],
      correctIndex: 1,
      explanation: "太棒了！Subagent 擁有獨立的 Context Window，它在搜尋過程中讀進來的幾萬個 Tokens 會在子任務結束時直接釋放，主對話只會收到最終的精華摘要，完美保持主對話輕量又快速！"
    }
  ]
};

# ⚡ AI Flow 互動教學實驗室：Agent、Skills、MCP 與 Token 變化全圖解

這是一個**純前端、零相依性、免編譯**的互動式教學網站，專為幫助開發者與團隊直覺理解現代 AI 開發工作流中的核心觀念（**LLM、Agent ReAct Loop、Skills 技能包、MCP 協定、Subagents 子代理**）以及**背後真實的 Token 流動與成本變化**而設計。

---

## 🚀 如何啟動觀看？

### 方式一：直接用瀏覽器開啟
因為採用純前端標準技術（HTML5 + CSS3 + Vanilla JS），直接雙擊或用瀏覽器開啟 `index.html` 即可完整體驗所有互動功能：
```bash
xdg-open /home/lyan/repos/tutorials/aiflow/index.html
```

### 方式二：使用本地靜態伺服器（選用）
```bash
python3 -m http.server 8080 --directory /home/lyan/repos/tutorials/aiflow
# 接著在瀏覽器開啟 http://localhost:8080
```

---

## 🎯 五大互動教學模組一覽

1. **🧠 一分鐘白話角色比喻（米其林智慧廚房）**
   - 將抽象的 **LLM、Agent、Skills (`SKILL.md`)、MCP、Subagent** 對應到「大腦、總主廚、按需翻閱的食譜、USB-C 萬用插座、外派採買分身」，點擊卡片即可聯動跳轉至架構圖。
2. **🏗️ 互動式架構拆解圖 (Interactive Architecture Explorer)**
   - 點擊架構圖上的任一節點（`User`、`System Rules`、`Agent Loop`、`LLM + Thinking`、`Skills`、`MCP Servers`、`Subagents`），即時檢視運作原理、Token 影響等級與真實設定檔範例（如 `SKILL.md`、`mcp_config.json`、`GEMINI.md`）。
3. **🔥 核心重頭戲：Agent 對話、思考與 Skills 的 Token 變化模擬器**
   - **即時 Context Window 堆疊色塊條**：動態拆解每一輪對話中 `System Rules`、`Skills 目錄索引`、`已載入 SKILL.md`、`MCP Schema`、`User`、`Thinking 思考`、`Tool 回傳` 與 `Assistant 回覆` 的 Token 佔比。
   - **內建 3 大真實範例劇本（支援逐步播放與自動播放）**：
     - **劇本 1（Skills 漸進式載入 vs 塞爆 System Prompt）**：示範 15 個 Skills 平時只花 520 tokens 放目錄索引，需要時才載入 `pdf-financial-extractor/SKILL.md` (+1,150 tokens) 並執行附帶腳本；還可一鍵切換「反面教材模式」比較省下超過 **83%** 累計 Token 的差異！
     - **劇本 2（Thinking 深度思考的生命週期）**：示範 `<thought>` 如何消耗本輪 Output Tokens，以及為什麼進入下一輪對話時舊的思考草稿會被自動修剪清除，避免塞爆 Context Window。
     - **劇本 3（MCP 工具風暴 vs Subagent 子代理隔離術）**：示範掛載多個 MCP 工具的 Schema 底消，以及委派 `Research Subagent` 在獨立 Context 消耗 22,000 tokens 後只回傳 450 tokens 結論給主對話的瘦身威力。
4. **🧪 動手組裝你的 AI Agent 實驗室 (Sandbox Token Calculator)**
   - 自由勾選不同數量的 MCP Servers、8 套團隊知識庫、切換「做成 Skills 按需載入」或「全塞進 System Prompt」、調整思考深度與迴圈步數（1~8 步），即時繪製每一步的 Token 堆疊長條圖與架構健康度評分（0~100 分）。
5. **🧭 實戰速查對照表 & 5 題闖關小測驗**
   - 支援依開發情境篩選最佳方案，並提供 5 題互動式情境問答與即時詳解。

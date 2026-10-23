# 📚 Interactive Technical Tutorials

純前端、零外部相依、免編譯的互動式技術教學實驗室合集。每個主題皆可直接以瀏覽器開啟 `index.html` 或透過 GitHub Pages 線上體驗。

## 🗂️ 教學目錄

| 目錄 | 主題 | 內容簡介 |
| :--- | :--- | :--- |
| [`aiflow/`](./aiflow/) | **⚡ AI Flow 互動教學實驗室** | Agent ReAct Loop、Skills (`SKILL.md`) 漸進式載入、MCP 協定、Subagents 子代理與 Context Window Token 變化全圖解 |
| [`ieee754/`](./ieee754/) | **🔢 IEEE 754 浮點數大冒險** | 以互動遊戲與 BigInt 精確運算學會 binary16（半精度）、binary32（單精度）、binary64（雙精度）的編碼、捨入與特殊值 |
| [`quant/`](./quant/) | **🗜️ AI 模型壓縮技術互動教學** | 動手實驗模型量化（FP16/BF16/FP8/INT8/PTQ/QAT/SmoothQuant）、剪枝（2:4 稀疏）、知識蒸餾與低秩分解（SVD） |

---

## 🚀 本機快速預覽

在根目錄啟動靜態伺服器即可一次瀏覽所有教學：

```bash
python3 -m http.server 8000
# 接著在瀏覽器開啟 http://localhost:8000
```

或直接開啟任一子目錄下的 `index.html`：
- `aiflow/index.html`
- `ieee754/index.html`
- `quant/index.html`

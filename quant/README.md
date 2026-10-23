# AI 模型壓縮技術：互動式教學

純前端、零相依套件的互動教學網站，用動手實驗學會 **量化、剪枝、知識蒸餾、低秩分解**。

## 使用方式

直接用瀏覽器開啟 `index.html` 即可（支援 `file://`，不需要伺服器、建置或網路）。

也可以用任意靜態伺服器：

```bash
python3 -m http.server 8000   # 然後開啟 http://localhost:8000
```

## 章節

| # | 章節 | 互動實驗 |
|---|------|----------|
| 0 | 為什麼要壓縮模型 | 模型記憶體與生成速度估算器 |
| 1 | 數字在電腦裡怎麼存 | FP32 / FP16 / BF16 / FP8 / INT8 位元檢視器（可點擊翻轉位元） |
| 2 | 量化基礎 | 數線上的逐步量化；4096 個權重的粒度、離群值、截斷實驗 |
| 3 | 進階量化：PTQ、QAT 與 LLM | SmoothQuant 啟動值平滑 |
| 4 | 剪枝 | 非結構化 / 結構化 / 2:4 剪枝矩陣與誤差曲線 |
| 5 | 知識蒸餾 | 溫度 softmax、蒸餾損失、讓學生逐步學習 |
| 6 | 低秩分解 | 圖片 SVD 壓縮（可上傳自己的圖片）；層分解計算器 |
| 7 | 綜合實驗室 | 在瀏覽器中訓練 MLP，再剪枝、量化與微調（QAT） |
| 8 | 總結與選擇指南 | 比較表、情境建議、術語表、期末測驗 |

每章都有「一句話重點」、公式、動手觀察提示、常見誤解與小測驗；測驗進度會存在瀏覽器的 localStorage。

## 檔案結構

```
index.html        教學內容
css/style.css     樣式（支援亮色 / 暗色主題、手機版）
js/common.js      共用工具：畫布、亂數、控制項、測驗、進度
js/intro.js       第 0 章
js/formats.js     第 1 章（浮點數編碼 / 解碼）
js/quant.js       第 2 章（Quant 量化核心函式）
js/quantadv.js    第 3 章
js/prune.js       第 4 章（Prune 剪枝核心函式）
js/distill.js     第 5 章
js/lowrank.js     第 6 章（單邊 Jacobi SVD）
js/lab.js         第 7 章（MLP、Adam、STE）
```

## 線上版（GitHub Pages）

推送到 `main` 後，根目錄 `.github/workflows/pages.yml` 會自動部署到
<https://lyanchih.github.io/tutorials/quant/>。

第一次使用前，請到 GitHub repo 的 **Settings → Pages → Build and deployment → Source** 選擇 **GitHub Actions**。

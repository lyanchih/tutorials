# IEEE 754 浮點數大冒險 🔢

用互動遊戲學會 IEEE 754 半精度（binary16）、單精度（binary32）、雙精度（binary64）。

純靜態網頁（HTML + CSS + JavaScript），不需要建置工具、不需要伺服器，所有運算都在瀏覽器中用 BigInt 精確完成。

## 內容

| 章節 | 互動內容 |
|---|---|
| 1 為什麼需要浮點數 | 會浮動的小數點、科學記號翻譯機 |
| 2 三兄弟的身體構造 | 位元比例圖、規格總表（即時計算）、偏差值轉換器 |
| 3 迷你浮點數玩具 | 可調位數的迷你格式，所有可表示的數畫在數線上 |
| 4 十進位 → IEEE 754 | 逐步編碼器：除 2 / 乘 2 表格、循環偵測、正規化、捨入、驗算 |
| 5 IEEE 754 → 十進位 | 位元遊樂場：點擊或拖曳翻轉位元、十六進位輸入、小任務 |
| 6 特殊值動物園 | ±0、次正規數、∞、NaN；下溢溜滑梯與溢位火箭；JS 實驗台 |
| 7 精度與捨入 | 捨入顯微鏡（平手取偶數）、三精度計算機、ULP 階梯圖、停滯的計數器 |
| 8 闖關挑戰 | 隨機題庫（解碼／指數／分類／編碼／觀念）、造數挑戰、分數與等級 |
| 9 小抄與陷阱 | 重點整理、程式設計常見陷阱、各語言型別對照 |

## 本機預覽

直接用瀏覽器開啟 `index.html` 即可。或啟動一個簡單的伺服器：

```bash
python3 -m http.server 8000
# 打開 http://localhost:8000
```

## 部署到 GitHub Pages

```bash
cd ieee754
git init
git add .
git commit -m "IEEE 754 互動教學"
git branch -M main
git remote add origin https://github.com/<你的帳號>/<repo 名稱>.git
git push -u origin main
```

接著到 GitHub 的 repo 頁面：

1. **Settings** → 左側 **Pages**
2. **Source** 選 **Deploy from a branch**
3. **Branch** 選 `main`，資料夾選 `/ (root)`，按 **Save**
4. 等一兩分鐘，網址會是 `https://<你的帳號>.github.io/<repo 名稱>/`

> 如果想放進既有的 `<你的帳號>.github.io` 網站，把整個資料夾複製成該 repo 裡的一個子資料夾（例如 `ieee754/`），網址就是 `https://<你的帳號>.github.io/ieee754/`。所有路徑都是相對路徑，放在哪裡都能運作。

`.nojekyll` 檔案讓 GitHub Pages 原封不動地提供檔案，不經過 Jekyll 處理。

## 檔案結構

```
index.html      頁面與教學文字
css/style.css   樣式（支援淺色 / 深色主題、手機版）
js/ieee.js      IEEE 754 核心運算（BigInt 精確編碼、解碼、捨入）
js/app.js       所有互動元件
```

`js/ieee.js` 不依賴 DOM，也可以在 Node.js 中使用：

```js
const IEEE = require('./js/ieee.js');
const { bits } = IEEE.encodeString(IEEE.FORMATS.half, '0.1');
IEEE.toHex(IEEE.FORMATS.half, bits);               // '0x2E66'
IEEE.exactDecimalOfBits(IEEE.FORMATS.half, bits);  // '0.0999755859375'
```

## 瀏覽器需求

需要支援 BigInt 與 CSS `color-mix()` 的現代瀏覽器（Chrome / Edge 111+、Firefox 113+、Safari 16.2+）。

# P2P 點對點網路：從 BitTorrent 到 WebRTC 的互動式教學

純前端、零相依套件的互動教學網站，用動手實驗理解 ShareDrop / PairDrop 這類「瀏覽器隔空投送」與 BitTorrent 背後的 P2P 原理：
**NAT 穿透、STUN / TURN / ICE、信令與裝置發現、WebRTC DataChannel、.torrent / infohash、Peer Wire Protocol、Swarm 演算法、Kademlia DHT**，以及 P2P 身分的解法 **DID（去中心化識別碼）**。

## 使用方式

建議用靜態伺服器開啟（第 6 章的「多分頁自動發現」需要 `BroadcastChannel`，部分瀏覽器在 `file://` 下不允許分頁互通）：

```bash
python3 -m http.server 8000   # 在 repo 根目錄執行，然後開啟 http://localhost:8000/p2p/
```

其餘章節直接開啟 `index.html` 也能使用。

## 章節

| # | 章節 | 互動實驗 |
|---|------|----------|
| 0 | 為什麼要 P2P | Client–Server vs P2P 分發時間（Kurose & Ross 下界） |
| 1 | P2P 演進史與搜尋 | 中央索引 / 洪泛（TTL）/ DHT 三種搜尋的訊息量比較 |
| 2 | NAT：連線的頭號敵人 | 封包層級 NAT 打洞模擬器（RFC 4787 映射 × 過濾），自動算出 5×5 相容表 |
| 3 | STUN / TURN / ICE | STUN XOR-MAPPED-ADDRESS 位元組；ICE 檢查清單模擬；**收集你瀏覽器真實的 ICE 候選** |
| 4 | 信令與裝置發現 | 「同公網 IP 分房」與 CGNAT / IPv6 陷阱、PairDrop 配對與房間；WebSocket vs Firebase 信令序列圖 |
| 5 | WebRTC DataChannel 傳檔 | **同頁真實 WebRTC 連線**、SDP 逐行解說、分塊與背壓（bufferedAmount 即時圖、SHA-256 驗證） |
| 6 | 實戰：自己做 PairDrop | **多分頁自動發現 + 跨裝置手動信令**，真的用 WebRTC 聊天與傳檔 |
| 7 | BitTorrent ①：.torrent 與 infohash | bencode 遊樂場；**在瀏覽器裡產生真的 .torrent**（或解析現成的）、磁力連結、竄改 piece 驗證 |
| 8 | BitTorrent ②：Tracker 與 Peer Wire | announce 網址、精簡 peer 清單解碼、handshake / 訊息位元組檢視器、peer 對話序列圖 |
| 9 | BitTorrent ③：Swarm 模擬器 | rarest-first / 隨機 / 循序 × tit-for-tat / 隨機；搭便車者、種子離開、批次比較 |
| 10 | BitTorrent ④：DHT / Kademlia | XOR 距離計算機；8-bit Kademlia 的 k-bucket 與迭代查詢視覺化 |
| 11 | 身分：DID 去中心化識別碼 | **用 WebCrypto 產生真的 Ed25519 did:key** 並解析；用真實 DTLS 憑證重現信令伺服器中間人攻擊，再用 DID 簽章擋下；did:dht 透過 BEP 44 在 Mainline DHT 發佈 / 解析 / 竄改 / 重放 |
| 12 | 總結：兩個世界的交會 | WebTorrent、全景比較、隱私與安全、術語表、期末測驗 |

每章都有「一句話重點」、動手觀察提示、常見誤解與小測驗；測驗進度存在瀏覽器的 localStorage。

## 會連到外部的地方

全部計算都在本機完成。只有以下兩處、而且要你主動按下按鈕時，才會連到 Google 的公開 STUN 伺服器 `stun.l.google.com:19302`（只送一個 Binding Request 取得你的公網位址，可取消勾選）：

- 第 3 章「收集候選」
- 第 6 章「手動信令模式」

第 11 章需要瀏覽器支援 WebCrypto Ed25519（近年版本的 Chrome / Edge / Firefox / Safari 皆支援），且要在 https 或 localhost 下開啟。

## 檔案結構

```
index.html        教學內容
css/style.css     樣式（與 quant/ 共用設計語言；亮色 / 暗色主題、手機版）
js/common.js      共用工具：畫布、亂數、Hex dump、SVG 序列圖、控制項、測驗、進度
js/intro.js       第 0–1 章（分發時間、搜尋模擬）
js/nat.js         第 2 章（NAT 映射 / 過濾模擬器，App.NatSim 供第 3 章使用）
js/ice.js         第 3 章（STUN 封包、ICE 優先權與檢查清單、真實候選收集）
js/signal.js      第 4 章（分房規則、信令序列圖）
js/webrtc.js      第 5 章（同頁 loopback、SDP 解說、背壓）
js/lab.js         第 6 章（BroadcastChannel 信令 + 手動信令，真實 WebRTC 傳檔）
js/torrent.js     第 7 章（bencode 編解碼、SHA-1、.torrent 產生 / 解析）
js/wire.js        第 8 章（announce、compact peers、Peer Wire 訊息）
js/swarm.js       第 9 章（swarm 模擬器）
js/dht.js         第 10 章（XOR 距離、Kademlia 查詢）
js/did.js         第 11 章（base58btc / z-base-32、did:key、DID 簽章防 MITM、did:dht 與 BEP 44）
```

## 線上版（GitHub Pages）

推送到 `main` 後，根目錄 `.github/workflows/pages.yml` 會自動部署到
<https://lyanchih.github.io/tutorials/p2p/>。

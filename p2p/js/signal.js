'use strict';

/* 第 4 章：依公網 IP 分房的發現機制、信令序列圖 */
(() => {
  const { $, esc } = App;

  // =====================================================================
  // 實驗 4a：分房規則
  // =====================================================================
  const NETS = [
    { name: '🏠 你家 Wi-Fi', ip: '203.0.113.7', devs: [['💻', '你的筆電', '192.168.1.10'], ['📱', '你的手機', '192.168.1.11'], ['🖥️', '家人的桌機', '192.168.1.12']] },
    { name: '☕ 咖啡店 Wi-Fi', ip: '198.51.100.20', devs: [['📱', '朋友的手機', '10.1.0.5'], ['💻', '隔壁桌陌生人', '10.1.0.9']] },
    { name: '📶 4G 行動網路（CGNAT）', ip: '192.0.2.200', devs: [['📱', '4G 路人甲', '100.64.12.3'], ['📱', '4G 路人乙', '100.71.200.8']], note: '兩支手機互不相識，只是被電信商分到同一個公網 IP' },
    { name: '🌐 IPv6 家庭', ip: '2001:db8:1:1::/64', v6: true, devs: [['💻', 'IPv6 筆電', '2001:db8:1:1::a'], ['📱', 'IPv6 手機', '2001:db8:1:1::b']], note: '純 IPv6，每台裝置的公網位址都不同' },
  ];
  const devices = [];
  NETS.forEach((n, ni) => n.devs.forEach(([icon, name, addr]) => devices.push({ id: devices.length, net: ni, icon, name, addr, pub: n.v6 ? addr : n.ip })));

  let strategy = 'ip', selected = 0;
  let pairs = [];     // [{ a, b, code }]
  let pubRooms = {};  // code → Set(deviceId)

  // 教學用的小型雜湊（FNV-1a），模擬 ShareDrop「用 SECRET 與 IP 算房間名稱」
  function roomHash(s) {
    let h = 0x811c9dc5;
    for (const ch of 'SECRET|' + s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  }

  function ipKey(d) {
    if (strategy === 'ip6' && d.pub.includes(':')) return d.pub.split(':').slice(0, 4).join(':') + '::/64';
    return d.pub;
  }

  function rooms() {
    const map = new Map();
    const add = (key, kind, id) => {
      if (!map.has(key)) map.set(key, { kind, members: new Set() });
      map.get(key).members.add(id);
    };
    devices.forEach(d => add('ip:' + ipKey(d), 'ip', d.id));
    pairs.forEach(p => { add('pair:' + p.code, 'pair', p.a); add('pair:' + p.code, 'pair', p.b); });
    Object.entries(pubRooms).forEach(([code, set]) => set.forEach(id => add('room:' + code, 'room', id)));
    return map;
  }

  function render() {
    const map = rooms();
    const sees = new Set();
    map.forEach(r => { if (r.members.has(selected)) r.members.forEach(id => id !== selected && sees.add(id)); });

    $('#roomNets').innerHTML = NETS.map((n, ni) => `<div class="net"><h5>${n.name}</h5><div class="ip">公網：${n.ip}</div>
      ${n.note ? `<div class="small-note">${n.note}</div>` : ''}
      ${devices.filter(d => d.net === ni).map(d => `<div class="dev ${d.id === selected ? 'sel' : sees.has(d.id) ? 'sees' : ''}" data-id="${d.id}">
        <span>${d.icon}</span><span>${esc(d.name)}</span><span class="addr">${esc(d.addr)}</span></div>`).join('')}</div>`).join('');

    const kindTxt = { ip: '依 IP', pair: '配對', room: '公開房間' };
    $('#roomTable').innerHTML = '<tr><th>房間</th><th>類型</th><th>ShareDrop 式房間名稱</th><th>成員</th></tr>' +
      [...map.entries()].map(([key, r]) => `<tr><td><code>${esc(key)}</code></td><td>${kindTxt[r.kind]}</td>
        <td><code>${r.kind === 'ip' ? roomHash(key) : '—'}</code></td>
        <td>${[...r.members].map(id => devices[id].icon + ' ' + esc(devices[id].name)).join('、')}${r.members.size === 1 ? ' <span class="tag">只有自己</span>' : ''}</td></tr>`).join('');
  }

  $('#roomNets').addEventListener('click', e => {
    const el = e.target.closest('.dev');
    if (el) { selected = +el.dataset.id; render(); }
  });
  App.seg('roomStrategy', v => { strategy = v; render(); });
  [$('#pairA'), $('#pairB'), $('#pubDev')].forEach(sel => devices.forEach(d => sel.add(new Option(d.icon + ' ' + d.name, d.id))));
  $('#pairA').value = 0; $('#pairB').value = 3;
  $('#pubDev').value = 4;
  $('#pairGo').addEventListener('click', () => {
    const a = +$('#pairA').value, b = +$('#pairB').value;
    if (a === b) return;
    const code = String(Math.floor(100000 + Math.random() * 900000));
    pairs.push({ a, b, code });
    selected = a;
    render();
  });
  $('#pubGo').addEventListener('click', () => {
    const code = $('#pubCode').value.trim().toUpperCase() || 'ROOM';
    (pubRooms[code] = pubRooms[code] || new Set()).add(+$('#pubDev').value);
    selected = +$('#pubDev').value;
    render();
  });
  $('#roomReset').addEventListener('click', () => { pairs = []; pubRooms = {}; render(); });
  render();

  // =====================================================================
  // 實驗 4b：信令序列圖
  // =====================================================================
  const OFFER_SDP = 'v=0\\r\\no=- 4611731400430051336 2 IN IP4 127.0.0.1\\r\\n...a=ice-ufrag:F7gI\\r\\na=ice-pwd:x9cml/YzichV2+XlhiMu8g\\r\\na=fingerprint:sha-256 49:66:12:17:...\\r\\na=setup:actpass\\r\\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel...';

  const P2P = (from, to, label, d, payload) => ({ from, to, label, d, payload, cls: 'p2p' });
  const SCRIPTS = {
    ws: {
      actors: ['瀏覽器 A', 'WebSocket 伺服器', '瀏覽器 B', 'STUN'],
      steps: [
        { from: 0, to: 1, label: 'WebSocket 連線', d: 'A 打開網頁，建立 wss:// 長連線。伺服器從連線（或反向代理的 X-Forwarded-For 標頭）得知 A 的公網 IP 是 203.0.113.7，把 A 放進房間「203.0.113.7」。' },
        { from: 1, to: 0, label: 'display-name / peers: []', d: '伺服器替 A 產生一個好記的顯示名稱，並告訴 A 房間裡目前沒有別人。', payload: { type: 'peers', peers: [] } },
        { from: 2, to: 1, label: 'WebSocket 連線', d: 'B 也打開網頁。因為 B 跟 A 在同一個 Wi-Fi，公網 IP 相同 → 進入同一個房間。' },
        { from: 1, to: 2, label: 'peers: [A]', d: '伺服器把房間成員清單給 B。', payload: { type: 'peers', peers: [{ id: 'a1b2', name: { displayName: 'Silver Fox', deviceName: 'Linux Chrome' } }] } },
        { from: 1, to: 0, label: 'peer-joined: B', d: '同時通知 A：有新成員加入。A 的畫面上出現 B 的頭像。', payload: { type: 'peer-joined', peer: { id: 'c3d4', name: { displayName: 'Teal Owl' } } } },
        { note: true, from: 0, label: '使用者在 A 點 B 的頭像，選擇檔案', d: '此時才開始 WebRTC 協商（有些實作會在發現彼此時就預先連線）。' },
        { from: 0, to: 3, label: 'STUN Binding Request', d: 'A 的 RTCPeerConnection 開始收集候選：向 STUN 伺服器詢問自己的公網位址。' },
        { from: 3, to: 0, label: 'XOR-MAPPED-ADDRESS', d: 'STUN 回報 A 的 srflx 位址 203.0.113.7:40001。' },
        { from: 0, to: 1, label: 'signal {to:B, sdp: offer}', d: 'A 呼叫 createOffer() / setLocalDescription()，把 SDP offer 包在 signal 訊息裡送給伺服器。伺服器不解析 SDP，只看 to 欄位。', payload: { type: 'signal', to: 'c3d4', sdp: { type: 'offer', sdp: OFFER_SDP } } },
        { from: 1, to: 2, label: '轉送 offer', d: '伺服器原封不動轉給 B，並附上 sender 欄位讓 B 知道是誰。', payload: { type: 'signal', sender: 'a1b2', sdp: { type: 'offer', sdp: '…' } } },
        { from: 2, to: 1, label: 'signal {to:A, sdp: answer}', d: 'B 呼叫 setRemoteDescription(offer)、createAnswer()、setLocalDescription()，回送 answer。B 的 SDP 裡也有自己的 ice-ufrag/pwd 與 fingerprint。' },
        { from: 1, to: 0, label: '轉送 answer', d: '現在雙方都知道彼此的 ICE 帳密與 DTLS 憑證指紋。' },
        { from: 0, to: 1, label: 'signal {to:B, ice}', d: 'Trickle ICE：A 每收集到一個候選就立刻送出，不必等收集完畢。', payload: { type: 'signal', to: 'c3d4', ice: { candidate: 'candidate:842163049 1 udp 1677729535 203.0.113.7 40001 typ srflx raddr 192.168.1.10 rport 5000', sdpMid: '0', sdpMLineIndex: 0 } } },
        { from: 1, to: 2, label: '轉送 ice（雙向都會發生）', d: 'B 呼叫 addIceCandidate()。B 的候選也以同樣方式送給 A。' },
        P2P(0, 2, 'ICE 連線檢查（STUN Binding）', '雙方直接對候選配對送 STUN Binding Request（帶 ice-ufrag 與用 ice-pwd 計算的 MESSAGE-INTEGRITY）。同一個 Wi-Fi 下 host ↔ host 配對最先成功。'),
        P2P(2, 0, 'DTLS 握手', '在選定的 UDP 路徑上做 DTLS 握手，並檢查對方憑證的雜湊是否等於 SDP 裡的 a=fingerprint。從這裡開始全部加密。'),
        P2P(0, 2, 'SCTP + DATA_CHANNEL_OPEN', 'SCTP 關聯建立在 DTLS 之上；DCEP 送出 DATA_CHANNEL_OPEN 開啟名為 file 的通道。'),
        P2P(0, 2, 'header {name, size, mime}', 'PairDrop 類應用會先送一個 JSON header，B 的畫面跳出「是否接收 photo.jpg（3.2 MB）？」', { type: 'header', name: 'photo.jpg', mime: 'image/jpeg', size: 3355443 }),
        P2P(0, 2, 'chunk × N（每 64 KB）', '檔案以 ArrayBuffer 分塊送出；每送滿一個 partition（例如 1 MB）等 B 回覆確認，作為背壓。'),
        { note: true, from: 1, label: '🔒 伺服器全程看不到檔案內容', d: '伺服器只看過「誰和誰在說話」以及 SDP（內含 IP 位址）。' },
        { from: 1, to: 0, label: 'peer-left: B', d: 'B 關閉分頁 → WebSocket 斷線 → 伺服器通知房間其他成員。', payload: { type: 'peer-left', peerId: 'c3d4' } },
      ],
    },
    fb: {
      actors: ['瀏覽器 A', 'Firebase / 伺服器', '瀏覽器 B', 'STUN'],
      steps: [
        { from: 0, to: 1, label: 'GET /room', d: 'A 向 ShareDrop 的小型後端要房間名稱。後端用 A 的公網 IP 與 SECRET 算出一個雜湊當作房間名稱，所以客戶端看不到彼此的 IP，同區網的人卻會拿到同一個名稱。' },
        { from: 1, to: 0, label: '{ name: "9f2c…" }', d: '同一個公網 IP 永遠得到同一個房間名稱。', payload: { name: '9f2c1ab7…' } },
        { from: 0, to: 1, label: '寫入 rooms/9f2c/users/A', d: 'A 把自己的資料寫進 Firebase 房間節點，並設定 onDisconnect().remove()：這是交給 Firebase 伺服器的「遺囑」，A 斷線時自動刪除。', payload: { uuid: 'A', label: 'Chrome on Linux', avatarUrl: '…' } },
        { from: 2, to: 1, label: '寫入 rooms/9f2c/users/B', d: 'B 做同樣的事。' },
        { from: 1, to: 0, label: 'child_added: B', d: 'A 監聽房間節點的 child_added 事件，Firebase 即時推送：B 出現了。（B 也會收到 A 的 child_added。）' },
        { note: true, from: 0, label: '使用者在 A 點 B 的頭像，選擇檔案', d: '' },
        { from: 0, to: 3, label: 'STUN Binding Request', d: '收集候選，與 WebSocket 版相同。' },
        { from: 3, to: 0, label: 'XOR-MAPPED-ADDRESS', d: '' },
        { from: 0, to: 1, label: '寫入 B 的訊息節點：offer', d: 'Firebase 版的「轉送」就是寫入資料庫：A 把 offer 寫到 B 監聽的路徑下（路徑為示意）。', payload: { from: 'A', type: 'offer', sdp: OFFER_SDP } },
        { from: 1, to: 2, label: 'child_added: offer', d: 'B 的監聽器被觸發，讀到 offer。' },
        { from: 2, to: 1, label: '寫入 A 的訊息節點：answer', d: '' },
        { from: 1, to: 0, label: 'child_added: answer', d: '' },
        { from: 0, to: 1, label: 'ICE 候選同樣寫入資料庫', d: '每個候選都是一筆資料庫寫入，對方的監聽器即時收到。' },
        { from: 1, to: 2, label: 'child_added: ice', d: '' },
        P2P(0, 2, 'ICE 連線檢查', '從這裡開始與 WebSocket 版完全相同——WebRTC 不在乎信令是怎麼送的。'),
        P2P(2, 0, 'DTLS 握手', ''),
        P2P(0, 2, 'SCTP + DataChannel', ''),
        P2P(0, 2, 'chunk × N', '檔案內容直接 P2P。'),
        { note: true, from: 1, label: '🔒 Firebase 看不到檔案內容', d: '' },
        { from: 1, to: 0, label: 'child_removed: B', d: 'B 關閉分頁，Firebase 伺服器偵測到斷線並執行 B 預先設定的 onDisconnect().remove()，A 收到 child_removed。' },
      ],
    },
  };

  let backend = 'ws', cur = 0, playTimer = null;
  function renderSeq() {
    const sc = SCRIPTS[backend];
    App.seqDiagram($('#seqSvg'), sc.actors, sc.steps, cur);
    const s = sc.steps[cur];
    $('#seqCount').textContent = `第 ${cur + 1} / ${sc.steps.length} 步`;
    $('#seqDetail').innerHTML = `<span class="step-n">${cur + 1}.</span><b>${esc(s.label)}</b><div>${esc(s.d || '')}</div>${s.payload ? `<pre>${esc(JSON.stringify(s.payload, null, 2))}</pre>` : ''}`;
  }
  const go = d => { const n = SCRIPTS[backend].steps.length; cur = Math.max(0, Math.min(n - 1, cur + d)); renderSeq(); };
  $('#seqPrev').addEventListener('click', () => go(-1));
  $('#seqNext').addEventListener('click', () => go(1));
  $('#seqPlay').addEventListener('click', () => {
    if (playTimer) { clearInterval(playTimer); playTimer = null; return; }
    if (cur >= SCRIPTS[backend].steps.length - 1) cur = 0;
    renderSeq();
    playTimer = setInterval(() => {
      if (cur >= SCRIPTS[backend].steps.length - 1) { clearInterval(playTimer); playTimer = null; return; }
      go(1);
    }, 1600);
  });
  App.seg('seqBackend', v => { backend = v; cur = 0; renderSeq(); });
  App.whenVisible($('#seqSvg'), renderSeq);
  App.onRedraw(() => $('#seqSvg').innerHTML && renderSeq());
})();

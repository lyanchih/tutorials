'use strict';

/* 第 8 章：Tracker announce、精簡 peer 清單、Peer Wire 訊息、對話流程 */
(() => {
  const { $, esc, fromHex, toHex, utf8, concatBytes, u32, u16, renderHex, PALETTE } = App;

  const PEER_ID = '-PT0001-' + Array.from({ length: 12 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
  let torrentInfo = { pieceCount: 20 };

  // =====================================================================
  // 實驗 8a：announce 網址
  // =====================================================================
  // info_hash 是 20 個原始位元組，逐位元組做 URL 編碼（不是 hex 字串）
  const urlBytes = bytes => [...bytes].map(b => {
    const c = String.fromCharCode(b);
    return /[A-Za-z0-9.\-_~]/.test(c) ? c : '%' + b.toString(16).toUpperCase().padStart(2, '0');
  }).join('');

  function updateAnnounce() {
    const hex = $('#annHash').value.trim();
    const ih = fromHex(hex);
    if (ih.length !== 20 || hex.replace(/[^0-9a-f]/gi, '').length !== 40) { $('#annUrl').textContent = '⚠️ infohash 必須是 40 個 hex 字元'; return; }
    const left = Math.max(0, +$('#annLeft').value | 0);
    const params = [
      ['info_hash', urlBytes(ih), 'bs'], ['peer_id', PEER_ID, 'bi'], ['port', '6881', 'bn'],
      ['uploaded', '0', 'bn'], ['downloaded', '0', 'bn'], ['left', String(left), 'bn'],
      ['compact', '1', 'bn'], ['event', left ? 'started' : 'completed', 'bd'],
    ];
    $('#annUrl').innerHTML = 'http://tracker.example.org:6969/announce?' +
      params.map(([k, v, c]) => `<b>${k}</b>=<span class="${c}">${esc(v)}</span>`).join('&amp;') +
      `<div class="small-note" style="margin-top:6px">注意 info_hash：可列印的位元組直接顯示為字元，其餘才用 %XX——所以它看起來不像 hex。left = ${left} → ${left ? '我是下載者（leecher）' : '我是種子（seeder），event=completed'}。</div>`;
  }
  $('#annHash').addEventListener('input', updateAnnounce);
  $('#annLeft').addEventListener('input', updateAnnounce);

  function updateCompact() {
    const bytes = fromHex($('#compactHex').value);
    const out = $('#compactOut');
    if (!bytes.length || bytes.length % 6) { out.innerHTML = `<p class="small-note">⚠️ 長度 ${bytes.length} bytes，必須是 6 的倍數</p>`; return; }
    let rows = '';
    for (let i = 0; i < bytes.length; i += 6) {
      const ip = [...bytes.subarray(i, i + 4)].join('.');
      const port = (bytes[i + 4] << 8) | bytes[i + 5];
      rows += `<tr><td>${i / 6 + 1}</td><td><code>${toHex(bytes.subarray(i, i + 4))}</code> <code>${toHex(bytes.subarray(i + 4, i + 6))}</code></td><td><b>${ip}:${port}</b></td></tr>`;
    }
    out.innerHTML = `<div class="table-wrap"><table><tr><th>#</th><th>原始位元組（IP 4 B + port 2 B，大端序）</th><th>位址</th></tr>${rows}</table></div>`;
  }
  $('#compactHex').addEventListener('input', updateCompact);
  updateCompact();

  // =====================================================================
  // 實驗 8b：訊息位元組
  // =====================================================================
  const TYPES = {
    handshake: { name: 'handshake', fields: [['info_hash', 'text', ''], ['peer_id', 'text', PEER_ID], ['dht', 'check', true], ['fast', 'check', true], ['ext', 'check', true]] },
    keepalive: { name: 'keep-alive', fields: [] },
    choke: { name: 'choke (0)', id: 0, fields: [] },
    unchoke: { name: 'unchoke (1)', id: 1, fields: [] },
    interested: { name: 'interested (2)', id: 2, fields: [] },
    notinterested: { name: 'not interested (3)', id: 3, fields: [] },
    have: { name: 'have (4)', id: 4, fields: [['index', 'number', 7]] },
    bitfield: { name: 'bitfield (5)', id: 5, fields: [['pieces', 'number', 20], ['own', 'text', '0-3,7,12']] },
    request: { name: 'request (6)', id: 6, fields: [['index', 'number', 0], ['begin', 'number', 16384], ['length', 'number', 16384]] },
    piece: { name: 'piece (7)', id: 7, fields: [['index', 'number', 0], ['begin', 'number', 16384], ['block', 'text', 'Hello, BitTorrent!']] },
    cancel: { name: 'cancel (8)', id: 8, fields: [['index', 'number', 0], ['begin', 'number', 16384], ['length', 'number', 16384]] },
    port: { name: 'port (9)', id: 9, fields: [['port', 'number', 6881]] },
  };
  const LABEL = { info_hash: 'info_hash（hex）', peer_id: 'peer_id（20 字元）', dht: 'DHT（BEP 5）', fast: 'Fast Extension（BEP 6）', ext: 'Extension Protocol（BEP 10）',
    index: 'piece index', begin: 'begin（piece 內位移）', length: 'length', pieces: 'torrent 共有幾個 piece', own: '我擁有的 piece（例：0-3,7）', block: '區塊資料（文字）', port: 'DHT port' };

  const sel = $('#wireType');
  Object.entries(TYPES).forEach(([k, t]) => sel.add(new Option(t.name, k)));

  function renderFields() {
    const t = TYPES[sel.value];
    $('#wireFields').innerHTML = t.fields.map(([k, type, def]) => {
      if (k === 'info_hash') def = (torrentInfo.infohash || 'c12fe1c06bba254a9dc9f519b335aa7c1367a88a');
      if (k === 'pieces') def = torrentInfo.pieceCount || 20;
      if (type === 'check') return `<label class="small-note"><input type="checkbox" data-k="${k}" ${def ? 'checked' : ''}> ${LABEL[k]}</label>`;
      return `<label class="small-note" style="display:block">${LABEL[k]}<input type="${type}" data-k="${k}" value="${esc(def)}"></label>`;
    }).join('') || '<span class="small-note">這個訊息沒有 payload</span>';
    $('#wireFields').querySelectorAll('input').forEach(i => i.addEventListener('input', renderWire));
    renderWire();
  }

  function parseSet(s, n) {
    const set = new Set();
    s.split(',').forEach(part => {
      const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
      if (!m) return;
      const a = +m[1], b = m[2] ? +m[2] : a;
      for (let i = a; i <= b && i < n; i++) set.add(i);
    });
    return set;
  }

  function renderWire() {
    const t = TYPES[sel.value];
    const v = {};
    $('#wireFields').querySelectorAll('input').forEach(i => { v[i.dataset.k] = i.type === 'checkbox' ? i.checked : i.value; });
    let fields;
    if (sel.value === 'handshake') {
      const reserved = new Uint8Array(8);
      if (v.ext) reserved[5] |= 0x10;
      if (v.fast) reserved[7] |= 0x04;
      if (v.dht) reserved[7] |= 0x01;
      const ih = fromHex(v.info_hash || '');
      const pid = utf8.encode((v.peer_id || '').padEnd(20, '0').slice(0, 20));
      fields = [
        { bytes: new Uint8Array([19]), label: 'pstrlen = 19', color: PALETTE[0] },
        { bytes: utf8.encode('BitTorrent protocol'), label: 'pstr = "BitTorrent protocol"', color: PALETTE[3] },
        { bytes: reserved, label: `reserved（${[v.ext && 'reserved[5]&0x10 擴充協定', v.fast && 'reserved[7]&0x04 Fast', v.dht && 'reserved[7]&0x01 DHT'].filter(Boolean).join('、') || '全部 0'}）`, color: PALETTE[7] },
        { bytes: ih.length === 20 ? ih : new Uint8Array(20), label: 'info_hash（20 bytes，必須與對方相同）', color: PALETTE[1] },
        { bytes: pid.subarray(0, 20), label: `peer_id「${utf8.encode(v.peer_id || '').length > 20 ? '（截斷）' : ''}${(v.peer_id || '').slice(0, 20)}」`, color: PALETTE[2] },
      ];
    } else if (sel.value === 'keepalive') {
      fields = [{ bytes: u32(0), label: 'length = 0（沒有 id 也沒有 payload）', color: PALETTE[0] }];
    } else {
      let payload = [];
      const n = x => Math.max(0, Math.floor(+x || 0)) >>> 0;
      if (sel.value === 'have') payload = [{ bytes: u32(n(v.index)), label: `piece index = ${n(v.index)}`, color: PALETTE[2] }];
      if (sel.value === 'bitfield') {
        const count = Math.min(4096, Math.max(1, n(v.pieces)));
        const own = parseSet(v.own || '', count);
        const bf = new Uint8Array(Math.ceil(count / 8));
        own.forEach(i => { bf[i >> 3] |= 0x80 >> (i & 7); });
        payload = [{ bytes: bf, label: `bitfield：${count} 個 piece 需要 ${bf.length} bytes，最高位元 = piece 0；末端多出的位元必須為 0`, color: PALETTE[2] }];
      }
      if (['request', 'cancel'].includes(sel.value)) {
        payload = [
          { bytes: u32(n(v.index)), label: `index = ${n(v.index)}`, color: PALETTE[2] },
          { bytes: u32(n(v.begin)), label: `begin = ${n(v.begin)}（第 ${Math.floor(n(v.begin) / 16384)} 個 16 KiB block）`, color: PALETTE[4] },
          { bytes: u32(n(v.length)), label: `length = ${n(v.length)}${n(v.length) > 16384 ? '（多數客戶端會拒絕 > 16 KiB 的請求）' : ''}`, color: PALETTE[6] },
        ];
      }
      if (sel.value === 'piece') {
        payload = [
          { bytes: u32(n(v.index)), label: `index = ${n(v.index)}`, color: PALETTE[2] },
          { bytes: u32(n(v.begin)), label: `begin = ${n(v.begin)}`, color: PALETTE[4] },
          { bytes: utf8.encode(v.block || ''), label: 'block：真正的檔案資料（通常 16 KiB）', color: PALETTE[8] },
        ];
      }
      if (sel.value === 'port') payload = [{ bytes: u16(n(v.port) & 0xffff), label: `DHT 監聽的 UDP port = ${n(v.port) & 0xffff}`, color: PALETTE[2] }];
      const body = concatBytes(payload.map(p => p.bytes));
      fields = [
        { bytes: u32(1 + body.length), label: `length = ${1 + body.length}（id 1 byte + payload ${body.length} bytes），大端序`, color: PALETTE[0] },
        { bytes: new Uint8Array([t.id]), label: `message id = ${t.id}（${t.name.split(' (')[0]}）`, color: PALETTE[5] },
        ...payload,
      ];
    }
    const total = renderHex($('#wireHex'), $('#wireLegend'), $('#wireHover'), fields);
    $('#wireLegend').insertAdjacentHTML('beforeend', `<span><b>共 ${total} bytes</b></span>`);
  }
  sel.addEventListener('change', renderFields);
  sel.value = 'handshake';
  renderFields();

  App.onShare('torrent', t => {
    torrentInfo = t;
    $('#annHash').value = t.infohash;
    if (t.total) $('#annLeft').value = t.total;
    updateAnnounce();
    if (sel.value === 'handshake' || sel.value === 'bitfield') renderFields();
  });
  updateAnnounce();

  // =====================================================================
  // 實驗 8c：peer 對話
  // =====================================================================
  const ACT = ['Leecher A', 'Seeder B', 'Tracker'];
  const STEPS = [
    { from: 0, to: 2, label: 'GET /announce?…&event=started', d: 'A 拿到 .torrent（或磁力連結），向 tracker 報到：我要下載這個 info_hash，left = 檔案大小。' },
    { from: 2, to: 0, label: 'd8:intervali1800e5:peers6:…e', d: 'tracker 回傳精簡 peer 清單（這裡只有 B），並要求 A 每 1800 秒再報到一次。' },
    { from: 0, to: 1, label: 'TCP 連線 → B:6881', d: 'B 有公網可連入的 port（UPnP 開好的，或 B 本身在公網），所以 A 可以直接連。如果雙方都在 NAT 後面且沒有開 port，就得靠 uTP 打洞或乾脆連不上。' },
    { from: 0, to: 1, label: 'handshake（68 B）', d: '<19>"BitTorrent protocol"<reserved><info_hash><peer_id>' },
    { from: 1, to: 0, label: 'handshake（68 B）', d: 'B 檢查 info_hash 是自己正在分享的 torrent，回送自己的 handshake。reserved 位元顯示雙方都支援 DHT 與擴充協定。' },
    { from: 1, to: 0, label: 'bitfield（全部是 1）', d: 'B 是種子，擁有所有 piece。若支援 Fast Extension 可改送更短的 have_all。' },
    { from: 0, to: 1, label: 'interested', d: 'A 看了 bitfield：B 有我缺的 piece → 表達興趣。此時 A 仍被 choke，不能下載。' },
    { from: 1, to: 0, label: 'unchoke', d: 'B 的 choking 演算法把一個名額給 A（對新人來說通常是 optimistic unchoke）。' },
    { from: 0, to: 1, label: 'request(0, 0, 16384) ×5', d: 'Pipelining：A 一次掛多個請求（piece 0 的 block 0–4），不用每個 block 都等一個來回，才能填滿頻寬。' },
    { from: 1, to: 0, label: 'piece(0, 0, <16 KiB>)', d: '資料來了。A 每收到一個 block 就補一個新的 request，維持管線滿載。' },
    { from: 1, to: 0, label: 'piece(0, 16384, …) …', d: '256 KiB 的 piece = 16 個 16 KiB block。' },
    { note: true, from: 0, label: 'A 收齊 piece 0 → SHA-1 比對 .torrent 第 0 個雜湊 ✓', d: '驗證通過才寫入磁碟並公開宣告；失敗就丟棄重下。' },
    { from: 0, to: 1, label: 'have(0)', d: 'A 對所有已連線的 peer 廣播「我有 piece 0 了」，其他下載者因此可以向 A 要。' },
    { from: 1, to: 0, label: 'choke', d: '10 秒後 B 重新評估，把名額輪給其他 peer。A 的 request 會被丟棄，A 要記得重新排隊。' },
    { from: 0, to: 1, label: 'keep-alive（00 00 00 00）', d: '約 2 分鐘沒有任何訊息時送出，避免連線被當成死掉。' },
    { from: 0, to: 2, label: 'GET /announce?…&event=completed', d: 'A 下載完成，告訴 tracker：left = 0，我現在是種子了。' },
  ];
  let ci = 0;
  function renderConv() {
    App.seqDiagram($('#convSvg'), ACT, STEPS, ci);
    const s = STEPS[ci];
    $('#convCount').textContent = `第 ${ci + 1} / ${STEPS.length} 步`;
    $('#convDetail').innerHTML = `<span class="step-n">${ci + 1}.</span><b>${esc(s.label)}</b><div>${esc(s.d)}</div>`;
  }
  $('#convPrev').addEventListener('click', () => { ci = Math.max(0, ci - 1); renderConv(); });
  $('#convNext').addEventListener('click', () => { ci = Math.min(STEPS.length - 1, ci + 1); renderConv(); });
  App.whenVisible($('#convSvg'), renderConv);
  App.onRedraw(() => $('#convSvg').innerHTML && renderConv());
})();

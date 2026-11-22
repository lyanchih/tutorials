'use strict';

/* 第 7 章：bencode、SHA-1、在瀏覽器裡製作 / 解析 .torrent */
(() => {
  const { $, esc, toHex, utf8, utf8d, concatBytes, fmtBytes } = App;

  // =====================================================================
  // bencode（位元組層級；字串一律以 Uint8Array 表示）
  // =====================================================================
  function cmpBytes(a, b) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
    return a.length - b.length;
  }
  function encode(v) {
    const out = [];
    const walk = x => {
      if (typeof x === 'number') {
        if (!Number.isInteger(x)) throw new Error(`bencode 只支援整數，${x} 不行`);
        out.push(utf8.encode(`i${x}e`));
      } else if (typeof x === 'string') {
        const b = utf8.encode(x);
        out.push(utf8.encode(b.length + ':'), b);
      } else if (x instanceof Uint8Array) {
        out.push(utf8.encode(x.length + ':'), x);
      } else if (Array.isArray(x)) {
        out.push(utf8.encode('l')); x.forEach(walk); out.push(utf8.encode('e'));
      } else if (x && typeof x === 'object') {
        out.push(utf8.encode('d'));
        Object.keys(x).map(k => [k, utf8.encode(k)]).sort((a, b) => cmpBytes(a[1], b[1])).forEach(([k, kb]) => {
          out.push(utf8.encode(kb.length + ':'), kb); walk(x[k]);
        });
        out.push(utf8.encode('e'));
      } else {
        throw new Error(`無法編碼 ${x === null ? 'null' : typeof x}（bencode 沒有 null / 布林值 / 小數）`);
      }
    };
    walk(v);
    return concatBytes(out);
  }

  // 解碼；spans 會記錄頂層字典中每個鍵的值所在的位元組範圍（用來從原始位元組算 infohash）
  function decode(buf) {
    let i = 0;
    const spans = {};
    const num = (end) => {
      let s = '';
      while (buf[i] !== end) { if (i >= buf.length) throw new Error('意外的結尾'); s += String.fromCharCode(buf[i++]); }
      i++;
      if (!/^-?\d+$/.test(s)) throw new Error(`不合法的數字「${s}」`);
      return parseInt(s, 10);
    };
    const val = depth => {
      const c = buf[i];
      if (c === 0x69) { i++; return num(0x65); }                           // i…e
      if (c === 0x6c) { i++; const a = []; while (buf[i] !== 0x65) { if (i >= buf.length) throw new Error('串列沒有結尾'); a.push(val(depth + 1)); } i++; return a; }
      if (c === 0x64) {                                                    // d…e
        i++; const o = {};
        while (buf[i] !== 0x65) {
          if (i >= buf.length) throw new Error('字典沒有結尾');
          const k = utf8d.decode(val(depth + 1));
          const start = i;
          o[k] = val(depth + 1);
          if (depth === 0) spans[k] = [start, i];
        }
        i++; return o;
      }
      if (c >= 0x30 && c <= 0x39) { const len = num(0x3a); const s = buf.subarray(i, i + len); if (s.length < len) throw new Error('字串長度超出資料'); i += len; return s; }
      throw new Error(`位移 ${i} 出現意外的字元「${String.fromCharCode(c)}」`);
    };
    const value = val(0);
    if (i !== buf.length) throw new Error(`解析完成後還剩 ${buf.length - i} bytes`);
    return { value, spans };
  }

  // 顯示用：把位元組字串轉成可讀文字（不可讀就顯示 hex）
  function readable(b, key) {
    if (key === 'pieces') return `<${b.length} bytes = ${b.length / 20} 個 SHA-1>`;
    try {
      const s = new TextDecoder('utf-8', { fatal: true }).decode(b);
      if (/^[\P{C}\n\t]*$/u.test(s)) return JSON.stringify(s.length > 120 ? s.slice(0, 120) + '…' : s);
    } catch (e) { /* 非 UTF-8 */ }
    return `<${b.length} bytes: ${toHex(b.subarray(0, 16))}${b.length > 16 ? '…' : ''}>`;
  }
  function tree(v, ind = '', key = '') {
    if (v instanceof Uint8Array) return readable(v, key);
    if (typeof v === 'number') return String(v);
    if (Array.isArray(v)) {
      if (!v.length) return '[]';
      const items = v.slice(0, 50).map(x => ind + '  ' + tree(x, ind + '  '));
      if (v.length > 50) items.push(ind + `  …（還有 ${v.length - 50} 項）`);
      return '[\n' + items.join(',\n') + '\n' + ind + ']';
    }
    const ks = Object.keys(v);
    return '{\n' + ks.map(k => `${ind}  ${JSON.stringify(k)}: ${tree(v[k], ind + '  ', k)}`).join(',\n') + '\n' + ind + '}';
  }

  // 彩色 bencode（教學用，輸入為 JSON 值）
  function bencHtml(x) {
    if (typeof x === 'number') return `<span class="bi">i${x}e</span>`;
    if (typeof x === 'string') return `<span class="bn">${utf8.encode(x).length}:</span><span class="bs">${esc(x)}</span>`;
    if (Array.isArray(x)) return `<span class="bl">l</span>${x.map(bencHtml).join('')}<span class="bl">e</span>`;
    const keys = Object.keys(x).map(k => [k, utf8.encode(k)]).sort((a, b) => cmpBytes(a[1], b[1])).map(a => a[0]);
    return `<span class="bd">d</span>${keys.map(k => bencHtml(k) + bencHtml(x[k])).join('')}<span class="bd">e</span>`;
  }

  // =====================================================================
  // SHA-1（優先用 WebCrypto，沒有安全環境時用純 JS）
  // =====================================================================
  function sha1js(bytes) {
    const ml = bytes.length;
    const withPad = new Uint8Array(((ml + 9 + 63) >> 6) << 6);
    withPad.set(bytes);
    withPad[ml] = 0x80;
    const dv = new DataView(withPad.buffer);
    dv.setUint32(withPad.length - 4, (ml * 8) >>> 0);
    dv.setUint32(withPad.length - 8, Math.floor(ml / 0x20000000));
    let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
    const w = new Uint32Array(80);
    for (let off = 0; off < withPad.length; off += 64) {
      for (let t = 0; t < 16; t++) w[t] = dv.getUint32(off + t * 4);
      for (let t = 16; t < 80; t++) { const x = w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16]; w[t] = (x << 1) | (x >>> 31); }
      let a = h0, b = h1, c = h2, d = h3, e = h4;
      for (let t = 0; t < 80; t++) {
        let f, k;
        if (t < 20) { f = (b & c) | (~b & d); k = 0x5A827999; }
        else if (t < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
        else if (t < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
        else { f = b ^ c ^ d; k = 0xCA62C1D6; }
        const tmp = (((a << 5) | (a >>> 27)) + f + e + k + w[t]) >>> 0;
        e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = tmp;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
    }
    const out = new Uint8Array(20);
    const ov = new DataView(out.buffer);
    [h0, h1, h2, h3, h4].forEach((h, i) => ov.setUint32(i * 4, h));
    return out;
  }
  const hasSubtle = !!(window.crypto && crypto.subtle && window.isSecureContext);
  async function sha1(bytes) {
    if (hasSubtle) return new Uint8Array(await crypto.subtle.digest('SHA-1', bytes));
    return sha1js(bytes);
  }
  App.bencode = { encode, decode, sha1 };

  // =====================================================================
  // 實驗 7a：bencode 遊樂場
  // =====================================================================
  async function updateBenc() {
    try {
      const v = JSON.parse($('#bencIn').value);
      const bytes = encode(v);
      $('#bencOut').innerHTML = bencHtml(v);
      $('#bencInfo').textContent = `共 ${bytes.length} bytes・SHA-1 = ${toHex(await sha1(bytes))}`;
    } catch (e) {
      $('#bencOut').textContent = '⚠️ ' + e.message;
      $('#bencInfo').textContent = '';
    }
  }
  function updateBencDec() {
    try {
      $('#bencDecOut').textContent = tree(decode(utf8.encode($('#bencDecIn').value)).value);
    } catch (e) { $('#bencDecOut').textContent = '⚠️ ' + e.message; }
  }
  $('#bencIn').addEventListener('input', updateBenc);
  $('#bencDecIn').addEventListener('input', updateBencDec);
  updateBenc(); updateBencDec();

  // =====================================================================
  // 實驗 7b：製作 / 解析 .torrent
  // =====================================================================
  let files = [], torrentBytes = null, made = null;
  const pieceSeg = App.seg('tfPiece', () => files.length && make());

  // 從「所有檔案串接起來」的虛擬位元組流中讀取 [start, end)
  async function readRange(start, end) {
    const parts = [];
    let base = 0;
    for (const f of files) {
      const fEnd = base + f.size;
      if (fEnd > start && base < end) {
        const s = Math.max(start, base) - base, e = Math.min(end, fEnd) - base;
        parts.push(new Uint8Array(await f.slice(s, e).arrayBuffer()));
      }
      base = fEnd;
      if (base >= end) break;
    }
    return concatBytes(parts);
  }

  const hue = h => `hsl(${Math.round(h[0] / 255 * 360)}, ${50 + (h[1] % 30)}%, ${45 + (h[2] % 20)}%)`;
  function drawPieces(hashes, bad = -1) {
    const box = $('#tfPieces');
    const MAX = 2000;
    box.innerHTML = hashes.slice(0, MAX).map((h, i) => `<i style="background:${hue(h)}" class="${i === bad ? 'bad' : ''}" title="piece ${i}: ${toHex(h)}"></i>`).join('') +
      (hashes.length > MAX ? `<span class="small-note">…還有 ${hashes.length - MAX} 個</span>` : '');
  }

  function magnet(ih, name, tracker) {
    return `magnet:?xt=urn:btih:${ih}&dn=${encodeURIComponent(name)}${tracker ? '&tr=' + encodeURIComponent(tracker) : ''}`;
  }

  function showSummary(rows) {
    $('#tfOut').innerHTML = `<dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
  }

  async function make() {
    const pieceLen = +pieceSeg.get();
    const total = files.reduce((s, f) => s + f.size, 0);
    if (!total) { showSummary([['錯誤', '檔案是空的']]); return; }
    $('#tfActions').hidden = true;
    $('#tfVerify').innerHTML = '';
    const hashes = [];
    const READ = Math.max(pieceLen, 4 * 1024 * 1024);
    let carry = new Uint8Array(0), done = 0;
    const t0 = performance.now();
    for (const f of files) {
      for (let off = 0; off < f.size; off += READ) {
        let buf = new Uint8Array(await f.slice(off, Math.min(f.size, off + READ)).arrayBuffer());
        if (carry.length) { buf = concatBytes([carry, buf]); carry = new Uint8Array(0); }
        let p = 0;
        for (; p + pieceLen <= buf.length; p += pieceLen) hashes.push(await sha1(buf.subarray(p, p + pieceLen)));
        carry = buf.slice(p);
        done += Math.min(READ, f.size - off);
        $('#tfBar').style.width = (done / total * 100).toFixed(1) + '%';
      }
    }
    if (carry.length) hashes.push(await sha1(carry));   // 最後一個 piece 可以比較短
    const sec = (performance.now() - t0) / 1000;

    const single = files.length === 1;
    const name = single ? files[0].name : 'shared-files';
    const info = single
      ? { name, 'piece length': pieceLen, pieces: concatBytes(hashes), length: total }
      : { name, 'piece length': pieceLen, pieces: concatBytes(hashes), files: files.map(f => ({ length: f.size, path: [f.name] })) };
    const tracker = $('#tfTracker').value.trim();
    const torrent = { 'created by': 'P2P Interactive Tutorial', 'creation date': Math.floor(Date.now() / 1000), info };
    if (tracker) torrent.announce = tracker;
    torrentBytes = encode(torrent);
    const infoBytes = encode(info);
    const ih = toHex(await sha1(infoBytes));
    made = { hashes, pieceLen, total, name, ih };
    showSummary([
      ['名稱', esc(name) + (single ? '（單檔模式）' : `（多檔模式，${files.length} 個檔案）`)],
      ['總大小', `${fmtBytes(total)}（${total.toLocaleString()} bytes）`],
      ['piece 大小', fmtBytes(pieceLen)],
      ['piece 數', `${hashes.length}（最後一個 ${fmtBytes(total - (hashes.length - 1) * pieceLen)}）`],
      ['pieces 欄位', `${hashes.length} × 20 = ${(hashes.length * 20).toLocaleString()} bytes`],
      ['info 字典', `${infoBytes.length.toLocaleString()} bytes（bencode 後）`],
      ['.torrent 檔', `${torrentBytes.length.toLocaleString()} bytes`],
      ['<b>infohash</b>', `<b>${ih}</b>`],
      ['磁力連結', `<a href="${esc(magnet(ih, name, tracker))}">${esc(magnet(ih, name, tracker))}</a>`],
      ['計算耗時', `${sec.toFixed(2)} 秒（${hasSubtle ? 'WebCrypto' : '純 JavaScript SHA-1'}）`],
    ]);
    drawPieces(hashes);
    $('#tfActions').hidden = false;
    $('#tfCorrupt').hidden = false;
    App.share('torrent', { infohash: ih, total, pieceLen, pieceCount: hashes.length, name });
  }

  async function load(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    try {
      const { value, spans } = decode(buf);
      if (!value.info || !spans.info) throw new Error('沒有 info 字典，這不是 .torrent');
      // infohash 必須對「原始位元組」計算，不能重新編碼（避免非標準編碼造成差異）
      const ih = toHex(await sha1(buf.subarray(spans.info[0], spans.info[1])));
      const info = value.info;
      const pieces = info.pieces instanceof Uint8Array ? info.pieces : new Uint8Array(0);
      const hashes = [];
      for (let i = 0; i + 20 <= pieces.length; i += 20) hashes.push(pieces.subarray(i, i + 20));
      const total = info.length || (info.files || []).reduce((s, f) => s + (f.length || 0), 0);
      const name = info.name ? utf8d.decode(info.name) : '(無名稱)';
      const tr = value.announce ? utf8d.decode(value.announce) : '';
      showSummary([
        ['檔案', esc(file.name)],
        ['名稱', esc(name)],
        ['總大小', total ? fmtBytes(total) : (info['meta version'] === 2 ? '（v2 torrent，大小記錄在 file tree 中）' : '?')],
        ['piece 大小', info['piece length'] ? fmtBytes(info['piece length']) : '?'],
        ['piece 數', hashes.length || '（v2 only：雜湊在 piece layers 中）'],
        ['<b>infohash</b>', `<b>${ih}</b>`],
        ['磁力連結', esc(magnet(ih, name, tr))],
        ['完整結構', `<div class="tree">${esc(tree(value))}</div>`],
      ]);
      drawPieces(hashes);
      $('#tfActions').hidden = true;
      made = null;
      App.share('torrent', { infohash: ih, total, pieceLen: info['piece length'], pieceCount: hashes.length, name });
    } catch (e) {
      showSummary([['解析失敗', esc(e.message)]]);
    }
  }

  async function corrupt() {
    if (!made) return;
    const k = Math.floor(Math.random() * made.hashes.length);
    const start = k * made.pieceLen, end = Math.min(made.total, start + made.pieceLen);
    const data = await readRange(start, end);
    const pos = Math.floor(Math.random() * data.length), bit = Math.floor(Math.random() * 8);
    const before = data[pos];
    data[pos] ^= 1 << bit;
    const h = await sha1(data);
    drawPieces(made.hashes, k);
    $('#tfVerify').innerHTML = `<div class="result-banner bad">🧨 piece #${k} 在位移 ${pos} 的第 ${bit} 個位元被翻轉（0x${before.toString(16).padStart(2, '0')} → 0x${data[pos].toString(16).padStart(2, '0')}）</div>
      <dl class="kv"><dt>.torrent 記錄的 SHA-1</dt><dd>${toHex(made.hashes[k])}</dd><dt>收到資料的 SHA-1</dt><dd style="color:var(--bad)">${toHex(h)}</dd>
      <dt>結果</dt><dd>不符 → 丟棄這個 piece，並把送來的 peer 記一筆「壞資料」，多次之後封鎖它。</dd></dl>`;
  }

  $('#tfFiles').addEventListener('change', e => { files = [...e.target.files]; if (files.length) make(); });
  $('#tfDemo').addEventListener('click', () => {
    const buf = new Uint8Array(1024 * 1024);
    let s = 12345;
    for (let i = 0; i < buf.length; i++) { s = (Math.imul(s, 1103515245) + 12345) >>> 0; buf[i] = s >>> 24; }
    files = [new File([buf], 'demo-1MiB.bin')];
    make();
  });
  $('#tfTracker').addEventListener('change', () => files.length && make());
  $('#tfLoad').addEventListener('change', e => { if (e.target.files[0]) load(e.target.files[0]); });
  $('#tfDownload').addEventListener('click', () => torrentBytes && App.download((made ? made.name : 'file') + '.torrent', torrentBytes, 'application/x-bittorrent'));
  $('#tfCorrupt').addEventListener('click', corrupt);
})();

'use strict';

/* 第 11 章：DID——did:key、用 DID 簽章擋中間人攻擊、did:dht（BEP 44） */
(() => {
  const { $, esc, toHex, utf8, utf8d, concatBytes, renderHex, PALETTE } = App;

  // =====================================================================
  // 編碼工具
  // =====================================================================
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function base58encode(bytes) {
    let n = 0n;
    for (const b of bytes) n = n * 256n + BigInt(b);
    let s = '';
    while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
    for (const b of bytes) { if (b !== 0) break; s = '1' + s; }
    return s;
  }
  function base58decode(str) {
    let n = 0n;
    for (const c of str) {
      const i = B58.indexOf(c);
      if (i < 0) throw new Error(`「${c}」不是 base58 字元（base58 刻意去掉了 0、O、I、l）`);
      n = n * 58n + BigInt(i);
    }
    const out = [];
    while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n; }
    for (const c of str) { if (c !== '1') break; out.unshift(0); }
    return new Uint8Array(out);
  }
  // z-base-32：did:dht 用的人類友善 base32（易混淆的字元被排除）
  const ZB32 = 'ybndrfg8ejkmcpqxot1uwisza345h769';
  function zbase32(bytes) {
    let bits = 0, val = 0, s = '';
    for (const b of bytes) {
      val = (val << 8) | b; bits += 8;
      while (bits >= 5) { s += ZB32[(val >>> (bits - 5)) & 31]; bits -= 5; }
    }
    if (bits > 0) s += ZB32[(val << (5 - bits)) & 31];
    return s;
  }
  function zbase32decode(str) {
    let bits = 0, val = 0;
    const out = [];
    for (const c of str) {
      const i = ZB32.indexOf(c);
      if (i < 0) throw new Error(`「${c}」不是 z-base-32 字元`);
      val = ((val << 5) | i) & 0xffff; bits += 5;
      if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
    }
    return new Uint8Array(out);
  }
  const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const b64urlDecode = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const short = hex => hex.slice(0, 16) + '…' + hex.slice(-8);

  // =====================================================================
  // Ed25519（WebCrypto）
  // =====================================================================
  const ED = { name: 'Ed25519' };
  async function genKey() {
    const kp = await crypto.subtle.generateKey(ED, false, ['sign', 'verify']);
    const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
    return { priv: kp.privateKey, pub, did: didKeyFromPub(pub) };
  }
  const sign = async (key, bytes) => new Uint8Array(await crypto.subtle.sign(ED, key.priv, bytes));
  async function verify(pub, sig, bytes) {
    const k = await crypto.subtle.importKey('raw', pub, ED, false, ['verify']);
    return crypto.subtle.verify(ED, k, sig, bytes);
  }

  const MULTICODEC_ED25519 = new Uint8Array([0xed, 0x01]);
  const multibase = pub => 'z' + base58encode(concatBytes([MULTICODEC_ED25519, pub]));
  const didKeyFromPub = pub => 'did:key:' + multibase(pub);
  function pubFromDidKey(did) {
    const m = did.trim().match(/^did:key:(.+)$/);
    if (!m) throw new Error('格式必須是 did:key:…');
    if (m[1][0] !== 'z') throw new Error(`multibase 前綴「${m[1][0]}」不是 z（base58btc）`);
    const bytes = base58decode(m[1].slice(1));
    if (bytes[0] !== 0xed || bytes[1] !== 0x01) throw new Error(`multicodec 標頭是 0x${toHex(bytes.subarray(0, 2))}，不是 Ed25519 的 0xed01`);
    if (bytes.length !== 34) throw new Error(`長度 ${bytes.length} bytes，Ed25519 應為 2 + 32 = 34 bytes`);
    return bytes.subarray(2);
  }
  function didKeyDocument(did) {
    const mb = did.slice('did:key:'.length);
    const vm = `${did}#${mb}`;
    return {
      '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/multikey/v1'],
      id: did,
      verificationMethod: [{ id: vm, type: 'Multikey', controller: did, publicKeyMultibase: mb }],
      authentication: [vm], assertionMethod: [vm], capabilityInvocation: [vm], capabilityDelegation: [vm],
    };
  }

  let supported = null;
  async function checkSupport() {
    if (supported !== null) return supported;
    try {
      if (!(window.crypto && crypto.subtle)) throw new Error('需要安全環境（https 或 localhost）');
      await crypto.subtle.generateKey(ED, false, ['sign', 'verify']);
      supported = true;
    } catch (e) { supported = false; }
    $('#didSupport').textContent = supported ? '✅ 這個瀏覽器支援 WebCrypto Ed25519' : '⚠️ 這個瀏覽器不支援 WebCrypto Ed25519（需要較新的 Chrome / Edge / Firefox / Safari，且要在 https 或 localhost 下開啟）';
    return supported;
  }
  let myKey = null;
  async function ensureKey() { if (!myKey) myKey = await genKey(); return myKey; }

  // =====================================================================
  // 實驗 11a：產生 / 解析 did:key
  // =====================================================================
  async function showGenerated() {
    if (!(await checkSupport())) return;
    myKey = await genKey();
    const { pub, did } = myKey;
    $('#didGenOut').innerHTML = `<dl class="kv">
      <dt>公鑰（32 bytes）</dt><dd>${toHex(pub)}</dd>
      <dt>multicodec + 公鑰</dt><dd>ed01 ${toHex(pub)}</dd>
      <dt>base58btc</dt><dd>${esc(base58encode(concatBytes([MULTICODEC_ED25519, pub])))}</dd>
      <dt><b>你的 DID</b></dt><dd><b>${esc(did)}</b></dd>
      <dt>DID Document</dt><dd><div class="tree">${esc(JSON.stringify(didKeyDocument(did), null, 2))}</div></dd></dl>
      <p class="small-note">did:key 規格也允許從 Ed25519 公鑰推導出一把 X25519 金鑰放在 keyAgreement（用來加密），這裡省略。實驗 11c 會沿用這把金鑰。</p>`;
    renderHex($('#didHex'), $('#didLegend'), $('#didHover'), [
      { bytes: MULTICODEC_ED25519, label: 'multicodec：0xed = ed25519-pub，以 unsigned varint 編碼成 ed 01', color: PALETTE[1] },
      { bytes: pub, label: 'Ed25519 公鑰（32 bytes）', color: PALETTE[2] },
    ]);
    $('#didHover').textContent = '把滑鼠移到位元組上看說明';
    $('#didResolveIn').value = did;
    resolveKey();
    resetDht();
  }

  function resolveKey() {
    const out = $('#didResolveOut');
    try {
      const did = $('#didResolveIn').value.trim();
      const pub = pubFromDidKey(did);
      out.innerHTML = `<div class="result-banner good">✅ 解析成功（完全離線）：公鑰 = ${toHex(pub)}</div>
        <div class="tree">${esc(JSON.stringify(didKeyDocument(did), null, 2))}</div>`;
    } catch (e) {
      out.innerHTML = `<div class="result-banner bad">❌ ${esc(e.message)}</div>`;
    }
  }
  $('#didGen').addEventListener('click', () => showGenerated().catch(e => { $('#didGenOut').textContent = '錯誤：' + e.message; }));
  $('#didResolveIn').addEventListener('input', resolveKey);
  resolveKey();
  App.whenVisible($('#didGen'), checkSupport);

  // =====================================================================
  // 實驗 11b：信令伺服器中間人攻擊 vs DID 簽章
  // =====================================================================
  const serverSeg = App.seg('mitmServer', () => {});
  const trickSeg = App.seg('mitmTrick', () => {});
  const didSeg = App.seg('mitmDid', () => {});
  let cast = null;   // Alice / Bob / Mallory 的金鑰與 DTLS 憑證

  async function fingerprint() {
    const cert = await RTCPeerConnection.generateCertificate({ name: 'ECDSA', namedCurve: 'P-256' });
    const fp = cert.getFingerprints()[0];
    return `${fp.algorithm} ${fp.value.toUpperCase()}`;
  }
  async function setupCast() {
    if (cast) return cast;
    const [alice, mallory] = await Promise.all([genKey(), genKey()]);
    const [fpA, fpM] = await Promise.all([fingerprint(), fingerprint()]);
    cast = { alice, mallory, fpA, fpM, ufrag: Math.random().toString(36).slice(2, 6) };
    return cast;
  }
  // 簽章內容：DTLS 指紋 + 這次連線的 ice-ufrag（避免舊簽章被重放到別的連線）
  const payload = (fp, ufrag) => utf8.encode(`webrtc-dtls|${fp}|ufrag=${ufrag}`);

  async function runMitm() {
    const log = $('#mitmLog'), banner = $('#mitmResult');
    log.innerHTML = ''; banner.className = 'result-banner idle'; banner.textContent = '執行中…';
    if (!(await checkSupport())) { banner.className = 'result-banner bad'; banner.textContent = '瀏覽器不支援 Ed25519，無法執行。'; return; }
    if (!window.RTCPeerConnection) { banner.className = 'result-banner bad'; banner.textContent = '瀏覽器不支援 WebRTC。'; return; }
    const c = await setupCast();
    const evil = serverSeg.get() === 'evil', resign = trickSeg.get() === 'resign', useDid = didSeg.get() === 'did';
    const L = (cls, t) => log.insertAdjacentHTML('beforeend', `<div class="${cls}">${esc(t)}</div>`);
    const msgs = [];

    // 1. Alice 送出 offer
    const sigA = await sign(c.alice, payload(c.fpA, c.ufrag));
    const sent = { fp: c.fpA, did: c.alice.did, sig: sigA };
    L('info', `Bob 在之前的配對（掃 QR code）中記住了 Alice 的 DID：${short(c.alice.did)}`);
    L('info', `Alice 的 offer：a=fingerprint:${short(c.fpA)}${useDid ? `，附上 DID 與簽章 ${short(toHex(sigA))}` : ''}`);
    msgs.push({ from: 0, to: 1, label: `offer：fingerprint ${c.fpA.slice(8, 19)}…${useDid ? ' + DID 簽章' : ''}` });

    // 2. 信令伺服器轉送（可能動手腳）
    let recv = { ...sent };
    if (evil) {
      recv.fp = c.fpM;
      L('drop', `😈 伺服器把指紋換成 Mallory 的：${short(c.fpM)}`);
      if (resign) {
        recv.did = c.mallory.did;
        recv.sig = await sign(c.mallory, payload(c.fpM, c.ufrag));
        L('drop', `😈 並用 Mallory 自己的 DID（${short(c.mallory.did)}）對新指紋重新簽章`);
      }
      msgs.push({ from: 1, to: 2, label: `offer：fingerprint ${c.fpM.slice(8, 19)}…（被換掉）`, cls: '' });
    } else {
      L('info', '伺服器原封不動轉送。');
      msgs.push({ from: 1, to: 2, label: `offer：fingerprint ${c.fpA.slice(8, 19)}…` });
    }

    // 3. Bob 驗證
    let accepted = true, reason = '';
    if (useDid) {
      if (recv.did !== c.alice.did) {
        accepted = false; reason = `簽章者是 ${short(recv.did)}，不是配對時記住的 Alice`;
      } else {
        const ok = await verify(pubFromDidKey(recv.did), recv.sig, payload(recv.fp, c.ufrag));
        L(ok ? 'ok' : 'drop', `Bob 用 Alice 的 DID 公鑰驗證簽章（WebCrypto Ed25519.verify）→ ${ok ? '有效' : '無效：簽章對不上收到的指紋'}`);
        if (!ok) { accepted = false; reason = 'Alice 的簽章對不上被換過的指紋'; }
      }
      if (recv.did !== c.alice.did) {
        const ok = await verify(pubFromDidKey(recv.did), recv.sig, payload(recv.fp, c.ufrag));
        L('info', `（簽章本身用 ${short(recv.did)} 驗證是${ok ? '有效' : '無效'}的——但那不重要）`);
      }
    }
    msgs.push({ note: true, from: 2, label: useDid ? (accepted ? 'Bob：DID 簽章驗證通過' : 'Bob：DID 驗證失敗，拒絕連線') : 'Bob：照單全收 SDP 裡的指紋' });

    // 4. DTLS 握手：真正接起連線的是誰？
    const realPeer = evil ? 'Mallory' : 'Alice';
    const presented = evil ? c.fpM : c.fpA;
    if (!accepted) {
      L('drop', `❌ Bob 拒絕：${reason}`);
      banner.className = 'result-banner good';
      banner.textContent = `🛡️ 攻擊被擋下：${reason}。Bob 不會和任何人建立 DTLS 連線，並可以警告使用者。`;
    } else {
      const match = presented === recv.fp;
      L(match ? 'ok' : 'drop', `DTLS 握手：對方出示的憑證指紋 ${short(presented)} ${match ? '＝' : '≠'} SDP 中的指紋 → ${match ? '握手成功' : '失敗'}`);
      msgs.push({ from: 2, to: evil ? 1 : 0, label: `DTLS 握手（對象：${realPeer}）`, cls: evil ? '' : 'p2p' });
      if (evil) {
        msgs.push({ from: 1, to: 0, label: 'Mallory 也假冒 Bob 跟 Alice 握手', cls: '' });
        L('drop', 'Mallory 對 Alice 那一側做同樣的事（換掉 Bob 的 answer 指紋），兩邊都以為在和對方加密通訊。');
        banner.className = 'result-banner bad';
        banner.textContent = '💀 中間人攻擊成功：Bob 的 DTLS 連線其實接到 Mallory，所有檔案都被解密後再轉送。從 Bob 的瀏覽器看，一切「正常加密」。';
      } else {
        banner.className = 'result-banner good';
        banner.textContent = useDid ? '✅ 連線建立，而且 Bob 確定對方就是 Alice。' : '✅ 連線建立（這次伺服器是誠實的，但 Bob 其實無從確認）。';
      }
    }
    App.seqDiagram($('#mitmSvg'), ['Alice', evil ? '信令伺服器（Mallory）' : '信令伺服器', 'Bob'], msgs);
  }
  $('#mitmRun').addEventListener('click', () => runMitm().catch(e => { $('#mitmResult').textContent = '錯誤：' + e.message; }));

  // =====================================================================
  // 實驗 11c：did:dht 發佈 / 解析（BEP 44 可變資料）
  // =====================================================================
  const K = 8;
  let dht = null;   // { nodes: [{ id, store }], key, did, seq, history, services }

  const hexToBig = h => BigInt('0x' + h);
  const prefixBits = (a, b) => { const x = hexToBig(a) ^ hexToBig(b); return x === 0n ? 160 : 160 - x.toString(2).length; };

  function resetDht() {
    dht = null;
    $('#dhtDidOut').innerHTML = '';
    $('#dhtDidLog').innerHTML = '';
  }

  function records(d) {
    const srv = d.services.map((s, i) => `s${i}`).join(',');
    const lines = [
      `_did.${d.zid}. TXT "v=0;vm=k0;auth=k0;asm=k0;inv=k0;del=k0${srv ? ';srv=' + srv : ''}"`,
      `_k0._did. TXT "id=0;t=0;k=${b64url(d.key.pub)}"`,
      ...d.services.map((s, i) => `_s${i}._did. TXT "id=${s.id};t=${s.type};se=${s.endpoint}"`),
    ];
    return lines.join('\n');
  }
  // BEP 44：簽章的對象是 bencode 片段 3:seqi<seq>e1:v<len>:<v>
  const signable = (seq, v) => concatBytes([utf8.encode(`3:seqi${seq}e1:v${v.length}:`), v]);

  function dLog(cls, t) {
    const el = $('#dhtDidLog');
    el.insertAdjacentHTML('beforeend', `<div class="${cls}">${esc(t)}</div>`);
    el.scrollTop = 1e9;
  }

  async function initDht() {
    if (dht) return dht;
    const key = await ensureKey();
    const nodes = Array.from({ length: 40 }, () => ({ id: toHex(crypto.getRandomValues(new Uint8Array(20))), store: null }));
    const target = toHex(await App.bencode.sha1(key.pub));
    const closest = nodes.map((n, i) => i).sort((a, b) => {
      const da = hexToBig(nodes[a].id) ^ hexToBig(target), db = hexToBig(nodes[b].id) ^ hexToBig(target);
      return da < db ? -1 : da > db ? 1 : 0;
    }).slice(0, K);
    dht = { key, nodes, target, closest, zid: zbase32(key.pub), seq: Math.floor(Date.now() / 1000), history: [], services: [] };
    dht.did = 'did:dht:' + dht.zid;
    return dht;
  }

  async function makeItem(d) {
    const v = utf8.encode(records(d));
    if (v.length > 1000) throw new Error('v 超過 BEP 44 的 1000 bytes 上限');
    const sig = await sign(d.key, signable(d.seq, v));
    return { k: d.key.pub, seq: d.seq, v, sig };
  }

  // DHT 節點收到 put：驗證簽章、檢查 seq，才會存
  async function nodePut(node, item) {
    if (!(await verify(item.k, item.sig, signable(item.seq, item.v)))) return [false, '簽章無效'];
    if (node.store && item.seq < node.store.seq) return [false, `seq ${item.seq} 比已存的 ${node.store.seq} 舊（BEP 44 錯誤 302）`];
    node.store = { ...item };
    return [true, '已儲存'];
  }

  async function putAll(item, label) {
    const d = dht;
    dLog('info', `${label}：先用 get_peers 類的迭代查詢（第 10 章）找到離 target 最近的 ${K} 個節點，再對它們送 put`);
    let ok = 0;
    for (const i of d.closest) {
      const [res, why] = await nodePut(d.nodes[i], item);
      if (res) ok++;
      dLog(res ? 'ok' : 'drop', `  節點 ${d.nodes[i].id.slice(0, 10)}…（與 target 共同前綴 ${prefixBits(d.nodes[i].id, d.target)} bits）：${why}`);
    }
    return ok;
  }

  function renderDht(resolved) {
    const d = dht;
    const cur = d.history[d.history.length - 1];
    const rows = d.closest.map(i => {
      const n = d.nodes[i];
      return `<tr><td><code>${n.id.slice(0, 12)}…</code></td><td class="num">${prefixBits(n.id, d.target)}</td>
        <td class="num">${n.store ? n.store.seq : '—'}</td><td>${n.store ? (n.store.tampered ? '<span class="tag bad">被竄改</span>' : '<span class="tag good">有資料</span>') : '<span class="tag">空</span>'}</td></tr>`;
    }).join('');
    $('#dhtDidOut').innerHTML = `<dl class="kv">
      <dt><b>DID</b></dt><dd><b>${esc(d.did)}</b></dd>
      <dt>k（公鑰）</dt><dd>${toHex(d.key.pub)}（與實驗 11a 同一把金鑰：${esc(short(d.key.did))}）</dd>
      <dt>target = SHA-1(k)</dt><dd>${d.target}</dd>
      ${cur ? `<dt>seq</dt><dd>${cur.seq}</dd><dt>v</dt><dd>${cur.v.length} bytes（上限 1000）</dd><dt>sig</dt><dd>${short(toHex(cur.sig))}（64 bytes Ed25519）</dd>
      <dt>簽章對象</dt><dd>${esc(`3:seqi${cur.seq}e1:v${cur.v.length}:`)}&lt;v&gt;</dd>` : ''}</dl>
      ${cur ? `<h4>v 的內容（DNS TXT 記錄，簡化顯示）</h4><div class="tree">${esc(utf8d.decode(cur.v))}</div>` : ''}
      <h4>離 target 最近的 ${K} 個 DHT 節點</h4>
      <div class="table-wrap"><table><tr><th>節點 ID</th><th class="num">共同前綴（bits）</th><th class="num">存的 seq</th><th>狀態</th></tr>${rows}</table></div>
      ${resolved ? `<h4>解析出來的 DID Document</h4><div class="tree">${esc(JSON.stringify(resolved, null, 2))}</div>` : ''}`;
  }

  // 解析：把 TXT 記錄還原成 DID Document
  function parseRecords(did, text) {
    const txt = {};
    text.split('\n').forEach(line => {
      const m = line.match(/^(\S+)\s+TXT\s+"(.*)"$/);
      if (m) txt[m[1]] = Object.fromEntries(m[2].split(';').map(kv => kv.split('=')));
    });
    const root = txt[`_did.${did.slice(8)}.`];
    if (!root) throw new Error('找不到根記錄');
    const vm = id => `${did}#${id}`;
    const keys = (root.vm || '').split(',').filter(Boolean).map(r => txt[`_${r}._did.`]);
    const services = (root.srv || '').split(',').filter(Boolean).map(r => txt[`_${r}._did.`]);
    const doc = {
      id: did,
      verificationMethod: keys.map(k => ({ id: vm(k.id), type: 'JsonWebKey', controller: did, publicKeyJwk: { kty: 'OKP', crv: 'Ed25519', x: k.k } })),
      authentication: keys.map(k => vm(k.id)), assertionMethod: keys.map(k => vm(k.id)),
    };
    if (services.length) doc.service = services.map(s => ({ id: `${did}#${s.id}`, type: s.t, serviceEndpoint: s.se }));
    return { doc, keys };
  }

  async function guard(fn) {
    if (!(await checkSupport())) { $('#dhtDidLog').innerHTML = '<div class="drop">瀏覽器不支援 Ed25519，無法執行。</div>'; return; }
    try { await fn(); } catch (e) { dLog('drop', '錯誤：' + e.message); }
  }

  async function publish() {
    const d = await initDht();
    if (d.history.length) { dLog('info', '已經發佈過了；要改內容請按「③ 更新文件」'); return; }
    const item = await makeItem(d);
    d.history.push(item);
    dLog('info', `🔑 擁有者用私鑰簽署 seq=${item.seq} 的文件`);
    await putAll(item, '① put');
    renderDht();
  }

  async function resolve() {
    const d = await initDht();
    if (!d.history.length) { dLog('drop', '還沒有發佈過，DHT 上找不到任何資料。'); renderDht(); return; }
    const k = zbase32decode(d.did.slice(8)).subarray(0, 32);
    dLog('info', `② 另一台電腦拿到 ${short(d.did)}：從識別碼解出公鑰 → 算出 target = SHA-1(k) = ${d.target.slice(0, 16)}… → 向最近的節點送 get`);
    let best = null;
    for (const i of d.closest) {
      const s = d.nodes[i].store;
      if (!s) continue;
      const ok = await verify(k, s.sig, signable(s.seq, s.v));
      dLog(ok ? 'ok' : 'drop', `  節點 ${d.nodes[i].id.slice(0, 10)}… 回傳 seq=${s.seq} → 簽章${ok ? '有效' : '無效，丟棄這個回應'}`);
      if (ok && (!best || s.seq > best.seq)) best = s;
    }
    if (!best) { dLog('drop', '沒有任何有效回應'); renderDht(); return; }
    const { doc, keys } = parseRecords(d.did, utf8d.decode(best.v));
    const same = keys.length && toHex(b64urlDecode(keys[0].k)) === toHex(k);
    dLog(same ? 'ok' : 'drop', `採用 seq 最大的有效版本（${best.seq}）。文件中的身分金鑰 ${same ? '＝' : '≠'} DID 識別碼中的公鑰`);
    renderDht(doc);
  }

  async function update() {
    const d = await initDht();
    if (!d.history.length) { dLog('drop', '請先發佈。'); return; }
    d.seq++;
    d.services.push({ id: `signal${d.services.length}`, type: 'SignalingService', endpoint: `wss://signal${d.services.length + 1}.example.com` });
    const item = await makeItem(d);
    d.history.push(item);
    dLog('info', `③ 新增 service（告訴別人到哪個信令伺服器找我），seq → ${item.seq}，重新簽章`);
    await putAll(item, '③ put');
    renderDht();
  }

  async function tamper() {
    const d = await initDht();
    const victim = d.closest.find(i => d.nodes[i].store);
    if (victim === undefined) { dLog('drop', '請先發佈。'); return; }
    const s = d.nodes[victim].store;
    const text = utf8d.decode(s.v).replace(/k=[^;"]+/, 'k=' + b64url(crypto.getRandomValues(new Uint8Array(32))));
    d.nodes[victim].store = { ...s, v: utf8.encode(text), tampered: true };
    dLog('drop', `😈 節點 ${d.nodes[victim].id.slice(0, 10)}… 把文件中的金鑰換成攻擊者的（簽章沒辦法跟著改）。現在按「② 解析」看看。`);
    renderDht();
  }

  async function replay() {
    const d = await initDht();
    if (d.history.length < 2) { dLog('drop', '要先按「③ 更新文件」產生新版本，才有舊版本可以重放。'); return; }
    const old = d.history[0];
    dLog('drop', `😈 攻擊者拿著舊版本（seq=${old.seq}，簽章是真的）重新 put，想把新加的 service 抹掉`);
    await putAll(old, '😈 put');
    renderDht();
  }

  $('#dhtDidPublish').addEventListener('click', () => guard(publish));
  $('#dhtDidResolve').addEventListener('click', () => guard(resolve));
  $('#dhtDidUpdate').addEventListener('click', () => guard(update));
  $('#dhtDidTamper').addEventListener('click', () => guard(tamper));
  $('#dhtDidReplay').addEventListener('click', () => guard(replay));
})();

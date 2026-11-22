'use strict';

/* 第 3 章：STUN 封包、ICE 連線檢查模擬、真實候選收集 */
(() => {
  const { $, esc, renderHex, PALETTE, u16, u32 } = App;

  // =====================================================================
  // 實驗 3a：STUN Binding Success Response + XOR-MAPPED-ADDRESS
  // =====================================================================
  const MAGIC = 0x2112A442;
  const txId = crypto.getRandomValues(new Uint8Array(12));

  function parseIp(s) {
    const p = s.trim().split('.').map(Number);
    if (p.length !== 4 || p.some(x => !Number.isInteger(x) || x < 0 || x > 255)) return null;
    return p;
  }

  function drawStun() {
    const ip = parseIp($('#stunIp').value);
    const port = Math.max(0, Math.min(65535, +$('#stunPort').value | 0));
    if (!ip) { $('#stunCalc').textContent = '請輸入合法的 IPv4 位址'; return; }
    const ipNum = ((ip[0] << 24) | (ip[1] << 16) | (ip[2] << 8) | ip[3]) >>> 0;
    const xport = port ^ (MAGIC >>> 16);
    const xaddr = (ipNum ^ MAGIC) >>> 0;
    const fields = [
      { bytes: u16(0x0101), label: 'Message Type 0x0101 = Binding Success Response', color: PALETTE[0] },
      { bytes: u16(12), label: 'Message Length = 12（header 之後的位元組數）', color: PALETTE[0] },
      { bytes: u32(MAGIC), label: 'Magic Cookie 0x2112A442（固定值，用來辨識 STUN）', color: PALETTE[3] },
      { bytes: txId, label: 'Transaction ID（96 bits 亂數，對應到你送出的 Request）', color: PALETTE[7] },
      { bytes: u16(0x0020), label: 'Attribute Type 0x0020 = XOR-MAPPED-ADDRESS', color: PALETTE[1] },
      { bytes: u16(8), label: 'Attribute Length = 8', color: PALETTE[1] },
      { bytes: new Uint8Array([0]), label: '保留位元組', color: PALETTE[1] },
      { bytes: new Uint8Array([1]), label: 'Family 0x01 = IPv4', color: PALETTE[1] },
      { bytes: u16(xport), label: `X-Port = ${port} ⊕ 0x2112 = ${xport}`, color: PALETTE[2] },
      { bytes: u32(xaddr), label: `X-Address = ${ip.join('.')} ⊕ 0x2112A442`, color: PALETTE[2] },
    ];
    renderHex($('#stunHex'), $('#stunLegend'), $('#stunHover'), fields);
    const xs = [24, 16, 8, 0].map(s => (xaddr >>> s) & 255).join('.');
    $('#stunCalc').innerHTML = `封包裡的位址看起來是 <code>${xs}:${xport}</code>——ALG 認不出來；客戶端再 XOR 一次就還原成 <code>${ip.join('.')}:${port}</code>。`;
  }
  $('#stunIp').addEventListener('input', drawStun);
  $('#stunPort').addEventListener('input', drawStun);
  drawStun();

  // =====================================================================
  // 實驗 3b：ICE 檢查清單模擬
  // =====================================================================
  const TYPE_PREF = { host: 126, prflx: 110, srflx: 100, relay: 0 };
  const prio = (type, localPref = 65535, comp = 1) => 2 ** 24 * TYPE_PREF[type] + 2 ** 8 * localPref + (256 - comp);
  // 配對優先權超過 2^53，用 BigInt 精確計算
  function pairPrio(G, D) {
    const g = BigInt(G), d = BigInt(D);
    const min = g < d ? g : d, max = g > d ? g : d;
    return (1n << 32n) * min + 2n * max + (g > d ? 1n : 0n);
  }

  const SCEN = {
    lan: { natA: 'port', natB: 'port', sameLan: true, desc: '兩台電腦在同一台路由器後面。' },
    cone: { natA: 'port', natB: 'port', desc: '一般的家用網路對家用網路。' },
    symres: { natA: 'sym', natB: 'restricted', desc: 'A 的 NAT 每個目的地換 port，但 B 只檢查 IP。' },
    symport: { natA: 'sym', natB: 'port', desc: '常見的「手機 4G 傳給家裡電腦」失敗情境。' },
    udpblock: { natA: 'port', natB: 'port', udpBlockA: true, desc: 'A 的公司防火牆只允許 TCP 443 對外。' },
  };

  function candidates(side, sc) {
    const isA = side === 'A';
    const hostIp = sc.sameLan ? (isA ? '192.168.1.10' : '192.168.1.23') : (isA ? '192.168.1.10' : '10.0.0.20');
    const pub = sc.sameLan ? '203.0.113.7' : (isA ? '203.0.113.7' : '198.51.100.9');
    const list = [{ type: 'host', addr: `${hostIp}:${isA ? 5000 : 6000}`, prio: prio('host') }];
    if (!(isA && sc.udpBlockA)) list.push({ type: 'srflx', addr: `${pub}:${isA ? 40001 : 51000}`, base: list[0].addr, prio: prio('srflx') });
    list.push({ type: 'relay', addr: `turn.example.com:${isA ? 49152 : 49200}`, prio: prio('relay'), note: isA && sc.udpBlockA ? '經 TURN over TLS:443 取得' : '' });
    return list;
  }

  // 判斷一個配對 (A 本地候選 la, B 遠端候選 rb) 的連線檢查能否成功
  function reach(la, rb, sc) {
    if (la.type === 'host' && sc.udpBlockA) return [false, 'A 的防火牆擋掉所有 UDP'];
    if (la.type === 'host' && rb.type === 'host') return sc.sameLan ? [true, '同網段，直接可達'] : [false, '對方的私有位址從這裡送不到'];
    if (la.type === 'host' && rb.type === 'srflx') {
      if (sc.sameLan) return [true, '經路由器 hairpin 轉回區網'];
      const ok = App.NatSim.canPunch(sc.natA, sc.natB);
      return ok ? [true, sc.natA === 'sym' ? '打洞成功；A 從回應中學到自己的 prflx 位址' : '打洞成功（第 2 章模擬器判定）'] : [false, '打洞失敗（第 2 章模擬器判定）'];
    }
    if (la.type === 'host' && rb.type === 'relay') return [true, 'A 直接送到 B 的 TURN 中繼位址'];
    if (la.type === 'relay' && rb.type === 'host') return [false, 'TURN 伺服器在公網，送不到私有位址'];
    return [true, '經 TURN 伺服器中繼'];
  }

  let iceScen = 'lan', pairs = [], iceTimer = null;

  function renderCands(box, list, isA) {
    box.innerHTML = list.map(c => {
      const pruned = isA && c.type === 'srflx';
      return `<div class="cand"><span class="tag ${c.type === 'host' ? 'acc' : c.type === 'srflx' ? 'good' : 'warn'}">${c.type}</span>${esc(c.addr)}
        <span class="small-note">priority ${c.prio}${c.base ? `・base ${c.base}` : ''}${c.note ? `・${c.note}` : ''}${pruned ? '・<b>配對時被剪除</b>' : ''}</span></div>`;
    }).join('');
  }

  function setupIce() {
    clearTimeout(iceTimer);
    const sc = SCEN[iceScen];
    const ca = candidates('A', sc), cb = candidates('B', sc);
    renderCands($('#iceCandA'), ca, true);
    renderCands($('#iceCandB'), cb, false);
    pairs = [];
    ca.filter(c => c.type !== 'srflx').forEach(la => cb.forEach(rb => {
      pairs.push({ la, rb, prio: pairPrio(la.prio, rb.prio), state: 'frozen' });
    }));
    pairs.sort((x, y) => (y.prio > x.prio ? 1 : y.prio < x.prio ? -1 : 0));
    renderPairs();
    $('#iceResult').className = 'result-banner idle';
    $('#iceResult').textContent = sc.desc + ' 按「執行連線檢查」。';
    $('#iceRun').disabled = false;
  }

  const STATE_TXT = { frozen: '⏸ Frozen', progress: '⏳ In-Progress', succeeded: '✅ Succeeded', failed: '❌ Failed', nominated: '⭐ Nominated' };
  function renderPairs() {
    $('#icePairs').innerHTML = '<tr><th>#</th><th>A 本地</th><th>B 遠端</th><th class="num">配對優先權</th><th>狀態</th><th>說明</th></tr>' +
      pairs.map((p, i) => `<tr class="st-${p.state}"><td>${i + 1}</td><td><span class="tag">${p.la.type}</span> ${esc(p.la.addr)}</td>
        <td><span class="tag">${p.rb.type}</span> ${esc(p.rb.addr)}</td><td class="num">${p.prio.toString()}</td>
        <td>${STATE_TXT[p.state]}</td><td class="small-note">${p.why || ''}</td></tr>`).join('');
  }

  function runIce() {
    $('#iceRun').disabled = true;
    const sc = SCEN[iceScen];
    let i = 0;
    const next = () => {
      if (i > 0) {
        const p = pairs[i - 1];
        const [ok, why] = reach(p.la, p.rb, sc);
        p.state = ok ? 'succeeded' : 'failed'; p.why = why;
      }
      if (i < pairs.length) {
        pairs[i].state = 'progress';
        renderPairs();
        i++;
        iceTimer = setTimeout(next, 550);
        return;
      }
      const best = pairs.find(p => p.state === 'succeeded');
      const banner = $('#iceResult');
      if (!best) {
        banner.className = 'result-banner bad'; banner.textContent = '❌ 沒有任何配對成功，連線失敗。';
      } else {
        best.state = 'nominated';
        const relay = best.la.type === 'relay' || best.rb.type === 'relay';
        const kind = relay ? 'TURN 中繼：資料經過伺服器，延遲較高且耗費伺服器頻寬' : best.rb.type === 'host' ? '區網直連：最快的路徑' : 'NAT 打洞直連：資料不經過任何伺服器';
        banner.className = `result-banner ${relay ? 'warn' : 'good'}`;
        banner.textContent = `⭐ 提名：${best.la.type} ↔ ${best.rb.type} —— ${kind}`;
      }
      renderPairs();
    };
    next();
  }

  App.seg('iceScenario', v => { iceScen = v; setupIce(); });
  $('#iceRun').addEventListener('click', runIce);
  setupIce();

  // =====================================================================
  // 實驗 3c：收集真實 ICE 候選
  // =====================================================================
  function describeCandidate(line) {
    const parts = line.replace(/^a=/, '').replace(/^candidate:/, '').split(/\s+/);
    const [foundation, component, transport, priority, address, port, , type] = parts;
    const extra = {};
    for (let i = 8; i + 1 < parts.length; i += 2) extra[parts[i]] = parts[i + 1];
    const p = +priority;
    return { foundation, component: +component, transport, priority: p, address, port, type, extra,
      typePref: Math.floor(p / 2 ** 24), localPref: Math.floor(p / 2 ** 8) % 65536, comp: 256 - (p % 256) };
  }

  async function gather() {
    const out = $('#gatherOut');
    if (!window.RTCPeerConnection) { out.innerHTML = '<div class="cand">這個瀏覽器不支援 WebRTC。</div>'; return; }
    out.innerHTML = '<div class="cand">收集中…</div>';
    const iceServers = $('#gatherStun').checked ? [{ urls: 'stun:stun.l.google.com:19302' }] : [];
    const pc = new RTCPeerConnection({ iceServers });
    pc.createDataChannel('probe');
    const found = [];
    const show = () => {
      out.innerHTML = found.length ? found.map(c => `<div class="cand"><span class="tag ${c.type === 'host' ? 'acc' : c.type === 'srflx' ? 'good' : c.type === 'relay' ? 'warn' : ''}">${c.type}</span>
        <b>${esc(c.address)}:${c.port}</b> ${c.transport}${c.extra.tcptype ? ' tcptype ' + c.extra.tcptype : ''}${c.extra.raddr ? `・raddr ${esc(c.extra.raddr)}:${c.extra.rport}` : ''}
        <br><span class="small-note">priority ${c.priority} = 2²⁴×<b>${c.typePref}</b> + 2⁸×${c.localPref} + (256−${c.comp})</span></div>`).join('')
        : '<div class="cand">沒有收集到候選（可能被瀏覽器設定或擴充功能停用）。</div>';
    };
    pc.onicecandidate = e => {
      if (e.candidate && e.candidate.candidate) { found.push(describeCandidate(e.candidate.candidate)); show(); }
    };
    await pc.setLocalDescription(await pc.createOffer());
    await new Promise(res => {
      const t = setTimeout(res, 6000);
      pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } };
    });
    show();
    out.insertAdjacentHTML('beforeend', `<div class="small-note">收集狀態：${pc.iceGatheringState}，共 ${found.length} 個候選。</div>`);
    pc.close();
  }
  $('#gatherGo').addEventListener('click', () => gather().catch(e => { $('#gatherOut').innerHTML = `<div class="cand">錯誤：${esc(e.message)}</div>`; }));
})();

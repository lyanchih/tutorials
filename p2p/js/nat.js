'use strict';

/* 第 2 章：NAT 打洞模擬器（映射行為 × 過濾行為，RFC 4787） */
(() => {
  const { $, esc } = App;

  const TYPES = {
    open: { name: '公網（無 NAT）', map: null, filter: null },
    full: { name: '完全錐形 Full Cone', map: 'EIM', filter: 'EIF' },
    restricted: { name: '限制錐形 Restricted', map: 'EIM', filter: 'ADF' },
    port: { name: '埠限制錐形 Port-Restricted', map: 'EIM', filter: 'APDF' },
    sym: { name: '對稱型 Symmetric', map: 'APDM', filter: 'APDF' },
  };
  const ORDER = ['open', 'full', 'restricted', 'port', 'sym'];
  const STUN = { ip: '192.0.2.1', port: 3478 };
  const ep = e => `${e.ip}:${e.port}`;

  class Nat {
    constructor(type, pubIp, firstPort, host) {
      this.type = type; this.cfg = TYPES[type];
      this.pubIp = pubIp; this.nextPort = firstPort; this.host = host;
      this.maps = [];
    }
    // 內部送出：回傳改寫後的來源位址
    outbound(dst) {
      if (!this.cfg.map) return { ext: { ip: this.pubIp, port: this.host.port }, created: false };
      let m = this.cfg.map === 'EIM' ? this.maps[0] : this.maps.find(x => x.dest === ep(dst));
      let created = false;
      if (!m) {
        m = { ext: this.nextPort, dest: this.cfg.map === 'EIM' ? null : ep(dst), sentTo: new Set(), sentIp: new Set() };
        this.nextPort += this.cfg.map === 'EIM' ? 1 : 7;
        this.maps.push(m);
        created = true;
      }
      m.sentTo.add(ep(dst)); m.sentIp.add(dst.ip);
      m.fresh = true;
      return { ext: { ip: this.pubIp, port: m.ext }, created, m };
    }
    // 外部送入：依過濾規則決定是否放行
    inbound(src, dstPort) {
      if (!this.cfg.map) return { ok: dstPort === this.host.port, why: '公網主機直接收' };
      const m = this.maps.find(x => x.ext === dstPort);
      if (!m) return { ok: false, why: `外部 port ${dstPort} 沒有任何映射` };
      if (this.cfg.filter === 'EIF') return { ok: true, why: '完全錐形：任何人都能進來' };
      if (this.cfg.filter === 'ADF') {
        return m.sentIp.has(src.ip) ? { ok: true, why: `曾送過封包給 ${src.ip}` } : { ok: false, why: `限制錐形：沒送過封包給 ${src.ip}` };
      }
      return m.sentTo.has(ep(src)) ? { ok: true, why: `曾送過封包給 ${ep(src)}` } : { ok: false, why: `過濾 APDF：沒送過封包給 ${ep(src)}` };
    }
  }

  function makeWorld(typeA, typeB) {
    const A = { name: 'A', ip: '192.168.1.10', port: 5000, knows: [], recvFrom: null };
    const B = { name: 'B', ip: '10.0.0.20', port: 6000, knows: [], recvFrom: null };
    A.nat = new Nat(typeA, '203.0.113.7', 40001, A);
    B.nat = new Nat(typeB, '198.51.100.9', 51000, B);
    if (typeA === 'open') { A.ip = A.nat.pubIp; }
    if (typeB === 'open') { B.ip = B.nat.pubIp; }
    return { A, B, log: [], connected: false };
  }

  // 從 host 送一個封包到 dst（公網位址）；dstHost 若存在代表目的地是另一個 peer
  function send(world, from, dst, dstHost, label) {
    const { ext, created } = from.nat.outbound(dst);
    const viaMsg = from.nat.cfg.map ? `NAT ${from.name} 改寫來源為 ${ep(ext)}${created ? '（新映射）' : ''}` : '公網主機';
    if (!dstHost) {
      world.log.push({ cls: 'info', text: `${from.name} → ${ep(dst)}：${label}。${viaMsg}` });
      return ext;
    }
    const r = dstHost.nat.inbound(ext, dst.port);
    if (r.ok) {
      world.log.push({ cls: 'ok', text: `${from.name} → ${ep(dst)}：${label}。${viaMsg} → ✅ NAT ${dstHost.name} 放行（${r.why}）` });
      dstHost.recvFrom = ext;
      if (!dstHost.knows.some(k => ep(k) === ep(ext))) {
        dstHost.knows.push({ ...ext, prflx: true });
        world.log.push({ cls: 'info', text: `　↳ ${dstHost.name} 收到來自 ${ep(ext)} 的封包，這是之前不知道的位址 → 記為 peer-reflexive 候選` });
      }
    } else {
      world.log.push({ cls: 'drop', text: `${from.name} → ${ep(dst)}：${label}。${viaMsg} → ❌ NAT ${dstHost.name} 丟棄（${r.why}）` });
    }
    return ext;
  }

  function stun(world, h) {
    const ext = send(world, h, STUN, null, 'STUN Binding Request');
    h.srflx = ext;
    // STUN 回應一定會被放行，因為 h 剛送過封包給 STUN
    world.log.push({ cls: 'ok', text: `S → ${h.name}：Binding Response，XOR-MAPPED-ADDRESS = ${ep(ext)}（${h.name} 的 server-reflexive 位址）` });
  }

  function punch(world, from, to) {
    const targets = [...from.knows];
    targets.forEach(t => send(world, from, t, to, t.prflx ? `打洞封包（送往學到的 prflx）` : '打洞封包（送往 srflx）'));
  }

  function checkConnected(world) {
    if (!world.connected && world.A.recvFrom && world.B.recvFrom) {
      world.connected = true;
      world.log.push({ cls: 'ok', text: `🎉 雙向都有封包抵達，連線建立：A(${ep(world.B.recvFrom)}) ⇄ B(${ep(world.A.recvFrom)})` });
    }
  }

  function buildSteps() {
    const steps = [
      { label: 'A 詢問 STUN：「我在外面看起來是誰？」', run: w => stun(w, w.A) },
      { label: 'B 詢問 STUN', run: w => stun(w, w.B) },
      { label: '透過信令伺服器交換 srflx 位址', run: w => {
        w.A.knows.push({ ...w.B.srflx }); w.B.knows.push({ ...w.A.srflx });
        w.log.push({ cls: 'info', text: `信令：A 得知 B 的 srflx = ${ep(w.B.srflx)}；B 得知 A 的 srflx = ${ep(w.A.srflx)}（這一步走 WebSocket / Firebase，不經過 NAT 打洞）` });
      } },
    ];
    for (let r = 1; r <= 3; r++) {
      steps.push({ label: `第 ${r} 輪：A 往 B 打洞`, run: w => { punch(w, w.A, w.B); checkConnected(w); } });
      steps.push({ label: `第 ${r} 輪：B 往 A 打洞`, run: w => { punch(w, w.B, w.A); checkConnected(w); } });
    }
    return steps;
  }
  const STEPS = buildSteps();

  // 跑完整流程，回傳是否能直接連線（第 3 章的 ICE 模擬也會用到）
  function canPunch(typeA, typeB) {
    const w = makeWorld(typeA, typeB);
    for (const s of STEPS) { s.run(w); if (w.connected) break; }
    return w.connected;
  }
  App.NatSim = { TYPES, ORDER, canPunch };

  // ---- 介面 ----
  let world, stepIdx;
  const selA = $('#natTypeA'), selB = $('#natTypeB');
  ORDER.forEach(t => {
    selA.add(new Option(TYPES[t].name, t));
    selB.add(new Option(TYPES[t].name, t));
  });
  selA.value = 'port'; selB.value = 'port';

  function renderTable(box, nat) {
    nat.maps.forEach(m => { m.freshShown = m.fresh; m.fresh = false; });
    if (!nat.cfg.map) { box.innerHTML = '<p class="small-note">公網主機：沒有 NAT，任何人都能直接送封包進來（假設沒有防火牆）。</p>'; return; }
    const cfg = nat.cfg;
    const rows = nat.maps.map(m => `<tr class="${m.freshShown ? 'fresh' : ''}">
      <td>${nat.host.ip}:${nat.host.port}</td><td>${nat.pubIp}:${m.ext}</td>
      <td>${m.dest ? esc(m.dest) : '任何目的地'}</td>
      <td>${cfg.filter === 'EIF' ? '任何人' : cfg.filter === 'ADF' ? [...m.sentIp].join('<br>') : [...m.sentTo].join('<br>')}</td></tr>`).join('');
    box.innerHTML = `<div class="small-note">映射 ${cfg.map}・過濾 ${cfg.filter}</div>
      <table class="nat-table"><tr><th>內部</th><th>外部</th><th>映射適用</th><th>允許進入的來源</th></tr>${rows || '<tr><td colspan="4">（空）</td></tr>'}</table>`;
  }

  function render() {
    renderTable($('#natTableA'), world.A.nat);
    renderTable($('#natTableB'), world.B.nat);
    $('#natLog').innerHTML = world.log.map(l => `<div class="${l.cls}">${esc(l.text)}</div>`).join('') || '<div class="info">（尚無封包）</div>';
    $('#natLog').scrollTop = 1e9;
    const banner = $('#natResult');
    const finished = world.connected || stepIdx >= STEPS.length;
    $('#natStepLabel').textContent = finished ? '流程結束' : `下一步：${STEPS[stepIdx].label}`;
    $('#natStep').disabled = finished;
    if (world.connected) {
      banner.className = 'result-banner good';
      banner.textContent = '✅ 打洞成功！A 與 B 之間建立了直接的 UDP 路徑，資料不需要經過任何伺服器。';
    } else if (stepIdx >= STEPS.length) {
      banner.className = 'result-banner bad';
      banner.textContent = '❌ 打洞失敗：至少有一方的封包始終進不去。實務上 ICE 會改用 TURN 伺服器中繼（第 3 章）。';
    } else if (stepIdx === 0) {
      banner.className = 'result-banner idle'; banner.textContent = '按「下一步」開始。';
    } else {
      banner.className = 'result-banner warn'; banner.textContent = '進行中…';
    }
  }

  function reset() { world = makeWorld(selA.value, selB.value); stepIdx = 0; render(); }
  function step() {
    if (world.connected || stepIdx >= STEPS.length) return;
    STEPS[stepIdx++].run(world);
    render();
  }

  $('#natStep').addEventListener('click', step);
  $('#natAll').addEventListener('click', () => { while (!world.connected && stepIdx < STEPS.length) STEPS[stepIdx++].run(world); render(); });
  $('#natReset').addEventListener('click', reset);
  selA.addEventListener('change', reset);
  selB.addEventListener('change', reset);
  reset();

  // 相容表
  const short = { open: '公網', full: '完全錐形', restricted: '限制錐形', port: '埠限制錐形', sym: '對稱型' };
  let html = '<tr><th>A ＼ B</th>' + ORDER.map(t => `<th>${short[t]}</th>`).join('') + '</tr>';
  ORDER.forEach(a => {
    html += `<tr><th>${short[a]}</th>` + ORDER.map(b => {
      const ok = canPunch(a, b);
      return `<td class="${ok ? 'ok' : 'no'}" data-a="${a}" data-b="${b}" style="cursor:pointer" title="點我載入這個組合">${ok ? '✅ 直連' : '❌ TURN'}</td>`;
    }).join('') + '</tr>';
  });
  const matrix = $('#natMatrix');
  matrix.innerHTML = html;
  matrix.addEventListener('click', e => {
    const td = e.target.closest('td[data-a]');
    if (!td) return;
    selA.value = td.dataset.a; selB.value = td.dataset.b; reset();
    $('#natTypeA').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
})();

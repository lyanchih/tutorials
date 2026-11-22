'use strict';

/* 第 0 章：分發時間模擬；第 1 章：三種搜尋方式 */
(() => {
  const { $, css, setupCanvas, fmtTime, fmtInt } = App;

  // =====================================================================
  // 實驗 0：Client–Server vs P2P 分發時間（Kurose & Ross 下界）
  // =====================================================================
  const nOf = v => Math.max(1, Math.round(10 ** v));
  let N = 100, F = 1000, Us = 1000, U = 20, D = 100;

  const tCS = n => Math.max(n * F * 8 / Us, F * 8 / D);
  const tP2P = n => Math.max(F * 8 / Us, F * 8 / D, n * F * 8 / (Us + n * U));

  function drawDist() {
    const { ctx, w, h } = setupCanvas($('#distCanvas'));
    const pad = { l: 64, r: 30, t: 14, b: 34 };
    const xs = n => pad.l + (Math.log10(n) / 4) * (w - pad.l - pad.r);
    const tMin = Math.min(tP2P(1), tCS(1));
    const tMax = tCS(10000);
    const lo = Math.floor(Math.log10(tMin)), hi = Math.ceil(Math.log10(tMax)) || lo + 1;
    const ys = t => h - pad.b - ((Math.log10(t) - lo) / Math.max(1, hi - lo)) * (h - pad.t - pad.b);

    ctx.strokeStyle = css('--grid'); ctx.fillStyle = css('--muted'); ctx.lineWidth = 1;
    for (let e = 0; e <= 4; e++) {
      const x = xs(10 ** e);
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b); ctx.stroke();
      ctx.textAlign = 'center'; ctx.fillText(fmtInt(10 ** e), x, h - pad.b + 16);
    }
    for (let e = lo; e <= hi; e++) {
      const y = ys(10 ** e);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      ctx.textAlign = 'right'; ctx.fillText(fmtTime(10 ** e), pad.l - 6, y + 4);
    }
    ctx.textAlign = 'center'; ctx.fillText('下載人數 N（對數座標）', (pad.l + w) / 2, h - 4);

    const curve = (fn, color) => {
      ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.beginPath();
      for (let i = 0; i <= 200; i++) {
        const n = 10 ** (i / 50);
        const x = xs(n), y = ys(fn(n));
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    };
    curve(tCS, css('--bad'));
    curve(tP2P, css('--good'));

    const x = xs(N);
    ctx.strokeStyle = css('--muted'); ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b); ctx.stroke(); ctx.setLineDash([]);
    [[tCS(N), '--bad'], [tP2P(N), '--good']].forEach(([t, c]) => {
      ctx.fillStyle = css(c); ctx.beginPath(); ctx.arc(x, ys(t), 5, 0, Math.PI * 2); ctx.fill();
    });
  }

  function updateDist() {
    const cs = tCS(N), p2p = tP2P(N);
    $('#distMetrics').innerHTML = `
      <div class="metric bad"><div class="k">Client–Server</div><div class="v">${fmtTime(cs)}</div><div class="s">伺服器要送出 ${fmtInt(N * F / 1000)} GB</div></div>
      <div class="metric good"><div class="k">P2P</div><div class="v">${fmtTime(p2p)}</div><div class="s">總上傳能力 ${fmtInt(Us + N * U)} Mbps</div></div>
      <div class="metric"><div class="k">P2P 快了</div><div class="v">${(cs / p2p).toFixed(1)}×</div><div class="s">${p2p === F * 8 / D ? '瓶頸：下載頻寬' : p2p === F * 8 / Us ? '瓶頸：種子至少送一份' : '瓶頸：總上傳頻寬'}</div></div>`;
    drawDist();
  }

  App.range('distN', v => { N = nOf(v); updateDist(); }, v => fmtInt(nOf(v)) + ' 人');
  App.range('distF', v => { F = v; updateDist(); }, v => v >= 1000 ? (v / 1000).toFixed(1) + ' GB' : v + ' MB');
  App.range('distUs', v => { Us = v; updateDist(); }, v => v >= 1000 ? (v / 1000).toFixed(1) + ' Gbps' : v + ' Mbps');
  App.range('distU', v => { U = v; updateDist(); }, v => v + ' Mbps');
  App.range('distD', v => { D = v; updateDist(); }, v => v + ' Mbps');
  N = nOf(+$('#distN').value);
  updateDist();
  App.onRedraw(drawDist);

  // =====================================================================
  // 實驗 1：中央索引 / 洪泛 / DHT 搜尋
  // =====================================================================
  const NODES = 80;
  let net, seed = 7;
  let anim = null;          // 目前動畫狀態
  let mode = 'central', ttl = 4, replicas = 1;

  function buildNet() {
    const rand = App.rng(seed);
    const nodes = [];
    while (nodes.length < NODES) {
      const p = { x: 0.04 + rand() * 0.92, y: 0.16 + rand() * 0.8 };
      if (nodes.every(q => Math.hypot(q.x - p.x, q.y - p.y) > 0.055)) nodes.push(p);
    }
    const adj = nodes.map(() => new Set());
    const d2 = (a, b) => (nodes[a].x - nodes[b].x) ** 2 + (nodes[a].y - nodes[b].y) ** 2;
    nodes.forEach((_, i) => {
      const near = nodes.map((_, j) => j).filter(j => j !== i).sort((a, b) => d2(i, a) - d2(i, b)).slice(0, 3);
      near.forEach(j => { adj[i].add(j); adj[j].add(i); });
    });
    // 把不相連的子圖接起來
    const comp = new Array(NODES).fill(-1);
    let c = 0;
    for (let i = 0; i < NODES; i++) {
      if (comp[i] >= 0) continue;
      const st = [i]; comp[i] = c;
      while (st.length) { const u = st.pop(); adj[u].forEach(v => { if (comp[v] < 0) { comp[v] = c; st.push(v); } }); }
      c++;
    }
    for (let k = 1; k < c; k++) {
      let best = null;
      for (let i = 0; i < NODES; i++) if (comp[i] === k) for (let j = 0; j < NODES; j++) if (comp[j] === 0) {
        if (!best || d2(i, j) < best[2]) best = [i, j, d2(i, j)];
      }
      adj[best[0]].add(best[1]); adj[best[1]].add(best[0]);
      for (let i = 0; i < NODES; i++) if (comp[i] === k) comp[i] = 0;
    }
    // DHT 用的 8-bit 節點 ID 與路由表（每個 bucket 最多 2 個聯絡人）
    const ids = App.shuffle([...Array(256).keys()], rand).slice(0, NODES);
    const routing = ids.map(me => {
      const table = [];
      for (let b = 0; b < 8; b++) {
        const inBucket = ids.map((id, j) => j).filter(j => { const d = ids[j] ^ me; return d >= (1 << b) && d < (1 << (b + 1)); });
        table.push(...App.shuffle(inBucket, rand).slice(0, 2));
      }
      return table;
    });
    net = { nodes, adj: adj.map(s => [...s]), ids, routing, rand };
    placeFile();
  }

  function placeFile() {
    const rand = net.rand;
    net.source = Math.floor(rand() * NODES);
    const others = App.shuffle([...Array(NODES).keys()].filter(i => i !== net.source), rand);
    net.holders = others.slice(0, replicas);
    net.key = Math.floor(rand() * 256);
    stopAnim();
    anim = null;
    drawSearch();
    $('#searchMetrics').innerHTML = '';
  }

  function stopAnim() { if (anim && anim.timer) clearTimeout(anim.timer); }

  function runSearch() {
    if (!net) buildNet();
    stopAnim();
    const { adj, source, holders } = net;
    if (mode === 'central') {
      anim = { mode, frames: [
        { lines: [{ from: source, to: 'server' }], msgs: 1 },
        { lines: [{ from: 'server', to: source }], msgs: 2 },
        { lines: [{ from: source, to: holders[0], p2p: true }], msgs: 2, found: holders[0] },
      ], step: 0 };
    } else if (mode === 'flood') {
      const frames = [];
      const seen = new Set([source]);
      let frontier = [{ node: source, from: -1 }];
      let msgs = 0, found = null;
      for (let t = 0; t < ttl && frontier.length; t++) {
        const lines = [], next = [];
        frontier.forEach(({ node, from }) => {
          adj[node].forEach(nb => {
            if (nb === from) return;
            msgs++;
            lines.push({ from: node, to: nb });
            if (!seen.has(nb)) { seen.add(nb); next.push({ node: nb, from: node }); }
          });
        });
        const hit = holders.find(hd => seen.has(hd));
        if (hit !== undefined && found === null) found = hit;
        frames.push({ lines, msgs, reached: new Set(seen), found });
        frontier = next;
      }
      anim = { mode, frames, step: 0 };
    } else {
      // DHT：貪婪地往 XOR 距離更近的節點跳，最後抵達「負責這個 key 的節點」
      const { ids, routing, key } = net;
      const dist = i => ids[i] ^ key;
      let cur = source;
      const path = [cur];
      for (;;) {
        let best = cur;
        routing[cur].forEach(j => { if (dist(j) < dist(best)) best = j; });
        if (best === cur) break;
        path.push(best); cur = best;
      }
      const frames = [];
      for (let i = 1; i < path.length; i++) {
        frames.push({ lines: [{ from: path[i - 1], to: path[i], dht: true }], msgs: i * 2, path: path.slice(0, i + 1) });
      }
      const resp = cur;
      frames.push({ lines: [{ from: source, to: holders[0], p2p: true }], msgs: (path.length - 1) * 2, path, found: holders[0], resp });
      anim = { mode, frames, step: 0, resp };
    }
    tick();
  }

  function tick() {
    drawSearch();
    showSearchMetrics();
    if (anim.step < anim.frames.length - 1) {
      anim.timer = setTimeout(() => { anim.step++; tick(); }, mode === 'flood' ? 700 : 600);
    }
  }

  function showSearchMetrics() {
    const f = anim.frames[anim.step];
    const done = anim.step === anim.frames.length - 1;
    let reached = '—', result;
    if (mode === 'flood') reached = f.reached.size + ' / ' + NODES;
    if (mode === 'central') reached = '伺服器 1 台';
    if (mode === 'dht') reached = `${f.path.length} 個節點`;
    if (!done) result = '<span class="tag warn">搜尋中…</span>';
    else result = f.found !== null && f.found !== undefined ? '<span class="tag good">找到了</span>' : '<span class="tag bad">TTL 用完，沒找到</span>';
    const hops = mode === 'flood' ? `第 ${anim.step + 1} 跳` : mode === 'dht' ? `${Math.max(0, f.path.length - 1)} 跳（log₂${NODES} ≈ ${Math.log2(NODES).toFixed(1)}）` : '1 次問答';
    $('#searchMetrics').innerHTML = `
      <div class="metric"><div class="k">查詢訊息數</div><div class="v">${fmtInt(f.msgs)}</div></div>
      <div class="metric"><div class="k">涉入的節點</div><div class="v" style="font-size:1rem">${reached}</div></div>
      <div class="metric"><div class="k">進度</div><div class="v" style="font-size:1rem">${hops}</div></div>
      <div class="metric"><div class="k">結果</div><div class="v" style="font-size:1rem">${result}</div></div>`;
    if (mode === 'dht' && done) {
      $('#searchMetrics').insertAdjacentHTML('beforeend', `<div class="metric" style="grid-column:1/-1"><div class="s">檔案 key = <b>${net.key}</b>（${net.key.toString(2).padStart(8, '0')}）。
        負責節點 ID = <b>${net.ids[anim.resp]}</b>，XOR 距離 ${net.ids[anim.resp] ^ net.key}（全網最小）。擁有者事先把「我有這個檔案」登記在負責節點上（announce），所以查詢者只要找到負責節點，就能拿到擁有者位址，再直接連線。</div></div>`);
    }
  }

  function drawSearch() {
    if (!net) return;
    const cv = $('#searchCanvas');
    const { ctx, w, h } = setupCanvas(cv);
    const { nodes, adj, source, holders } = net;
    const P = i => i === 'server' ? { x: w / 2, y: 28 } : { x: nodes[i].x * w, y: nodes[i].y * h };
    const f = anim ? anim.frames[anim.step] : null;

    ctx.strokeStyle = css('--border'); ctx.lineWidth = 1;
    adj.forEach((nbs, i) => nbs.forEach(j => {
      if (j < i) return;
      const a = P(i), b = P(j);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }));

    if (mode === 'central') {
      ctx.fillStyle = css('--accent-soft'); ctx.strokeStyle = css('--accent'); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(w / 2 - 80, 12, 160, 32, 8); ctx.fill(); ctx.stroke();
      ctx.fillStyle = css('--accent'); ctx.textAlign = 'center'; ctx.font = 'bold 12px system-ui';
      ctx.fillText('🗂️ 中央索引伺服器', w / 2, 33); ctx.font = '12px system-ui';
    }

    if (f) {
      const drawn = mode === 'flood' ? anim.frames.slice(0, anim.step + 1) : anim.frames.slice(0, anim.step + 1);
      drawn.forEach((fr, k) => fr.lines.forEach(l => {
        const a = P(l.from), b = P(l.to);
        const latest = k === anim.step;
        ctx.strokeStyle = l.p2p ? css('--good') : l.dht ? css('--c2') : css('--accent');
        ctx.globalAlpha = latest ? 1 : 0.35;
        ctx.lineWidth = l.p2p || l.dht ? 3 : 2;
        if (l.dht || l.from === 'server' || l.to === 'server' || l.p2p) {
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 - 40;
          ctx.setLineDash(l.p2p ? [6, 4] : []);
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(mx, my, b.x, b.y); ctx.stroke();
          ctx.setLineDash([]);
        } else {
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }));
    }

    nodes.forEach((_, i) => {
      const p = P(i);
      const reached = f && mode === 'flood' && f.reached.has(i);
      const onPath = f && mode === 'dht' && f.path && f.path.includes(i);
      ctx.fillStyle = reached ? css('--accent') : onPath ? css('--c2') : css('--panel-2');
      ctx.strokeStyle = css('--muted'); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (mode === 'dht') {
        ctx.fillStyle = css('--muted'); ctx.font = '9px ui-monospace, monospace'; ctx.textAlign = 'center';
        ctx.fillText(net.ids[i], p.x, p.y - 10); ctx.font = '12px system-ui';
      }
    });
    if (mode === 'dht' && anim && anim.resp !== undefined && anim.step === anim.frames.length - 1) {
      const p = P(anim.resp);
      ctx.strokeStyle = css('--c2'); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, 12, 0, Math.PI * 2); ctx.stroke();
    }
    const label = (i, txt, color) => {
      const p = P(i);
      ctx.fillStyle = color; ctx.font = 'bold 18px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(txt, p.x, p.y + 6); ctx.font = '12px system-ui';
    };
    holders.forEach(hd => label(hd, '◆', f && f.found === hd ? css('--good') : css('--c2')));
    label(source, '★', css('--warn'));
  }

  App.seg('searchMode', v => { mode = v; stopAnim(); anim = null; drawSearch(); $('#searchMetrics').innerHTML = ''; });
  App.range('searchTTL', v => { ttl = v; }, v => v);
  App.range('searchReplicas', v => { replicas = v; if (net) placeFile(); }, v => v + ' 份');
  ttl = +$('#searchTTL').value;
  replicas = +$('#searchReplicas').value;
  $('#searchGo').addEventListener('click', runSearch);
  $('#searchNew').addEventListener('click', () => { seed++; buildNet(); });
  App.whenVisible($('#searchCanvas'), () => { if (!net) buildNet(); });
  App.onRedraw(() => net && drawSearch());
})();

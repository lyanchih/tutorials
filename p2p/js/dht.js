'use strict';

/* 第 10 章：XOR 距離、Kademlia k-bucket 與迭代查詢（8-bit ID 空間） */
(() => {
  const { $, css, setupCanvas, rng, shuffle } = App;
  const BITS = 8, SPACE = 1 << BITS;
  const bin = x => x.toString(2).padStart(BITS, '0');
  const bucketOf = d => (d === 0 ? -1 : 31 - Math.clz32(d));

  // =====================================================================
  // 實驗 10a：XOR 距離
  // =====================================================================
  function updateXor() {
    const a = +$('#xorA').value, b = +$('#xorB').value, d = a ^ b;
    const bk = bucketOf(d);
    const cpl = d === 0 ? BITS : BITS - 1 - bk;
    const mark = s => s.slice(0, cpl) + (cpl < BITS ? '│' + s.slice(cpl) : '');
    $('#xorOut').textContent =
`a       = ${mark(bin(a))}   (${a})
b       = ${mark(bin(b))}   (${b})
a ⊕ b   = ${mark(bin(d))}   (${d})  ← 距離
共同前綴長度 = ${cpl} bits${d ? `\n→ b 落在 a 的第 ${bk} 號 bucket（距離 ${1 << bk}–${(1 << (bk + 1)) - 1}，這個 bucket 涵蓋 ${1 << bk} 個 ID）` : '\n→ 同一個 ID，距離 0'}
最高的不同位元決定距離的「數量級」：只要那一位不同，其餘位元怎麼變都比它小。`;
  }
  App.range('xorA', updateXor, v => `${v} (${bin(v)})`);
  App.range('xorB', updateXor, v => `${v} (${bin(v)})`);
  updateXor();

  // =====================================================================
  // 實驗 10b：路由表與迭代查詢
  // =====================================================================
  let net = null, lookup = null, seed = 3;
  let K = 3, ALPHA = 2, target = 200;

  function buildNet() {
    const rand = rng(seed);
    const n = +$('#dhtNodes').value;
    const ids = shuffle([...Array(SPACE).keys()], rand).slice(0, n).sort((a, b) => a - b);
    const tables = new Map();
    ids.forEach(me => {
      const buckets = [];
      for (let b = 0; b < BITS; b++) {
        const inB = ids.filter(id => bucketOf(id ^ me) === b);
        buckets.push(shuffle(inB, rand).slice(0, K));
      }
      tables.set(me, buckets);
    });
    // 預設把「我」放在目標的另一半 ID 空間，查詢才看得出逐步逼近
    const far = ids.filter(id => (id ^ target) >= SPACE / 2);
    const me = net && ids.includes(net.me) ? net.me : (far.length ? far : ids)[Math.floor(rand() * (far.length || ids.length))];
    net = { ids, tables, me };
    lookup = null;
    render();
  }

  const closest = (list, t, k) => [...new Set(list)].sort((a, b) => (a ^ t) - (b ^ t)).slice(0, k);

  function startLookup() {
    const t = target;
    const own = net.tables.get(net.me).flat();
    const short = new Map();   // id → { round: 已詢問的回合（-1 = 未詢問）, from }
    closest(own, t, K).forEach(id => short.set(id, { round: -1, from: 'table' }));
    lookup = { t, short, rounds: [], done: false, msgs: 0, best: Math.min(...[...short.keys()].map(id => id ^ t)) };
    render();
  }

  function stepLookup() {
    if (!lookup) startLookup();
    if (lookup.done) return;
    const { t, short } = lookup;
    const top = closest([...short.keys()], t, K);
    const unq = top.filter(id => short.get(id).round < 0);
    if (!unq.length) { lookup.done = true; render(); return; }
    // 上一輪有進步就只問 α 個；沒進步就把前 k 名裡還沒問過的全部問完（Kademlia 原論文的收尾規則）
    const last = lookup.rounds[lookup.rounds.length - 1];
    const ask = last && !last.improved ? unq : unq.slice(0, ALPHA);
    const r = lookup.rounds.length;
    const learned = [];
    ask.forEach(id => {
      short.get(id).round = r;
      lookup.msgs += 2;
      const reply = closest(net.tables.get(id).flat().filter(x => x !== net.me), t, K);
      reply.forEach(x => { if (!short.has(x)) { short.set(x, { round: -1, from: id }); learned.push(x); } });
    });
    const best = Math.min(...[...short.keys()].map(id => id ^ t));
    lookup.rounds.push({ ask, learned, improved: best < lookup.best });
    lookup.best = best;
    const top2 = closest([...short.keys()], t, K);
    if (top2.every(id => short.get(id).round >= 0)) lookup.done = true;
    render();
  }

  // ---- 繪圖 ----
  let geom = null;
  function draw() {
    if (!net) return;
    const { ctx, w, h } = setupCanvas($('#dhtCanvas'));
    const x0 = 30, x1 = w - 20, axisY = h - 110;
    const X = id => x0 + ((id + 0.5) / SPACE) * (x1 - x0);
    geom = { X, axisY };
    const me = net.me;
    const table = net.tables.get(me);
    const inTable = new Set(table.flat());

    // bucket 區間（相對於「我」）
    const colors = [css('--c1'), css('--c2'), css('--c3'), css('--warn')];
    for (let b = 0; b < BITS; b++) {
      const size = 1 << b;
      const start = ((me >> (b + 1)) << (b + 1)) | ((me ^ size) & size);
      const xa = X(start) - (x1 - x0) / SPACE / 2, xb = X(start + size - 1) + (x1 - x0) / SPACE / 2;
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = colors[b % colors.length];
      ctx.fillRect(xa, axisY + 8, xb - xa, 26 + b * 6);
      ctx.globalAlpha = 1;
      ctx.fillStyle = colors[b % colors.length];
      ctx.font = '10px system-ui';
      ctx.textAlign = 'center';
      if (xb - xa > 14) ctx.fillText(`b${b}`, (xa + xb) / 2, axisY + 30 + b * 6);
    }

    ctx.strokeStyle = css('--border'); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, axisY); ctx.lineTo(x1, axisY); ctx.stroke();
    ctx.fillStyle = css('--muted'); ctx.font = '10px ui-monospace, monospace'; ctx.textAlign = 'center';
    [0, 64, 128, 192, 255].forEach(v => ctx.fillText(v, X(v), h - 8));
    ctx.textAlign = 'left'; ctx.fillText('ID 空間 0–255（依二進位排序：左半 0xxxxxxx、右半 1xxxxxxx）', x0, h - 22);

    // 查詢的弧線：迭代查詢中，所有請求都是「我」直接送出的
    if (lookup) {
      lookup.rounds.forEach((r, ri) => {
        const latest = ri === lookup.rounds.length - 1;
        r.ask.forEach(id => {
          const xa = X(me), xb = X(id);
          ctx.strokeStyle = css('--c2'); ctx.globalAlpha = latest ? 1 : 0.3; ctx.lineWidth = latest ? 2.5 : 1.5;
          ctx.beginPath(); ctx.moveTo(xa, axisY);
          ctx.quadraticCurveTo((xa + xb) / 2, axisY - 40 - Math.abs(xb - xa) * 0.35, xb, axisY); ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.fillStyle = css('--c2'); ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'center';
          ctx.fillText(`R${ri + 1}`, (xa + xb) / 2, axisY - 22 - Math.abs(xb - xa) * 0.18);
        });
      });
    }

    const truth = closest(net.ids, target, K);
    net.ids.forEach(id => {
      const x = X(id);
      const st = lookup && lookup.short.get(id);
      let r = 4, fill = css('--panel-2'), stroke = css('--muted');
      if (inTable.has(id)) { fill = css('--accent'); stroke = css('--accent'); }
      if (st) { fill = st.round >= 0 ? css('--c2') : css('--warn-soft'); stroke = css('--c2'); r = 5; }
      ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, axisY, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (lookup && lookup.done && truth.includes(id)) {
        ctx.strokeStyle = css('--good'); ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(x, axisY, 9, 0, Math.PI * 2); ctx.stroke();
      }
    });
    // 我
    ctx.fillStyle = css('--warn'); ctx.font = 'bold 20px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('★', X(me), axisY - 8);
    ctx.font = '11px system-ui'; ctx.fillText(`我 ${me}`, X(me), axisY - 28);
    // 目標
    const xt = X(target);
    ctx.fillStyle = css('--bad');
    ctx.beginPath(); ctx.moveTo(xt, axisY - 6); ctx.lineTo(xt - 6, axisY - 18); ctx.lineTo(xt + 6, axisY - 18); ctx.closePath(); ctx.fill();
    ctx.fillText(`目標 ${target}`, xt, axisY - 22 - (Math.abs(xt - X(me)) < 50 ? 18 : 0));
  }

  function render() {
    draw();
    const me = net.me, table = net.tables.get(me);
    $('#dhtTable').innerHTML = '<tr><th>bucket</th><th>距離範圍</th><th>聯絡人（ID）</th></tr>' + table.map((list, b) => {
      const size = 1 << b;
      const start = ((me >> (b + 1)) << (b + 1)) | ((me ^ size) & size);
      const total = net.ids.filter(id => bucketOf(id ^ me) === b).length;
      return `<tr><td>${b}</td><td class="small-note">${size}–${2 * size - 1}<br>ID ${start}–${start + size - 1}</td>
        <td>${list.map(id => `<code title="${bin(id)}">${id}</code>`).join(' ') || '—'} <span class="small-note">（區間內共 ${total} 個節點）</span></td></tr>`;
    }).reverse().join('');

    if (!lookup) {
      $('#dhtShort').innerHTML = '<tr><td class="small-note">按「開始查詢」</td></tr>';
      $('#dhtMetrics').innerHTML = `<div class="metric"><div class="k">我的路由表大小</div><div class="v">${table.flat().length}</div><div class="s">全網 ${net.ids.length} 個節點</div></div>`;
      return;
    }
    const t = lookup.t;
    const list = [...lookup.short.entries()].sort((a, b) => (a[0] ^ t) - (b[0] ^ t));
    const topK = new Set(list.slice(0, K).map(e => e[0]));
    $('#dhtShort').innerHTML = '<tr><th>節點</th><th>二進位</th><th class="num">距離</th><th>狀態</th></tr>' + list.slice(0, 14).map(([id, s]) =>
      `<tr class="${topK.has(id) ? 'st-succeeded' : ''}"><td>${id}</td><td><code>${bin(id)}</code></td><td class="num">${id ^ t}</td>
        <td class="small-note">${s.round >= 0 ? `第 ${s.round + 1} 輪已詢問` : '未詢問'}・${s.from === 'table' ? '來自我的路由表' : `由 ${s.from} 回報`}</td></tr>`).join('');
    const truth = closest(net.ids, t, K);
    const found = closest([...lookup.short.keys()], t, K);
    const ok = truth.every(id => found.includes(id));
    $('#dhtMetrics').innerHTML = `
      <div class="metric"><div class="k">查詢輪數</div><div class="v">${lookup.rounds.length}</div><div class="s">log₂${net.ids.length} ≈ ${Math.log2(net.ids.length).toFixed(1)}</div></div>
      <div class="metric"><div class="k">送出的 KRPC 訊息</div><div class="v">${lookup.msgs}</div><div class="s">請求 + 回應</div></div>
      <div class="metric"><div class="k">目前最近距離</div><div class="v">${lookup.best}</div></div>
      <div class="metric ${lookup.done ? (ok ? 'good' : 'bad') : ''}"><div class="k">找到全網最近的 ${K} 個？</div><div class="v">${lookup.done ? (ok ? '✓ 是' : '✗ 否') : '…'}</div>
        <div class="s">${lookup.done ? '綠圈 = 真正最近的節點，peer 會 announce 到這裡' : '查詢進行中'}</div></div>`;
  }

  $('#dhtCanvas').addEventListener('click', e => {
    if (!geom || !net) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    let best = net.ids[0];
    net.ids.forEach(id => { if (Math.abs(geom.X(id) - x) < Math.abs(geom.X(best) - x)) best = id; });
    net.me = best;
    lookup = null;
    render();
  });
  App.range('dhtNodes', () => { lookup = null; buildNet(); }, v => v);
  App.range('dhtK', v => { K = v; buildNet(); }, v => v);
  App.range('dhtAlpha', v => { ALPHA = v; lookup = null; if (net) render(); }, v => v);
  App.range('dhtTarget', v => { target = v; lookup = null; if (net) render(); }, v => `${v} (${bin(v)})`);
  K = +$('#dhtK').value; ALPHA = +$('#dhtAlpha').value; target = +$('#dhtTarget').value;
  $('#dhtStart').addEventListener('click', () => {
    if (!net) buildNet();
    startLookup();
    const mine = lookup;
    const run = () => { if (lookup === mine && !lookup.done) { stepLookup(); setTimeout(run, 900); } };
    setTimeout(run, 600);
  });
  $('#dhtStepBtn').addEventListener('click', () => { if (!net) buildNet(); stepLookup(); });
  $('#dhtNew').addEventListener('click', () => { seed++; net = null; buildNet(); });
  App.whenVisible($('#dhtCanvas'), () => { if (!net) buildNet(); });
  App.onRedraw(() => net && draw());
})();

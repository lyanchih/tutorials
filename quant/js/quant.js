'use strict';

/* 量化核心函式（其他章節也會用到） */
const Quant = {
  // 對稱量化（限制範圍）：整數 ∈ [−(2^(b−1)−1), 2^(b−1)−1]，zero-point = 0
  sym(maxAbs, bits) {
    const qmax = Math.pow(2, bits - 1) - 1;
    return { s: maxAbs / qmax || 1e-12, z: 0, qmin: -qmax, qmax };
  },
  // 非對稱量化：整數 ∈ [0, 2^b − 1]，範圍一定包含 0，讓 0 能被精確表示
  asym(min, max, bits) {
    const lo = Math.min(min, 0), hi = Math.max(max, 0);
    const qmax = Math.pow(2, bits) - 1;
    const s = (hi - lo) / qmax || 1e-12;
    return { s, z: Math.round(-lo / s), qmin: 0, qmax };
  },
  q: (x, p) => Math.max(p.qmin, Math.min(p.qmax, Math.round(x / p.s) + p.z)),
  dq: (q, p) => p.s * (q - p.z),
  fake: (x, p) => p.s * (Math.max(p.qmin, Math.min(p.qmax, Math.round(x / p.s) + p.z)) - p.z),
};

/* 第 2 章 A：數線上的量化 */
document.addEventListener('DOMContentLoaded', () => {
  const { $, fmt, css } = App;
  const canvas = $('#qLine');
  const textIn = $('#qValues');
  let values = [];
  let mode = 'asym';

  const bits = App.range('qBits', render, v => `${v} bits（${Math.pow(2, v)} 個刻度）`);
  App.seg('qMode', v => { mode = v; render(); });

  function parse() {
    const v = textIn.value.split(/[,，\s]+/).map(Number).filter(Number.isFinite).slice(0, 16);
    if (v.length >= 2) values = v;
  }
  textIn.addEventListener('input', () => { parse(); render(); });

  $('#qRandom').addEventListener('click', () => {
    const r = App.rng(Date.now() & 0xffff);
    const shift = (r() - 0.3) * 2;
    textIn.value = Array.from({ length: 8 }, () => (App.gauss(r) + shift).toFixed(2)).join(', ');
    parse(); render();
  });
  $('#qOutlier').addEventListener('click', () => {
    parse();
    values = values.slice();
    values[values.length - 1] = 12;
    textIn.value = values.join(', ');
    render();
  });
  $('#qReset').addEventListener('click', () => {
    textIn.value = textIn.defaultValue;
    parse(); render();
  });

  function params() {
    const b = bits.get();
    if (mode === 'sym') return Quant.sym(Math.max(...values.map(Math.abs)), b);
    return Quant.asym(Math.min(...values), Math.max(...values), b);
  }

  function render() {
    if (!values.length) return;
    const b = bits.get();
    const p = params();
    const rows = values.map(x => {
      const raw = x / p.s + p.z;
      const r = Math.round(x / p.s) + p.z;
      const q = Math.max(p.qmin, Math.min(p.qmax, r));
      const xh = Quant.dq(q, p);
      return { x, raw, r, q, xh, err: xh - x };
    });

    // 公式（代入目前數字）
    const mx = Math.max(...values), mn = Math.min(...values);
    const fx = $('#qFormula');
    if (mode === 'sym') {
      const ma = Math.max(...values.map(Math.abs));
      fx.innerHTML = `
        <span class="hl">s</span> = max|x| ÷ (2<sup>b−1</sup> − 1) = ${fmt(ma)} ÷ ${p.qmax} = <b>${fmt(p.s)}</b>　　zero-point <span class="hl">z</span> = 0<br>
        q = clamp( round(x ÷ s), ${p.qmin}, ${p.qmax} )　　x̂ = s · q`;
    } else {
      const lo = Math.min(mn, 0), hi = Math.max(mx, 0);
      fx.innerHTML = `
        <span class="hl">s</span> = (max − min) ÷ (2<sup>b</sup> − 1) = (${fmt(hi)} − (${fmt(lo)})) ÷ ${p.qmax} = <b>${fmt(p.s)}</b><br>
        <span class="hl">z</span> = round(−min ÷ s) = round(${fmt(-lo / p.s)}) = <b>${p.z}</b><br>
        q = clamp( round(x ÷ s) + z, 0, ${p.qmax} )　　x̂ = s · (q − z)`;
    }

    // 逐步表格
    $('#qTable').innerHTML = `
      <tr><th>#</th><th class="num">原始 x</th><th class="num">x ÷ s${mode === 'asym' ? ' + z' : ''}</th>
      <th class="num">四捨五入</th><th class="num">截斷後 q（存這個）</th><th class="num">還原 x̂</th><th class="num">誤差 x̂ − x</th></tr>
      ${rows.map((r, i) => `<tr${r.q !== r.r ? ' class="bad"' : ''}>
        <td>${i + 1}</td><td class="num">${fmt(r.x)}</td><td class="num">${r.raw.toFixed(3)}</td>
        <td class="num">${r.r}</td><td class="num"><b>${r.q}</b></td><td class="num">${fmt(r.xh)}</td>
        <td class="num">${r.err >= 0 ? '+' : ''}${fmt(r.err, 3)}</td></tr>`).join('')}`;

    const mse = rows.reduce((a, r) => a + r.err * r.err, 0) / rows.length;
    const maxErr = Math.max(...rows.map(r => Math.abs(r.err)));
    const usedLevels = new Set(rows.map(r => r.q)).size;
    $('#qMetrics').innerHTML = `
      <div class="metric"><div class="k">scale s</div><div class="v">${fmt(p.s)}</div><div class="s">相鄰刻度的距離</div></div>
      <div class="metric"><div class="k">均方誤差 MSE</div><div class="v">${fmt(mse, 3)}</div><div class="s">最大誤差 ${fmt(maxErr, 3)}（≤ s/2 = ${fmt(p.s / 2, 3)}）</div></div>
      <div class="metric"><div class="k">實際用到的刻度</div><div class="v">${usedLevels} / ${p.qmax - p.qmin + 1}</div><div class="s">${mode === 'sym' ? '對稱量化會浪費掉沒有資料的一側' : '非對稱量化貼合資料範圍'}</div></div>
      <div class="metric"><div class="k">儲存大小</div><div class="v">${values.length * b + 32 + (mode === 'asym' ? b : 0)} bits</div><div class="s">FP32 需要 ${values.length * 32} bits</div></div>`;

    drawLine(rows, p);
  }

  function drawLine(rows, p) {
    const { ctx, w, h } = App.setupCanvas(canvas);
    const levels = [];
    for (let q = p.qmin; q <= p.qmax; q++) levels.push({ q, v: Quant.dq(q, p) });
    const lo = Math.min(levels[0].v, ...values), hi = Math.max(levels[levels.length - 1].v, ...values);
    const pad = (hi - lo) * 0.06 || 1;
    const X = v => 24 + (v - (lo - pad)) / (hi - lo + 2 * pad) * (w - 48);
    const yTop = 62, yAxis = h - 52;

    // 可表示範圍
    ctx.fillStyle = css('--accent-soft');
    ctx.fillRect(X(levels[0].v), yAxis - 14, X(levels[levels.length - 1].v) - X(levels[0].v), 28);

    // 軸線
    ctx.strokeStyle = css('--muted');
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(12, yAxis); ctx.lineTo(w - 12, yAxis); ctx.stroke();

    // 量化刻度
    const labelEvery = Math.ceil(levels.length / Math.max(4, Math.floor(w / 38)));
    ctx.textAlign = 'center';
    levels.forEach((l, i) => {
      const x = X(l.v);
      ctx.strokeStyle = css('--accent');
      ctx.beginPath(); ctx.moveTo(x, yAxis - 10); ctx.lineTo(x, yAxis + 10); ctx.stroke();
      if (i % labelEvery === 0 || i === levels.length - 1) {
        ctx.fillStyle = css('--accent');
        ctx.fillText(String(l.q), x, yAxis + 24);
        ctx.fillStyle = css('--muted');
        ctx.fillText(fmt(l.v, 3), x, yAxis + 40);
      }
    });
    // 0 的位置
    ctx.strokeStyle = css('--text');
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(X(0), 44); ctx.lineTo(X(0), yAxis); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = css('--text');
    ctx.fillText('x = 0', X(0), 40);

    // 原始值 → 量化值
    rows.forEach(r => {
      const x0 = X(r.x), x1 = X(r.xh);
      ctx.strokeStyle = css('--muted');
      ctx.globalAlpha = 0.7;
      ctx.beginPath(); ctx.moveTo(x0, yTop); ctx.lineTo(x1, yAxis - 4); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = css('--c2');
      ctx.beginPath(); ctx.arc(x0, yTop, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = css('--c1');
      ctx.beginPath(); ctx.moveTo(x1, yAxis - 7); ctx.lineTo(x1 + 5, yAxis); ctx.lineTo(x1, yAxis + 7); ctx.lineTo(x1 - 5, yAxis); ctx.fill();
    });
    ctx.textAlign = 'left';
    ctx.fillStyle = css('--c2');
    ctx.fillText('● 原始值 x', 12, 22);
    ctx.fillStyle = css('--c1');
    ctx.fillText('◆ 量化後 x̂（藍色刻度下方的數字 = 存起來的整數 q）', 96, 22);
  }

  parse();
  render();
  App.onRedraw(render);
});

/* 第 2 章 B：權重分佈、粒度、離群值與截斷 */
document.addEventListener('DOMContentLoaded', () => {
  const { $, fmt, css } = App;
  const N = 4096;
  let seed = 7, dist = 'normal', outliers = 'off', group = 'tensor', view = 'focus';
  let weights;

  const bits = App.range('dBits', render, v => `${v} bits`);
  const clip = App.range('dClip', render, v => v >= 100 ? '不截斷（用最大值）' : `第 ${v} 百分位`);
  App.seg('dDist', v => { dist = v; generate(); render(); });
  App.seg('dOutlier', v => { outliers = v; generate(); render(); });
  App.seg('dGroup', v => { group = v; render(); });
  App.seg('dView', v => { view = v; render(); });
  $('#dResample').addEventListener('click', () => { seed++; generate(); render(); });

  function generate() {
    const r = App.rng(seed);
    weights = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      if (dist === 'normal') weights[i] = App.gauss(r);
      else { const u = r() - 0.5; weights[i] = -Math.SQRT1_2 * Math.sign(u) * Math.log(1 - 2 * Math.abs(u)); }
    }
    if (outliers === 'on') {
      for (let k = 0; k < 5; k++) weights[Math.floor(r() * N)] = (r() < 0.5 ? -1 : 1) * (12 + r() * 8);
    }
  }

  // 依群組量化：回傳還原值
  function quantize(w, b, g, clipPct) {
    const out = new Float64Array(w.length);
    const size = g === 'tensor' ? w.length : +g;
    for (let start = 0; start < w.length; start += size) {
      const end = Math.min(w.length, start + size);
      const abs = [];
      for (let i = start; i < end; i++) abs.push(Math.abs(w[i]));
      abs.sort((a, c) => a - c);
      const idx = Math.min(abs.length - 1, Math.floor(clipPct / 100 * (abs.length - 1)));
      const p = Quant.sym(abs[clipPct >= 100 ? abs.length - 1 : idx], b);
      for (let i = start; i < end; i++) out[i] = Quant.fake(w[i], p);
    }
    return out;
  }
  function sqnr(w, wq) {
    let sig = 0, noise = 0;
    for (let i = 0; i < w.length; i++) { sig += w[i] * w[i]; noise += (w[i] - wq[i]) ** 2; }
    return { db: 10 * Math.log10(sig / Math.max(noise, 1e-30)), mse: noise / w.length };
  }
  const effBits = (b, g) => b + (g === 'tensor' ? 16 / N : 16 / +g);

  function render() {
    const b = bits.get(), c = clip.get();
    const wq = quantize(weights, b, group, c);
    const { db, mse } = sqnr(weights, wq);
    const eb = effBits(b, group);
    const sizeBits = N * eb;
    const maxAbs = weights.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    $('#dMetrics').innerHTML = `
      <div class="metric ${db > 20 ? 'good' : db < 12 ? 'bad' : 'warn'}"><div class="k">SQNR（越高越好）</div><div class="v">${db.toFixed(1)} dB</div><div class="s">訊號能量 ÷ 誤差能量</div></div>
      <div class="metric"><div class="k">均方誤差 MSE</div><div class="v">${fmt(mse, 3)}</div><div class="s">權重變異數 ≈ 1</div></div>
      <div class="metric"><div class="k">平均位元數</div><div class="v">${eb.toFixed(eb % 1 ? 3 : 0)}</div><div class="s">${group === 'tensor' ? '整個張量共用 1 個 scale' : `每 ${group} 個權重多存 1 個 FP16 scale`}</div></div>
      <div class="metric"><div class="k">大小（相對 FP16）</div><div class="v">${(sizeBits / (N * 16) * 100).toFixed(1)}%</div><div class="s">最大 |w| = ${fmt(maxAbs, 3)}</div></div>`;
    drawHist(wq, b);
    drawCurve(b, c);
  }

  function drawHist(wq, b) {
    const { ctx, w, h } = App.setupCanvas($('#dHist'));
    const maxAbs = weights.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    const R = view === 'focus' ? 4 : maxAbs * 1.05;
    const bins = Math.max(60, Math.min(240, Math.floor(w / 3)));
    const left = 40, right = w - 10, top = 10, bottom = h - 26;
    const X = v => left + (v + R) / (2 * R) * (right - left);
    const histo = arr => {
      const c = new Array(bins).fill(0);
      let outside = 0;
      arr.forEach(v => {
        const k = Math.floor((v + R) / (2 * R) * bins);
        if (k < 0 || k >= bins) outside++; else c[k]++;
      });
      return { c, outside };
    };
    const ho = histo(weights), hq = histo(wq);
    const maxC = Math.max(...ho.c, ...hq.c);
    const Y = c => bottom - Math.sqrt(c / maxC) * (bottom - top); // 平方根刻度讓尾巴也看得見
    const bw = (right - left) / bins;

    ctx.fillStyle = css('--muted');
    ctx.globalAlpha = 0.28;
    ho.c.forEach((c, i) => { if (c) ctx.fillRect(left + i * bw, Y(c), bw, bottom - Y(c)); });
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = css('--c1');
    hq.c.forEach((c, i) => { if (c) ctx.fillRect(left + i * bw + bw * 0.2, Y(c), Math.max(1.2, bw * 0.6), bottom - Y(c)); });
    ctx.globalAlpha = 1;

    // 整張量量化時，畫出刻度與截斷邊界
    if (group === 'tensor') {
      const abs = Array.from(weights, Math.abs).sort((a, c) => a - c);
      const cp = clip.get();
      const ma = cp >= 100 ? abs[abs.length - 1] : abs[Math.floor(cp / 100 * (abs.length - 1))];
      const p = Quant.sym(ma, b);
      ctx.strokeStyle = css('--bad');
      ctx.setLineDash([4, 3]);
      [-ma, ma].forEach(v => { if (Math.abs(v) <= R) { ctx.beginPath(); ctx.moveTo(X(v), top); ctx.lineTo(X(v), bottom); ctx.stroke(); } });
      ctx.setLineDash([]);
      ctx.fillStyle = css('--bad');
      ctx.textAlign = 'right';
      ctx.fillText(`紅色虛線 = 可表示範圍 ±${fmt(ma, 3)}，刻度間距 s = ${fmt(p.s, 3)}`, right - 10, top + 12);
    }

    // 軸
    ctx.strokeStyle = css('--border');
    ctx.beginPath(); ctx.moveTo(left, bottom); ctx.lineTo(right, bottom); ctx.stroke();
    ctx.fillStyle = css('--muted');
    ctx.textAlign = 'center';
    const step = R > 10 ? 5 : R > 5 ? 2 : 1;
    for (let v = -Math.floor(R / step) * step; v <= R; v += step) ctx.fillText(String(v), X(v), bottom + 16);
    ctx.textAlign = 'left';
    ctx.fillText('次數(√)', 0, top + 10);
    if (ho.outside) {
      ctx.fillStyle = css('--warn');
      ctx.fillText(`⚠ ${ho.outside} 個離群值在畫面外（切到「全部」查看）`, left + 6, top + 28);
    }
  }

  function drawCurve(curB, curClip) {
    const { ctx, w, h } = App.setupCanvas($('#dCurve'));
    const compare = group === 'tensor' ? '64' : group;
    const series = [
      { name: '整張量 per-tensor', g: 'tensor', color: css('--c2') },
      { name: `分組 group=${compare}`, g: compare, color: css('--c1') },
    ];
    const bitsList = [2, 3, 4, 5, 6, 7, 8];
    series.forEach(s => { s.ys = bitsList.map(b => sqnr(weights, quantize(weights, b, s.g, curClip)).db); });
    const left = 44, right = w - 12, top = 14, bottom = h - 30;
    const maxY = Math.ceil(Math.max(...series.flatMap(s => s.ys)) / 10) * 10;
    const minY = Math.min(0, Math.floor(Math.min(...series.flatMap(s => s.ys)) / 10) * 10);
    const X = b => left + (b - 2) / 6 * (right - left);
    const Y = v => bottom - (v - minY) / (maxY - minY) * (bottom - top);

    ctx.strokeStyle = css('--grid');
    ctx.fillStyle = css('--muted');
    ctx.textAlign = 'right';
    for (let v = minY; v <= maxY; v += 10) {
      ctx.beginPath(); ctx.moveTo(left, Y(v)); ctx.lineTo(right, Y(v)); ctx.stroke();
      ctx.fillText(v + ' dB', left - 4, Y(v) + 4);
    }
    ctx.textAlign = 'center';
    bitsList.forEach(b => ctx.fillText(b + ' bit', X(b), bottom + 18));

    series.forEach((s, si) => {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      s.ys.forEach((y, i) => (i ? ctx.lineTo(X(bitsList[i]), Y(y)) : ctx.moveTo(X(bitsList[i]), Y(y))));
      ctx.stroke();
      ctx.fillStyle = s.color;
      s.ys.forEach((y, i) => { ctx.beginPath(); ctx.arc(X(bitsList[i]), Y(y), 3, 0, Math.PI * 2); ctx.fill(); });
      ctx.textAlign = 'left';
      ctx.fillText('— ' + s.name, left + 8, top + 12 + si * 16);
    });
    ctx.lineWidth = 1;
    const cur = series.find(s => s.g === group) || series[0];
    const yv = cur.ys[curB - 2];
    ctx.strokeStyle = css('--text');
    ctx.beginPath(); ctx.arc(X(curB), Y(yv), 7, 0, Math.PI * 2); ctx.stroke();
  }

  generate();
  render();
  App.onRedraw(render);
});

'use strict';

/* 剪枝核心：回傳 mask（1 = 保留, 0 = 剪掉）。W 為 rows × cols 的一維陣列 */
const Prune = {
  // 非結構化：剪掉 |w| 最小的 p 比例
  unstructured(W, p) {
    const k = Math.floor(W.length * p);
    const mask = new Float64Array(W.length).fill(1);
    if (k <= 0) return mask;
    const order = Array.from(W.keys()).sort((a, b) => Math.abs(W[a]) - Math.abs(W[b]));
    for (let i = 0; i < k; i++) mask[order[i]] = 0;
    return mask;
  },
  // 結構化：以列（輸出神經元）的 L2 範數排序，整列剪掉
  rows(W, rows, cols, p) {
    const k = Math.floor(rows * p);
    const mask = new Float64Array(W.length).fill(1);
    const norms = Array.from({ length: rows }, (_, r) => {
      let s = 0;
      for (let c = 0; c < cols; c++) s += W[r * cols + c] ** 2;
      return { r, s };
    }).sort((a, b) => a.s - b.s);
    for (let i = 0; i < k; i++) for (let c = 0; c < cols; c++) mask[norms[i].r * cols + c] = 0;
    return mask;
  },
  // 半結構化 N:M：每 M 個連續權重只保留 |w| 最大的 N 個
  nm(W, cols, n = 2, m = 4) {
    const mask = new Float64Array(W.length).fill(0);
    for (let start = 0; start < W.length; start += m) {
      const idx = [];
      for (let i = start; i < Math.min(start + m, W.length); i++) idx.push(i);
      idx.sort((a, b) => Math.abs(W[b]) - Math.abs(W[a]));
      idx.slice(0, n).forEach(i => { mask[i] = 1; });
    }
    return mask;
  },
};

/* 第 4 章：剪枝互動 */
document.addEventListener('DOMContentLoaded', () => {
  const { $, css, fmt, pct } = App;
  const R = 12, C = 16;
  let mode = 'unstructured';
  let W, Xs;

  const sparsity = App.range('pSparsity', render, v => v + '%');
  App.seg('pMode', v => { mode = v; render(); });
  $('#pResample').addEventListener('click', () => { build(Date.now() & 0xffff); render(); });

  function build(seed) {
    const r = App.rng(seed);
    // 讓每一列的「重要性」不同，結構化剪枝才有東西可挑
    const rowScale = Array.from({ length: R }, () => 0.4 + r() * 1.2);
    W = new Float64Array(R * C);
    for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) W[i * C + j] = App.gauss(r) * 0.5 * rowScale[i];
    Xs = Array.from({ length: 200 }, () => Array.from({ length: C }, () => App.gauss(r)));
  }

  function maskFor(m, p) {
    if (m === 'unstructured') return Prune.unstructured(W, p);
    if (m === 'rows') return Prune.rows(W, R, C, p);
    return Prune.nm(W, C);
  }

  // 相對輸出誤差 ‖Wx − W'x‖ / ‖Wx‖（以 200 個隨機輸入平均）
  function outputError(mask) {
    let num = 0, den = 0;
    Xs.forEach(x => {
      for (let i = 0; i < R; i++) {
        let y = 0, yp = 0;
        for (let j = 0; j < C; j++) { const t = W[i * C + j] * x[j]; y += t; yp += t * mask[i * C + j]; }
        num += (y - yp) ** 2; den += y * y;
      }
    });
    return Math.sqrt(num / den);
  }

  function render() {
    if (mode === 'nm') sparsity.el.disabled = true; else sparsity.el.disabled = false;
    const p = mode === 'nm' ? 0.5 : sparsity.get() / 100;
    const mask = maskFor(mode, p);
    const maxAbs = W.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    const color = App.divergingScale();

    const grid = $('#pGrid');
    grid.style.gridTemplateColumns = `repeat(${C}, minmax(0, 1fr))`;
    grid.classList.toggle('nm', mode === 'nm');
    grid.innerHTML = Array.from(W, (v, i) =>
      `<div class="wcell ${mask[i] ? '' : 'pruned'}" style="background:${App.rgb(color(v / maxAbs))}" title="w[${Math.floor(i / C)},${i % C}] = ${v.toFixed(3)}${mask[i] ? '' : '（已剪掉）'}"></div>`).join('');

    let kept = 0, energy = 0, total = 0;
    W.forEach((v, i) => { total += v * v; if (mask[i]) { kept++; energy += v * v; } });
    const err = outputError(mask);
    const speed = {
      unstructured: '需要稀疏格式與專用 kernel；稀疏度通常要很高（>~70–90%）才有明顯加速',
      rows: '直接變成更小的稠密矩陣，任何硬體都能加速',
      nm: 'NVIDIA Ampere 之後的 Sparse Tensor Core 原生支援，矩陣乘法理論上最高 2×',
    }[mode];
    $('#pMetrics').innerHTML = `
      <div class="metric"><div class="k">實際稀疏度</div><div class="v">${pct(1 - kept / W.length)}</div><div class="s">保留 ${kept} / ${W.length} 個權重</div></div>
      <div class="metric"><div class="k">保留的權重能量</div><div class="v">${pct(energy / total)}</div><div class="s">Σw² 剩下多少</div></div>
      <div class="metric ${err < 0.15 ? 'good' : err > 0.4 ? 'bad' : 'warn'}"><div class="k">輸出相對誤差</div><div class="v">${pct(err)}</div><div class="s">‖Wx − W′x‖ ÷ ‖Wx‖</div></div>`;
    $('#pSpeed').textContent = speed;
    drawCurve(mode === 'nm' ? 0.5 : p);
  }

  function drawCurve(curP) {
    const { ctx, w, h } = App.setupCanvas($('#pCurve'));
    const left = 44, right = w - 12, top = 14, bottom = h - 28;
    const ps = Array.from({ length: 20 }, (_, i) => i * 0.05);
    const lines = [
      { name: '非結構化', m: 'unstructured', color: css('--c1') },
      { name: '結構化（整列）', m: 'rows', color: css('--c2') },
    ].map(l => ({ ...l, ys: ps.map(p => outputError(maskFor(l.m, p))) }));
    const nmErr = outputError(maskFor('nm', 0.5));
    const maxY = Math.min(1.2, Math.ceil(Math.max(...lines.flatMap(l => l.ys)) * 5) / 5);
    const X = p => left + p / 0.95 * (right - left);
    const Y = v => bottom - Math.min(v, maxY) / maxY * (bottom - top);

    ctx.strokeStyle = css('--grid');
    ctx.fillStyle = css('--muted');
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const v = maxY * i / 4;
      ctx.beginPath(); ctx.moveTo(left, Y(v)); ctx.lineTo(right, Y(v)); ctx.stroke();
      ctx.fillText((v * 100).toFixed(0) + '%', left - 4, Y(v) + 4);
    }
    ctx.textAlign = 'center';
    [0, 0.2, 0.4, 0.6, 0.8].forEach(p => ctx.fillText((p * 100) + '%', X(p), bottom + 18));
    lines.forEach((l, li) => {
      ctx.strokeStyle = l.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      l.ys.forEach((y, i) => (i ? ctx.lineTo(X(ps[i]), Y(y)) : ctx.moveTo(X(ps[i]), Y(y))));
      ctx.stroke();
      ctx.fillStyle = l.color;
      ctx.textAlign = 'left';
      ctx.fillText('— ' + l.name, left + 8, top + 10 + li * 16);
    });
    ctx.lineWidth = 1;
    ctx.fillStyle = css('--c3');
    ctx.beginPath(); ctx.arc(X(0.5), Y(nmErr), 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillText('● 2:4（固定 50%）', left + 8, top + 42);
    ctx.strokeStyle = css('--text');
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(X(Math.min(curP, 0.95)), top); ctx.lineTo(X(Math.min(curP, 0.95)), bottom); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = css('--muted');
    ctx.textAlign = 'right';
    ctx.fillText('橫軸：稀疏度　縱軸：輸出誤差', right, bottom - 6);
  }

  build(3);
  render();
  App.onRedraw(render);
});

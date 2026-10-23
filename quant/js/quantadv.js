'use strict';

/* 第 3 章：SmoothQuant —— 把啟動值的離群值「搬」到權重上 */
document.addEventListener('DOMContentLoaded', () => {
  const { $, css, fmt } = App;
  const T = 64, C = 16, O = 16;
  const OUTLIER_CH = [3, 11];
  let aBits = 8;
  let X0, W;

  const alpha = App.range('sqAlpha', render, v => v.toFixed(2));
  const strength = App.range('sqStrength', () => { build(); render(); }, v => `×${v}`);
  App.seg('sqBits', v => { aBits = +v; render(); });

  function build() {
    const r = App.rng(42);
    X0 = Array.from({ length: T }, () => Array.from({ length: C }, (_, j) =>
      App.gauss(r) * (OUTLIER_CH.includes(j) ? strength.get() : 1)));
    W = Array.from({ length: C }, () => Array.from({ length: O }, () => App.gauss(r) * 0.5));
  }

  const matmul = (A, B) => A.map(row => B[0].map((_, k) => row.reduce((s, v, j) => s + v * B[j][k], 0)));
  const maxAbs = arr => arr.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const relErr = (A, B) => {
    let n = 0, d = 0;
    A.forEach((row, i) => row.forEach((v, k) => { n += (v - B[i][k]) ** 2; d += v * v; }));
    return Math.sqrt(n / d);
  };

  // 回傳平滑後的 X'、W'，以及量化後 Y 的相對誤差
  function evaluate(a) {
    const xMax = Array.from({ length: C }, (_, j) => maxAbs(X0.map(r => r[j])));
    const wMax = W.map(maxAbs);
    const s = xMax.map((xm, j) => Math.pow(xm, a) / Math.pow(wMax[j], 1 - a));
    const Xs = X0.map(row => row.map((v, j) => v / s[j]));
    const Ws = W.map((row, j) => row.map(v => v * s[j]));
    // 啟動值：per-tensor 對稱量化；權重：per-output-channel INT8
    const px = Quant.sym(maxAbs(Xs.flat()), aBits);
    const Xq = Xs.map(row => row.map(v => Quant.fake(v, px)));
    const Wq = Ws.map(row => row.slice());
    for (let k = 0; k < O; k++) {
      const pw = Quant.sym(maxAbs(Ws.map(r => r[k])), 8);
      for (let j = 0; j < C; j++) Wq[j][k] = Quant.fake(Ws[j][k], pw);
    }
    const Y = matmul(X0, W);
    return {
      err: relErr(Y, matmul(Xq, Wq)),
      xMax: xMax.map((v, j) => v / s[j]),
      wMax: Ws.map(maxAbs),
    };
  }

  function render() {
    const a = alpha.get();
    const cur = evaluate(a), base = evaluate(0);
    const alphas = Array.from({ length: 21 }, (_, i) => i / 20);
    const curve = alphas.map(x => evaluate(x).err);
    const best = alphas[curve.indexOf(Math.min(...curve))];

    $('#sqMetrics').innerHTML = `
      <div class="metric"><div class="k">不平滑（α = 0）輸出誤差</div><div class="v">${(base.err * 100).toFixed(2)}%</div></div>
      <div class="metric ${cur.err < base.err * 0.7 ? 'good' : ''}"><div class="k">目前 α = ${a.toFixed(2)} 輸出誤差</div><div class="v">${(cur.err * 100).toFixed(2)}%</div></div>
      <div class="metric"><div class="k">本例最佳 α</div><div class="v">${best.toFixed(2)}</div><div class="s">論文常用 0.5 左右</div></div>`;

    drawBars(cur);
    drawCurve(alphas, curve, a);
  }

  function drawBars(cur) {
    const { ctx, w, h } = App.setupCanvas($('#sqBars'));
    const left = 36, right = w - 8, top = 22, bottom = h - 22;
    const maxV = Math.max(...cur.xMax, ...cur.wMax);
    const gw = (right - left) / C;
    const Y = v => bottom - v / maxV * (bottom - top);
    for (let j = 0; j < C; j++) {
      const x = left + j * gw;
      ctx.fillStyle = css('--c2');
      ctx.fillRect(x + gw * 0.1, Y(cur.xMax[j]), gw * 0.38, bottom - Y(cur.xMax[j]));
      ctx.fillStyle = css('--c1');
      ctx.fillRect(x + gw * 0.52, Y(cur.wMax[j]), gw * 0.38, bottom - Y(cur.wMax[j]));
      ctx.fillStyle = OUTLIER_CH.includes(j) ? css('--bad') : css('--muted');
      ctx.textAlign = 'center';
      ctx.fillText(String(j), x + gw / 2, bottom + 14);
    }
    ctx.strokeStyle = css('--border');
    ctx.beginPath(); ctx.moveTo(left, bottom); ctx.lineTo(right, bottom); ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillStyle = css('--muted');
    ctx.fillText(fmt(maxV, 3), left - 4, top + 4);
    ctx.fillText('0', left - 4, bottom);
    ctx.textAlign = 'left';
    ctx.fillStyle = css('--c2');
    ctx.fillText('■ 啟動值 X 每個通道的 max|x|', left, 12);
    ctx.fillStyle = css('--c1');
    ctx.fillText('■ 權重 W 對應列的 max|w|', left + 190, 12);
  }

  function drawCurve(alphas, curve, a) {
    const { ctx, w, h } = App.setupCanvas($('#sqCurve'));
    const left = 48, right = w - 12, top = 14, bottom = h - 28;
    const maxY = Math.max(...curve) * 1.1;
    const X = v => left + v * (right - left);
    const Y = v => bottom - v / maxY * (bottom - top);
    ctx.strokeStyle = css('--grid');
    ctx.fillStyle = css('--muted');
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const v = maxY * i / 4;
      ctx.beginPath(); ctx.moveTo(left, Y(v)); ctx.lineTo(right, Y(v)); ctx.stroke();
      ctx.fillText((v * 100).toFixed(1) + '%', left - 4, Y(v) + 4);
    }
    ctx.textAlign = 'center';
    [0, 0.25, 0.5, 0.75, 1].forEach(v => ctx.fillText('α=' + v, X(v), bottom + 18));
    ctx.strokeStyle = css('--c1');
    ctx.lineWidth = 2;
    ctx.beginPath();
    curve.forEach((v, i) => (i ? ctx.lineTo(X(alphas[i]), Y(v)) : ctx.moveTo(X(alphas[i]), Y(v))));
    ctx.stroke();
    ctx.lineWidth = 1;
    const cur = evaluate(a).err;
    ctx.fillStyle = css('--c2');
    ctx.beginPath(); ctx.arc(X(a), Y(cur), 6, 0, Math.PI * 2); ctx.fill();
    ctx.textAlign = 'left';
    ctx.fillStyle = css('--muted');
    ctx.fillText('Y = XW 的量化相對誤差', left + 6, top + 10);
  }

  build();
  render();
  App.onRedraw(render);
});

'use strict';

/* 單邊 Jacobi SVD：A (m×n，以列為主的 Float64Array) → { U (m×n), S (n), V (n×n) }，奇異值由大到小 */
function svd(A, m, n) {
  // 以欄為單位存取比較快：先拆成 n 個長度 m 的欄，V 從單位矩陣開始累積旋轉
  const cols = Array.from({ length: n }, (_, j) => { const c = new Float64Array(m); for (let i = 0; i < m; i++) c[i] = A[i * n + j]; return c; });
  const vcols = Array.from({ length: n }, (_, j) => { const c = new Float64Array(n); c[j] = 1; return c; });
  for (let sweep = 0; sweep < 30; sweep++) {
    let off = 0;
    for (let p = 0; p < n - 1; p++) {
      const cp = cols[p], vp = vcols[p];
      for (let q = p + 1; q < n; q++) {
        const cq = cols[q], vq = vcols[q];
        let a = 0, b = 0, g = 0;
        for (let i = 0; i < m; i++) { a += cp[i] * cp[i]; b += cq[i] * cq[i]; g += cp[i] * cq[i]; }
        if (Math.abs(g) <= 1e-12 * Math.sqrt(a * b) || g === 0) continue;
        off = Math.max(off, Math.abs(g) / Math.sqrt(a * b));
        const zeta = (b - a) / (2 * g);
        const t = Math.sign(zeta || 1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
        const c = 1 / Math.sqrt(1 + t * t), s = c * t;
        for (let i = 0; i < m; i++) { const x = cp[i], y = cq[i]; cp[i] = c * x - s * y; cq[i] = s * x + c * y; }
        for (let i = 0; i < n; i++) { const x = vp[i], y = vq[i]; vp[i] = c * x - s * y; vq[i] = s * x + c * y; }
      }
    }
    if (off < 1e-10) break;
  }
  const order = cols.map((c, j) => ({ j, s: Math.hypot(...c) })).sort((x, y) => y.s - x.s);
  const S = new Float64Array(n);
  const Uo = [], Vo = [];
  order.forEach(({ j, s }, k) => {
    S[k] = s;
    Uo.push(cols[j].map(v => (s > 1e-12 ? v / s : 0)));
    Vo.push(vcols[j]);
  });
  return { U: Uo, S, V: Vo }; // U[k]、V[k] 分別是第 k 個左/右奇異向量
}

/* 第 6 章：低秩分解 */
document.addEventListener('DOMContentLoaded', () => {
  const { $, css, fmtInt, pct } = App;
  const N = 128;
  let A = null, dec = null;
  const origCanvas = $('#lrOrig'), recCanvas = $('#lrRec');
  origCanvas.width = recCanvas.width = N;
  origCanvas.height = recCanvas.height = N;

  const rank = App.range('lrRank', renderImage, v => String(v));

  // 程序產生的示範圖：漸層、圓、文字、條紋（不同部分有不同「秩」）
  function demoImage() {
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, N, N);
    grad.addColorStop(0, '#202020'); grad.addColorStop(1, '#d0d0d0');
    g.fillStyle = grad; g.fillRect(0, 0, N, N);
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(40, 42, 26, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#000000';
    g.font = 'bold 46px sans-serif';
    g.fillText('AI', 64, 70);
    g.save();
    g.beginPath(); g.rect(8, 84, 112, 36); g.clip();
    for (let i = -N; i < N * 2; i += 8) {
      g.strokeStyle = i % 16 ? '#ffffff' : '#111111';
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(i, 84); g.lineTo(i + 36, 120); g.stroke();
    }
    g.restore();
    return c;
  }

  function loadFrom(source, sw, sh) {
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d');
    const side = Math.min(sw, sh); // 置中裁成正方形
    g.drawImage(source, (sw - side) / 2, (sh - side) / 2, side, side, 0, 0, N, N);
    const d = g.getImageData(0, 0, N, N).data;
    A = new Float64Array(N * N);
    for (let i = 0; i < N * N; i++) A[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
    paint(origCanvas, A);
    $('#lrStatus').textContent = '計算 SVD 中…';
    setTimeout(() => {
      const t0 = performance.now();
      dec = svd(A, N, N);
      $('#lrStatus').textContent = `SVD 完成（${Math.round(performance.now() - t0)} ms，於你的瀏覽器中計算）`;
      renderImage();
    }, 30);
  }

  function paint(canvas, M) {
    const g = canvas.getContext('2d');
    const img = g.createImageData(N, N);
    for (let i = 0; i < N * N; i++) {
      const v = Math.max(0, Math.min(255, Math.round(M[i] * 255)));
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }

  function renderImage() {
    if (!dec) return;
    const r = rank.get();
    const M = new Float64Array(N * N);
    for (let k = 0; k < r; k++) {
      const s = dec.S[k], u = dec.U[k], v = dec.V[k];
      for (let i = 0; i < N; i++) {
        const su = s * u[i];
        if (su === 0) continue;
        const row = i * N;
        for (let j = 0; j < N; j++) M[row + j] += su * v[j];
      }
    }
    paint(recCanvas, M);
    let all = 0, kept = 0;
    dec.S.forEach((s, k) => { all += s * s; if (k < r) kept += s * s; });
    const params = r * (N + N + 1);
    $('#lrMetrics').innerHTML = `
      <div class="metric"><div class="k">原始參數</div><div class="v">${fmtInt(N * N)}</div><div class="s">${N} × ${N}</div></div>
      <div class="metric ${params < N * N ? 'good' : 'bad'}"><div class="k">rank-${r} 參數</div><div class="v">${fmtInt(params)}</div><div class="s">r × (m + n + 1) → ${pct(params / (N * N))}</div></div>
      <div class="metric"><div class="k">保留能量 Σσ²</div><div class="v">${pct(kept / all, 2)}</div></div>
      <div class="metric"><div class="k">相對誤差 ‖A−Aᵣ‖/‖A‖</div><div class="v">${pct(Math.sqrt(Math.max(0, all - kept) / all), 2)}</div></div>`;
    $('#lrRecCap').textContent = `rank ${r} 近似（${r} 組 σ·u·vᵀ 相加）`;
    drawSpectrum(r);
  }

  function drawSpectrum(r) {
    const { ctx, w, h } = App.setupCanvas($('#lrSpec'));
    const left = 44, right = w - 10, top = 12, bottom = h - 26;
    const S = Array.from(dec.S).map(s => Math.max(s, 1e-6));
    const lmax = Math.log10(S[0]), lmin = Math.max(lmax - 5, Math.log10(S[S.length - 1]));
    const X = k => left + k / N * (right - left);
    const Y = s => bottom - (Math.log10(s) - lmin) / (lmax - lmin) * (bottom - top);
    ctx.strokeStyle = css('--grid');
    ctx.fillStyle = css('--muted');
    ctx.textAlign = 'right';
    for (let e = Math.ceil(lmin); e <= Math.floor(lmax); e++) {
      ctx.beginPath(); ctx.moveTo(left, Y(10 ** e)); ctx.lineTo(right, Y(10 ** e)); ctx.stroke();
      ctx.fillText('10' + (e < 0 ? '⁻' : '') + '⁰¹²³⁴⁵⁶⁷⁸⁹'[Math.abs(e)], left - 4, Y(10 ** e) + 4);
    }
    const bw = (right - left) / N;
    S.forEach((s, k) => {
      ctx.fillStyle = k < r ? css('--c1') : css('--border');
      const y = Math.min(bottom, Y(s));
      ctx.fillRect(X(k), y, Math.max(1, bw - 0.5), bottom - y);
    });
    ctx.textAlign = 'center';
    ctx.fillStyle = css('--muted');
    [1, 32, 64, 96, 128].forEach(k => ctx.fillText(String(k), X(k - 0.5), bottom + 16));
    ctx.textAlign = 'right';
    ctx.fillText('奇異值 σₖ（log 刻度）；藍色 = 保留的部分', right - 6, top + 10);
  }

  $('#lrUpload').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => { loadFrom(img, img.naturalWidth, img.naturalHeight); URL.revokeObjectURL(img.src); };
    img.src = URL.createObjectURL(file);
  });
  $('#lrDemo').addEventListener('click', () => loadFrom(demoImage(), N, N));

  App.whenVisible($('#lowrank'), () => loadFrom(demoImage(), N, N));
  App.onRedraw(() => dec && drawSpectrum(rank.get()));
});

/* 第 6 章：神經網路層的低秩分解計算器 */
document.addEventListener('DOMContentLoaded', () => {
  const { $, fmtInt, pct } = App;
  const din = App.range('lrIn', render, v => fmtInt(v));
  const dout = App.range('lrOut', render, v => fmtInt(v));
  const r = App.range('lrR', render, v => String(v));

  function render() {
    const m = dout.get(), n = din.get(), k = r.get();
    const full = m * n, low = k * (m + n);
    const breakEven = Math.floor(m * n / (m + n));
    $('#lrCalc').innerHTML = `
      <div class="metric"><div class="k">原始 W（${fmtInt(m)} × ${fmtInt(n)}）</div><div class="v">${fmtInt(full)}</div><div class="s">參數 = 每個 token 的乘加次數</div></div>
      <div class="metric ${low < full ? 'good' : 'bad'}"><div class="k">分解成 (${fmtInt(m)}×${k})·(${k}×${fmtInt(n)})</div><div class="v">${fmtInt(low)}</div><div class="s">原本的 ${pct(low / full, 2)}</div></div>
      <div class="metric"><div class="k">損益平衡點</div><div class="v">r &lt; ${fmtInt(breakEven)}</div><div class="s">超過這個秩反而更大</div></div>`;
  }
  render();
});

'use strict';

/* 第 7 章：綜合實驗室 —— 在瀏覽器裡訓練小型 MLP，然後剪枝、量化、微調 */
document.addEventListener('DOMContentLoaded', () => {
  const { $, css, fmtBytes, pct } = App;
  const SIZES_HIDDEN = 32;
  const GRID = 64;
  const S = {
    dataset: 'spiral', C: 3, train: null, test: null,
    layers: [], baseline: null, baseAcc: null,
    masks: null, bits: 32, sparsity: 0,
    busy: false, step: 0, loss: 0,
  };

  // ---------- 資料集 ----------
  function makeData(kind, n, seed) {
    const r = App.rng(seed);
    const X = [], Y = [];
    if (kind === 'spiral') {
      const per = Math.floor(n / 3);
      for (let c = 0; c < 3; c++) for (let i = 0; i < per; i++) {
        const t = i / per;
        const ang = c * 2 * Math.PI / 3 + t * 4.2 + App.gauss(r) * 0.18;
        X.push([t * Math.sin(ang), t * Math.cos(ang)]); Y.push(c);
      }
    } else if (kind === 'moons') {
      for (let i = 0; i < n; i++) {
        const c = i % 2, t = r() * Math.PI;
        const x = c ? 1 - Math.cos(t) : Math.cos(t), y = c ? 0.5 - Math.sin(t) : Math.sin(t);
        X.push([(x - 0.5) * 0.85 + App.gauss(r) * 0.09, (y - 0.25) * 0.85 + App.gauss(r) * 0.09]); Y.push(c);
      }
    } else {
      for (let i = 0; i < n; i++) {
        const c = i % 2, a = r() * 2 * Math.PI, rad = (c ? 0.85 : 0.38) + App.gauss(r) * 0.08;
        X.push([rad * Math.cos(a), rad * Math.sin(a)]); Y.push(c);
      }
    }
    return { X, Y };
  }

  // ---------- 網路 ----------
  function initNet(seed) {
    const r = App.rng(seed);
    const sizes = [2, SIZES_HIDDEN, SIZES_HIDDEN, S.C];
    S.layers = [];
    for (let l = 0; l < sizes.length - 1; l++) {
      const nin = sizes[l], nout = sizes[l + 1];
      const gain = l === 0 ? 2.5 : 1;
      const W = new Float64Array(nout * nin).map(() => App.gauss(r) * gain / Math.sqrt(nin));
      S.layers.push({ nin, nout, W, b: new Float64Array(nout) });
    }
    S.masks = null;
  }
  const snapshot = () => S.layers.map(L => ({ W: Float64Array.from(L.W), b: Float64Array.from(L.b) }));
  const restore = snap => snap.forEach((s, l) => { S.layers[l].W.set(s.W); S.layers[l].b.set(s.b); });

  // 只剪中間層（約佔全部權重的 86%）；輸入層與輸出層很小又敏感，實務上也常保留不剪
  const PRUNABLE = [1];
  function computeMasks() {
    S.masks = S.sparsity > 0
      ? S.layers.map((L, l) => (PRUNABLE.includes(l) ? Prune.unstructured(L.W, S.sparsity) : new Float64Array(L.W.length).fill(1)))
      : null;
  }
  // 微調前把剪掉的主權重真正設為 0，之後重新計算遮罩時才會選到同一批位置
  function hardPrune() {
    if (!S.masks) return;
    S.layers.forEach((L, l) => { for (let i = 0; i < L.W.length; i++) if (!S.masks[l][i]) L.W[i] = 0; });
  }

  // 有效權重 = 量化( 遮罩 ⊙ 主權重 )；每個輸出通道（列）一個 scale
  function effective() {
    return S.layers.map((L, l) => {
      const E = Float64Array.from(L.W);
      if (S.masks) for (let i = 0; i < E.length; i++) E[i] *= S.masks[l][i];
      if (S.bits < 32) {
        for (let o = 0; o < L.nout; o++) {
          let m = 0;
          for (let i = 0; i < L.nin; i++) m = Math.max(m, Math.abs(E[o * L.nin + i]));
          const p = Quant.sym(m, S.bits);
          for (let i = 0; i < L.nin; i++) E[o * L.nin + i] = Quant.fake(E[o * L.nin + i], p);
        }
      }
      return E;
    });
  }

  function forward(x, E, keep) {
    let a = x;
    const acts = [x];
    S.layers.forEach((L, l) => {
      const z = new Float64Array(L.nout);
      const W = E[l];
      for (let o = 0; o < L.nout; o++) {
        let s = L.b[o];
        const off = o * L.nin;
        for (let i = 0; i < L.nin; i++) s += W[off + i] * a[i];
        z[o] = l < S.layers.length - 1 ? Math.tanh(s) : s;
      }
      a = z;
      if (keep) acts.push(z);
    });
    return keep ? acts : a;
  }
  const argmax = v => { let k = 0; for (let i = 1; i < v.length; i++) if (v[i] > v[k]) k = i; return k; };
  function accuracy(data, E = effective()) {
    let ok = 0;
    data.X.forEach((x, i) => { if (argmax(forward(x, E)) === data.Y[i]) ok++; });
    return ok / data.X.length;
  }

  // ---------- 訓練（Adam；梯度對有效權重計算後直接套用到主權重 = STE） ----------
  let adam = null;
  function resetAdam() {
    adam = { t: 0, m: S.layers.map(L => ({ W: new Float64Array(L.W.length), b: new Float64Array(L.nout) })), v: S.layers.map(L => ({ W: new Float64Array(L.W.length), b: new Float64Array(L.nout) })) };
  }
  function trainStep(lr) {
    const E = effective();
    const G = S.layers.map(L => ({ W: new Float64Array(L.W.length), b: new Float64Array(L.nout) }));
    const n = S.train.X.length;
    let loss = 0;
    for (let k = 0; k < n; k++) {
      const acts = forward(S.train.X[k], E, true);
      const logits = acts[acts.length - 1];
      const mx = Math.max(...logits);
      const ex = Array.from(logits, v => Math.exp(v - mx));
      const sum = ex.reduce((a, b) => a + b, 0);
      let delta = Float64Array.from(ex, v => v / sum);
      loss -= Math.log(delta[S.train.Y[k]] + 1e-12);
      delta[S.train.Y[k]] -= 1;
      for (let l = S.layers.length - 1; l >= 0; l--) {
        const L = S.layers[l], a = acts[l], W = E[l];
        const prev = new Float64Array(L.nin);
        for (let o = 0; o < L.nout; o++) {
          const d = delta[o];
          if (d === 0) continue;
          G[l].b[o] += d;
          const off = o * L.nin;
          for (let i = 0; i < L.nin; i++) { G[l].W[off + i] += d * a[i]; prev[i] += W[off + i] * d; }
        }
        if (l > 0) for (let i = 0; i < L.nin; i++) prev[i] *= 1 - a[i] * a[i]; // tanh'
        delta = prev;
      }
    }
    adam.t++;
    const b1 = 0.9, b2 = 0.999, c1 = 1 - b1 ** adam.t, c2 = 1 - b2 ** adam.t;
    S.layers.forEach((L, l) => {
      const upd = (P, g, m, v, mask) => {
        for (let i = 0; i < P.length; i++) {
          if (mask && !mask[i]) continue; // 被剪掉的權重不更新
          const gi = g[i] / n;
          m[i] = b1 * m[i] + (1 - b1) * gi;
          v[i] = b2 * v[i] + (1 - b2) * gi * gi;
          P[i] -= lr * (m[i] / c1) / (Math.sqrt(v[i] / c2) + 1e-8);
        }
      };
      upd(L.W, G[l].W, adam.m[l].W, adam.v[l].W, S.masks && S.masks[l]);
      upd(L.b, G[l].b, adam.m[l].b, adam.v[l].b, null);
    });
    return loss / n;
  }

  function train(steps, lr, label, done) {
    S.busy = true;
    setBusy(true, label);
    resetAdam();
    let i = 0;
    const tick = () => {
      const perFrame = 12;
      for (let k = 0; k < perFrame && i < steps; k++, i++) S.loss = trainStep(lr);
      $('#labStatus').innerHTML = `<span class="status-dot run"></span>${label}：第 ${i} / ${steps} 步，loss = ${S.loss.toFixed(3)}`;
      render();
      if (i < steps) requestAnimationFrame(tick);
      else { S.busy = false; setBusy(false); done && done(); }
    };
    requestAnimationFrame(tick);
  }

  // ---------- 介面 ----------
  const log = (msg, cls = '') => {
    const box = $('#labLog');
    const d = document.createElement('div');
    d.className = cls;
    d.textContent = msg;
    box.prepend(d);
  };
  function setBusy(b, label) {
    ['#labFinetune', '#labRestore', '#labRetrain', '#labRecord'].forEach(id => { $(id).disabled = b; });
    if (!b) $('#labStatus').innerHTML = `<span class="status-dot ok"></span>就緒（訓練 ${S.train.X.length} 筆、測試 ${S.test.X.length} 筆）`;
    else $('#labStatus').innerHTML = `<span class="status-dot run"></span>${label}…`;
  }
  const settingText = () => `剪枝 ${Math.round(S.sparsity * 100)}%、${S.bits === 32 ? 'FP32' : `INT${S.bits}`}`;

  function sizeInfo() {
    let total = 0, nz = 0, rows = 0, biases = 0;
    S.layers.forEach((L, l) => {
      total += L.W.length; rows += L.nout; biases += L.nout;
      nz += S.masks ? S.masks[l].reduce((a, v) => a + v, 0) : L.W.length;
    });
    const wb = S.bits;
    let bits = nz * wb + biases * 32;
    if (S.bits < 32) bits += rows * 16;   // 每個輸出通道一個 FP16 scale
    if (S.masks) PRUNABLE.forEach(l => { bits += S.layers[l].W.length; }); // 稀疏位元遮罩：被剪的層每個權重 1 bit
    const fp32 = (total + biases) * 32;
    return { bytes: bits / 8, ratio: fp32 / bits, nz, total };
  }

  function render() {
    const E = effective();
    const testAcc = accuracy(S.test, E);
    const trainAcc = accuracy(S.train, E);
    const sz = sizeInfo();
    const drop = S.baseAcc !== null ? testAcc - S.baseAcc : 0;
    $('#labMetrics').innerHTML = `
      <div class="metric"><div class="k">FP32 原始模型（測試）</div><div class="v">${S.baseAcc === null ? '—' : pct(S.baseAcc)}</div></div>
      <div class="metric ${drop < -0.05 ? 'bad' : drop < -0.015 ? 'warn' : 'good'}"><div class="k">目前模型（測試）</div><div class="v">${pct(testAcc)}</div><div class="s">訓練集 ${pct(trainAcc)}</div></div>
      <div class="metric"><div class="k">模型大小</div><div class="v">${fmtBytes(sz.bytes)}</div><div class="s">非零權重 ${sz.nz} / ${sz.total}</div></div>
      <div class="metric ${sz.ratio > 1 ? 'good' : ''}"><div class="k">壓縮比（相對 FP32）</div><div class="v">${sz.ratio.toFixed(1)}×</div></div>`;
    S.lastAcc = testAcc;
    drawBoundary(E);
    drawWeights(E);
  }

  function drawBoundary(E) {
    const canvas = $('#labCanvas');
    const { ctx, w, h } = App.setupCanvas(canvas);
    const colors = [css('--c1'), css('--c2'), css('--c3')].map(App.hexToRgb);
    const bg = App.hexToRgb(css('--panel'));
    const off = document.createElement('canvas');
    off.width = off.height = GRID;
    const og = off.getContext('2d');
    const img = og.createImageData(GRID, GRID);
    const R = 1.25;
    for (let gy = 0; gy < GRID; gy++) for (let gx = 0; gx < GRID; gx++) {
      const x = -R + (gx + 0.5) / GRID * 2 * R, y = R - (gy + 0.5) / GRID * 2 * R;
      const z = forward([x, y], E);
      const k = argmax(z);
      const mx = z[k];
      let sum = 0; for (let i = 0; i < z.length; i++) sum += Math.exp(z[i] - mx);
      const conf = 1 / sum;
      const c = App.mix(bg, colors[k], 0.15 + 0.4 * conf);
      const p = (gy * GRID + gx) * 4;
      img.data[p] = c[0]; img.data[p + 1] = c[1]; img.data[p + 2] = c[2]; img.data[p + 3] = 255;
    }
    og.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, w, h);
    const P = ([x, y]) => [(x + R) / (2 * R) * w, (R - y) / (2 * R) * h];
    ctx.lineWidth = 1;
    S.train.X.forEach((x, i) => {
      const [px, py] = P(x);
      ctx.fillStyle = App.rgb(colors[S.train.Y[i]]);
      ctx.strokeStyle = css('--panel');
      ctx.beginPath(); ctx.arc(px, py, 3.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    });
  }

  function drawWeights(E) {
    // 熱圖：第 2 層（32×32）有效權重；灰色斜線 = 剪掉
    const { ctx, w, h } = App.setupCanvas($('#labHeat'));
    const L = S.layers[1], W = E[1];
    const maxAbs = W.reduce((m, v) => Math.max(m, Math.abs(v)), 1e-9);
    const color = App.divergingScale();
    const cell = Math.min(w, h) / L.nout;
    const ox = (w - cell * L.nin) / 2;
    for (let o = 0; o < L.nout; o++) for (let i = 0; i < L.nin; i++) {
      const v = W[o * L.nin + i];
      const pruned = S.masks && !S.masks[1][o * L.nin + i];
      ctx.fillStyle = pruned ? css('--panel-2') : App.rgb(color(v / maxAbs));
      ctx.fillRect(ox + i * cell, o * cell, cell - 0.5, cell - 0.5);
    }

    // 直方圖：所有層的非零有效權重
    const hc = App.setupCanvas($('#labHist'));
    const all = [];
    E.forEach((W, l) => W.forEach((v, i) => { if (!S.masks || S.masks[l][i]) all.push(v); }));
    const R = Math.max(...all.map(Math.abs), 1e-6);
    const bins = 90;
    const cnt = new Array(bins).fill(0);
    all.forEach(v => { cnt[Math.min(bins - 1, Math.floor((v + R) / (2 * R) * bins))]++; });
    const mc = Math.max(...cnt);
    const bw = hc.w / bins;
    hc.ctx.fillStyle = css('--c1');
    cnt.forEach((c, i) => {
      const bh = Math.sqrt(c / mc) * (hc.h - 18);
      hc.ctx.fillRect(i * bw, hc.h - 14 - bh, Math.max(1, bw - 0.5), bh);
    });
    hc.ctx.fillStyle = css('--muted');
    hc.ctx.textAlign = 'left';
    hc.ctx.fillText(`−${R.toFixed(2)}`, 2, hc.h - 2);
    hc.ctx.textAlign = 'right';
    hc.ctx.fillText(`+${R.toFixed(2)}`, hc.w - 2, hc.h - 2);
    hc.ctx.textAlign = 'center';
    hc.ctx.fillText(`${all.length} 個非零權重`, hc.w / 2, hc.h - 2);
  }

  function trainBaseline() {
    S.C = S.dataset === 'spiral' ? 3 : 2;
    S.train = makeData(S.dataset, 300, 11);
    S.test = makeData(S.dataset, 300, 99);
    initNet(5);
    S.bits = 32; S.sparsity = 0; S.masks = null;
    S.baseAcc = null;
    train(S.dataset === 'spiral' ? 1500 : 700, 0.01, '訓練 FP32 原始模型', () => {
      S.baseline = snapshot();
      S.baseAcc = accuracy(S.test);
      log(`FP32 原始模型訓練完成：測試準確率 ${pct(S.baseAcc)}`, 'good');
      applyUi();
      render();
    });
  }

  // 使用者的設定；訓練進行中調整時，等訓練結束才套用
  const ui = { bits: 32, sparsity: 0 };
  function applyUi() {
    const changed = S.sparsity !== ui.sparsity || (!S.masks && ui.sparsity > 0);
    S.bits = ui.bits;
    S.sparsity = ui.sparsity;
    if (changed) computeMasks();
  }
  App.seg('labBits', v => {
    ui.bits = +v;
    if (!S.busy) { applyUi(); render(); }
  });
  const sp = App.range('labSparsity', v => {
    ui.sparsity = v / 100;
    if (!S.busy) { applyUi(); render(); }
  }, v => v + '%');
  App.seg('labData', v => { if (S.busy) return; S.dataset = v; log(`切換資料集：${v}`); trainBaseline(); });

  $('#labFinetune').addEventListener('click', () => {
    applyUi();
    hardPrune();
    render();
    const before = S.lastAcc;
    train(300, 0.005, `在「${settingText()}」下微調`, () => {
      render();
      log(`微調（${settingText()}）：${pct(before)} → ${pct(S.lastAcc)}`, S.lastAcc >= before ? 'good' : 'bad');
      applyUi();
      render();
    });
  });
  $('#labRestore').addEventListener('click', () => {
    restore(S.baseline);
    applyUi();
    computeMasks();
    render();
    log(`還原成 FP32 原始權重，直接套用 ${settingText()}（未微調）：${pct(S.lastAcc)}`);
  });
  $('#labRetrain').addEventListener('click', trainBaseline);
  $('#labRecord').addEventListener('click', () => {
    const sz = sizeInfo();
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${S.dataset}</td><td>${settingText()}</td><td class="num">${pct(S.lastAcc)}</td><td class="num">${fmtBytes(sz.bytes)}</td><td class="num">${sz.ratio.toFixed(1)}×</td>`;
    $('#labRecords').appendChild(tr);
    $('#labRecordsWrap').hidden = false;
  });

  ui.sparsity = sp.get() / 100;
  App.whenVisible($('#lab'), trainBaseline);
  App.onRedraw(() => { if (S.train && !S.busy) render(); });
});

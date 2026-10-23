/*
 * app.js — 所有互動元件
 * 依賴 ieee.js（window.IEEE）
 */
(function () {
  'use strict';

  const I = window.IEEE;
  const F = I.FORMATS;
  const FMTS = [F.half, F.single, F.double];

  /* =====================================================
   * 小工具
   * ===================================================== */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // 用 <sup> 而非 Unicode 上標字元：¹²³ 與 ⁴⁻⁹ 在多數字型中大小不一致
  const sup = (n) => `<sup>${String(n).replace('-', '−')}</sup>`;
  /** 把 HTML 的 <sup> 轉成 SVG 可用的 tspan */
  const svgText = (html) => String(html).replace(/<sup>(.*?)<\/sup>/g, '<tspan baseline-shift="super" font-size="75%">$1</tspan>');
  const pow2 = (e) => `2${sup(e)}`;
  const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
  const KIND_NAME = { normal: '正規化數', subnormal: '次正規數', zero: '零', inf: '無限大', nan: 'NaN' };
  const store = {
    get(k, d) { try { const v = localStorage.getItem('ieee754-' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('ieee754-' + k, JSON.stringify(v)); } catch (e) { /* 忽略 */ } },
  };

  /** 把 JS 的 1.5e-7 變成 1.5 × 10<sup>−7</sup> */
  function pretty(s) {
    s = String(s);
    const m = /^(-?)([\d.]+)e([+-]\d+)$/.exec(s);
    if (!m) return s.replace(/^-/, '−');
    return `${m[1] ? '−' : ''}${m[2]} × 10${sup(+m[3])}`;
  }

  /**
   * 位元代表的數值（給人看的）：
   * 精確十進位不超過 12 位有效數字就直接顯示精確值（例如 65504、0.0999755859375），
   * 否則依格式顯示 5 / 9 / 17 位有效數字（不用「最短還原字串」，以免 65504 被寫成 65500 誤導初學者）。
   */
  function shortest(f, bits) {
    const v = I.toNumber(f, bits);
    if (Number.isNaN(v)) return 'NaN';
    if (!Number.isFinite(v)) return v > 0 ? '+∞' : '−∞';
    if (v === 0) return Object.is(v, -0) ? '−0' : '0';
    const ex = I.exactDecimalOfBits(f, bits);
    const sig = ex.replace(/^-/, '').replace('.', '').replace(/^0+/, '').length;
    if (sig <= 12) return ex;
    if (f.key === 'double') return String(v);
    return String(Number(v.toPrecision(f.key === 'half' ? 5 : f.key === 'single' ? 9 : 6)));
  }
  const prettyShort = (f, bits) => pretty(shortest(f, bits));

  /** 彩色的位元字串 S | E | F */
  function bitsHTML(f, bits, sep = ' ') {
    const b = I.toBinString(f, bits);
    return `<span class="bs"><span class="s">${b[0]}</span>${sep}<span class="e">${b.slice(1, 1 + f.expBits)}</span>${sep}<span class="m">${b.slice(1 + f.expBits)}</span></span>`;
  }

  /** 精確十進位值，太長就折疊 */
  function exactHTML(str, max = 70) {
    if (str.length <= max) return `<span class="exact-box">${esc(str)}</span>`;
    return `<span class="exact-box exact-wrap" data-full="${esc(str)}">${esc(str.slice(0, max))}… <button type="button" class="linkish">展開全部 ${str.length} 個字元</button></span>`;
  }
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.exact-wrap .linkish');
    if (btn) { const w = btn.closest('.exact-wrap'); w.textContent = w.dataset.full; }
  });

  /** 有理數 n/d 的科學記號近似（BigInt 精確計算） */
  function ratSci(n, d, digits = 4) {
    if (n === 0n) return '0';
    if (d < 0n) { n = -n; d = -d; }
    const neg = n < 0n; if (neg) n = -n;
    let e = n.toString().length - d.toString().length;
    const scaled = (e) => { const s = digits - 1 - e; return s >= 0 ? (n * 10n ** BigInt(s)) / d : n / (d * 10n ** BigInt(-s)); };
    let q = scaled(e);
    if (q.toString().length > digits) { e++; q = scaled(e); }
    else if (q.toString().length < digits) { e--; q = scaled(e); }
    let qs = q.toString();
    let mant = qs[0] + (qs.length > 1 ? '.' + qs.slice(1) : '');
    mant = mant.includes('.') ? mant.replace(/\.?0+$/, '') : mant;
    if (e === 0) return (neg ? '−' : '') + mant;
    return `${neg ? '−' : ''}${mant} × 10${sup(e)}`;
  }

  /** 有理數 n/d 的十進位展開（最多 maxSig 個有效位數） */
  function ratToDec(n, d, maxSig = 40) {
    if (d < 0n) { n = -n; d = -d; }
    const neg = n < 0n; if (neg) n = -n;
    const ip = n / d; let r = n % d;
    let s = (neg ? '−' : '') + ip.toString();
    if (r === 0n) return s;
    let frac = ''; let sig = ip > 0n ? ip.toString().length : 0;
    while (r !== 0n && sig < maxSig && frac.length < 1200) {
      r *= 10n; const dg = r / d; r %= d; frac += dg.toString();
      if (sig > 0 || dg > 0n) sig++;
    }
    return s + '.' + frac + (r !== 0n ? '…' : '');
  }

  /** 位元代表的精確有理數 (numer / denom)，含正負號 */
  function bitsToRat(f, bits) {
    const d = I.decodeExact(f, bits);
    if (d.kind === 'inf' || d.kind === 'nan') return null;
    let n = d.pow >= 0 ? d.sig << BigInt(d.pow) : d.sig;
    const den = d.pow >= 0 ? 1n : 1n << BigInt(-d.pow);
    if (d.sign) n = -n;
    return { n, d: den };
  }

  function randomBigBits(nbits) {
    let b = 0n;
    for (let i = 0; i < nbits; i += 16) b = (b << 16n) | BigInt(Math.floor(Math.random() * 65536));
    return b & ((1n << BigInt(nbits)) - 1n);
  }

  /* =====================================================
   * 共用元件：位元視圖
   * ===================================================== */
  function BitView(host, fmt, opts = {}) {
    const { onChange = null, readOnly = false, showIdx = true } = opts;
    let f = fmt;
    let bits = 0n;
    let cells = [];
    let labels = {};
    const root = document.createElement('div');
    host.innerHTML = '';
    host.appendChild(root);

    let painting = null; // 拖曳連續塗色
    let pointerHandled = false;
    window.addEventListener('pointerup', () => { painting = null; });

    function idxVisible(pos) {
      if (f.bits <= 32) return true;
      return pos % 4 === 0 || pos === f.bits - 1 || pos === f.fracBits || pos === f.fracBits - 1;
    }

    function build() {
      const sizeKey = f.key === 'custom' ? 'half' : f.key;
      root.className = `bitview fmt-${sizeKey}${showIdx ? ' show-idx' : ''}`;
      root.innerHTML = '';
      cells = [];
      labels = {};
      const groups = [['s', 1, '符號'], ['e', f.expBits, '指數'], ['m', f.fracBits, '尾數']];
      let pos = f.bits - 1;
      for (const [cls, n, name] of groups) {
        const g = document.createElement('div');
        g.className = `bit-group g-${cls}`;
        const c = document.createElement('div');
        c.className = 'bit-cells';
        for (let i = 0; i < n; i++, pos--) {
          const b = document.createElement(readOnly ? 'span' : 'button');
          if (!readOnly) b.type = 'button';
          b.className = `bit ${cls}${readOnly ? ' ro' : ''}`;
          b.dataset.pos = pos;
          b.setAttribute('aria-label', `${name}位元，第 ${pos} 位`);
          b.innerHTML = `${showIdx && idxVisible(pos) ? `<span class="idx">${pos}</span>` : ''}<span class="v">0</span>`;
          c.appendChild(b);
          cells.push(b);
        }
        const lab = document.createElement('div');
        lab.className = 'bit-label';
        g.append(c, lab);
        labels[cls] = lab;
        root.appendChild(g);
      }
      if (!readOnly) {
        cells.forEach((cell) => {
          const pos = BigInt(cell.dataset.pos);
          // 觸控與鍵盤走 click（捲動手勢不會誤觸）；滑鼠與觸控筆走 pointerdown，可拖曳連續塗色
          cell.addEventListener('click', () => { if (pointerHandled) { pointerHandled = false; return; } toggle(pos); });
          cell.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 || (e.pointerType !== 'mouse' && e.pointerType !== 'pen')) return;
            e.preventDefault();
            pointerHandled = true;
            const target = ((bits >> pos) & 1n) ^ 1n;
            setBit(pos, target);
            painting = target;
          });
          cell.addEventListener('pointerenter', () => { if (painting !== null) setBit(pos, painting); });
        });
      }
    }

    function toggle(pos) { setBit(pos, ((bits >> pos) & 1n) ^ 1n); }
    function setBit(pos, v) {
      const nb = v ? bits | (1n << pos) : bits & ~(1n << pos);
      if (nb === bits) return;
      set(nb);
      if (onChange) onChange(bits);
    }

    function set(nb) {
      const old = bits;
      bits = nb;
      cells.forEach((cell) => {
        const pos = BigInt(cell.dataset.pos);
        const on = (bits >> pos) & 1n;
        cell.classList.toggle('on', on === 1n);
        cell.querySelector('.v').textContent = on.toString();
        if (((old ^ bits) >> pos) & 1n) {
          cell.classList.remove('flash'); void cell.offsetWidth; cell.classList.add('flash');
        }
      });
      const fl = I.fields(f, bits);
      labels.s.innerHTML = `符號<br><b>${fl.sign ? '−' : '+'}</b>`;
      labels.e.innerHTML = `指數 ${f.expBits} 位<br><b>= ${fl.exp}</b>`;
      labels.m.innerHTML = `尾數 ${f.fracBits} 位`;
    }

    build();
    set(0n);
    return {
      set, get: () => bits,
      setFormat(nf, nb = 0n) { f = nf; bits = nb; build(); set(nb); },
      get fmt() { return f; },
    };
  }

  /* 分頁 / 快捷按鈕 */
  function makeTabs(host, items, initial, onSelect) {
    host.innerHTML = '';
    const btns = items.map((it) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.innerHTML = (it.color ? `<span class="sw" style="background:${it.color}"></span>` : '') + it.label;
      b.addEventListener('click', () => { select(it.key); onSelect(it.key); });
      host.appendChild(b);
      return b;
    });
    function select(k) { btns.forEach((b, i) => b.setAttribute('aria-selected', String(items[i].key === k))); }
    select(initial);
    return { select };
  }
  const FMT_TABS = FMTS.map((f) => ({ key: f.key, label: `${f.name}（${f.bits}）`, color: `var(--c-${f.key})` }));

  function makeChips(host, list, onPick) {
    host.innerHTML = '';
    list.forEach((it) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = it.label;
      b.addEventListener('click', () => onPick(it));
      host.appendChild(b);
    });
  }

  /* 工具提示 */
  const tip = $('#tooltip');
  function showTip(html, x, y) {
    tip.innerHTML = html;
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let left = x + 14, top = y + 14;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
    tip.style.left = Math.max(8, left) + 'px';
    tip.style.top = Math.max(8, top) + 'px';
  }
  function hideTip() { tip.hidden = true; }

  /* 彩帶 */
  function confetti(n = 28) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const host = $('#confetti');
    const em = ['🎉', '✨', '⭐', '🟣', '🟡', '🔴', '1', '0'];
    for (let i = 0; i < n; i++) {
      const s = document.createElement('span');
      s.className = 'confetto';
      s.textContent = pick(em);
      s.style.left = Math.random() * 100 + 'vw';
      const dur = 1.4 + Math.random() * 1.6;
      s.style.animationDuration = dur + 's';
      s.style.animationDelay = Math.random() * 0.3 + 's';
      host.appendChild(s);
      setTimeout(() => s.remove(), (dur + 0.4) * 1000);
    }
  }

  /* =====================================================
   * 共用：解碼說明面板
   * ===================================================== */
  function explainHTML(f, bits) {
    const { sign, exp, frac } = I.fields(f, bits);
    const kind = I.classify(f, bits);
    const expBin = I.toBinString(f, bits).slice(1, 1 + f.expBits);
    const fracBin = I.toBinString(f, bits).slice(1 + f.expBits);
    const emin = 1 - f.bias;
    const rows = [];
    const row = (k, v) => rows.push(`<div class="row"><span>${k}</span><span>${v}</span></div>`);

    rows.push(`<div class="row"><span>數值</span><span class="val-big">${prettyShort(f, bits)}</span><span class="kind-badge">${KIND_NAME[kind]}</span></div>`);
    row('符號 S', `<b class="hl-s">${sign}</b> → ${sign ? '負數 (−)' : '正數 (+)'}`);

    if (kind === 'inf') {
      row('指數欄位', `<span class="bs"><span class="e">${expBin}</span></span> = ${exp}（<b>全 1</b>）`);
      row('尾數欄位', `<span class="bs"><span class="m">${fracBin}</span></span>（全 0）`);
      row('解讀', `指數全 1 且尾數全 0 → <b>${sign ? '負' : '正'}無限大</b>`);
    } else if (kind === 'nan') {
      const quiet = (frac >> BigInt(f.fracBits - 1)) & 1n;
      row('指數欄位', `<span class="bs"><span class="e">${expBin}</span></span> = ${exp}（<b>全 1</b>）`);
      row('尾數欄位', `<span class="bs"><span class="m">${fracBin}</span></span>（不是全 0）`);
      row('解讀', `指數全 1 且尾數非 0 → <b>NaN</b>（${quiet ? '尾數最高位是 1 → quiet NaN' : '尾數最高位是 0 → signaling NaN'}）`);
    } else if (kind === 'zero') {
      row('指數欄位', `<span class="bs"><span class="e">${expBin}</span></span>（全 0）`);
      row('尾數欄位', `<span class="bs"><span class="m">${fracBin}</span></span>（全 0）`);
      row('解讀', `全部是 0 → <b>${sign ? '−0（負零）' : '+0（正零）'}</b>`);
    } else {
      const sub = kind === 'subnormal';
      const E = sub ? emin : exp - f.bias;
      const lead = sub ? '0' : '1';
      const fracTrim = fracBin.replace(/0+$/, '') || '0';
      const sigDec = I.exactDecimal((sub ? 0n : 1n << BigInt(f.fracBits)) + frac, -f.fracBits);
      if (sub) {
        row('指數欄位', `<span class="bs"><span class="e">${expBin}</span></span> = 0（全 0 → <b>次正規數</b>）→ 實際指數固定為 1 − ${f.bias} = <b>${E}</b>`);
        row('尾數', `隱藏位元變成 <b>0</b>：<span class="mono">0.<span class="hl-m">${fracTrim}</span>₂ = ${sigDec}</span>`);
      } else {
        row('指數欄位', `<span class="bs"><span class="e">${expBin}</span></span>₂ = ${exp} → 實際指數 = ${exp} − ${f.bias} = <b>${E}</b>`);
        row('尾數', `補上隱藏的 1：<span class="mono">1.<span class="hl-m">${fracTrim}</span>₂ = ${sigDec}</span>`);
      }
      const p2 = Math.abs(E) <= 20 ? ` = ${sign ? '−' : ''}${sigDec} × ${I.exactDecimal(1n, E)}` : '';
      row('計算', `<span class="mono">(−1)${sup(sign)} × ${lead}.${fracTrim}₂ × ${pow2(E)}</span>`);
      row('', `<span class="mono">= ${sign ? '−' : ''}${sigDec} × ${pow2(E)}${p2}</span>`);
      row('精確值', exactHTML(I.exactDecimalOfBits(f, bits)));
    }
    row('十六進位', `<span class="mono">${I.toHex(f, bits)}</span>`);
    return rows.join('');
  }

  /* =====================================================
   * Hero：自動變化的半精度位元
   * ===================================================== */
  function initHero() {
    const view = BitView($('#hero-bits'), F.half, { readOnly: true, showIdx: false });
    const cap = $('#hero-caption');
    const vals = ['1', '-2', '0.1', '3.14159', '65504', '0.5', '-0.000123', 'inf', '42', '-0', '0.333', 'nan', '1e-7'];
    let i = 0;
    function step() {
      const b = I.encodeString(F.half, vals[i % vals.length]).bits;
      view.set(b);
      const kind = I.classify(F.half, b);
      cap.innerHTML = `${bitsHTML(F.half, b)} &nbsp;=&nbsp; <b>${prettyShort(F.half, b)}</b> <span class="muted">（半精度${kind === 'normal' ? '' : '・' + KIND_NAME[kind]}）</span>`;
      i++;
    }
    step();
    // 只在 hero 看得到、且分頁在前景時才播放：畫面外的變動在 iOS（沒有 scroll anchoring）會讓頁面跳動
    let visible = true;
    new IntersectionObserver((es) => { visible = es[0].isIntersecting; }).observe($('#hero-bits'));
    setInterval(() => { if (visible && !document.hidden) step(); }, 2600);
  }

  /* =====================================================
   * 第 1 章
   * ===================================================== */
  function initFloatPoint() {
    const digits = '1011';
    const slider = $('#fp-exp'), out = $('#fp-exp-out'), disp = $('#fp-display'), res = $('#fp-result');
    function render() {
      const k = +slider.value;
      out.textContent = k;
      const pos = 1 + k; // 小數點在第 pos 個字之後
      let html;
      const D = (s) => s.split('').map((c) => `<span class="d">${c}</span>`).join('');
      const Z = (n) => `<span class="z">${'0'.repeat(n)}</span>`;
      const P = '<span class="pt">.</span>';
      if (pos <= 0) html = `${Z(1)}${P}${Z(-pos)}${D(digits)}`;
      else if (pos >= digits.length) html = `${D(digits)}${Z(pos - digits.length)}${P}${Z(1)}`;
      else html = `${D(digits.slice(0, pos))}${P}${D(digits.slice(pos))}`;
      disp.innerHTML = html;
      const val = I.exactDecimal(11n, k - 3);
      res.innerHTML = `<span class="mono">1.011₂ × ${pow2(k)}</span> = <b>${val}</b>（十進位）`;
    }
    slider.addEventListener('input', render);
    render();
  }

  function initSci() {
    const input = $('#sci-input'), out = $('#sci-out');
    function render() {
      const s = input.value;
      const enc = I.encodeString(F.double, s);
      if (!enc || enc.parsed.special) { out.innerHTML = `<div class="line">請輸入一般的有限數字，例如 13.25、0.1、-3e5</div>`; return; }
      const v = I.toNumber(F.double, enc.bits);
      if (v === 0) { out.innerHTML = `<div class="line">0 很特別：它沒辦法寫成 1.xxx × 2ⁿ，IEEE 754 用「全部位元為 0」來表示它（第 6 章）。</div>`; return; }
      if (!Number.isFinite(v)) { out.innerHTML = `<div class="line">這個數太大了，連雙精度都裝不下 → ∞</div>`; return; }
      const [m, e] = Math.abs(v).toExponential().split('e');
      const sgn = v < 0 ? '−' : '';
      const d = I.decodeExact(F.double, enc.bits);
      const bin = d.sig.toString(2);
      const E = d.pow + bin.length - 1;
      const frac = bin.slice(1).replace(/0+$/, '');
      let positional = '';
      if (E >= -20 && E <= 40) {
        const all = bin.replace(/0+$/, '') || '1';
        const pt = E + 1;
        let p;
        if (pt <= 0) p = '0.' + '0'.repeat(-pt) + all;
        else if (pt >= all.length) p = all + '0'.repeat(pt - all.length);
        else p = all.slice(0, pt) + '.' + all.slice(pt);
        positional = `<div class="line"><small>二進位（一般寫法）</small>${sgn}${p}₂</div>`;
      }
      const inexact = enc.info.roundDir && enc.info.roundDir !== 'exact';
      out.innerHTML = `
        <div class="line"><small>十進位科學記號</small>${sgn}<span class="hl-m">${m}</span> × 10<sup class="hl-e">${+e}</sup></div>
        ${positional}
        <div class="line"><small>二進位科學記號（正規化：小數點前固定是 1）</small>${sgn}<span class="hl-m">1.${frac || '0'}</span>₂ × 2<sup class="hl-e">${E}</sup></div>
        ${inexact ? `<div class="line"><small>⚠️ 注意</small>這個數在二進位是<b>無限位數</b>（像 1/3 在十進位一樣），上面只顯示雙精度能存的前 52 位。第 4 章會看到它怎麼被「捨入」。</div>` : ''}`;
    }
    input.addEventListener('input', render);
    makeChips($('#sci-chips'), ['13.25', '0.5', '0.1', '1000000', '0.000123', '-3.75'].map((v) => ({ label: v, value: v })), (it) => { input.value = it.value; render(); });
    render();
  }

  /* =====================================================
   * 第 2 章
   * ===================================================== */
  function initAnatomy() {
    $('#format-bars').innerHTML = FMTS.map((f) => `
      <div class="fbar-row">
        <div class="fbar-name">${f.name}<small>${f.en}</small></div>
        <div class="fbar" style="width:${(f.bits / 64) * 100}%">
          <div class="s" style="flex:1" title="符號 1 位">S</div>
          <div class="e" style="flex:${f.expBits}" title="指數 ${f.expBits} 位">E ${f.expBits}</div>
          <div class="m" style="flex:${f.fracBits}" title="尾數 ${f.fracBits} 位">尾數 ${f.fracBits}</div>
        </div>
      </div>`).join('');

    const info = FMTS.map((f) => {
      const fb = BigInt(f.fracBits);
      const maxBits = ((BigInt(I.maxExpField(f)) << fb) - 1n);
      const p = f.fracBits + 1;
      return {
        f,
        rows: {
          total: `${f.bits}`,
          layout: `1 / ${f.expBits} / ${f.fracBits}`,
          bias: `${f.bias}`,
          prec: `${p} 位`,
          range: `${1 - f.bias} ～ +${f.bias}`,
          max: prettyShort(f, maxBits),
          minN: prettyShort(f, 1n << fb),
          minS: prettyShort(f, 1n),
          eps: `${pow2(-f.fracBits)} ≈ ${pretty(Number(Math.pow(2, -f.fracBits).toPrecision(4)))}`,
          digits: `≈ ${(p * Math.log10(2)).toFixed(2)} 位`,
        },
      };
    });
    const labels = [
      ['total', '總位元數'], ['layout', '符號 / 指數 / 尾數'], ['bias', '偏差值 bias'], ['prec', '精度 p（含隱藏位）'],
      ['range', '正規化數的實際指數'], ['max', '最大有限值'], ['minN', '最小正規化數'], ['minS', '最小次正規數'],
      ['eps', '機器 ε（1 到下一個數的距離）'], ['digits', '十進位有效位數'],
    ];
    const uses = { half: 'AI 推論、GPU 圖形、HDR 影像', single: '遊戲 / 3D 繪圖、機器學習、C 的 float', double: '科學計算、JavaScript 與 Python 的預設數字' };
    let html = `<thead><tr><th></th>${info.map((x) => `<th><span class="tag t-${x.f.key}">${x.f.name}</span> <small class="muted">${x.f.en}</small></th>`).join('')}</tr></thead><tbody>`;
    html += labels.map(([k, name]) => `<tr><td>${name}</td>${info.map((x) => `<td>${x.rows[k]}</td>`).join('')}</tr>`).join('');
    html += `<tr><td>常見用途</td>${info.map((x) => `<td class="txt">${uses[x.f.key]}</td>`).join('')}</tr></tbody>`;
    $('#spec-table').innerHTML = html;

    // 偏差值轉換器
    let bf = F.single;
    const slider = $('#bias-slider'), out = $('#bias-out'), res = $('#bias-result');
    function setup(key) {
      bf = F[key];
      slider.min = 1 - bf.bias; slider.max = bf.bias;
      if (+slider.value < +slider.min || +slider.value > +slider.max || slider.value === '') slider.value = 3;
      render();
    }
    function render() {
      const E = +slider.value;
      out.textContent = E;
      const stored = E + bf.bias;
      const bin = stored.toString(2).padStart(bf.expBits, '0');
      const approx = Math.abs(E) <= 20 ? I.exactDecimal(1n, E) : pretty(Math.pow(2, E).toPrecision(5));
      res.innerHTML = `實際指數 <b>${E}</b> + 偏差值 <b>${bf.bias}</b> = <b>${stored}</b> → 存成 <span class="bs"><span class="e">${bin}</span></span><br>
        <span class="muted small">代表 ${pow2(E)} = ${approx}。欄位值 0（全 0）和 ${(1 << bf.expBits) - 1}（全 1）保留給特殊值，所以實際指數只能從 ${1 - bf.bias} 到 ${bf.bias}。</span>`;
    }
    makeTabs($('#bias-tabs'), FMT_TABS, 'single', setup);
    slider.addEventListener('input', render);
    setup('single');
  }

  /* =====================================================
   * 第 3 章：迷你浮點數
   * ===================================================== */
  function initMini() {
    let fmt = I.makeFormat(3, 2);
    let zoom = 'all';
    const eS = $('#mini-e'), fS = $('#mini-f');
    const view = BitView($('#mini-bits'), fmt, { onChange: render });

    function rebuild() {
      fmt = I.makeFormat(+eS.value, +fS.value);
      $('#mini-e-out').textContent = eS.value;
      $('#mini-f-out').textContent = fS.value;
      // 預設選 1
      view.setFormat(fmt, BigInt(fmt.bias) << BigInt(fmt.fracBits));
      render();
    }

    function render() {
      const bits = view.get();
      $('#mini-explain').innerHTML = explainHTML(fmt, bits);
      renderLine(bits);
    }

    function renderLine(sel) {
      const W = 900, H = 140, padL = 16, padR = 16, axisY = 94;
      const maxE = I.maxExpField(fmt);
      const pts = [];
      const lim = BigInt(maxE) << BigInt(fmt.fracBits);
      for (let b = 0n; b < lim; b++) pts.push({ b, v: I.toNumber(fmt, b), e: I.fields(fmt, b).exp });
      const vmaxAll = pts[pts.length - 1].v;
      const vmax = zoom === 'all' ? vmaxAll : Math.min(+zoom, vmaxAll);
      const X = (v) => padL + (v / vmax) * (W - padL - padR);
      const emin = 1 - fmt.bias;
      const colors = ['var(--c-half)', 'var(--c-single)'];
      let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="迷你浮點數所有可表示的正數在數線上的位置">`;
      // 樓層色帶
      const subHi = Math.pow(2, emin);
      svg += `<rect x="${X(0)}" y="${axisY - 34}" width="${Math.max(0, X(Math.min(subHi, vmax)) - X(0))}" height="44" fill="var(--muted)" fill-opacity=".12"/>`;
      let lastTick = X(0);
      svg += `<text x="${X(0)}" y="${axisY + 24}" text-anchor="middle" font-size="12" fill="var(--muted)">0</text>`;
      for (let e = 1; e < maxE; e++) {
        const lo = Math.pow(2, e - fmt.bias), hi = Math.pow(2, e - fmt.bias + 1);
        if (lo > vmax) break;
        const x0 = X(lo), x1 = X(Math.min(hi, vmax));
        svg += `<rect x="${x0}" y="${axisY - 34}" width="${Math.max(0, x1 - x0)}" height="44" fill="${colors[e % 2]}" fill-opacity=".10"/>`;
        if (x1 - x0 > 56) svg += `<text x="${(x0 + x1) / 2}" y="14" text-anchor="middle" font-size="12" fill="var(--ink-2)">指數 ${e - fmt.bias}</text>`;
        if (x0 - lastTick > 34) {
          svg += `<line x1="${x0}" x2="${x0}" y1="${axisY}" y2="${axisY + 8}" stroke="var(--axis)"/>`;
          svg += `<text x="${x0}" y="${axisY + 24}" text-anchor="middle" font-size="12" fill="var(--muted)">${svgText(pretty(lo))}</text>`;
          lastTick = x0;
        }
      }
      svg += `<line x1="${X(0)}" x2="${W - padR}" y1="${axisY}" y2="${axisY}" stroke="var(--axis)" stroke-width="1"/>`;
      const selMag = sel & ((1n << BigInt(fmt.bits - 1)) - 1n);
      for (const p of pts) {
        if (p.v > vmax) break;
        const color = p.e === 0 ? 'var(--muted)' : colors[p.e % 2];
        const isSel = p.b === selMag;
        svg += `<g class="pt" data-b="${p.b}" tabindex="-1">
          <circle cx="${X(p.v)}" cy="${axisY}" r="11" fill="transparent"/>
          <circle class="mark" cx="${X(p.v)}" cy="${axisY}" r="${isSel ? 7 : 4.5}" fill="${color}" stroke="var(--surface)" stroke-width="2"/>
          ${isSel ? `<circle cx="${X(p.v)}" cy="${axisY}" r="11" fill="none" stroke="var(--ink)" stroke-width="2"/>` : ''}
        </g>`;
      }
      const kind = I.classify(fmt, sel);
      const selV = I.toNumber(fmt, selMag);
      if ((kind === 'inf' || kind === 'nan')) {
        svg += `<text x="${W - padR}" y="${axisY - 40}" text-anchor="end" font-size="13" fill="var(--ink)">${kind === 'inf' ? '目前選的是 ∞，不在數線上 →' : 'NaN 不是數字，數線上找不到它 👻'}</text>`;
      } else if (selV <= vmax) {
        svg += `<text x="${Math.min(Math.max(X(selV), 60), W - 60)}" y="${axisY - 40}" text-anchor="middle" font-size="13" font-weight="700" fill="var(--ink)">${sel !== selMag ? '|' : ''}${svgText(pretty(shortest(fmt, selMag)))}${sel !== selMag ? '|（負數畫在對稱的左側）' : ''}</text>`;
      } else {
        svg += `<text x="${W - padR}" y="${axisY - 40}" text-anchor="end" font-size="13" fill="var(--ink)">選取的數 ${svgText(pretty(selV))} 在放大範圍外 →</text>`;
      }
      svg += '</svg>';
      const host = $('#mini-line');
      host.innerHTML = svg;
      $$('.pt', host).forEach((g) => {
        const b = BigInt(g.dataset.b);
        g.addEventListener('click', () => { view.set(b); render(); });
        g.addEventListener('pointermove', (e) => showTip(`<div class="tt-h">${KIND_NAME[I.classify(fmt, b)]}</div><b>${prettyShort(fmt, b)}</b><div>${bitsHTML(fmt, b)}</div>`, e.clientX, e.clientY));
        g.addEventListener('pointerleave', hideTip);
      });
      const count = pts.length - 1;
      const nPerFloor = 1 << fmt.fracBits;
      $('#mini-stats').innerHTML = `這個 ${fmt.bits} 位元的迷你格式（1 / ${fmt.expBits} / ${fmt.fracBits}，偏差值 ${fmt.bias}）共有 <b>${count}</b> 個正的有限數；每層 ${nPerFloor} 個；最大 ${pretty(vmaxAll)}，最小正規化數 ${pretty(Math.pow(2, emin))}，最小次正規數 ${pretty(I.toNumber(fmt, 1n))}。`;
    }

    eS.addEventListener('input', rebuild);
    fS.addEventListener('input', rebuild);
    $$('[data-zoom]').forEach((b) => b.addEventListener('click', () => {
      zoom = b.dataset.zoom;
      $$('[data-zoom]').forEach((x) => x.classList.toggle('active', x === b));
      render();
    }));
    rebuild();
  }

  /* =====================================================
   * 第 4 章：逐步編碼
   * ===================================================== */
  function initEncoder() {
    let fmt = F.single;
    const input = $('#enc-input'), host = $('#enc-steps');
    const step = (title, body, cls = '') => `<div class="step ${cls}"><h4>${title}</h4>${body}</div>`;

    // n/den（den = 10^m）的精確十進位字串
    function decOf(n, den) {
      const m = den.toString().length - 1;
      const s = n.toString().padStart(m + 1, '0');
      const ip = s.slice(0, s.length - m), fp = s.slice(s.length - m).replace(/0+$/, '');
      return fp ? `${ip}.${fp}` : ip;
    }

    function render() {
      const f = fmt;
      const raw = input.value.trim();
      const p = I.parseDecimal(raw);
      if (!p) { host.innerHTML = step('看不懂這個數字 🤔', '<p>請輸入像 <code>-6.625</code>、<code>0.1</code>、<code>1.5e-3</code>、<code>inf</code>、<code>nan</code> 這樣的數字。</p>', 'error-step'); return; }
      const enc = I.encodeString(f, raw);
      const bits = enc.bits;
      const sign = p.sign;
      const out = [];
      const finalStep = () => step(`完成！${f.name}的結果`, `<div class="bv-final"></div><p>二進位：${bitsHTML(f, bits)}</p><p>十六進位：<b class="mono">${I.toHex(f, bits)}</b>　數值：<b>${prettyShort(f, bits)}</b></p>`, 'final');

      if (p.special === 'inf' || p.special === 'nan') {
        out.push(step('特殊值', p.special === 'inf'
          ? `<p>∞ 不需要計算：<b>指數全部填 1、尾數全部填 0</b>，符號位 = ${sign}。</p>`
          : `<p>NaN 不需要計算：<b>指數全部填 1、尾數不是 0</b>（慣例上把尾數最高位設為 1，稱為 quiet NaN）。</p>`));
        out.push(finalStep());
      } else if (p.special === 'huge' || p.special === 'tiny') {
        out.push(step(p.special === 'huge' ? '太大了！' : '太小了！', p.special === 'huge'
          ? `<p>這個數遠遠超過${f.name}的最大值，直接<b>溢位成 ${sign ? '−' : '+'}∞</b>。</p>`
          : `<p>這個數比最小次正規數的一半還小，直接<b>下溢成 ${sign ? '−' : '+'}0</b>。</p>`));
        out.push(finalStep());
      } else if (p.num === 0n) {
        out.push(step('零是特殊值', `<p>0 無法寫成 1.xxx × 2ⁿ，所以 IEEE 754 規定：<b>指數與尾數全部為 0</b> 就代表零。符號位 = ${sign}（${sign ? '負零 −0' : '正零 +0'}）。</p>`));
        out.push(finalStep());
      } else {
        const { num, den } = p;
        const info = enc.info;
        const emin = 1 - f.bias;
        const absStr = decOf(num, den);

        // ① 符號
        out.push(step('決定符號位 S', `<p><b>${esc(raw)}</b> 是${sign ? '負' : '正'}數 → <b class="hl-s">S = ${sign}</b>。接下來只處理絕對值 <b>${absStr}</b>。</p>`));

        // ② 轉二進位
        const ip = num / den;
        const fracN = num % den;
        let intHTML;
        if (ip === 0n) intHTML = `<p>整數部分是 0 → <b>0</b>₂</p>`;
        else if (ip < 1048576n) {
          let n = ip; const rows = [];
          while (n > 0n) { rows.push(`<tr><td>${n} ÷ 2</td><td>= ${n / 2n}</td><td>餘 <span class="bitcell">${n % 2n}</span></td></tr>`); n /= 2n; }
          intHTML = `<p><b>整數部分 ${ip}</b>：不斷除以 2，餘數<b>由下往上</b>讀</p><table class="calc-table">${rows.join('')}</table><p>→ <b class="mono">${ip.toString(2)}</b>₂</p>`;
        } else {
          const b = ip.toString(2);
          intHTML = `<p><b>整數部分</b>（太大了，直接給答案）：<span class="mono">${b.length > 80 ? b.slice(0, 80) + '…（共 ' + b.length + ' 位）' : b}</span>₂</p>`;
        }
        let fracHTML = '';
        if (fracN === 0n) fracHTML = '<p>沒有小數部分 👍</p>';
        else {
          const seen = new Map();
          let r = fracN; const rows = []; let loopAt = -1; let bitsStr = '';
          const MAX = 12;
          for (let i = 0; i < MAX && r !== 0n; i++) {
            if (seen.has(r)) { loopAt = seen.get(r); break; }
            seen.set(r, i);
            const two = r * 2n;
            const bit = two >= den ? 1 : 0;
            rows.push({ txt: `0.${decOf(r, den).split('.')[1] || '0'} × 2 = ${decOf(two, den)}`, bit });
            bitsStr += bit;
            r = bit ? two - den : two;
            if (r !== 0n && seen.has(r) && i + 1 <= MAX) { loopAt = seen.get(r); break; }
          }
          const tr = rows.map((x, i) => `<tr class="${loopAt >= 0 && i >= loopAt ? 'loop' : ''}"><td>${x.txt}</td><td>→ 取 <span class="bitcell">${x.bit}</span></td></tr>`).join('');
          let tail;
          if (r === 0n) tail = `<p>乘到小數部分變 0，結束！→ <b class="mono">0.${bitsStr}</b>₂</p>`;
          else if (loopAt >= 0) tail = `<p>🔁 <b>出現循環了！</b>黃色那幾列會無限重複 → <b class="mono">0.${bitsStr.slice(0, loopAt)}(${bitsStr.slice(loopAt)})</b>₂ 括號裡無限循環。這就是為什麼它<b>不可能被精確儲存</b>。</p>`;
          else tail = `<p>還沒結束……（表格只列前 ${MAX} 步）→ <b class="mono">0.${bitsStr}…</b>₂</p>`;
          fracHTML = `<p><b>小數部分 0.${decOf(fracN, den).split('.')[1]}</b>：不斷乘以 2，取整數部分<b>由上往下</b>讀</p><table class="calc-table">${tr}</table>${tail}`;
        }
        out.push(step('把絕對值轉成二進位', `<div class="cols-2"><div>${intHTML}</div><div>${fracHTML}</div></div>`));

        // ③ 正規化
        const E = info.E, Eu = info.Eeff, sub = info.subnormal;
        const G = 6;
        const sh = f.fracBits + G - Eu;
        const scaled = sh >= 0 ? (num << BigInt(sh)) / den : num / (den << BigInt(-sh));
        const remNZ = sh >= 0 ? (num << BigInt(sh)) % den !== 0n : num % (den << BigInt(-sh)) !== 0n;
        const sStr = scaled.toString(2).padStart(f.fracBits + G + 1, '0');
        const lead = sStr[0], kept = sStr.slice(1, 1 + f.fracBits), extra = sStr.slice(1 + f.fracBits) + (remNZ ? '…' : '');
        const shiftTxt = E > 0 ? `小數點往<b>左</b>移 ${E} 位` : E < 0 ? `小數點往<b>右</b>移 ${-E} 位` : '小數點不用移';
        let normHTML;
        if (!sub) {
          normHTML = `<p>把小數點移到<b>第一個 1 的後面</b>（${shiftTxt}）：</p>
            <p class="mono" style="font-size:1.05em;word-break:break-all"><span class="g">1</span>.<span class="hl-m">${kept}</span><span class="g">${extra}</span> × 2<sup class="hl-e">${E}</sup></p>
            <p class="small muted">開頭的 1 是「隱藏位元」不用存；紫色是尾數放得下的 ${f.fracBits} 位，灰色是放不下、要捨入的部分。</p>`;
        } else {
          normHTML = `<p>正規化應該寫成 1.xxx × 2<sup>${E}</sup>，但 <b>${E} 比最小指數 ${emin} 還小</b>！</p>
            <p>只好把指數固定在 ${emin}，寫成 <b>0.xxx</b> 的形式 → 這是<b>次正規數</b>：</p>
            <p class="mono" style="word-break:break-all"><span class="g">${lead}</span>.<span class="hl-m">${kept}</span><span class="g">${extra}</span> × 2<sup class="hl-e">${emin}</sup></p>
            <p class="small muted">前面多出來的 0 吃掉了尾數位數 → 精度變差。</p>`;
        }
        out.push(step('正規化：寫成 1.xxx × 2<sup>E</sup>', normHTML));

        // ④ 指數
        const maxE = I.maxExpField(f);
        if (!sub && E + f.bias >= maxE) {
          out.push(step('計算指數欄位 → 溢位！', `<p>E + 偏差值 = ${E} + ${f.bias} = ${E + f.bias}，但指數欄位最大只能存 ${maxE - 1}（${maxE} 保留給 ∞/NaN）。</p><p>💥 <b>溢位</b>：結果變成 <b>${sign ? '−' : '+'}∞</b>。</p>`));
        } else {
          out.push(step('計算指數欄位（加上偏差值）', sub
            ? `<p>次正規數的指數欄位規定為<b>全 0</b>：<span class="bs"><span class="e">${'0'.repeat(f.expBits)}</span></span>（代表實際指數 ${emin}，且隱藏位元是 0）</p>`
            : `<p>E + 偏差值 = ${E} + ${f.bias} = <b>${E + f.bias}</b> → ${f.expBits} 位二進位：<span class="bs"><span class="e">${(E + f.bias).toString(2).padStart(f.expBits, '0')}</span></span></p>`));

          // ⑤ 尾數與捨入
          const fl = I.fields(f, bits);
          const finalFrac = fl.frac.toString(2).padStart(f.fracBits, '0');
          const dirMap = {
            exact: ['exact', '✨ 被捨去的部分全是 0 → <b>剛好放得下，沒有誤差</b>！'],
            down: ['lossy', '被捨去的部分 <b>小於</b>最後一位的一半 → <b>捨去</b>（直接截斷）'],
            up: ['lossy', '被捨去的部分 <b>大於</b>最後一位的一半 → <b>進位</b>（尾數 + 1）'],
            'tie-down': ['lossy', '被捨去的部分<b>剛好等於一半</b>！最後一位已經是偶數 0 → <b>捨去</b>（平手取偶數）'],
            'tie-up': ['lossy', '被捨去的部分<b>剛好等於一半</b>！最後一位是奇數 1 → <b>進位</b>讓它變偶數（平手取偶數）'],
          };
          const [cls, txt] = dirMap[info.roundDir];
          const carried = (!sub && fl.exp !== E + f.bias) || (sub && fl.exp !== 0);
          let rHTML = `<p>保留：<span class="bs"><span class="m">${kept}</span></span> ｜ 捨去：<span class="bs"><span class="x">${extra || '（無）'}</span></span></p>
            <p><span class="round-pill ${cls}">${cls === 'exact' ? '精確' : '有捨入誤差'}</span> ${txt}</p>`;
          if (info.overflow) rHTML += `<p>💥 進位之後超過最大值 → <b>溢位成 ∞</b>！</p>`;
          else if (carried) rHTML += `<p>🔄 進位一路傳上去，尾數變成全 0、<b>指數 +1</b>（變成 ${fl.exp}）。</p>`;
          if (!info.overflow) rHTML += `<p>最終尾數：<span class="bs"><span class="m">${finalFrac}</span></span></p>`;
          if (!info.overflow && fl.exp === 0 && fl.frac === 0n) rHTML += `<p>💤 結果<b>變成 0</b> 了——數字太小，連次正規數都裝不下（<b>下溢</b>）。</p>`;
          out.push(step('取尾數並捨入', rHTML));
        }

        // ⑥ 組合
        out.push(finalStep());

        // ⑦ 驗算
        const st = bitsToRat(f, bits);
        if (st) {
          const inN = sign ? -num : num;
          const diffN = st.n * den - inN * st.d;
          const diffD = st.d * den;
          const rel = diffN === 0n ? '0' : ratSci(diffN < 0n ? -diffN : diffN, num * st.d, 3);
          out.push(step('驗算：實際存了什麼？', `
            <p>輸入：<span class="exact-box">${esc(raw)}</span></p>
            <p>實際儲存的精確值：${exactHTML(I.exactDecimalOfBits(f, bits), 90)}</p>
            <p>誤差（儲存值 − 輸入）：<b>${ratSci(diffN, diffD)}</b>　相對誤差：<b>${rel}</b></p>
            ${compareTable(raw, p)}`));
        }
      }
      host.innerHTML = out.join('');
      const fv = $('.bv-final', host);
      if (fv) BitView(fv, f, { readOnly: true }).set(bits);
    }

    function compareTable(raw, p) {
      const rows = FMTS.map((f) => {
        const b = I.encodeString(f, raw).bits;
        const st = bitsToRat(f, b);
        let err = '—';
        if (st) {
          const inN = p.sign ? -p.num : p.num;
          err = ratSci(st.n * p.den - inN * st.d, st.d * p.den, 3);
        } else err = '溢位';
        return `<tr><td><span class="tag t-${f.key}">${f.name}</span></td><td class="mono">${I.toHex(f, b)}</td><td class="mono">${prettyShort(f, b)}</td><td class="mono">${err}</td></tr>`;
      }).join('');
      return `<p class="small" style="margin-top:12px"><b>三種精度比一比：</b></p><div class="table-wrap"><table class="data-table compact"><thead><tr><th>格式</th><th>十六進位</th><th>儲存的值</th><th>誤差</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }

    makeTabs($('#enc-tabs'), FMT_TABS, 'single', (k) => { fmt = F[k]; render(); });
    makeChips($('#enc-chips'), ['-6.625', '0.1', '13.25', '0.15625', '1.0009765625', '0.333333', '65504', '65520', '100000', '0.00001', '1e-8', '0', 'inf', 'nan']
      .map((v) => ({ label: v, value: v })), (it) => { input.value = it.value; render(); });
    input.addEventListener('input', render);
    render();
  }

  /* =====================================================
   * 第 5 章：位元遊樂場
   * ===================================================== */
  const playground = {};
  function initPlayground() {
    let fmt = F.single;
    const hex = $('#play-hex'), dec = $('#play-dec');
    const view = BitView($('#play-bits'), fmt, { onChange: () => update(false) });
    const tabs = makeTabs($('#play-tabs'), FMT_TABS, 'single', (k) => setFormat(F[k]));

    const done = new Set(store.get('tasks', []));
    const TASKS = [
      { id: 'one', label: '做出數字 1', test: (f, b) => I.toNumber(f, b) === 1 },
      { id: 'threeq', label: '做出 0.75', test: (f, b) => I.toNumber(f, b) === 0.75 },
      { id: 'negzero', label: '做出 −0（負零）', test: (f, b) => Object.is(I.toNumber(f, b), -0) },
      { id: 'inf', label: '做出 +∞', test: (f, b) => I.toNumber(f, b) === Infinity },
      { id: 'nan', label: '做出一個 NaN', test: (f, b) => I.classify(f, b) === 'nan' },
      { id: 'minsub', label: '做出最小的正次正規數', test: (f, b) => b === 1n },
      { id: 'max', label: '做出最大的有限數', test: (f, b) => I.classify(f, b) === 'normal' && I.fields(f, b).sign === 0 && I.classify(f, b + 1n) === 'inf' },
    ];
    function renderTasks() {
      $('#play-tasks').innerHTML = TASKS.map((t) => `<li class="${done.has(t.id) ? 'done' : ''}">${t.label}</li>`).join('');
    }

    function setFormat(f, bits) {
      fmt = f;
      tabs.select(f.key);
      view.setFormat(f, bits !== undefined ? bits : I.encodeString(f, '1').bits);
      makePresets();
      update(true);
    }

    function update(fromCode) {
      const b = view.get();
      if (document.activeElement !== hex) hex.value = I.toHex(fmt, b);
      $('#play-explain').innerHTML = explainHTML(fmt, b);
      let newly = false;
      for (const t of TASKS) if (!done.has(t.id) && t.test(fmt, b)) { done.add(t.id); newly = true; }
      if (newly) { store.set('tasks', [...done]); if (!fromCode) confetti(20); }
      renderTasks();
    }
    function setBits(b) { view.set(b); update(false); }

    function makePresets() {
      const f = fmt, fb = BigInt(f.fracBits);
      const signBit = 1n << BigInt(f.bits - 1);
      const list = [
        ['1', I.encodeString(f, '1').bits], ['−2', I.encodeString(f, '-2').bits], ['0.1', I.encodeString(f, '0.1').bits],
        ['π', I.encodeNumber(f, Math.PI)], ['最大值', (BigInt(I.maxExpField(f)) << fb) - 1n], ['最小正規化數', 1n << fb],
        ['最小次正規數', 1n], ['+0', 0n], ['−0', signBit], ['+∞', BigInt(I.maxExpField(f)) << fb],
        ['NaN', (BigInt(I.maxExpField(f)) << fb) | (1n << (fb - 1n))],
      ];
      makeChips($('#play-presets'), list.map(([label, b]) => ({ label, b })), (it) => setBits(it.b));
    }

    hex.addEventListener('input', () => {
      const b = I.fromHex(fmt, hex.value);
      if (b !== null && hex.value.replace(/^0x/i, '').length === fmt.bits / 4) setBits(b);
    });
    hex.addEventListener('blur', () => { hex.value = I.toHex(fmt, view.get()); });
    dec.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyDec(); });
    dec.addEventListener('change', applyDec);
    function applyDec() {
      const r = I.encodeString(fmt, dec.value);
      if (r) setBits(r.bits);
    }

    $$('#w-play [data-act]').forEach((btn) => btn.addEventListener('click', () => {
      const b = view.get();
      const v = I.toNumber(fmt, b);
      const signBit = 1n << BigInt(fmt.bits - 1);
      switch (btn.dataset.act) {
        case 'up': setBits(I.nextUp(fmt, b)); break;
        case 'down': setBits(I.nextDown(fmt, b)); break;
        case 'mul': setBits(I.encodeNumber(fmt, v * 2)); break;
        case 'div': setBits(I.encodeNumber(fmt, v / 2)); break;
        case 'neg': setBits(b ^ signBit); break;
        case 'clear': setBits(0n); break;
        case 'rand': {
          if (Math.random() < 0.7) {
            const e = BigInt(fmt.bias + rand(-8, 8));
            const s = BigInt(rand(0, 1));
            setBits((s << BigInt(fmt.bits - 1)) | (e << BigInt(fmt.fracBits)) | randomBigBits(fmt.fracBits));
          } else setBits(randomBigBits(fmt.bits));
          break;
        }
      }
    }));

    playground.load = (f, b) => { setFormat(f, b); $('#w-play').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    playground.fmt = () => fmt;
    makePresets();
    renderTasks();
    setFormat(F.single, I.encodeString(F.single, '13.25').bits);
  }

  /* =====================================================
   * 第 6 章：特殊值
   * ===================================================== */
  function initZoo() {
    const rows = [
      ['零', '全 0', '全 0', '±0', (f) => 0n],
      ['次正規數', '全 0', '不是 0', '±<b>0</b>.F × 2<sup>1−bias</sup>', (f) => 1n],
      ['正規化數', '不是全 0 也不是全 1', '任意', '±<b>1</b>.F × 2<sup>E−bias</sup>', (f) => I.encodeString(f, '1').bits],
      ['無限大', '全 1', '全 0', '±∞', (f) => BigInt(I.maxExpField(f)) << BigInt(f.fracBits)],
      ['NaN', '全 1', '不是 0', 'NaN', (f) => (BigInt(I.maxExpField(f)) << BigInt(f.fracBits)) | (1n << BigInt(f.fracBits - 1))],
    ];
    $('#zoo-body').innerHTML = rows.map((r, i) => `<tr><td><b>${r[0]}</b></td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td><td><button class="btn small" type="button" data-zoo="${i}">在遊樂場查看</button></td></tr>`).join('');
    $$('[data-zoo]').forEach((b) => b.addEventListener('click', () => {
      const f = playground.fmt();
      playground.load(f, rows[+b.dataset.zoo][4](f));
    }));

    // 溜滑梯
    let fmt = F.half;
    let bits;
    let timer = null;
    let count = 0;
    const view = BitView($('#slide-bits'), fmt, { readOnly: true });
    const log = $('#slide-log'), status = $('#slide-status');
    function reset() {
      stop();
      bits = I.encodeString(fmt, '1').bits;
      count = 0;
      view.setFormat(fmt, bits);
      log.innerHTML = '';
      addLog(null);
      renderStatus();
    }
    function sigBits() {
      const k = I.classify(fmt, bits);
      if (k === 'normal') return fmt.fracBits + 1;
      if (k === 'subnormal') return I.fields(fmt, bits).frac.toString(2).length;
      return 0;
    }
    function renderStatus() {
      const k = I.classify(fmt, bits);
      const sb = sigBits();
      const msg = {
        normal: `🟢 正規化數，有效位元 <b>${sb}</b> 位`,
        subnormal: `🐜 次正規數！隱藏位元變 0，有效位元只剩 <b>${sb}</b> 位`,
        zero: `💤 變成 0 了（下溢）`,
        inf: `💥 溢位成 ∞ 了！`,
        nan: 'NaN',
      }[k];
      status.innerHTML = `目前是 1 ${count >= 0 ? '÷' : '×'} 2${sup(Math.abs(count))}，值 = <b>${prettyShort(fmt, bits)}</b>　${msg}`;
    }
    function addLog(evt) {
      const d = document.createElement('div');
      if (evt) { d.className = 'ev'; d.textContent = evt; }
      else d.innerHTML = `<span style="display:inline-block;min-width:4.5em">${count >= 0 ? '÷2' + sup(count) : '×2' + sup(-count)}</span>${bitsHTML(fmt, bits, '')}  ${prettyShort(fmt, bits)}`;
      log.appendChild(d);
      while (log.childElementCount > 600) log.firstChild.remove();
      log.scrollTop = log.scrollHeight;
    }
    function apply(dir) {
      const k0 = I.classify(fmt, bits);
      if ((dir < 0 && k0 === 'zero') || (dir > 0 && k0 === 'inf')) { stop(); return false; }
      const v = I.toNumber(fmt, bits);
      bits = I.encodeNumber(fmt, dir < 0 ? v / 2 : v * 2);
      count += dir < 0 ? 1 : -1;
      const k1 = I.classify(fmt, bits);
      if (k1 !== k0) {
        const ev = { subnormal: k0 === 'normal' ? '🐜 進入次正規區！從這裡開始，精度一位一位流失……' : null, zero: '💤 變成 0 了！這叫做「下溢」(underflow)', inf: '💥 衝破最大值，溢位成 ∞！', normal: k0 === 'subnormal' ? '🟢 回到正規化數區' : null }[k1];
        if (ev) addLog(ev);
      }
      addLog(null);
      return true;
    }
    function stepUI(dir) { apply(dir); view.set(bits); renderStatus(); }
    function stop() {
      if (timer) clearInterval(timer);
      timer = null;
      $('#slide-auto-down').textContent = '⏬ 自動滑到底';
      $('#slide-auto-up').textContent = '⏫ 自動飛到頂';
    }
    function auto(dir, btn, label) {
      if (timer) { stop(); return; }
      btn.textContent = '⏸ 暫停';
      const per = { half: 1, single: 2, double: 8 }[fmt.key];
      timer = setInterval(() => {
        for (let i = 0; i < per; i++) if (!apply(dir)) break;
        view.set(bits); renderStatus();
        const k = I.classify(fmt, bits);
        if ((dir < 0 && k === 'zero') || (dir > 0 && k === 'inf')) stop();
      }, 70);
    }
    makeTabs($('#slide-tabs'), FMT_TABS, 'half', (k) => { fmt = F[k]; reset(); });
    $('#slide-div').addEventListener('click', () => { stop(); stepUI(-1); });
    $('#slide-mul').addEventListener('click', () => { stop(); stepUI(1); });
    $('#slide-auto-down').addEventListener('click', (e) => auto(-1, e.currentTarget));
    $('#slide-auto-up').addEventListener('click', (e) => auto(1, e.currentTarget));
    $('#slide-reset').addEventListener('click', reset);
    reset();

    // 實驗台
    const show = (v) => (typeof v === 'boolean' ? String(v) : Object.is(v, -0) ? '-0' : String(v));
    const LAB = [
      ['0.1 + 0.2', () => 0.1 + 0.2, '0.1 和 0.2 都無法精確儲存，誤差加起來就露餡了'],
      ['0.1 + 0.2 === 0.3', () => 0.1 + 0.2 === 0.3, '兩邊的捨入誤差不一樣，所以不相等'],
      ['1 / 0', () => 1 / 0, '正數除以 0 → +∞（不是錯誤！）'],
      ['-1 / 0', () => -1 / 0, '負數除以 0 → −∞'],
      ['1 / -0', () => 1 / -0, '除以負零 → −∞，這是 −0 存在的意義之一'],
      ['0 / 0', () => 0 / 0, '沒有意義的運算 → NaN'],
      ['Infinity - Infinity', () => Infinity - Infinity, '∞ − ∞ 無法定義 → NaN'],
      ['Math.sqrt(-1)', () => Math.sqrt(-1), '實數中沒有負數的平方根 → NaN'],
      ['NaN === NaN', () => { const n = NaN; return n === n; }, 'NaN 不等於任何東西，包括自己！'],
      ['0 === -0', () => 0 === -0, '比較時 +0 和 −0 視為相等'],
      ['Object.is(0, -0)', () => Object.is(0, -0), 'Object.is 會區分位元不同的 +0 與 −0'],
      ['2**53 + 1', () => 2 ** 53 + 1, '超過 2^53 後，相鄰數的間距是 2，奇數存不下'],
      ['1e308 * 10', () => 1e308 * 10, '超過雙精度最大值 ≈ 1.8e308 → 溢位成 ∞'],
      ['5e-324 / 2', () => 5e-324 / 2, '最小次正規數再除以 2 → 平手取偶數 → 0'],
      ['0.1 * 3', () => 0.1 * 3, '和 0.1 + 0.2 一樣的問題'],
      ['9007199254740993', () => 9007199254740993, '2^53 + 1 根本存不進去，被捨入成 2^53'],
    ];
    const grid = $('#lab-grid');
    grid.innerHTML = LAB.map(([e], i) => `<button type="button" class="lab-item" data-lab="${i}"><code>${esc(e)}</code><span class="res">？ 點我揭曉</span><span class="why"></span></button>`).join('');
    $$('[data-lab]', grid).forEach((b) => b.addEventListener('click', () => {
      const [, fn, why] = LAB[+b.dataset.lab];
      b.classList.add('revealed');
      $('.res', b).textContent = '→ ' + show(fn());
      $('.why', b).textContent = why;
    }));
  }

  /* =====================================================
   * 第 7 章
   * ===================================================== */
  function initRounding() {
    let fmt = F.half;
    const base = $('#round-base'), t = $('#round-t');
    function render() {
      const enc = I.encodeString(fmt, base.value.replace(/^-/, ''));
      const host = $('#round-line'), out = $('#round-out');
      if (!enc || ['inf', 'nan'].includes(I.classify(fmt, enc.bits))) { host.innerHTML = ''; out.innerHTML = '請輸入一個此格式範圍內的正數。'; return; }
      let lo = enc.bits;
      let hi = I.nextUp(fmt, lo);
      if (I.classify(fmt, hi) === 'inf') { hi = lo; lo = I.nextDown(fmt, hi); }
      const dl = I.decodeExact(fmt, lo), dh = I.decodeExact(fmt, hi);
      const P = Math.min(dl.pow, dh.pow);
      const L = dl.sig << BigInt(dl.pow - P), H = dh.sig << BigInt(dh.pow - P);
      const tv = BigInt(t.value);
      let num = L * 1000n + (H - L) * tv;
      let den = 1000n;
      if (P >= 0) num <<= BigInt(P); else den <<= BigInt(-P);
      const r = I.encodeRational(fmt, 0, num, den);
      const chosen = r.bits;
      const tie = t.value === '500';
      const lsb = (b) => Number(I.fields(fmt, b).frac & 1n);
      const W = 800, Hh = 120, x0 = 70, x1 = 730, y = 60;
      const xp = x0 + (x1 - x0) * (+t.value / 1000);
      const cx = chosen === lo ? x0 : x1;
      const lab = (b) => prettyShort(fmt, b);
      host.innerHTML = `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="捨入示意圖">
        <line x1="${x0}" x2="${x1}" y1="${y}" y2="${y}" stroke="var(--axis)" stroke-width="2"/>
        <line x1="${(x0 + x1) / 2}" x2="${(x0 + x1) / 2}" y1="${y - 18}" y2="${y + 18}" stroke="var(--muted)" stroke-width="1"/>
        <text x="${(x0 + x1) / 2}" y="${y + 34}" text-anchor="middle" font-size="12" fill="var(--muted)">正中間</text>
        <path d="M ${xp} ${y - 8} Q ${(xp + cx) / 2} ${y - 50} ${cx} ${y - 12}" fill="none" stroke="var(--accent)" stroke-width="2"/>
        <circle cx="${x0}" cy="${y}" r="${chosen === lo ? 9 : 6}" fill="var(--c-half)" stroke="var(--surface)" stroke-width="2"/>
        <circle cx="${x1}" cy="${y}" r="${chosen === hi ? 9 : 6}" fill="var(--c-single)" stroke="var(--surface)" stroke-width="2"/>
        <path d="M ${xp - 7} ${y + 16} L ${xp + 7} ${y + 16} L ${xp} ${y + 4} Z" fill="var(--ink)"/>
        <text x="${x0}" y="${y + 36}" text-anchor="middle" font-size="13" font-weight="700" fill="var(--ink)">${svgText(lab(lo))}</text>
        <text x="${x0}" y="${y + 52}" text-anchor="middle" font-size="11" fill="var(--ink-2)">尾數末位 ${lsb(lo)}${lsb(lo) ? '（奇）' : '（偶）'}</text>
        <text x="${x1}" y="${y + 36}" text-anchor="middle" font-size="13" font-weight="700" fill="var(--ink)">${svgText(lab(hi))}</text>
        <text x="${x1}" y="${y + 52}" text-anchor="middle" font-size="11" fill="var(--ink-2)">尾數末位 ${lsb(hi)}${lsb(hi) ? '（奇）' : '（偶）'}</text>
      </svg>`;
      const pct = (+t.value / 10).toFixed(1);
      const xApprox = ratToDec(num, den, 12);
      let why;
      if (tie) why = `⚖️ <b>剛好在正中間！</b>平手 → 選尾數最後一位是 <b>0（偶數）</b>的 <b>${lab(chosen)}</b>`;
      else if (+t.value < 500) why = `離左邊比較近 → 捨入到 <b>${lab(chosen)}</b>`;
      else why = `離右邊比較近 → 捨入到 <b>${lab(chosen)}</b>`;
      out.innerHTML = `<div class="row"><span>你的數 x</span><span class="mono">${xApprox}</span></div>
        <div class="row"><span>位置</span><span>從左邊走了 ${pct}% 的間距（間距 = 1 ULP = ${ratToDec((H - L) * (P >= 0 ? 1n << BigInt(P) : 1n), P >= 0 ? 1n : 1n << BigInt(-P), 12)}）</span></div>
        <div class="row"><span>結果</span><span>${why}</span></div>
        <div class="row"><span></span><span class="small muted">小技巧：把滑桿拖到正中間（50%），看看平手時誰贏。換個數字（例如 2049），結果可能相反喔！</span></div>`;
    }
    makeTabs($('#round-tabs'), FMT_TABS, 'half', (k) => { fmt = F[k]; render(); });
    base.addEventListener('input', render);
    t.addEventListener('input', render);
    render();
  }

  function initCalc() {
    const a = $('#calc-a'), b = $('#calc-b'), op = $('#calc-op'), out = $('#calc-out');
    const OPS = { '+': (x, y) => x + y, '-': (x, y) => x - y, '*': (x, y) => x * y, '/': (x, y) => x / y };
    const ROUND = { half: Math.f16round ? Math.f16round : (x) => I.roundTo(F.half, x), single: Math.fround, double: (x) => x };
    const OPSYM = { '+': '+', '-': '−', '*': '×', '/': '÷' };

    function truth(pa, pb, o) {
      if (!pa || !pb || pa.special || pb.special) return null;
      const an = pa.sign ? -pa.num : pa.num, bn = pb.sign ? -pb.num : pb.num;
      if (o === '+') return { n: an * pb.den + bn * pa.den, d: pa.den * pb.den };
      if (o === '-') return { n: an * pb.den - bn * pa.den, d: pa.den * pb.den };
      if (o === '*') return { n: an * bn, d: pa.den * pb.den };
      if (bn === 0n) return null;
      return { n: an * pb.den, d: pa.den * bn };
    }

    function render() {
      const o = op.value;
      const pa = I.parseDecimal(a.value), pb = I.parseDecimal(b.value);
      if (!pa || !pb) { out.innerHTML = '<p>請輸入兩個數字。</p>'; return; }
      const T = truth(pa, pb, o);
      const cards = FMTS.map((f) => {
        const A = I.encodeString(f, a.value).bits, B = I.encodeString(f, b.value).bits;
        const va = I.toNumber(f, A), vb = I.toNumber(f, B);
        const rv = ROUND[f.key](OPS[o](va, vb));
        const R = I.encodeNumber(f, rv);
        const kind = I.classify(f, R);
        let verdict;
        if (kind === 'inf') verdict = '💥 溢位成 ∞';
        else if (kind === 'nan') verdict = '👻 NaN';
        else if (!T) verdict = '';
        else {
          const st = bitsToRat(f, R);
          const diffN = st.n * T.d - T.n * st.d;
          verdict = diffN === 0n ? '✅ 和真實答案完全一樣' : `⚠️ 誤差 ${ratSci(diffN, st.d * T.d, 3)}`;
        }
        const note = (name, str, bits) => {
          const e = I.encodeString(f, str);
          if (!e.info.roundDir || e.info.roundDir === 'exact') return '';
          const r = bitsToRat(f, bits);
          return `${name} 實際存成 ${r ? ratToDec(r.n, r.d, 12) : prettyShort(f, bits)}<br>`;
        };
        const aNote = note('a', a.value, A), bNote = note('b', b.value, B);
        return `<div class="calc-card fc-${f.key}">
          <div><span class="tag t-${f.key}">${f.name}</span></div>
          <div class="res">${prettyShort(f, R)}</div>
          <div class="sub">${I.toHex(f, R)}</div>
          <div class="sub">${aNote}${bNote}</div>
          <div class="verdict">${verdict}</div>
        </div>`;
      }).join('');
      const truthTxt = T ? `<span class="mono">${ratToDec(T.n, T.d, 30)}</span>` : '<span class="muted">（含特殊值，略）</span>';
      out.innerHTML = `<div class="calc-results">${cards}</div>
        <div class="calc-truth">📐 數學上的真實答案：${esc(a.value)} ${OPSYM[o]} ${esc(b.value)} = ${truthTxt}</div>
        <p class="small muted">每種格式都是：先把 a、b 各自捨入成該格式 → 計算 → 結果再捨入一次。</p>`;
    }
    const presets = [
      ['0.1 + 0.2', '0.1', '+', '0.2'], ['2048 + 1', '2048', '+', '1'], ['16777216 + 1', '16777216', '+', '1'],
      ['2^53 + 1', '9007199254740992', '+', '1'], ['1 ÷ 3', '1', '/', '3'], ['300 × 300', '300', '*', '300'],
      ['1 − 0.9', '1', '-', '0.9'], ['1e16 + 1', '1e16', '+', '1'], ['0.5 + 0.25', '0.5', '+', '0.25'],
    ];
    makeChips($('#calc-chips'), presets.map(([label, x, o, y]) => ({ label, x, o, y })), (it) => { a.value = it.x; op.value = it.o; b.value = it.y; render(); });
    [a, b, op].forEach((e) => e.addEventListener('input', render));
    render();
  }

  function initUlp() {
    const chart = $('#ulp-chart');
    const X0 = -30, X1 = 70, Y0 = -90, Y1 = 50;
    const W = 760, H = 340, m = { l: 52, r: 96, t: 18, b: 44 };
    const X = (e) => m.l + ((e - X0) / (X1 - X0)) * (W - m.l - m.r);
    const Y = (u) => H - m.b - ((u - Y0) / (Y1 - Y0)) * (H - m.t - m.b);
    const ulpLog = (f, e) => (e > f.bias ? null : Math.max(e, 1 - f.bias) - f.fracBits);
    const LABEL = { half: '半精度', single: '單精度', double: '雙精度' };

    $('#ulp-legend').innerHTML = FMTS.map((f) => `<span><span class="key" style="background:var(--c-${f.key})"></span>${LABEL[f.key]}</span>`).join('');

    let marker = null;
    function render() {
      let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="三種格式的 ULP 間距隨數值大小變化的階梯圖">`;
      s += '<g class="grid">';
      for (let u = -80; u <= 40; u += 20) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(u)}" y2="${Y(u)}"/>`;
      s += '</g><g class="ticks">';
      for (let u = -80; u <= 40; u += 20) s += `<text x="${m.l - 8}" y="${Y(u) + 4}" text-anchor="end">${svgText(pow2(u))}</text>`;
      for (let e = X0; e <= X1; e += 10) s += `<text x="${X(e)}" y="${H - m.b + 18}" text-anchor="middle">${svgText(pow2(e))}</text>`;
      s += `<text x="${(m.l + W - m.r) / 2}" y="${H - 6}" text-anchor="middle">數值大小 x（對數刻度）</text>`;
      s += `<text transform="translate(12 ${(m.t + H - m.b) / 2}) rotate(-90)" text-anchor="middle">ULP 間距（對數刻度）</text>`;
      s += `</g><line class="axis" x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}" stroke="var(--axis)"/>`;
      if (marker !== null && marker >= X0 && marker <= X1) {
        s += `<line x1="${X(marker)}" x2="${X(marker)}" y1="${m.t}" y2="${H - m.b}" stroke="var(--accent)" stroke-width="1.5"/>`;
        s += `<text x="${X(marker) + 4}" y="${m.t + 10}" class="dlabel">你的數字</text>`;
      }
      for (const f of FMTS) {
        let d = '', last = null, endE = X1;
        for (let e = X0; e < X1; e++) {
          const u = ulpLog(f, e);
          if (u === null) { endE = e; break; }
          if (last === null) d += `M ${X(e)} ${Y(u)} `;
          else if (u !== last) d += `V ${Y(u)} `;
          d += `H ${X(e + 1)} `;
          last = u;
        }
        s += `<path d="${d}" fill="none" stroke="var(--c-${f.key})" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
        const ex = X(endE), ey = Y(last);
        s += `<circle cx="${ex}" cy="${ey}" r="4" fill="var(--c-${f.key})" stroke="var(--surface)" stroke-width="2"/>`;
        s += endE < X1
          ? `<text class="dlabel" x="${ex - 4}" y="${ey - 12}" text-anchor="end">${LABEL[f.key]}（再往右就溢位 ∞）</text>`
          : `<text class="dlabel" x="${ex + 8}" y="${ey + 4}">${LABEL[f.key]}</text>`;
      }
      s += `<line class="crosshair" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/>`;
      s += `<rect class="hit" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent"/>`;
      s += '</svg>';
      chart.innerHTML = s;
      const svg = $('svg', chart), hit = $('.hit', chart), ch = $('.crosshair', chart);
      hit.addEventListener('pointermove', (ev) => {
        const r = svg.getBoundingClientRect();
        const px = ((ev.clientX - r.left) / r.width) * W;
        const e = Math.max(X0, Math.min(X1 - 1, Math.floor(X0 + ((px - m.l) / (W - m.l - m.r)) * (X1 - X0))));
        const cx = X(e + 0.5);
        ch.setAttribute('x1', cx); ch.setAttribute('x2', cx); ch.setAttribute('visibility', 'visible');
        const rows = FMTS.map((f) => {
          const u = ulpLog(f, e);
          const v = u === null ? '溢位 ∞' : `${pow2(u)} ≈ ${pretty(Math.pow(2, u).toPrecision(3))}`;
          return `<div class="tt-row"><span class="key" style="background:var(--c-${f.key})"></span><b>${v}</b><span>${LABEL[f.key]}</span></div>`;
        }).join('');
        showTip(`<div class="tt-h">x 介於 ${pow2(e)} ～ ${pow2(e + 1)}（≈ ${pretty(Math.pow(2, e).toPrecision(3))}）</div>${rows}`, ev.clientX, ev.clientY);
      });
      hit.addEventListener('pointerleave', () => { ch.setAttribute('visibility', 'hidden'); hideTip(); });
    }

    const input = $('#ulp-input');
    function renderTable() {
      const p = I.parseDecimal(input.value.replace(/^-/, ''));
      const tbl = $('#ulp-table');
      if (!p || p.special || p.num === 0n) { tbl.innerHTML = '<tr><td>請輸入一個不為 0 的有限數字。</td></tr>'; marker = null; render(); return; }
      const v = Number(input.value.replace(/^-/, ''));
      marker = Math.log2(v);
      render();
      const rows = FMTS.map((f) => {
        const b = I.encodeString(f, input.value.replace(/^-/, '')).bits;
        const k = I.classify(f, b);
        if (k === 'inf') return `<tr><td><span class="tag t-${f.key}">${f.name}</span></td><td colspan="4">超出範圍 → ∞</td></tr>`;
        if (k === 'zero') return `<tr><td><span class="tag t-${f.key}">${f.name}</span></td><td colspan="4">太小 → 0</td></tr>`;
        const up = I.nextUp(f, b), dn = I.nextDown(f, b);
        const upRat = bitsToRat(f, up), bRat = bitsToRat(f, b);
        let gap = '∞';
        let rel = '—';
        if (upRat) {
          const gn = upRat.n * bRat.d - bRat.n * upRat.d, gd = upRat.d * bRat.d;
          gap = ratToDec(gn, gd, 8);
          rel = ratSci(gn * bRat.d, gd * bRat.n, 3);
        }
        return `<tr><td><span class="tag t-${f.key}">${f.name}</span></td><td class="mono">${prettyShort(f, dn)}</td><td class="mono"><b>${prettyShort(f, b)}</b></td><td class="mono">${prettyShort(f, up)}</td><td class="mono">${gap}</td><td class="mono">${rel}</td></tr>`;
      }).join('');
      tbl.innerHTML = `<thead><tr><th>格式</th><th>上一個數</th><th>存成</th><th>下一個數</th><th>間距 ULP</th><th>相對間距</th></tr></thead><tbody>${rows}</tbody>`;
    }
    input.addEventListener('input', renderTable);
    renderTable();
  }

  function initAccumulator() {
    const slider = $('#acc-n'), outN = $('#acc-n-out'), out = $('#acc-out');
    const MAXN = 100000;
    const ROUND = { half: Math.f16round ? Math.f16round : (x) => I.roundTo(F.half, x), single: Math.fround, double: (x) => x };
    const data = {};
    for (const f of FMTS) {
      const r = ROUND[f.key];
      const tenth = r(0.1);
      const arr = new Float64Array(MAXN + 1);
      let s = 0, stuck = -1;
      for (let i = 1; i <= MAXN; i++) {
        const ns = r(s + tenth);
        if (ns === s && stuck < 0) stuck = i;
        s = ns; arr[i] = s;
      }
      data[f.key] = { arr, stuck, tenth };
    }
    function render() {
      const N = Math.round(Math.pow(10, +slider.value));
      outN.textContent = N.toLocaleString();
      const exact = N / 10;
      out.innerHTML = `<div class="acc-grid">${FMTS.map((f) => {
        const d = data[f.key];
        const v = d.arr[N];
        const err = v - exact;
        const relPct = (Math.abs(err) / exact) * 100;
        const vStr = pretty(f.key === 'double' ? String(v) : shortest(f, I.encodeNumber(f, v)));
        const stuckMsg = d.stuck > 0 && N >= d.stuck
          ? `<div class="verdict">🛑 從第 ${d.stuck.toLocaleString()} 次起<b>卡住了</b>！總和到 ${pretty(d.arr[d.stuck])} 時，相鄰數間距已經大到 0.1 被捨入掉，加了等於沒加。</div>`
          : '';
        return `<div class="calc-card fc-${f.key}">
          <div><span class="tag t-${f.key}">${f.name}</span></div>
          <div class="res">${vStr}</div>
          <div class="sub">正確答案 ${exact.toLocaleString()}</div>
          <div class="sub">誤差 ${pretty(err.toPrecision(3))}（${relPct < 1e-9 ? '≈ 0' : relPct.toPrecision(2)}%）</div>
          ${stuckMsg}
        </div>`;
      }).join('')}</div>
      <p class="small muted">提示：0.1 存進半精度其實是 ${I.exactDecimalOfBits(F.half, I.encodeString(F.half, '0.1').bits)}，單精度是 ${I.exactDecimalOfBits(F.single, I.encodeString(F.single, '0.1').bits)}。把 N 拉到 2300 以上，看看半精度發生什麼事！</p>`;
    }
    slider.addEventListener('input', render);
    render();
  }

  /* =====================================================
   * 第 8 章：闖關
   * ===================================================== */
  function initQuiz() {
    let score = 0, streak = 0, best = store.get('best', 0);
    let current = null, answered = false;
    const LEVELS = [[0, '🥚 新手'], [50, '🐣 見習生'], [120, '🐥 學徒'], [250, '🦅 高手'], [450, '🐉 浮點大師']];

    function updateScore(bump) {
      $('#q-score').textContent = score;
      $('#q-streak').textContent = streak + (streak >= 3 ? ' 🔥' : '');
      if (score > best) { best = score; store.set('best', best); }
      $('#q-best').textContent = best;
      $('#q-level').textContent = LEVELS.filter(([s]) => score >= s).pop()[1];
      if (bump) { const el = $('#q-score'); el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
    }
    function addScore(n) { score += n; updateScore(true); }

    const niceHalf = () => {
      const sign = rand(0, 1), E = rand(-3, 5), top = rand(0, 7);
      const frac = BigInt(top) << 7n;
      return I.compose(F.half, sign, E + 15, frac);
    };

    const GEN = {
      decode() {
        const b = niceHalf();
        const v = I.toNumber(F.half, b);
        const { sign, exp, frac } = I.fields(F.half, b);
        const E = exp - 15;
        const m = 1 + Number(frac) / 1024;
        const cands = [v, -v, v * 2, v / 2, (sign ? -1 : 1) * m * Math.pow(2, exp), (sign ? -1 : 1) * (m - 1) * Math.pow(2, E)];
        const opts = [...new Set(cands.filter((x) => x !== 0 && Number.isFinite(x)).map(String))];
        const choices = shuffle([String(v), ...shuffle(opts.filter((x) => x !== String(v))).slice(0, 3)]);
        return {
          type: '解碼題・半精度',
          html: `<p>這個<b>半精度</b>數字代表多少？</p><p style="font-size:1.3em;text-align:center">${bitsHTML(F.half, b)}</p>`,
          choices: choices.map(pretty), answer: choices.indexOf(String(v)),
          explain: `S = ${sign}，指數欄位 ${exp} − 15 = ${E}，尾數 1.${I.toBinString(F.half, b).slice(6).replace(/0+$/, '') || '0'}₂ = ${m} → ${sign ? '−' : ''}${m} × ${pow2(E)} = <b>${pretty(v)}</b>`,
        };
      },
      exponent() {
        const f = pick([F.half, F.single]);
        const E = rand(-6, 10), k = rand(0, 7), sign = rand(0, 1);
        const v = (sign ? -1 : 1) * (1 + k / 8) * Math.pow(2, E);
        const ans = E + f.bias;
        const opts = [...new Set([ans, E, ans + 1, ans - 1, E + f.bias + 1 + 1])];
        const choices = shuffle([ans, ...shuffle(opts.filter((x) => x !== ans)).slice(0, 3)]);
        return {
          type: `指數題・${f.name}`,
          html: `<p>把 <b>${pretty(v)}</b> 存成<b>${f.name}</b>時，指數欄位存的值（十進位）是多少？</p>`,
          choices: choices.map(String), answer: choices.indexOf(ans),
          explain: `${pretty(Math.abs(v))} = ${1 + k / 8} × ${pow2(E)}，實際指數 E = ${E}，加上偏差值 ${f.bias} → <b>${ans}</b>（二進位 ${ans.toString(2).padStart(f.expBits, '0')}）`,
        };
      },
      classify() {
        const f = pick([F.half, F.single]);
        const kinds = ['normal', 'subnormal', 'zero', 'inf', 'nan'];
        const k = pick(kinds);
        const fb = BigInt(f.fracBits), maxE = BigInt(I.maxExpField(f));
        let fracR = randomBigBits(f.fracBits); if (fracR === 0n) fracR = 1n;
        const sign = BigInt(rand(0, 1)) << BigInt(f.bits - 1);
        const b = sign | {
          normal: (BigInt(rand(1, Number(maxE) - 1)) << fb) | randomBigBits(f.fracBits),
          subnormal: fracR, zero: 0n, inf: maxE << fb, nan: (maxE << fb) | fracR,
        }[k];
        const names = kinds.map((x) => KIND_NAME[x]);
        return {
          type: `分類題・${f.name}`,
          html: `<p>這個<b>${f.name}</b>位元組合屬於哪一種？</p><p style="text-align:center;font-size:${f.bits > 16 ? 1 : 1.3}em">${bitsHTML(f, b)}</p>`,
          choices: names, answer: kinds.indexOf(k),
          explain: '看指數欄位：全 0 → 零或次正規數（看尾數是否為 0）；全 1 → ∞ 或 NaN（看尾數是否為 0）；其他 → 正規化數。這題答案是 <b>' + KIND_NAME[k] + '</b>。',
        };
      },
      hex() {
        const b = niceHalf();
        const v = I.toNumber(F.half, b);
        const ans = I.toHex(F.half, b);
        const alts = [b ^ 0x8000n, b + 0x0400n, b - 0x0400n, b ^ 0x0200n, b ^ 0x0100n].map((x) => I.toHex(F.half, x & 0xFFFFn));
        const choices = shuffle([ans, ...shuffle([...new Set(alts)].filter((x) => x !== ans)).slice(0, 3)]);
        return {
          type: '編碼題・半精度',
          html: `<p><b>${pretty(v)}</b> 的<b>半精度</b>十六進位表示是？</p>`,
          choices, answer: choices.indexOf(ans),
          explain: `${pretty(v)} → ${bitsHTML(F.half, b)} → 每 4 位一組轉十六進位 = <b>${ans}</b>`,
        };
      },
      concept() {
        const Q = [
          ['單精度的偏差值 (bias) 是？', ['127', '128', '255', '1023'], 0, '2<sup>8−1</sup> − 1 = 127'],
          ['雙精度的「尾數欄位」有幾個位元？', ['52', '53', '23', '64'], 0, '欄位存 52 位，加上隱藏位元才是 53 位精度'],
          ['半精度能表示的最大有限值是？', ['65504', '65535', '32768', '131008'], 0, '(2 − 2<sup>−10</sup>) × 2<sup>15</sup> = 65504'],
          ['在 IEEE 754 中，NaN == NaN 的結果是？', ['false', 'true', '看 NaN 的位元', '程式會當掉'], 0, 'NaN 與任何值比較都不相等，包括它自己'],
          ['下列哪個數能被二進位浮點數「精確」表示？', ['0.375', '0.1', '0.2', '0.3'], 0, '0.375 = 0.011₂（= ¼ + ⅛），分母是 2 的次方才能精確表示'],
          ['隱藏位元 (hidden bit) 的好處是？', ['不佔空間卻多 1 位精度', '用來表示正負號', '用來標記 NaN', '讓指數可以是負的'], 0, '正規化後首位必為 1，所以不用存'],
          ['1.0 / −0.0 的結果是？', ['−∞', '+∞', 'NaN', '0'], 0, '除以負零得到負無限大'],
          ['指數全 1、尾數全 0 代表？', ['±∞', 'NaN', '±0', '最大值'], 0, '指數全 1 保留給 ∞（尾數 0）與 NaN（尾數非 0）'],
          ['IEEE 754 預設的捨入模式是？', ['最接近，平手取偶數', '無條件捨去', '四捨五入（.5 一律進位）', '無條件進位'], 0, 'round half to even，避免統計偏差'],
          ['在半精度中計算 2048 + 1，結果是？', ['2048', '2049', '2050', '∞'], 0, '2048～4096 之間的間距是 2，2049 剛好在中間 → 取偶數 2048'],
          ['單精度大約有幾位十進位有效數字？', ['約 7 位', '約 3 位', '約 16 位', '23 位'], 0, '24 × log<sub>10</sub>2 ≈ 7.22'],
          ['單精度次正規數的實際指數是？', ['−126', '−127', '0', '−149'], 0, '固定為 1 − bias = 1 − 127 = −126（不是 −127！）'],
          ['為什麼數字越大，浮點數越不精確？', ['每層尾數格子數固定，層越高格子越寬', '因為指數位元不夠', '因為符號位會干擾', '其實大小數一樣精確'], 0, '每個 [2<sup>E</sup>, 2<sup>E+1</sup>) 都只分成 2<sup>F</sup> 格'],
          ['JavaScript 的 Number.MAX_SAFE_INTEGER 是？', ['2<sup>53</sup> − 1', '2<sup>63</sup> − 1', '2<sup>32</sup> − 1', '2<sup>52</sup> − 1'], 0, '雙精度有 53 位精度'],
          ['單精度 0 01111111 000…0 代表？', ['1', '0', '127', '2'], 0, '指數 127 − 127 = 0，1.0 × 2<sup>0</sup> = 1'],
          ['把一個很小的正數一直除以 2，最後會變成？', ['0（先經過次正規數）', '負數', 'NaN', '最小正規化數後停住'], 0, '漸進式下溢：正規化 → 次正規 → 0'],
          ['bfloat16 與半精度的差別是？', ['bfloat16 指數 8 位、尾數 7 位', 'bfloat16 是 32 位元', '兩者完全一樣', 'bfloat16 沒有符號位'], 0, 'bfloat16 = 1/8/7，範圍同單精度但精度較低'],
        ];
        const [q, opts, ans, why] = pick(Q);
        const order = shuffle(opts.map((_, i) => i));
        return { type: '觀念題', html: `<p>${q}</p>`, choices: order.map((i) => opts[i]), answer: order.indexOf(ans), explain: why };
      },
    };
    const TYPES = ['decode', 'decode', 'exponent', 'classify', 'hex', 'concept', 'concept', 'concept'];

    function next() {
      current = GEN[pick(TYPES)]();
      answered = false;
      $('#q-type').textContent = current.type;
      $('#q-body').innerHTML = current.html;
      $('#q-feedback').innerHTML = '';
      const host = $('#q-choices');
      host.innerHTML = '';
      current.choices.forEach((c, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'choice';
        b.innerHTML = `<b>${'ABCDE'[i]}.</b> ${c}`;
        b.addEventListener('click', () => answer(i, b));
        host.appendChild(b);
      });
    }
    function answer(i, btn) {
      if (answered) return;
      answered = true;
      const btns = $$('#q-choices .choice');
      btns.forEach((b) => (b.disabled = true));
      btns[current.answer].classList.add('correct');
      if (i === current.answer) {
        streak++;
        addScore(10 + Math.min(streak - 1, 5) * 2);
        $('#q-feedback').innerHTML = `<span class="good">✅ 答對了！${streak >= 3 ? `連續 ${streak} 題 🔥` : ''}</span><br>${current.explain}`;
        confetti(streak % 5 === 0 ? 60 : 14);
      } else {
        streak = 0;
        updateScore(false);
        btn.classList.add('wrong');
        $('#q-feedback').innerHTML = `<span class="bad">❌ 差一點！</span><br>${current.explain}`;
      }
    }
    $('#q-next').addEventListener('click', next);

    // 造數挑戰
    let target = 0n, hints = 0;
    const view = BitView($('#build-bits'), F.half, { onChange: renderNow });
    function renderNow() {
      const b = view.get();
      $('#build-now').innerHTML = `你目前拼出的是：<b>${prettyShort(F.half, b)}</b>`;
    }
    function newTarget() {
      target = niceHalf();
      hints = 0;
      $('#build-target').innerHTML = prettyShort(F.half, target);
      $('#build-feedback').innerHTML = '';
      view.set(0n);
      renderNow();
    }
    $('#build-check').addEventListener('click', () => {
      if (view.get() === target) {
        addScore(Math.max(5, 20 - hints * 5));
        $('#build-feedback').innerHTML = `<span class="good">🎉 完全正確！+${Math.max(5, 20 - hints * 5)} 分</span> 再來一題吧！`;
        confetti(50);
      } else {
        const v = I.toNumber(F.half, view.get()), t = I.toNumber(F.half, target);
        $('#build-feedback').innerHTML = `<span class="bad">還不對喔！</span> 你的數${v > t ? '太大' : '太小'}了。`;
      }
    });
    $('#build-hint').addEventListener('click', () => {
      const { sign, exp, frac } = I.fields(F.half, target);
      hints++;
      const h = [
        `符號位應該是 <b>${sign}</b>（${sign ? '負數' : '正數'}）。`,
        `${pretty(Math.abs(I.toNumber(F.half, target)))} = 1.xxx × ${pow2(exp - 15)}，所以指數欄位 = ${exp - 15} + 15 = <b>${exp}</b> = <span class="bs"><span class="e">${exp.toString(2).padStart(5, '0')}</span></span>。`,
        `尾數應該是 <span class="bs"><span class="m">${frac.toString(2).padStart(10, '0')}</span></span>。`,
      ];
      $('#build-feedback').innerHTML = '💡 ' + h.slice(0, Math.min(hints, 3)).join('<br>💡 ');
    });
    $('#build-new').addEventListener('click', newTarget);

    updateScore(false);
    next();
    newTarget();
  }

  /* =====================================================
   * 導覽、進度、主題
   * ===================================================== */
  function initNav() {
    const chapters = $$('.chapter');
    const links = $$('.topnav a');
    const visited = new Set(store.get('visited', []));
    const NAMES = ['為什麼', '構造', '迷你玩具', '編碼', '解碼', '特殊值', '精度', '闖關', '小抄'];
    function renderProgress() {
      links.forEach((a) => a.classList.toggle('done', visited.has(a.getAttribute('href').slice(1))));
      $('#progress-list').innerHTML = chapters.map((c, i) => `<span class="${visited.has(c.id) ? 'done' : ''}">${visited.has(c.id) ? '✓ ' : ''}${i + 1} ${NAMES[i]}</span>`).join('');
    }
    // 只水平捲動導覽列本身；不用 scrollIntoView，因為它會連帶接管整頁捲動，打斷手機的慣性滑動
    const nav = $('.topnav');
    function centerNavLink(a) {
      const nr = nav.getBoundingClientRect(), ar = a.getBoundingClientRect();
      if (ar.left >= nr.left && ar.right <= nr.right) return;
      nav.scrollLeft += ar.left - nr.left - (nr.width - ar.width) / 2;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) {
          links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + en.target.id));
          const act = links.find((a) => a.classList.contains('active'));
          if (act) centerNavLink(act);
          if (!visited.has(en.target.id)) { visited.add(en.target.id); store.set('visited', [...visited]); renderProgress(); }
        }
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    chapters.forEach((c) => io.observe(c));
    renderProgress();

    const bar = $('#read-progress');
    const onScroll = () => {
      const h = document.documentElement;
      bar.style.width = (h.scrollTop / Math.max(1, h.scrollHeight - h.clientHeight)) * 100 + '%';
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    $('#theme-toggle').addEventListener('click', () => {
      const root = document.documentElement;
      const cur = root.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      const nxt = cur === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', nxt);
      try { localStorage.setItem('ieee754-theme', nxt); } catch (e) { /* 忽略 */ }
    });
  }

  /* 啟動（各元件互相獨立，一個壞掉不影響其他） */
  [initHero, initFloatPoint, initSci, initAnatomy, initMini, initEncoder, initPlayground, initZoo,
    initRounding, initCalc, initUlp, initAccumulator, initQuiz, initNav].forEach((fn) => {
    try { fn(); } catch (err) { console.error(fn.name, err); }
  });
})();

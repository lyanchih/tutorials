'use strict';

/* 共用工具：畫布、亂數、格式化、控制項、測驗與學習進度 */
const App = (() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  // ---- 重繪（視窗大小改變、切換主題時） ----
  const redrawers = [];
  const onRedraw = fn => redrawers.push(fn);
  const redrawAll = () => redrawers.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(redrawAll, 150);
  });

  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const rgb = c => `rgb(${c[0]},${c[1]},${c[2]})`;

  // 發散色階：v ∈ [-1, 1]，負值偏紅、正值偏藍
  function divergingScale() {
    const neg = hexToRgb(css('--neg')), pos = hexToRgb(css('--pos')), mid = hexToRgb(css('--neutral'));
    return v => {
      const t = Math.max(-1, Math.min(1, v));
      return t < 0 ? mix(mid, neg, -t) : mix(mid, pos, t);
    };
  }

  function setupCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.font = '12px system-ui, sans-serif';
    return { ctx, w, h };
  }

  // ---- 可重現的亂數 ----
  function rng(seed = 1) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(rand) {
    let u = 0;
    while (u === 0) u = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  }

  // ---- 格式化 ----
  const SUP = { '-': '⁻', '+': '', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  function fmt(x, digits = 4) {
    if (Number.isNaN(x)) return 'NaN';
    if (!Number.isFinite(x)) return x > 0 ? '+∞' : '−∞';
    if (x === 0) return '0';
    const a = Math.abs(x);
    if (a >= 1e6 || a < 1e-3) {
      const [m, e] = x.toExponential(Math.max(0, digits - 1)).split('e');
      return `${parseFloat(m)}×10${e.split('').map(c => SUP[c]).join('')}`;
    }
    return String(parseFloat(x.toPrecision(digits)));
  }
  function fmtBytes(b) {
    if (b >= 1e12) return (b / 1e12).toFixed(2) + ' TB';
    if (b >= 1e9) return (b / 1e9).toFixed(b >= 1e11 ? 0 : 1) + ' GB';
    if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB';
    if (b >= 1e3) return (b / 1e3).toFixed(1) + ' KB';
    return Math.round(b) + ' B';
  }
  const fmtInt = n => Math.round(n).toLocaleString('en-US');
  const pct = (x, d = 1) => (x * 100).toFixed(d) + '%';

  // ---- 控制項 ----
  // 綁定滑桿：回傳目前值的 getter；format 決定 <output> 顯示
  function range(id, onChange, format = v => v) {
    const input = document.getElementById(id);
    const out = document.querySelector(`output[for="${id}"]`);
    const update = () => {
      if (out) out.textContent = format(+input.value);
      onChange(+input.value);
    };
    input.addEventListener('input', update);
    if (out) out.textContent = format(+input.value);
    return { get: () => +input.value, set: v => { input.value = v; update(); }, el: input };
  }

  // 分段按鈕：容器內的 <button data-value>
  function seg(id, onChange) {
    const box = document.getElementById(id);
    const buttons = $$('button', box);
    let value = (buttons.find(b => b.classList.contains('active')) || buttons[0]).dataset.value;
    const select = v => {
      value = v;
      buttons.forEach(b => b.classList.toggle('active', b.dataset.value === v));
    };
    select(value);
    buttons.forEach(b => b.addEventListener('click', () => { select(b.dataset.value); onChange(value); }));
    return { get: () => value, set: v => { select(v); onChange(v); } };
  }

  // 元素接近畫面時才初始化（避免一開頁就做重運算）
  function whenVisible(el, fn) {
    if (!('IntersectionObserver' in window)) { fn(); return; }
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { io.disconnect(); fn(); }
    }, { rootMargin: '300px' });
    io.observe(el);
  }

  // ---- 學習進度 ----
  const STORE = 'model-compression-tutorial-progress';
  let progress = {};
  try { progress = JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { progress = {}; }
  const saveProgress = () => { try { localStorage.setItem(STORE, JSON.stringify(progress)); } catch (e) { /* 私密模式 */ } };

  function renderProgress() {
    const links = $$('.nav a');
    let done = 0;
    links.forEach(a => {
      const id = a.getAttribute('href').slice(1);
      const ok = !!progress[id];
      a.classList.toggle('done', ok);
      if (ok) done++;
    });
    $('#progressBar').style.width = pct(done / links.length, 0);
    $('#progressText').textContent = `${done} / ${links.length}`;
  }

  // ---- 測驗 ----
  function initQuizzes() {
    $$('.quiz').forEach(quiz => {
      const sectionId = quiz.closest('section').id;
      const qs = $$('.q', quiz);
      const score = document.createElement('span');
      score.className = 'score';
      $('.quiz-title', quiz).appendChild(score);
      const correctSet = new Set();
      const updateScore = () => {
        score.textContent = `答對 ${correctSet.size} / ${qs.length}`;
        if (correctSet.size === qs.length && !progress[sectionId]) {
          progress[sectionId] = true;
          saveProgress();
          renderProgress();
        }
      };
      qs.forEach((q, qi) => {
        const answer = +q.dataset.answer;
        const opts = $$('.opts li', q);
        const retry = document.createElement('button');
        retry.className = 'btn small retry';
        retry.textContent = '再試一次';
        retry.hidden = true;
        q.appendChild(retry);
        opts.forEach((li, i) => {
          li.tabIndex = 0;
          li.setAttribute('role', 'button');
          const choose = () => {
            if (q.classList.contains('answered')) return;
            q.classList.add('answered');
            if (i === answer) {
              li.classList.add('correct');
              correctSet.add(qi);
            } else {
              li.classList.add('wrong');
              opts[answer].classList.add('correct');
              retry.hidden = false;
            }
            updateScore();
          };
          li.addEventListener('click', choose);
          li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } });
        });
        retry.addEventListener('click', () => {
          q.classList.remove('answered');
          opts.forEach(li => li.classList.remove('correct', 'wrong'));
          retry.hidden = true;
        });
      });
      updateScore();
    });
  }

  // ---- 導覽列 ----
  function initNav() {
    const links = $$('.nav a');
    const sections = links.map(a => document.getElementById(a.getAttribute('href').slice(1)));
    const setActive = () => {
      const y = window.scrollY + window.innerHeight * 0.3;
      let idx = 0;
      sections.forEach((s, i) => { if (s.offsetTop <= y) idx = i; });
      links.forEach((a, i) => a.classList.toggle('active', i === idx));
    };
    window.addEventListener('scroll', setActive, { passive: true });
    setActive();

    const sidebar = $('.sidebar');
    $('.menu-btn').addEventListener('click', () => sidebar.classList.toggle('open'));
    links.forEach(a => a.addEventListener('click', () => sidebar.classList.remove('open')));

    $('#resetProgress').addEventListener('click', () => {
      if (!confirm('確定要清除測驗進度嗎？')) return;
      progress = {};
      saveProgress();
      location.reload();
    });
  }

  // ---- 主題 ----
  function initTheme() {
    const KEY = 'model-compression-tutorial-theme';
    let theme;
    try { theme = localStorage.getItem(KEY); } catch (e) { theme = null; }
    if (!theme) theme = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    const apply = t => {
      document.documentElement.dataset.theme = t;
      $('#themeToggle').textContent = t === 'dark' ? '☀️ 亮色' : '🌙 暗色';
    };
    apply(theme);
    $('#themeToggle').addEventListener('click', () => {
      theme = theme === 'dark' ? 'light' : 'dark';
      apply(theme);
      try { localStorage.setItem(KEY, theme); } catch (e) { /* 忽略 */ }
      redrawAll();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initNav();
    initQuizzes();
    renderProgress();
  });

  return {
    $, $$, css, hexToRgb, mix, rgb, divergingScale, setupCanvas, rng, gauss,
    fmt, fmtBytes, fmtInt, pct, range, seg, whenVisible, onRedraw, redrawAll,
  };
})();

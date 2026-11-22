'use strict';

/* 共用工具：畫布、亂數、格式化、控制項、序列圖、Hex、測驗與學習進度 */
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
  function shuffle(arr, rand = Math.random) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ---- 格式化 ----
  function fmtBytes(b) {
    if (b >= 1024 ** 3) return (b / 1024 ** 3).toFixed(2) + ' GiB';
    if (b >= 1024 ** 2) return (b / 1024 ** 2).toFixed(1) + ' MiB';
    if (b >= 1024) return (b / 1024).toFixed(1) + ' KiB';
    return Math.round(b) + ' B';
  }
  function fmtTime(sec) {
    if (!Number.isFinite(sec)) return '∞';
    if (sec >= 86400) return (sec / 86400).toFixed(1) + ' 天';
    if (sec >= 3600) return (sec / 3600).toFixed(1) + ' 小時';
    if (sec >= 60) return (sec / 60).toFixed(1) + ' 分';
    return sec.toFixed(1) + ' 秒';
  }
  const fmtInt = n => Math.round(n).toLocaleString('en-US');
  const pct = (x, d = 1) => (x * 100).toFixed(d) + '%';
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---- 位元組工具 ----
  const toHex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  function fromHex(hex) {
    const clean = hex.replace(/[^0-9a-f]/gi, '');
    const out = new Uint8Array(clean.length >> 1);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
    return out;
  }
  const utf8 = new TextEncoder();
  const utf8d = new TextDecoder();
  function concatBytes(parts) {
    const len = parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(len);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  // 32 位元大端序整數
  const u32 = n => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
  const u16 = n => new Uint8Array([(n >>> 8) & 255, n & 255]);

  // Hex dump：fields = [{ bytes, label, color }]；hover 時顯示欄位說明
  function renderHex(box, legendBox, hoverBox, fields) {
    box.innerHTML = '';
    let offset = 0;
    fields.forEach(f => {
      [...f.bytes].forEach((b, i) => {
        const span = document.createElement('span');
        span.className = 'b';
        span.textContent = b.toString(16).padStart(2, '0');
        span.style.background = f.color;
        span.style.color = '#fff';
        const off = offset + i;
        span.addEventListener('mouseenter', () => {
          const ch = b >= 32 && b < 127 ? ` '${String.fromCharCode(b)}'` : '';
          hoverBox.textContent = `位移 ${off}：0x${span.textContent} = ${b}${ch} → ${f.label}`;
        });
        box.appendChild(span);
      });
      offset += f.bytes.length;
    });
    if (legendBox) {
      legendBox.innerHTML = fields.map(f => `<span><i style="background:${f.color}"></i>${esc(f.label)}（${f.bytes.length} B）</span>`).join('');
    }
    return offset;
  }
  const PALETTE = ['#4b63e6', '#e8743b', '#17a37a', '#b04fc4', '#c99a06', '#d34a4a', '#2a8fb8', '#7a6a58', '#5a9e3a', '#c2477a'];

  // ---- 序列圖（SVG） ----
  // actors: [名稱]；msgs: [{ from, to, label, cls?, note? }]；cur：目前步驟索引（之後的淡化）
  function seqDiagram(box, actors, msgs, cur = msgs.length - 1) {
    const W = Math.max(560, box.clientWidth || 700);
    const colW = W / actors.length;
    const rowH = 30, top = 52;
    const H = top + msgs.length * rowH + 20;
    const x = i => colW * i + colW / 2;
    let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;
    s += `<defs><marker id="arr-${box.id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/></marker></defs>`;
    actors.forEach((a, i) => {
      const bw = Math.min(colW - 16, 150);
      s += `<g class="actor"><rect x="${x(i) - bw / 2}" y="8" width="${bw}" height="30" rx="8"/><text x="${x(i)}" y="28" text-anchor="middle">${esc(a)}</text></g>`;
      s += `<line class="life" x1="${x(i)}" y1="38" x2="${x(i)}" y2="${H - 6}"/>`;
    });
    msgs.forEach((m, i) => {
      const y = top + i * rowH + 12;
      const state = i === cur ? ' cur' : i > cur ? ' future' : '';
      if (m.note) {
        const xi = x(m.from), bw = Math.min(W - 20, Math.max(200, m.label.length * 12));
        const left = Math.max(8, Math.min(W - bw - 8, xi - bw / 2));
        s += `<g class="note${state}"><rect x="${left}" y="${y - 10}" width="${bw}" height="22" rx="6"/><text x="${left + bw / 2}" y="${y + 5}" text-anchor="middle">${esc(m.label)}</text></g>`;
        return;
      }
      const x1 = x(m.from), x2 = x(m.to);
      const dir = x2 > x1 ? 1 : -1;
      s += `<g class="msg${state} ${m.cls || ''}">`;
      s += `<line x1="${x1 + dir * 3}" y1="${y + 8}" x2="${x2 - dir * 3}" y2="${y + 8}" marker-end="url(#arr-${box.id})"${m.dashed ? ' stroke-dasharray="5 4"' : ''}/>`;
      s += `<text x="${(x1 + x2) / 2}" y="${y + 2}" text-anchor="middle">${esc(m.label)}</text></g>`;
    });
    s += '</svg>';
    box.innerHTML = s;
  }

  // ---- 控制項 ----
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

  function whenVisible(el, fn) {
    if (!('IntersectionObserver' in window)) { fn(); return; }
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { io.disconnect(); fn(); }
    }, { rootMargin: '300px' });
    io.observe(el);
  }

  function download(name, data, mime = 'application/octet-stream') {
    const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: mime }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ---- 跨章節共享狀態（例如第 7 章算出的 infohash 給第 8 章用） ----
  const shared = {};
  const listeners = {};
  function share(key, value) { shared[key] = value; (listeners[key] || []).forEach(fn => fn(value)); }
  function onShare(key, fn) { (listeners[key] = listeners[key] || []).push(fn); if (key in shared) fn(shared[key]); }

  // ---- 學習進度 ----
  const STORE = 'p2p-tutorial-progress';
  let progress = {};
  try { progress = JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { progress = {}; }
  const saveProgress = () => { try { localStorage.setItem(STORE, JSON.stringify(progress)); } catch (e) { /* 私密模式 */ } };

  function renderProgress() {
    const links = $$('.nav a');
    let done = 0;
    links.forEach(a => {
      const ok = !!progress[a.getAttribute('href').slice(1)];
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
    const KEY = 'p2p-tutorial-theme';
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
    $, $$, css, setupCanvas, rng, shuffle, fmtBytes, fmtTime, fmtInt, pct, esc,
    toHex, fromHex, utf8, utf8d, concatBytes, u32, u16, renderHex, PALETTE, seqDiagram,
    range, seg, whenVisible, onRedraw, redrawAll, download, share, onShare,
  };
})();

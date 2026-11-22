'use strict';

/* 第 9 章：BitTorrent swarm 模擬（piece 選擇 × choking 演算法） */
(() => {
  const { $, css, setupCanvas, rng, shuffle } = App;

  const RECHOKE = 3, OPTIMISTIC = 9, SLOTS = 4, DOWN_CAP = 4;

  class Swarm {
    constructor({ n, m, free, pick, choke, seedLeave, stay, seed }) {
      this.rand = rng(seed);
      this.m = m; this.pick = pick; this.choke = choke; this.seedLeave = seedLeave; this.stay = stay;
      this.t = 0; this.stuck = false; this.idle = 0; this.finished = false;
      const nFree = Math.round(n * free);
      const freeIdx = new Set(shuffle([...Array(n).keys()], this.rand).slice(0, nFree));
      const caps = [1, 2, 2, 3, 4];
      this.peers = [{ id: 0, seed: true, cap: 4, free: false }];
      for (let i = 0; i < n; i++) {
        const free = freeIdx.has(i);
        this.peers.push({ id: i + 1, seed: false, free, cap: free ? 0 : caps[Math.floor(this.rand() * caps.length)] });
      }
      const P = this.peers.length;
      this.peers.forEach(p => {
        p.have = new Uint8Array(m); p.count = 0; p.gone = false; p.doneAt = null;
        p.recv = new Float64Array(P); p.unchoked = []; p.optimistic = -1; p.uploaded = 0; p.fresh = new Set();
      });
      const s = this.peers[0];
      s.have.fill(1); s.count = m; s.doneAt = 0;
      this.avail = new Int32Array(m).fill(1);
    }
    present(p) { return !p.gone; }
    wants(u, v) {
      // v 想要 u 的東西嗎？
      if (v.count >= this.m) return false;
      for (let i = 0; i < this.m; i++) if (u.have[i] && !v.have[i]) return true;
      return false;
    }
    leave(p) {
      if (p.gone) return;
      p.gone = true;
      for (let i = 0; i < this.m; i++) if (p.have[i]) this.avail[i]--;
    }
    rechoke() {
      const opt = this.t % OPTIMISTIC === 0;
      this.peers.forEach(u => {
        if (u.gone || u.cap === 0) { u.unchoked = []; return; }
        const cands = this.peers.filter(v => v !== u && !v.gone && this.wants(u, v));
        if (this.choke === 'rand' || u.seed || u.count >= this.m) {
          // 隨機分配；種子（含下載完留下來的人）也用輪替的方式
          u.unchoked = shuffle(cands, this.rand).slice(0, SLOTS);
          return;
        }
        // tit-for-tat：依「最近從對方收到多少」排序取前 3 名
        const ranked = shuffle(cands.slice(), this.rand).sort((a, b) => u.recv[b.id] - u.recv[a.id]);
        const regular = ranked.slice(0, SLOTS - 1);
        if (opt || !cands.includes(this.peers[u.optimistic]) || regular.includes(this.peers[u.optimistic])) {
          const rest = cands.filter(v => !regular.includes(v));
          u.optimistic = rest.length ? rest[Math.floor(this.rand() * rest.length)].id : -1;
        }
        u.unchoked = u.optimistic >= 0 ? [...regular, this.peers[u.optimistic]] : regular;
      });
      this.peers.forEach(p => { for (let i = 0; i < p.recv.length; i++) p.recv[i] *= 0.5; });
    }
    choosePiece(u, v) {
      const opts = [];
      for (let i = 0; i < this.m; i++) if (u.have[i] && !v.have[i] && !v.pending.has(i)) opts.push(i);
      if (!opts.length) return -1;
      if (this.pick === 'seq') return opts[0];
      if (this.pick === 'random' || (v.count === 0 && v.pending.size === 0)) return opts[Math.floor(this.rand() * opts.length)];
      let best = Infinity, list = [];
      // 稀有度 = 已有副本 + 本回合正在傳的份數（避免大家同時搶同一個最稀有的 piece）
      opts.forEach(i => {
        const a = this.avail[i] + this.inflight[i];
        if (a < best) { best = a; list = [i]; } else if (a === best) list.push(i);
      });
      return list[Math.floor(this.rand() * list.length)];
    }
    step() {
      if (this.finished || this.stuck) return;
      if (this.t % RECHOKE === 0) this.rechoke();
      this.peers.forEach(p => { p.pending = new Set(); p.fresh = new Set(); p.downThisTick = 0; });
      this.inflight = new Int32Array(this.m);
      const transfers = [];
      shuffle(this.peers.slice(), this.rand).forEach(u => {
        if (u.gone || !u.cap) return;
        let budget = u.cap, progress = true;
        const list = u.unchoked.filter(v => !v.gone);
        while (budget > 0 && progress) {
          progress = false;
          for (const v of list) {
            if (budget <= 0) break;
            if (v.downThisTick >= DOWN_CAP) continue;
            const p = this.choosePiece(u, v);
            if (p < 0) continue;
            v.pending.add(p); v.downThisTick++; this.inflight[p]++;
            transfers.push([u, v, p]);
            budget--; progress = true;
          }
        }
      });
      transfers.forEach(([u, v, p]) => {
        if (v.have[p]) return;
        v.have[p] = 1; v.count++; this.avail[p]++; v.fresh.add(p);
        v.recv[u.id] += 1; u.uploaded++;
      });
      this.t++;
      this.peers.forEach(v => {
        if (!v.seed && v.doneAt === null && v.count === this.m) {
          v.doneAt = this.t;
          if (!this.stay) this.leave(v);
        }
      });
      const s = this.peers[0];
      if (this.seedLeave && !s.gone && s.uploaded >= 1.5 * this.m) this.leave(s);
      const leechers = this.peers.filter(p => !p.seed);
      if (leechers.every(p => p.doneAt !== null)) { this.finished = true; return; }
      if (!transfers.length) {
        if (++this.idle >= 8) this.stuck = true;
      } else this.idle = 0;
    }
    stats() {
      const leech = this.peers.filter(p => !p.seed);
      const avg = arr => (arr.length ? arr.reduce((s, p) => s + p.doneAt, 0) / arr.length : NaN);
      const normal = leech.filter(p => !p.free), free = leech.filter(p => p.free);
      // 「拿得到」的副本：只算還在、而且會上傳的 peer
      const usable = new Int32Array(this.m);
      this.peers.forEach(p => { if (!p.gone && p.cap > 0) for (let i = 0; i < this.m; i++) usable[i] += p.have[i]; });
      const presentAvail = Math.min(...usable);
      return {
        done: leech.filter(p => p.doneAt !== null).length, total: leech.length,
        avgNormal: avg(normal.filter(p => p.doneAt !== null)), avgFree: avg(free.filter(p => p.doneAt !== null)),
        normalDone: normal.every(p => p.doneAt !== null), freeDone: free.every(p => p.doneAt !== null), nFree: free.length,
        minAvail: presentAvail,
      };
    }
  }

  // ---- 介面 ----
  let sim, playing = false, timer = null, seedCounter = 1;
  const opts = () => ({
    n: +$('#swN').value, m: +$('#swM').value, free: +$('#swFree').value,
    pick: pickSeg.get(), choke: chokeSeg.get(), seedLeave: $('#swSeedLeave').checked, stay: $('#swStay').checked,
  });

  function reset() {
    stop();
    sim = new Swarm({ ...opts(), seed: seedCounter });
    draw(); metrics();
  }

  function metrics() {
    const s = sim.stats();
    const status = sim.finished ? '<span class="tag good">全部完成</span>' : sim.stuck ? '<span class="tag bad">卡住了：某些 piece 只剩已離開或不上傳的人有</span>' : '<span class="tag warn">進行中</span>';
    const f = x => (Number.isFinite(x) ? x.toFixed(1) : '—');
    $('#swMetrics').innerHTML = `
      <div class="metric"><div class="k">回合</div><div class="v">${sim.t}</div></div>
      <div class="metric"><div class="k">完成的下載者</div><div class="v">${s.done} / ${s.total}</div></div>
      <div class="metric good"><div class="k">一般下載者平均完成</div><div class="v">${f(s.avgNormal)}</div><div class="s">回合</div></div>
      <div class="metric warn"><div class="k">🆓 搭便車者平均完成</div><div class="v">${s.nFree ? f(s.avgFree) : '—'}</div><div class="s">${s.nFree} 人</div></div>
      <div class="metric ${s.minAvail === 0 ? 'bad' : ''}"><div class="k">最稀有 piece 可取得副本數</div><div class="v">${s.minAvail}</div></div>
      <div class="metric"><div class="k">狀態</div><div class="v" style="font-size:.9rem">${status}</div></div>`;
  }

  function draw() {
    if (!sim) return;
    const P = sim.peers.length, M = sim.m;
    const labelW = 118, availH = 70, gap = 12;
    $('#swCanvas').style.height = Math.round(P * 14 + availH + gap + 14) + 'px';
    const { ctx, w, h } = setupCanvas($('#swCanvas'));
    const cw = (w - labelW - 8) / M;
    const rh = Math.min(16, (h - availH - gap - 6) / P);
    const accent = css('--accent'), good = css('--good'), panel2 = css('--panel-2'), muted = css('--muted'), text = css('--text');
    ctx.font = `${Math.min(11, rh - 1)}px system-ui, sans-serif`;
    sim.peers.forEach((p, r) => {
      const y = 4 + r * rh;
      ctx.globalAlpha = p.gone ? 0.3 : 1;
      ctx.fillStyle = p.seed ? good : p.free ? css('--warn') : text;
      const tag = p.seed ? '🌱 原始種子' : `${p.free ? '🆓' : '　'} #${p.id}`;
      ctx.textAlign = 'left';
      ctx.fillText(`${tag} ↑${p.cap}${p.doneAt !== null && !p.seed ? ' ✓' + p.doneAt : ''}${p.gone ? ' 離開' : ''}`, 2, y + rh - 3);
      for (let i = 0; i < M; i++) {
        ctx.fillStyle = p.fresh && p.fresh.has(i) ? good : p.have[i] ? accent : panel2;
        ctx.fillRect(labelW + i * cw, y + 1, Math.max(1, cw - 1), rh - 2);
      }
    });
    ctx.globalAlpha = 1;
    // 副本數長條
    const y0 = 4 + P * rh + gap, maxA = P;
    ctx.fillStyle = muted; ctx.textAlign = 'left';
    ctx.fillText('副本數', 2, y0 + availH / 2);
    for (let i = 0; i < M; i++) {
      const a = sim.avail[i];
      const bh = (a / maxA) * availH;
      ctx.fillStyle = a === 0 ? css('--bad') : css('--c2');
      ctx.fillRect(labelW + i * cw, y0 + availH - Math.max(bh, a === 0 ? 3 : 0), Math.max(1, cw - 1), Math.max(bh, a === 0 ? 3 : 0));
    }
  }

  function loop() {
    const k = +$('#swSpeed').value;
    for (let i = 0; i < Math.max(1, k / 6); i++) sim.step();
    draw(); metrics();
    if (sim.finished || sim.stuck) { stop(); return; }
    timer = setTimeout(loop, Math.max(16, 300 / k));
  }
  function play() { if (playing) { stop(); return; } if (sim.finished || sim.stuck) reset(); playing = true; $('#swPlay').textContent = '⏸ 暫停'; loop(); }
  function stop() { playing = false; clearTimeout(timer); $('#swPlay').textContent = '▶ 播放'; }

  function batch() {
    const base = opts();
    const PICKS = [['rarest', 'Rarest first'], ['random', '隨機'], ['seq', '循序']];
    const CHOKES = [['tft', 'Tit-for-tat'], ['rand', '隨機分配']];
    const RUNS = 4;
    let rows = '';
    PICKS.forEach(([pk, pn]) => CHOKES.forEach(([ck, cn]) => {
      let tot = 0, stuck = 0, nAvg = 0, nCnt = 0, fAvg = 0, fCnt = 0;
      for (let r = 0; r < RUNS; r++) {
        const s = new Swarm({ ...base, pick: pk, choke: ck, seed: 1000 + r });
        while (!s.finished && !s.stuck && s.t < 4000) s.step();
        const st = s.stats();
        if (s.finished) tot += s.t; else stuck++;
        if (Number.isFinite(st.avgNormal)) { nAvg += st.avgNormal; nCnt++; }
        if (Number.isFinite(st.avgFree)) { fAvg += st.avgFree; fCnt++; }
      }
      const ok = RUNS - stuck;
      rows += `<tr class="${stuck ? 'bad' : ''}"><td>${pn}</td><td>${cn}</td>
        <td class="num">${ok ? (tot / ok).toFixed(0) : '—'}</td><td class="num">${stuck ? `${stuck} / ${RUNS}` : '0'}</td>
        <td class="num">${nCnt ? (nAvg / nCnt).toFixed(1) : '—'}</td><td class="num">${fCnt ? (fAvg / fCnt).toFixed(1) : '—'}</td></tr>`;
    }));
    $('#swBatchOut').innerHTML = `<h4>批次比較（目前的人數 / piece 數 / 情境，每種組合跑 ${RUNS} 次取平均）</h4>
      <div class="table-wrap"><table><tr><th>Piece 選擇</th><th>Choking</th><th class="num">全部完成回合</th><th class="num">卡住次數</th><th class="num">一般下載者平均完成</th><th class="num">🆓 搭便車者平均完成</th></tr>${rows}</table></div>
      <p class="small-note">「平均完成」只計算有完成的人。卡住代表原始種子離開後，某些 piece 只剩已離開或不上傳的 peer 擁有，其他人再也拿不到。</p>`;
  }

  App.range('swN', () => reset(), v => v + ' 人');
  App.range('swM', () => reset(), v => v + ' 個');
  App.range('swFree', () => reset(), v => Math.round(v * 100) + '%');
  App.range('swSpeed', () => {}, v => v + '×');
  const pickSeg = App.seg('swPick', () => reset());
  const chokeSeg = App.seg('swChoke', () => reset());
  $('#swSeedLeave').addEventListener('change', reset);
  $('#swStay').addEventListener('change', reset);
  $('#swPlay').addEventListener('click', play);
  $('#swStep').addEventListener('click', () => { stop(); if (!sim) reset(); sim.step(); draw(); metrics(); });
  $('#swReset').addEventListener('click', () => { seedCounter++; reset(); });
  $('#swBatch').addEventListener('click', () => { $('#swBatchOut').innerHTML = '<p class="small-note">計算中…</p>'; setTimeout(batch, 20); });
  reset();
  App.onRedraw(draw);
})();

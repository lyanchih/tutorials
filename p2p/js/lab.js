'use strict';

/* 第 6 章：迷你 PairDrop——BroadcastChannel 自動發現 + 手動信令，真實 WebRTC 聊天與傳檔 */
(() => {
  const { $, esc, fmtBytes } = App;
  const STUN = [{ urls: 'stun:stun.l.google.com:19302' }];

  // =====================================================================
  // 一條 P2P 連線：RTCPeerConnection + 一個 DataChannel，自訂訊息協定
  //   文字：{ t:'text', text }
  //   檔案：{ t:'file', name, size, mime }，接著是 ArrayBuffer chunks
  // =====================================================================
  class Link {
    constructor({ initiator, iceServers = [], signal = null, ui }) {
      this.ui = ui;
      this.signal = signal;
      this.initiator = initiator;
      this.pending = [];
      this.queue = Promise.resolve();
      this.pc = new RTCPeerConnection({ iceServers });
      this.pc.onicecandidate = e => { if (e.candidate && this.signal) this.signal({ ice: e.candidate.toJSON() }); };
      this.pc.onconnectionstatechange = () => ui.state(this.pc.connectionState);
      if (initiator) this.setupChannel(this.pc.createDataChannel('p2p', { ordered: true }));
      else this.pc.ondatachannel = e => this.setupChannel(e.channel);
    }
    get open() { return this.dc && this.dc.readyState === 'open'; }
    setupChannel(dc) {
      this.dc = dc;
      dc.binaryType = 'arraybuffer';
      dc.bufferedAmountLowThreshold = 256 * 1024;
      dc.onopen = () => this.ui.opened(this);
      dc.onclose = () => this.ui.state('closed');
      dc.onmessage = e => this.onMessage(e.data);
    }
    // RTCSessionDescription 不能被 postMessage 複製，轉成純物件
    get local() { const d = this.pc.localDescription; return { type: d.type, sdp: d.sdp }; }
    async makeOffer() {
      await this.pc.setLocalDescription(await this.pc.createOffer());
      return this.local;
    }
    async acceptOffer(desc) {
      await this.pc.setRemoteDescription(desc);
      await this.flush();
      await this.pc.setLocalDescription(await this.pc.createAnswer());
      return this.local;
    }
    async acceptAnswer(desc) {
      await this.pc.setRemoteDescription(desc);
      await this.flush();
    }
    async addIce(c) {
      if (!this.pc.remoteDescription) { this.pending.push(c); return; }
      await this.pc.addIceCandidate(c);
    }
    async flush() { for (const c of this.pending.splice(0)) await this.pc.addIceCandidate(c); }
    waitGathering(ms = 6000) {
      if (this.pc.iceGatheringState === 'complete') return Promise.resolve();
      return new Promise(res => {
        const t = setTimeout(res, ms);
        this.pc.addEventListener('icegatheringstatechange', () => {
          if (this.pc.iceGatheringState === 'complete') { clearTimeout(t); res(); }
        });
      });
    }
    sendText(text) { this.dc.send(JSON.stringify({ t: 'text', text })); }
    sendFile(file) {
      this.queue = this.queue.then(() => this._sendFile(file)).catch(e => this.ui.sys('傳送失敗：' + e.message));
    }
    async _sendFile(file) {
      const CHUNK = 16 * 1024, HIGH = 1024 * 1024;
      const dc = this.dc;
      dc.send(JSON.stringify({ t: 'file', name: file.name, size: file.size, mime: file.type }));
      const prog = this.ui.progress(`⬆ ${file.name}`, file.size);
      for (let off = 0; off < file.size; off += CHUNK) {
        if (dc.bufferedAmount > HIGH) await new Promise(res => dc.addEventListener('bufferedamountlow', res, { once: true }));
        dc.send(await file.slice(off, off + CHUNK).arrayBuffer());
        prog(Math.min(file.size, off + CHUNK));
      }
      prog(file.size);
    }
    onMessage(data) {
      if (typeof data === 'string') {
        const m = JSON.parse(data);
        if (m.t === 'text') this.ui.text(m.text, false);
        if (m.t === 'file') {
          this.rx = { ...m, parts: [], got: 0, prog: this.ui.progress(`⬇ ${m.name}`, m.size) };
          if (m.size === 0) this.finishRx();
        }
        return;
      }
      if (!this.rx) return;
      this.rx.parts.push(data);
      this.rx.got += data.byteLength;
      this.rx.prog(this.rx.got);
      if (this.rx.got >= this.rx.size) this.finishRx();
    }
    finishRx() {
      const { name, mime, parts } = this.rx;
      this.ui.file(name, new Blob(parts, { type: mime || 'application/octet-stream' }));
      this.rx = null;
    }
    close() { try { this.pc.close(); } catch (e) { /* 忽略 */ } }
  }

  // =====================================================================
  // 裝置卡片 UI
  // =====================================================================
  function peerCard(container, { avatar, name, onConnect }) {
    const el = document.createElement('div');
    el.className = 'peer-card';
    el.innerHTML = `<span class="avatar">${avatar}</span>
      <div><div class="pname">${esc(name)}</div><div class="pstate">未連線</div></div>
      <div class="btn-row">
        ${onConnect ? '<button class="btn small primary" data-act="connect">🔌 連線</button>' : ''}
        <label class="btn small">📎 傳檔<input type="file" multiple hidden></label>
      </div>
      <div style="flex-basis:100%">
        <div class="chat"><div class="sys">連線後可以聊天、傳檔，或把檔案拖到這張卡片上</div></div>
        <div class="btn-row" style="margin-top:6px"><input type="text" placeholder="輸入訊息，按 Enter 送出" style="flex:1"><button class="btn small" data-act="send">送出</button></div>
        <div class="xfers"></div>
      </div>`;
    container.appendChild(el);
    const chat = el.querySelector('.chat'), input = el.querySelector('input[type=text]');
    const stateEl = el.querySelector('.pstate'), xfers = el.querySelector('.xfers');
    let link = null;
    const add = (cls, html) => { chat.insertAdjacentHTML('beforeend', `<div class="${cls}">${html}</div>`); chat.scrollTop = 1e9; };
    const STATE = { new: '準備中', connecting: '🔄 ICE / DTLS 協商中…', connected: '🟢 已連線（P2P）', disconnected: '🟡 連線中斷', failed: '🔴 連線失敗（NAT 打不通？）', closed: '⚪ 已關閉' };
    const ui = {
      el,
      setLink(l) { link = l; },
      state(s) { stateEl.textContent = STATE[s] || s; },
      opened() { ui.state('connected'); add('sys', 'DataChannel 已開啟，接下來的訊息都不經過任何伺服器'); },
      sys(t) { add('sys', esc(t)); },
      text(t, mine) { add(mine ? 'me' : 'them', esc(t)); },
      progress(label, size) {
        const row = document.createElement('div');
        row.style.margin = '6px 0';
        row.innerHTML = `<div class="small-note">${esc(label)}（${fmtBytes(size)}）<span></span></div><div class="bar"><div></div></div>`;
        xfers.appendChild(row);
        const bar = row.querySelector('.bar > div'), pct = row.querySelector('span');
        const t0 = performance.now();
        return got => {
          bar.style.width = (size ? got / size * 100 : 100) + '%';
          const sec = (performance.now() - t0) / 1000;
          pct.textContent = `　${size ? Math.round(got / size * 100) : 100}%・${fmtBytes(got / Math.max(sec, 0.001))}/s`;
        };
      },
      file(name, blob) {
        const url = URL.createObjectURL(blob);
        const isImg = blob.type.startsWith('image/');
        add('them', `📄 <a href="${url}" download="${esc(name)}">${esc(name)}</a>（${fmtBytes(blob.size)}）${isImg ? `<br><img src="${url}" style="max-width:200px;border-radius:6px;margin-top:4px">` : ''}`);
      },
    };
    const sendText = () => {
      const t = input.value.trim();
      if (!t || !link || !link.open) return;
      link.sendText(t); ui.text(t, true); input.value = '';
    };
    const sendFiles = files => {
      if (!link || !link.open) { ui.sys('請先連線'); return; }
      [...files].forEach(f => link.sendFile(f));
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') sendText(); });
    el.querySelector('[data-act=send]').addEventListener('click', sendText);
    el.querySelector('input[type=file]').addEventListener('change', e => { sendFiles(e.target.files); e.target.value = ''; });
    if (onConnect) el.querySelector('[data-act=connect]').addEventListener('click', onConnect);
    el.addEventListener('dragover', e => { e.preventDefault(); el.style.outline = '2px dashed var(--accent)'; });
    el.addEventListener('dragleave', () => { el.style.outline = ''; });
    el.addEventListener('drop', e => { e.preventDefault(); el.style.outline = ''; sendFiles(e.dataTransfer.files); });
    return ui;
  }

  // =====================================================================
  // 實驗 6a：BroadcastChannel 當作信令伺服器
  // =====================================================================
  const ADJ = ['銀色', '靛藍', '琥珀', '翡翠', '珊瑚', '紫晶', '金色', '雪白', '赤紅', '墨黑'];
  const ANIMALS = [['🦊', '狐狸'], ['🦉', '貓頭鷹'], ['🐼', '熊貓'], ['🐬', '海豚'], ['🦄', '獨角獸'], ['🐢', '烏龜'], ['🐧', '企鵝'], ['🦁', '獅子'], ['🐙', '章魚'], ['🦔', '刺蝟']];
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const myId = Math.random().toString(16).slice(2, 10);
  const [myAvatar, animal] = pick(ANIMALS);
  const me = { id: myId, avatar: myAvatar, name: pick(ADJ) + animal };
  $('#bcMyName').textContent = `${me.avatar} ${me.name}`;

  $('#bcOpenTab').addEventListener('click', () => window.open(location.href.split('#')[0] + '#lab', '_blank'));

  const peers = new Map();   // id → { info, ui, link, lastSeen }
  const listEl = $('#bcPeers');
  let bc = null;
  try { bc = new BroadcastChannel('p2p-tutorial-lab'); } catch (e) { bc = null; }

  if (!bc) {
    listEl.innerHTML = '<div class="small-note">這個瀏覽器（或 file:// 環境）不支援 BroadcastChannel，請改用手動信令模式。</div>';
  } else {
    const post = msg => bc.postMessage({ ...msg, from: me.id });
    const renderEmpty = () => {
      const hint = listEl.querySelector('.empty');
      if (!peers.size && !hint) listEl.innerHTML = '<div class="small-note empty">（還沒有其他分頁。按上面的按鈕開一個新分頁，並在那邊捲到本章。）</div>';
      if (peers.size && hint) hint.remove();
    };

    const upsertPeer = info => {
      let p = peers.get(info.from);
      if (!p) {
        p = { info, lastSeen: Date.now(), link: null };
        peers.set(info.from, p);
        renderEmpty();
        p.ui = peerCard(listEl, { avatar: info.avatar, name: info.name, onConnect: () => connectTo(info.from) });
        p.ui.sys(`發現「${info.name}」（透過 BroadcastChannel 廣播的 hello）`);
      }
      p.lastSeen = Date.now();
      return p;
    };

    const newLink = (id, initiator) => {
      const p = peers.get(id);
      if (p.link) p.link.close();
      p.link = new Link({ initiator, ui: p.ui, signal: data => post({ type: 'signal', to: id, data }) });
      p.ui.setLink(p.link);
      p.ui.state('connecting');
      return p.link;
    };

    async function connectTo(id) {
      const link = newLink(id, true);
      peers.get(id).ui.sys('送出 offer（經 BroadcastChannel 轉送）');
      post({ type: 'signal', to: id, data: { sdp: await link.makeOffer() } });
    }

    bc.onmessage = async ({ data: m }) => {
      if (m.to && m.to !== me.id) return;          // 不是給我的信令：就像伺服器只轉給 to
      if (m.type === 'hello') { upsertPeer(m); post({ type: 'here', to: m.from, avatar: me.avatar, name: me.name }); return; }
      if (m.type === 'here' || m.type === 'ping') { upsertPeer(m); return; }
      if (m.type === 'bye') {
        const p = peers.get(m.from);
        if (p) { if (p.link) p.link.close(); p.ui.el.remove(); peers.delete(m.from); renderEmpty(); }
        return;
      }
      if (m.type !== 'signal') return;
      const p = peers.get(m.from);
      if (!p) return;
      const { sdp, ice } = m.data;
      try {
        if (sdp && sdp.type === 'offer') {
          // 雙方同時按「連線」（glare）：ID 較大的一方忽略對方的 offer，較小的一方讓步
          if (p.link && p.link.initiator && !p.link.open && me.id > m.from) return;
          const link = newLink(m.from, false);
          p.ui.sys('收到 offer → 回覆 answer');
          post({ type: 'signal', to: m.from, data: { sdp: await link.acceptOffer(sdp) } });
        } else if (sdp && sdp.type === 'answer' && p.link) {
          p.ui.sys('收到 answer → 開始 ICE 連線檢查');
          await p.link.acceptAnswer(sdp);
        } else if (ice && p.link) {
          await p.link.addIce(ice);
        }
      } catch (e) { p.ui.sys('信令錯誤：' + e.message); }
    };

    post({ type: 'hello', avatar: me.avatar, name: me.name });
    setInterval(() => {
      post({ type: 'ping', avatar: me.avatar, name: me.name });
      peers.forEach((p, id) => {
        if (Date.now() - p.lastSeen > 12000 && !(p.link && p.link.open)) { p.ui.el.remove(); peers.delete(id); renderEmpty(); }
      });
    }, 4000);
    window.addEventListener('pagehide', () => post({ type: 'bye' }));
  }

  // =====================================================================
  // 實驗 6b：手動信令
  // =====================================================================
  const encode = desc => btoa(JSON.stringify({ type: desc.type, sdp: desc.sdp }));
  function decode(text) {
    const t = text.trim();
    return JSON.parse(t.startsWith('{') ? t : atob(t));
  }
  let manLink = null, manUi = null;
  function manualCard() {
    if (manLink) manLink.close();
    $('#manPeer').innerHTML = '';
    manUi = peerCard($('#manPeer'), { avatar: '🛰️', name: '手動連線的對方' });
    return manUi;
  }
  const ice = () => ($('#manStun').checked ? STUN : []);
  const copy = id => {
    const ta = $(id);
    if (navigator.clipboard) navigator.clipboard.writeText(ta.value).catch(() => { ta.select(); document.execCommand('copy'); });
    else { ta.select(); document.execCommand('copy'); }
  };

  $('#manOffer').addEventListener('click', async () => {
    const ui = manualCard();
    manLink = new Link({ initiator: true, iceServers: ice(), ui });
    ui.setLink(manLink);
    ui.state('new');
    $('#manOfferOut').value = '收集 ICE 候選中…';
    await manLink.makeOffer();
    await manLink.waitGathering();
    $('#manOfferOut').value = encode(manLink.pc.localDescription);
    const n = (manLink.pc.localDescription.sdp.match(/a=candidate/g) || []).length;
    ui.sys(`offer 已產生（含 ${n} 個候選），把它傳給對方`);
  });
  $('#manAccept').addEventListener('click', async () => {
    if (!manLink) return;
    try {
      await manLink.acceptAnswer(decode($('#manAnswerIn').value));
      manUi.state('connecting');
    } catch (e) { manUi.sys('answer 格式錯誤：' + e.message); }
  });
  $('#manAnswer').addEventListener('click', async () => {
    const ui = manualCard();
    manLink = new Link({ initiator: false, iceServers: ice(), ui });
    ui.setLink(manLink);
    try {
      await manLink.acceptOffer(decode($('#manOfferIn').value));
      $('#manAnswerOut').value = '收集 ICE 候選中…';
      await manLink.waitGathering();
      $('#manAnswerOut').value = encode(manLink.pc.localDescription);
      ui.state('connecting');
      ui.sys('answer 已產生，把它傳回給發起方');
    } catch (e) { ui.sys('offer 格式錯誤：' + e.message); }
  });
  $('#manCopyOffer').addEventListener('click', () => copy('#manOfferOut'));
  $('#manCopyAnswer').addEventListener('click', () => copy('#manAnswerOut'));
})();

'use strict';

/* 第 5 章：同頁 WebRTC loopback、SDP 解說、分塊傳輸與背壓 */
(() => {
  const { $, esc, css, setupCanvas, fmtBytes, toHex } = App;

  const SDP_HELP = [
    [/^v=/, '協定版本，永遠是 0。'],
    [/^o=/, 'Origin：使用者名稱、session ID、版本、位址。瀏覽器刻意填 127.0.0.1 之類的假值，不洩漏真實 IP。'],
    [/^s=/, 'Session 名稱，WebRTC 不使用，固定填「-」。'],
    [/^t=/, '有效時間，0 0 代表永久。'],
    [/^a=group:BUNDLE/, 'BUNDLE：所有媒體與資料區段共用同一條 ICE / DTLS 傳輸，只需打一次洞。'],
    [/^a=extmap-allow-mixed/, '允許 RTP 標頭擴充混用一位元組/兩位元組格式（影音用，資料通道用不到）。'],
    [/^a=msid-semantic/, '媒體串流識別語意（影音用）。'],
    [/^m=application/, '資料通道的媒體區段。port 9 只是佔位（真正的位址在 a=candidate 裡）；UDP/DTLS/SCTP 表示 SCTP 跑在 DTLS 上、DTLS 跑在 UDP 上。'],
    [/^c=IN IP4/, '連線位址佔位，實際位址由 ICE 決定。'],
    [/^a=candidate/, 'ICE 候選：foundation、component、傳輸協定、優先權、位址、port、類型（第 3 章）。'],
    [/^a=end-of-candidates/, '告知對方：候選已經全部列完。'],
    [/^a=ice-ufrag/, 'ICE 使用者名稱片段。連線檢查的 STUN USERNAME 是「對方 ufrag:我方 ufrag」，用來對應是哪一次協商。'],
    [/^a=ice-pwd/, 'ICE 密碼。連線檢查用它計算 MESSAGE-INTEGRITY（HMAC-SHA1），證明封包來自真正交換過 SDP 的對象。'],
    [/^a=ice-options/, 'trickle：支援邊收集邊送候選（Trickle ICE，RFC 8838）。'],
    [/^a=fingerprint/, 'DTLS 憑證的 SHA-256 雜湊。DTLS 握手時對方出示的自簽憑證必須符合這個值，否則中斷連線——這是防中間人攻擊的關鍵，前提是信令通道可信。'],
    [/^a=setup/, 'DTLS 角色：offer 填 actpass（都可以），answer 選 active（當 DTLS client）或 passive。'],
    [/^a=mid/, '媒體區段 ID，對應 BUNDLE 群組中的成員。'],
    [/^a=sctp-port/, 'SCTP 埠號。這是 DTLS 內部的 SCTP 位址，不是 UDP port。'],
    [/^a=max-message-size/, '單一 DataChannel 訊息的大小上限（位元組）。送出更大的訊息會失敗。'],
  ];

  let pcA, pcB, dcA, dcB, connected = false;
  const log = (msg, cls = '') => {
    const el = $('#lbLog');
    el.insertAdjacentHTML('beforeend', `<div class="${cls}">${new Date().toLocaleTimeString()}　${esc(msg)}</div>`);
    el.scrollTop = 1e9;
  };

  function showSdp(sdp) {
    const box = $('#lbSdp');
    box.innerHTML = '';
    sdp.split(/\r?\n/).filter(Boolean).forEach(line => {
      const div = document.createElement('div');
      div.textContent = line;
      const help = SDP_HELP.find(([re]) => re.test(line));
      if (help) {
        div.className = 'known';
        div.addEventListener('mouseenter', () => {
          box.querySelectorAll('.on').forEach(x => x.classList.remove('on'));
          div.classList.add('on');
          $('#lbSdpExplain').innerHTML = `<code>${esc(line.length > 60 ? line.slice(0, 60) + '…' : line)}</code><br>${esc(help[1])}`;
        });
      }
      box.appendChild(div);
    });
  }

  async function connect() {
    if (pcA) { pcA.close(); pcB.close(); }
    connected = false;
    $('#lbLog').innerHTML = '';
    $('#lbSend').disabled = true;
    pcA = new RTCPeerConnection();
    pcB = new RTCPeerConnection();
    [['左手 A', pcA], ['右手 B', pcB]].forEach(([name, pc]) => {
      pc.addEventListener('icegatheringstatechange', () => log(`${name} iceGatheringState → ${pc.iceGatheringState}`));
      pc.addEventListener('iceconnectionstatechange', () => log(`${name} iceConnectionState → ${pc.iceConnectionState}`, pc.iceConnectionState === 'connected' ? 'good' : ''));
      pc.addEventListener('connectionstatechange', () => {
        log(`${name} connectionState → ${pc.connectionState}（DTLS ${pc.connectionState === 'connected' ? '握手完成' : '…'}）`, pc.connectionState === 'connected' ? 'good' : pc.connectionState === 'failed' ? 'bad' : '');
        $('#lbState').textContent = `A: ${pcA.connectionState}・B: ${pcB.connectionState}`;
      });
    });
    pcA.onicecandidate = e => { if (e.candidate) { log(`A 收集到候選 → 經「信令」交給 B：${e.candidate.candidate.split(' ').slice(4, 8).join(' ')}`); pcB.addIceCandidate(e.candidate); } };
    pcB.onicecandidate = e => { if (e.candidate) { log(`B 收集到候選 → 交給 A：${e.candidate.candidate.split(' ').slice(4, 8).join(' ')}`); pcA.addIceCandidate(e.candidate); } };

    dcA = pcA.createDataChannel('file', { ordered: true });
    dcA.binaryType = 'arraybuffer';
    const thisDc = dcA;
    dcA.onclose = () => { if (dcA !== thisDc) return; connected = false; $('#lbSend').disabled = true; log('DataChannel 已關閉', 'bad'); };
    dcA.onopen = async () => {
      connected = true;
      log(`DataChannel「file」已開啟（SCTP over DTLS），max-message-size = ${pcA.sctp ? pcA.sctp.maxMessageSize : '?'}`, 'good');
      $('#lbSend').disabled = !source;
      try {
        const stats = await pcA.getStats();
        let pair;
        stats.forEach(r => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r; });
        if (pair) {
          const l = stats.get(pair.localCandidateId), r = stats.get(pair.remoteCandidateId);
          log(`ICE 選中的配對：${l.candidateType} ${l.address || l.ip || ''}:${l.port} ↔ ${r.candidateType} ${r.address || r.ip || ''}:${r.port}`, 'good');
        }
      } catch (e) { /* 舊瀏覽器沒有完整 stats */ }
    };
    pcB.ondatachannel = e => {
      dcB = e.channel;
      dcB.binaryType = 'arraybuffer';
      dcB.onmessage = onReceive;
      log('B 收到 ondatachannel 事件（DCEP 的 DATA_CHANNEL_OPEN）');
    };

    const offer = await pcA.createOffer();
    await pcA.setLocalDescription(offer);
    log('A: createOffer() + setLocalDescription()');
    showSdp(offer.sdp);
    await pcB.setRemoteDescription(offer);
    log('B: setRemoteDescription(offer)');
    const answer = await pcB.createAnswer();
    await pcB.setLocalDescription(answer);
    log('B: createAnswer() + setLocalDescription()');
    await pcA.setRemoteDescription(answer);
    log('A: setRemoteDescription(answer) → 開始 ICE 連線檢查');
    // 收集完成後改顯示含候選的完整 SDP
    pcA.addEventListener('icegatheringstatechange', () => {
      if (pcA.iceGatheringState === 'complete') showSdp(pcA.localDescription.sdp);
    });
  }

  // ---- 傳輸 ----
  let source = null;   // { name, size, blob }
  let rx = null, tx = null, samples = [], sampleTimer = null;

  function setSource(s) {
    source = s;
    $('#lbSrcInfo').textContent = `${s.name}（${fmtBytes(s.size)}）`;
    $('#lbSend').disabled = !connected;
  }
  $('#lbFile').addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) setSource({ name: f.name, size: f.size, blob: f });
  });
  $('#lbGen').addEventListener('click', () => {
    const buf = new Uint8Array(32 * 1024 * 1024);
    for (let i = 0; i < buf.length; i += 65536) crypto.getRandomValues(buf.subarray(i, i + 65536));
    setSource({ name: 'random-32MiB.bin', size: buf.length, blob: new Blob([buf]) });
  });
  const chunkSeg = App.seg('lbChunk', () => {});
  const bpSeg = App.seg('lbBp', () => {});

  function onReceive(e) {
    if (typeof e.data === 'string') {
      const msg = JSON.parse(e.data);
      if (msg.type === 'header') { rx = { ...msg, parts: [], got: 0 }; }
      return;
    }
    if (!rx) return;
    rx.parts.push(e.data);
    rx.got += e.data.byteLength;
    if (rx.got >= rx.size) finish();
  }

  async function sha256(blob) {
    if (!(window.crypto && crypto.subtle)) return null;
    return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())));
  }

  async function finish() {
    const dur = (performance.now() - tx.t0) / 1000;
    samples.push({ t: dur, buf: dcA.bufferedAmount, got: rx.got });
    stopSampling();
    const blob = new Blob(rx.parts);
    const box = $('#lbDone');
    box.innerHTML = `<div class="result-banner good">✅ 收到 ${fmtBytes(rx.got)}，耗時 ${dur.toFixed(2)} 秒（${fmtBytes(rx.got / dur)}/s）。正在比對 SHA-256…</div>`;
    if (rx.size <= 512 * 1024 * 1024) {
      const [h1, h2] = await Promise.all([sha256(source.blob), sha256(blob)]);
      if (h1) {
        box.innerHTML += `<div class="small-note">送出：<code>${h1.slice(0, 32)}…</code><br>收到：<code>${h2.slice(0, 32)}…</code> ${h1 === h2 ? '<span class="tag good">完全一致</span>' : '<span class="tag bad">不一致！</span>'}</div>`;
      }
    }
    const url = URL.createObjectURL(blob);
    box.innerHTML += `<p><a class="btn small" href="${url}" download="${esc(rx.name)}">⬇ 下載 B 收到的檔案</a></p>`;
    rx = null;
  }

  function startSampling() {
    samples = [];
    const t0 = performance.now();
    sampleTimer = setInterval(() => {
      samples.push({ t: (performance.now() - t0) / 1000, buf: dcA.bufferedAmount, got: rx ? rx.got : (samples.length ? samples[samples.length - 1].got : 0) });
      tx.maxBuf = Math.max(tx.maxBuf, dcA.bufferedAmount);
      drawChart();
      updateMetrics();
    }, 50);
  }
  function stopSampling() { clearInterval(sampleTimer); drawChart(); updateMetrics(); }

  function updateMetrics() {
    if (!tx) return;
    const got = samples.length ? samples[samples.length - 1].got : 0;
    $('#lbBar').style.width = (got / tx.size * 100).toFixed(1) + '%';
    $('#lbMetrics').innerHTML = `
      <div class="metric"><div class="k">已呼叫 send()</div><div class="v">${fmtBytes(tx.sent)}</div><div class="s">${tx.chunks} 個 chunk</div></div>
      <div class="metric good"><div class="k">B 已收到</div><div class="v">${fmtBytes(got)}</div></div>
      <div class="metric ${tx.maxBuf > 8 * 1024 * 1024 ? 'bad' : ''}"><div class="k">佇列最高水位</div><div class="v">${fmtBytes(tx.maxBuf)}</div></div>
      <div class="metric"><div class="k">背壓等待次數</div><div class="v">${tx.waits}</div></div>`;
  }

  function drawChart() {
    const { ctx, w, h } = setupCanvas($('#lbCanvas'));
    if (!samples.length || !tx) return;
    const pad = { l: 60, r: 10, t: 10, b: 22 };
    const tMax = Math.max(1, samples[samples.length - 1].t);
    const yMax = Math.max(tx.size, ...samples.map(s => s.buf));
    const X = t => pad.l + (t / tMax) * (w - pad.l - pad.r);
    const Y = v => h - pad.b - (v / yMax) * (h - pad.t - pad.b);
    ctx.fillStyle = css('--muted'); ctx.strokeStyle = css('--grid');
    for (let i = 0; i <= 4; i++) {
      const v = yMax * i / 4;
      ctx.beginPath(); ctx.moveTo(pad.l, Y(v)); ctx.lineTo(w - pad.r, Y(v)); ctx.stroke();
      ctx.textAlign = 'right'; ctx.fillText(fmtBytes(v), pad.l - 4, Y(v) + 4);
    }
    ctx.textAlign = 'center'; ctx.fillText(`${tMax.toFixed(1)} 秒`, w - 30, h - 6);
    const line = (key, color) => {
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
      samples.forEach((s, i) => (i ? ctx.lineTo(X(s.t), Y(s[key])) : ctx.moveTo(X(s.t), Y(s[key]))));
      ctx.stroke();
    };
    line('buf', css('--warn'));
    line('got', css('--good'));
  }

  async function send() {
    if (!connected || !source) return;
    $('#lbSend').disabled = true;
    $('#lbDone').innerHTML = '';
    const chunk = +chunkSeg.get();
    const bp = bpSeg.get() === 'on';
    const HIGH = 4 * 1024 * 1024;
    dcA.bufferedAmountLowThreshold = 1024 * 1024;
    tx = { size: source.size, sent: 0, chunks: 0, waits: 0, maxBuf: 0, t0: performance.now() };
    rx = null;
    startSampling();
    dcA.send(JSON.stringify({ type: 'header', name: source.name, size: source.size }));
    try {
      for (let off = 0; off < source.size; off += chunk) {
        if (bp && dcA.bufferedAmount > HIGH) {
          tx.waits++;
          await new Promise(res => dcA.addEventListener('bufferedamountlow', res, { once: true }));
        }
        const buf = await source.blob.slice(off, off + chunk).arrayBuffer();
        dcA.send(buf);
        tx.sent += buf.byteLength;
        tx.chunks++;
      }
      if (source.size === 0) finish();
    } catch (e) {
      stopSampling();
      $('#lbDone').innerHTML = `<div class="result-banner bad">💥 send() 丟出錯誤：${esc(e.name)}: ${esc(e.message)}（送到 ${fmtBytes(tx.sent)} 時，佇列中有 ${fmtBytes(dcA.bufferedAmount)}）。這就是沒有背壓的下場——請按「① 建立連線」重新連線後再試。</div>`;
      log(`send() 失敗：${e.message}`, 'bad');
      return;
    } finally {
      $('#lbSend').disabled = !connected;
    }
  }

  $('#lbConnect').addEventListener('click', () => {
    if (!window.RTCPeerConnection) { log('這個瀏覽器不支援 WebRTC', 'bad'); return; }
    connect().catch(e => log('錯誤：' + e.message, 'bad'));
  });
  $('#lbSend').addEventListener('click', send);
  App.onRedraw(drawChart);
})();

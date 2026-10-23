'use strict';

/* 第 0 章：模型記憶體與生成速度估算 */
document.addEventListener('DOMContentLoaded', () => {
  const { $, fmtBytes, fmt } = App;

  const MODELS = [
    { name: 'BERT-base', params: 0.11 },
    { name: 'Llama 3.1 8B', params: 8 },
    { name: 'Llama 3.1 70B', params: 70.6 },
    { name: 'Llama 3.1 405B', params: 405 },
  ];
  const PRECISIONS = [
    { name: 'FP32', bits: 32 },
    { name: 'FP16 / BF16', bits: 16 },
    { name: 'INT8 / FP8', bits: 8 },
    { name: 'INT4', bits: 4 },
    { name: 'INT2', bits: 2 },
  ];
  // 記憶體 (GB) 與頻寬 (GB/s) 皆為概略值
  const DEVICES = {
    phone: { name: '旗艦手機', mem: 12, bw: 60 },
    laptop: { name: '筆電 GPU', mem: 8, bw: 256 },
    rtx4090: { name: 'RTX 4090', mem: 24, bw: 1008 },
    h100: { name: 'H100', mem: 80, bw: 3350 },
  };

  const slider = $('#memParams');
  const label = $('#memParamsOut');
  const presetBox = $('#memPresets');
  const rows = $('#memRows');
  let device = 'rtx4090';

  // 滑桿使用 log 刻度：0.05B ~ 500B
  const toParams = v => Math.pow(10, v);
  const toSlider = p => Math.log10(p);

  MODELS.forEach(m => {
    const b = document.createElement('button');
    b.className = 'btn small';
    b.textContent = m.name;
    b.addEventListener('click', () => { slider.value = toSlider(m.params); render(); });
    presetBox.appendChild(b);
  });

  App.seg('memDevice', v => { device = v; render(); });

  function render() {
    const paramsB = toParams(+slider.value);
    const params = paramsB * 1e9;
    label.textContent = paramsB >= 1 ? `${fmt(paramsB, 3)} B（${fmt(paramsB, 3)} 十億）` : `${fmt(paramsB * 1000, 3)} M（百萬）`;
    const dev = DEVICES[device];
    const maxBytes = params * 4;
    const limitPct = Math.min(100, (dev.mem * 1e9) / maxBytes * 100);

    rows.innerHTML = '';
    PRECISIONS.forEach(p => {
      const bytes = params * p.bits / 8;
      const fits = bytes <= dev.mem * 1e9;
      // batch=1 時每個 token 要讀過所有權重一次：速度上限 ≈ 頻寬 / 權重大小
      const tps = dev.bw * 1e9 / bytes;
      const row = document.createElement('div');
      row.className = 'mem-row';
      row.innerHTML = `
        <div><b>${p.name}</b><br><span class="caption">${p.bits} bits / 參數</span></div>
        <div class="mem-track">
          <div class="mem-bar ${fits ? '' : 'over'}" style="width:${bytes / maxBytes * 100}%"></div>
          ${limitPct < 100 ? `<div class="mem-limit" style="left:${limitPct}%" title="${dev.name} 記憶體 ${dev.mem} GB"></div>` : ''}
        </div>
        <div class="mem-info">${fmtBytes(bytes)} ${fits ? '✅ 放得下' : '❌ 放不下'}
          <span class="tps">${fits ? `生成上限 ≈ ${tps >= 100 ? Math.round(tps) : fmt(tps, 2)} token/s` : '需多卡或卸載到 CPU'}</span>
        </div>`;
      rows.appendChild(row);
    });
    $('#memNote').textContent =
      `黑色直線 = ${dev.name} 的記憶體容量（約 ${dev.mem} GB，頻寬約 ${dev.bw} GB/s）。` +
      '這裡只計算權重，實際還需要 KV cache、啟動值等額外空間。';
  }

  slider.addEventListener('input', render);
  render();
});

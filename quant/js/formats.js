'use strict';

/* 第 1 章：浮點數 / 整數位元檢視器（可點擊位元翻轉） */
const NumFormats = (() => {
  const FORMATS = [
    { id: 'fp32', name: 'FP32', E: 8, M: 23, bias: 127, kind: 'ieee' },
    { id: 'fp16', name: 'FP16', E: 5, M: 10, bias: 15, kind: 'ieee' },
    { id: 'bf16', name: 'BF16', E: 8, M: 7, bias: 127, kind: 'ieee' },
    { id: 'e4m3', name: 'FP8 E4M3', E: 4, M: 3, bias: 7, kind: 'fn' },   // OCP E4M3FN：無 ∞，最大 448
    { id: 'e5m2', name: 'FP8 E5M2', E: 5, M: 2, bias: 15, kind: 'ieee' },
    { id: 'int8', name: 'INT8（無 scale）', bits: 8, kind: 'int' },
  ];
  FORMATS.forEach(f => { if (f.kind !== 'int') f.bits = 1 + f.E + f.M; });

  const f32 = new DataView(new ArrayBuffer(4));

  function decode(f, code) {
    if (f.kind === 'int') return code >= 128 ? code - 256 : code;
    if (f.id === 'fp32') { f32.setUint32(0, code >>> 0); return f32.getFloat32(0); }
    const sign = (code >>> (f.E + f.M)) & 1;
    const exp = (code >>> f.M) & ((1 << f.E) - 1);
    const man = code & ((1 << f.M) - 1);
    const expMax = (1 << f.E) - 1, manMax = (1 << f.M) - 1;
    const s = sign ? -1 : 1;
    if (f.kind === 'ieee' && exp === expMax) return man === 0 ? s * Infinity : NaN;
    if (f.kind === 'fn' && exp === expMax && man === manMax) return NaN;
    if (exp === 0) return s * (man / (1 << f.M)) * Math.pow(2, 1 - f.bias);
    return s * (1 + man / (1 << f.M)) * Math.pow(2, exp - f.bias);
  }

  // 小格式：列舉所有正數編碼後以二分搜尋找最近值（平手取偶數編碼）
  const tables = {};
  function table(f) {
    if (tables[f.id]) return tables[f.id];
    const codes = [], values = [];
    for (let c = 0; c < (1 << (f.E + f.M)); c++) {
      const v = decode(f, c);
      if (Number.isFinite(v)) { codes.push(c); values.push(v); }
    }
    return (tables[f.id] = { codes, values });
  }

  function encode(f, x) {
    if (f.kind === 'int') {
      const q = Math.max(-128, Math.min(127, Math.round(x)));
      return q < 0 ? q + 256 : q;
    }
    if (f.id === 'fp32') { f32.setFloat32(0, x); return f32.getUint32(0); }
    const signBit = (x < 0 || Object.is(x, -0)) ? 1 << (f.E + f.M) : 0;
    const expMax = (1 << f.E) - 1;
    if (Number.isNaN(x)) return signBit | ((f.kind === 'fn' ? (expMax << f.M) | ((1 << f.M) - 1) : (expMax << f.M) | 1));
    const a = Math.abs(x);
    const { codes, values } = table(f);
    const n = values.length;
    const maxV = values[n - 1];
    if (a > maxV) {
      const halfUlp = (maxV - values[n - 2]) / 2;
      if (f.kind === 'ieee' && a >= maxV + halfUlp) return signBit | (expMax << f.M); // 溢位成 ∞
      return signBit | codes[n - 1];                                                // 飽和到最大值
    }
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (values[mid] <= a) lo = mid; else hi = mid;
    }
    const dLo = a - values[lo], dHi = values[hi] - a;
    let pick;
    if (dLo < dHi) pick = lo;
    else if (dHi < dLo) pick = hi;
    else pick = (codes[lo] & 1) === 0 ? lo : hi;
    return signBit | codes[pick];
  }

  const roundTrip = (f, x) => decode(f, encode(f, x));
  return { FORMATS, decode, encode, roundTrip, get: id => FORMATS.find(f => f.id === id) };
})();

document.addEventListener('DOMContentLoaded', () => {
  const { $, fmt } = App;
  const input = $('#fmtInput');
  const box = $('#fmtRows');
  const state = {}; // 每個格式目前的編碼

  function bitClass(f, i) {
    // i = 從最高位元算起的索引
    if (f.kind === 'int') return 'i';
    if (i === 0) return 's';
    return i <= f.E ? 'e' : 'm';
  }

  function explain(f, code, value) {
    if (f.kind === 'int') {
      return `二補數整數 = ${value}　（只能表示 −128 ~ 127 的整數；小數會被四捨五入，超出範圍會被截斷）`;
    }
    const sign = (code >>> (f.E + f.M)) & 1;
    const exp = (code >>> f.M) & ((1 << f.E) - 1);
    const man = code & ((1 << f.M) - 1);
    const expMax = (1 << f.E) - 1;
    if (Number.isNaN(value)) return '特殊值 NaN（不是數字）';
    if (!Number.isFinite(value)) return `指數全為 1、尾數為 0 → ${sign ? '−' : '+'}∞（溢位）`;
    const manStr = man.toString(2).padStart(f.M, '0');
    if (exp === 0) {
      return `次正規數：(−1)^${sign} × 2^(1−${f.bias}) × 0.${manStr}₂ = ${fmt(value, 8)}`;
    }
    const note = f.kind === 'fn' && exp === expMax ? '（E4M3 指數全 1 仍是一般數字）' : '';
    return `(−1)^${sign} × 2^(${exp}−${f.bias}) × 1.${manStr}₂ = ${fmt(value, 8)} ${note}`;
  }

  function renderRow(f) {
    const code = state[f.id];
    const value = NumFormats.decode(f, code);
    const target = +input.value;
    const err = Math.abs(value - target);
    const rel = target !== 0 ? err / Math.abs(target) : err;
    let errText;
    if (!Number.isFinite(value)) errText = '<span class="err-bad">無法表示</span>';
    else if (err === 0) errText = '<span class="err-good">完全精確</span>';
    else errText = `<span class="${rel > 0.01 ? 'err-bad' : ''}">誤差 ${fmt(err, 3)}（相對 ${fmt(rel * 100, 3)}%）</span>`;

    const row = document.getElementById('fmt-' + f.id);
    const bitsHtml = [];
    for (let i = 0; i < f.bits; i++) {
      const bit = (code >>> (f.bits - 1 - i)) & 1;
      const cls = bitClass(f, i);
      if (i > 0 && cls !== bitClass(f, i - 1)) bitsHtml.push('<span class="bit-gap"></span>');
      bitsHtml.push(`<span class="bit ${cls} ${bit ? '' : 'zero'}" data-i="${i}" title="點擊翻轉這個位元">${bit}</span>`);
    }
    row.innerHTML = `
      <div class="bit-head">
        <span><b>${f.name}</b>　<span class="caption">${f.bits} bits${f.kind === 'int' ? '' : `：1 符號 + ${f.E} 指數 + ${f.M} 尾數`}</span></span>
        <span>儲存值 = <b>${fmt(value, 8)}</b>　${errText}</span>
      </div>
      <div class="bits">${bitsHtml.join('')}</div>
      <div class="bit-decode">${explain(f, code, value)}</div>`;
  }

  NumFormats.FORMATS.forEach(f => {
    const row = document.createElement('div');
    row.className = 'bit-row';
    row.id = 'fmt-' + f.id;
    row.addEventListener('click', e => {
      const b = e.target.closest('.bit');
      if (!b) return;
      const i = +b.dataset.i;
      state[f.id] = (state[f.id] ^ (1 << (f.bits - 1 - i))) >>> 0;
      renderRow(f);
    });
    box.appendChild(row);
  });

  function encodeAll() {
    const x = +input.value;
    if (input.value.trim() === '' || Number.isNaN(x)) return;
    NumFormats.FORMATS.forEach(f => { state[f.id] = NumFormats.encode(f, x); renderRow(f); });
  }

  input.addEventListener('input', encodeAll);
  document.querySelectorAll('#fmtPresets button').forEach(b => {
    b.addEventListener('click', () => { input.value = b.dataset.v; encodeAll(); });
  });
  encodeAll();
});

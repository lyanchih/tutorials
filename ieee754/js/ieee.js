/*
 * ieee.js — IEEE 754 核心運算（純函式，無 DOM）
 * 全部使用 BigInt 做「精確」運算，不依賴瀏覽器的 float 行為，
 * 因此半精度 / 單精度 / 雙精度的結果都是正確捨入（round half to even）。
 */
(function (root) {
  'use strict';

  const FORMATS = {
    half:   { key: 'half',   name: '半精度',   en: 'binary16', bits: 16, expBits: 5,  fracBits: 10, bias: 15,   cType: '_Float16 / half' },
    single: { key: 'single', name: '單精度',   en: 'binary32', bits: 32, expBits: 8,  fracBits: 23, bias: 127,  cType: 'float' },
    double: { key: 'double', name: '雙精度',   en: 'binary64', bits: 64, expBits: 11, fracBits: 52, bias: 1023, cType: 'double' },
  };

  /** 建立任意格式（給迷你浮點數玩具用） */
  function makeFormat(expBits, fracBits) {
    return {
      key: 'custom', name: '迷你', en: 'mini', bits: 1 + expBits + fracBits,
      expBits, fracBits, bias: (1 << (expBits - 1)) - 1, cType: '-',
    };
  }

  const big = (x) => BigInt(x);
  const maxExpField = (f) => (1 << f.expBits) - 1;

  function bitLength(n) {
    return n === 0n ? 0 : n.toString(2).length;
  }

  /* ---------- 位元欄位 ---------- */

  function fields(f, bits) {
    const fb = big(f.fracBits);
    const frac = bits & ((1n << fb) - 1n);
    const exp = Number((bits >> fb) & ((1n << big(f.expBits)) - 1n));
    const sign = Number((bits >> big(f.expBits + f.fracBits)) & 1n);
    return { sign, exp, frac };
  }

  function compose(f, sign, exp, frac) {
    return (big(sign) << big(f.expBits + f.fracBits)) | (big(exp) << big(f.fracBits)) | big(frac);
  }

  function classify(f, bits) {
    const { exp, frac } = fields(f, bits);
    if (exp === maxExpField(f)) return frac === 0n ? 'inf' : 'nan';
    if (exp === 0) return frac === 0n ? 'zero' : 'subnormal';
    return 'normal';
  }

  /**
   * 解碼：把位元轉成精確的 { sign, sig, pow } ，值 = (-1)^sign × sig × 2^pow
   * sig 為 BigInt 整數。inf/nan 另外標示。
   */
  function decodeExact(f, bits) {
    const { sign, exp, frac } = fields(f, bits);
    const kind = classify(f, bits);
    if (kind === 'inf' || kind === 'nan') return { sign, kind };
    if (exp === 0) return { sign, kind, sig: frac, pow: 1 - f.bias - f.fracBits };
    return { sign, kind, sig: (1n << big(f.fracBits)) + frac, pow: exp - f.bias - f.fracBits };
  }

  /** 解碼成 JS number（half/single 在 double 中都能精確表示） */
  function toNumber(f, bits) {
    const d = decodeExact(f, bits);
    if (d.kind === 'nan') return NaN;
    if (d.kind === 'inf') return d.sign ? -Infinity : Infinity;
    // 分兩段乘，避免 2^pow 本身下溢（例如 2^-1074 以下）
    let v = Number(d.sig);
    let p = d.pow;
    while (p < -1000) { v *= 2 ** -1000; p += 1000; }
    v *= 2 ** p;
    return d.sign ? -v : v;
  }

  /** sig × 2^pow 的完整十進位展開（一定是有限小數） */
  function exactDecimal(sig, pow) {
    if (sig === 0n) return '0';
    if (pow >= 0) return (sig << big(pow)).toString();
    const k = -pow;
    let s = (sig * 5n ** big(k)).toString(); // sig × 2^-k = sig × 5^k / 10^k
    if (s.length <= k) s = '0'.repeat(k - s.length + 1) + s;
    let intPart = s.slice(0, s.length - k);
    let fracPart = s.slice(s.length - k).replace(/0+$/, '');
    return fracPart ? `${intPart}.${fracPart}` : intPart;
  }

  function exactDecimalOfBits(f, bits) {
    const d = decodeExact(f, bits);
    if (d.kind === 'nan') return 'NaN';
    if (d.kind === 'inf') return d.sign ? '-∞' : '+∞';
    const s = exactDecimal(d.sig, d.pow);
    return (d.sign ? '-' : '') + s;
  }

  /* ---------- 編碼：精確有理數 → 最接近的浮點數 ---------- */

  /**
   * 解析十進位字串為精確有理數 { sign, num, den } 或特殊值。
   * 支援：123, -0.1, 1.5e-3, .5, inf, -Infinity, nan
   */
  function parseDecimal(str) {
    const s = String(str).trim().replace(/[,_\s]/g, '');
    if (/^[+-]?(inf|infinity|∞)$/i.test(s)) return { special: 'inf', sign: s[0] === '-' ? 1 : 0 };
    if (/^[+-]?nan$/i.test(s)) return { special: 'nan', sign: s[0] === '-' ? 1 : 0 };
    const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(s);
    if (!m || (m[2] === '' && (m[3] === undefined || m[3] === ''))) return null;
    const sign = m[1] === '-' ? 1 : 0;
    const intDigits = m[2] || '';
    const fracDigits = m[3] || '';
    let e10 = (m[4] ? parseInt(m[4], 10) : 0) - fracDigits.length;
    if (Math.abs(e10) > 4000) {
      // 超出範圍太多：直接當作溢位或下溢
      const digits = (intDigits + fracDigits).replace(/^0+/, '');
      if (!digits) return { sign, num: 0n, den: 1n };
      return e10 > 0 ? { special: 'huge', sign } : { special: 'tiny', sign };
    }
    let num = BigInt((intDigits + fracDigits) || '0');
    let den = 1n;
    if (e10 >= 0) num *= 10n ** big(e10); else den = 10n ** big(-e10);
    return { sign, num, den };
  }

  /** floor(log2(num/den))，num, den > 0 */
  function floorLog2(num, den) {
    let e = bitLength(num) - bitLength(den);
    // 確保 2^e <= num/den < 2^(e+1)
    const ge = (e) => (e >= 0 ? num >= (den << big(e)) : (num << big(-e)) >= den);
    if (!ge(e)) e -= 1;
    return e;
  }

  /**
   * 將精確有理數四捨五入（round half to even）到格式 f。
   * 回傳 { bits, info }，info 給「逐步教學」使用。
   */
  function encodeRational(f, sign, num, den) {
    const fb = big(f.fracBits);
    const emin = 1 - f.bias;
    if (num === 0n) {
      return { bits: compose(f, sign, 0, 0n), info: { zero: true } };
    }
    const E = floorLog2(num, den);
    const Eeff = Math.max(E, emin);
    const s = f.fracBits - Eeff;           // 要乘上 2^s 讓尾數變整數
    let n = num, d = den;
    if (s >= 0) n = num << big(s); else d = den << big(-s);
    let q = n / d;
    const r = n % d;
    const truncated = q;
    let roundDir = 'exact';
    if (r !== 0n) {
      const twice = r * 2n;
      if (twice > d || (twice === d && (q & 1n) === 1n)) { q += 1n; roundDir = twice === d ? 'tie-up' : 'up'; }
      else roundDir = twice === d ? 'tie-down' : 'down';
    }
    let bits;
    if (q >= (1n << fb)) bits = (big(Eeff + f.bias) << fb) + q - (1n << fb);
    else bits = q; // 次正規數
    let overflow = false;
    if (Number(bits >> fb) >= maxExpField(f)) { bits = big(maxExpField(f)) << fb; overflow = true; }
    bits |= big(sign) << big(f.expBits + f.fracBits);
    return {
      bits,
      info: { E, Eeff, subnormal: E < emin, truncated, rounded: q, remainder: r, divisor: d, roundDir, overflow },
    };
  }

  /** 字串 → 位元（可直接給 UI 用） */
  function encodeString(f, str) {
    const p = parseDecimal(str);
    if (!p) return null;
    const signBit = big(p.sign) << big(f.expBits + f.fracBits);
    if (p.special === 'inf' || p.special === 'huge')
      return { bits: signBit | (big(maxExpField(f)) << big(f.fracBits)), parsed: p, info: { overflow: p.special === 'huge' } };
    if (p.special === 'nan')
      return { bits: signBit | (big(maxExpField(f)) << big(f.fracBits)) | (1n << big(f.fracBits - 1)), parsed: p, info: {} };
    if (p.special === 'tiny') return { bits: signBit, parsed: p, info: { underflow: true } };
    const r = encodeRational(f, p.sign, p.num, p.den);
    return { bits: r.bits, parsed: p, info: r.info };
  }

  /** JS number → 位元（number 本身就是 double，可精確轉為有理數） */
  function encodeNumber(f, x) {
    if (Number.isNaN(x)) return encodeString(f, 'nan').bits;
    if (!Number.isFinite(x)) return encodeString(f, x < 0 ? '-inf' : 'inf').bits;
    const sign = x < 0 || Object.is(x, -0) ? 1 : 0;
    const db = doubleBits(Math.abs(x));
    const d = decodeExact(FORMATS.double, db);
    if (d.sig === 0n) return compose(f, sign, 0, 0n);
    const num = d.pow >= 0 ? d.sig << big(d.pow) : d.sig;
    const den = d.pow >= 0 ? 1n : 1n << big(-d.pow);
    return encodeRational(f, sign, num, den).bits;
  }

  function doubleBits(x) {
    const dv = new DataView(new ArrayBuffer(8));
    dv.setFloat64(0, x);
    return dv.getBigUint64(0);
  }

  /** 四捨五入到格式 f，再轉回 JS number（用來模擬 half/single 的運算結果） */
  function roundTo(f, x) {
    return toNumber(f, encodeNumber(f, x));
  }

  /* ---------- 雜項 ---------- */

  function toBinString(f, bits) {
    return bits.toString(2).padStart(f.bits, '0');
  }

  function toHex(f, bits) {
    return '0x' + bits.toString(16).toUpperCase().padStart(f.bits / 4, '0');
  }

  function fromHex(f, str) {
    const s = String(str).trim().replace(/^0x/i, '').replace(/[\s_]/g, '');
    if (!/^[0-9a-f]+$/i.test(s) || s.length > f.bits / 4) return null;
    return BigInt('0x' + s);
  }

  /** 下一個 / 上一個可表示的數（依數值大小，不是依位元） */
  function nextUp(f, bits) {
    const kind = classify(f, bits);
    const { sign } = fields(f, bits);
    const mag = bits & ((1n << big(f.bits - 1)) - 1n);
    if (kind === 'nan') return bits;
    if (sign === 0) {
      if (kind === 'inf') return bits;
      return bits + 1n;
    }
    if (mag === 0n) return 1n; // -0 → 最小正次正規數
    return bits - 1n;
  }

  function nextDown(f, bits) {
    const signMask = 1n << big(f.bits - 1);
    return nextUp(f, bits ^ signMask) ^ signMask;
  }

  /** 某個數附近相鄰兩個可表示數的距離（ULP） */
  function ulpAt(f, x) {
    const bits = encodeNumber(f, Math.abs(x));
    const kind = classify(f, bits);
    if (kind === 'inf' || kind === 'nan') return NaN;
    const up = nextUp(f, bits);
    if (classify(f, up) === 'inf') return toNumber(f, bits) - toNumber(f, nextDown(f, bits));
    return toNumber(f, up) - toNumber(f, bits);
  }

  /** 把 num/den 展開成二進位小數，回傳整數部分與小數部分的位元串 */
  function binaryExpansion(num, den, maxFracBits) {
    const intPart = num / den;
    let rem = num % den;
    let frac = '';
    const steps = [];
    let terminated = rem === 0n;
    for (let i = 0; i < maxFracBits && rem !== 0n; i++) {
      const before = rem;
      rem *= 2n;
      const bit = rem >= den ? 1 : 0;
      if (bit) rem -= den;
      frac += bit;
      steps.push({ before, after: rem, bit });
      if (rem === 0n) terminated = true;
    }
    return { intPart, frac, steps, terminated };
  }

  const api = {
    FORMATS, makeFormat, fields, compose, classify, decodeExact, toNumber,
    exactDecimal, exactDecimalOfBits, parseDecimal, encodeRational, encodeString,
    encodeNumber, roundTo, toBinString, toHex, fromHex, nextUp, nextDown, ulpAt,
    binaryExpansion, floorLog2, maxExpField, doubleBits,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IEEE = api;
})(typeof window !== 'undefined' ? window : globalThis);

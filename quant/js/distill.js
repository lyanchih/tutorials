'use strict';

/* 第 5 章：知識蒸餾 —— 溫度 softmax 與蒸餾損失 */
document.addEventListener('DOMContentLoaded', () => {
  const { $, css } = App;
  const CLASSES = ['貓', '老虎', '狗', '汽車', '飛機'];
  const TRUE = 0;
  const TEACHER0 = [9, 6.5, 5, 0.5, -1];
  const STUDENT0 = [3, -1, 2.5, 2, 1.5];
  const teacher = TEACHER0.slice();
  const student = STUDENT0.slice();
  let timer = null;

  const temp = App.range('kdTemp', render, v => v.toFixed(1));
  const alpha = App.range('kdAlpha', render, v => v.toFixed(2));

  const softmax = (z, T = 1) => {
    const m = Math.max(...z.map(v => v / T));
    const e = z.map(v => Math.exp(v / T - m));
    const s = e.reduce((a, b) => a + b, 0);
    return e.map(v => v / s);
  };

  // 產生 logit 滑桿
  function buildSliders(boxId, arr, cls) {
    const box = $(boxId);
    box.innerHTML = '';
    CLASSES.forEach((name, i) => {
      const lab = document.createElement('span');
      lab.textContent = name + (i === TRUE ? ' ✔' : '');
      const inp = document.createElement('input');
      Object.assign(inp, { type: 'range', min: -5, max: 12, step: 0.1, value: arr[i] });
      inp.style.accentColor = css(cls);
      const out = document.createElement('output');
      out.textContent = arr[i].toFixed(1);
      inp.addEventListener('input', () => { arr[i] = +inp.value; out.textContent = arr[i].toFixed(1); render(); });
      box.append(lab, inp, out);
    });
  }
  function syncSliders(boxId, arr) {
    const inputs = $(boxId).querySelectorAll('input');
    const outs = $(boxId).querySelectorAll('output');
    arr.forEach((v, i) => { inputs[i].value = v; outs[i].textContent = v.toFixed(1); });
  }

  function losses() {
    const T = temp.get(), a = alpha.get();
    const ps1 = softmax(student, 1);
    const pt = softmax(teacher, T), ps = softmax(student, T);
    const ce = -Math.log(ps1[TRUE]);
    const kl = pt.reduce((s, p, i) => s + p * Math.log(p / ps[i]), 0);
    const total = a * ce + (1 - a) * T * T * kl;
    return { T, a, ps1, pt, ps, ce, kl, total };
  }

  function render() {
    const L = losses();
    const hard = CLASSES.map((_, i) => (i === TRUE ? 1 : 0));
    const bar = (p, color) => `<div class="pbar"><div style="width:${p * 100}%;background:${color}"></div><span>${(p * 100).toFixed(1)}%</span></div>`;
    $('#kdProbs').innerHTML = `
      <span></span><span class="h">硬標籤（資料集答案）</span><span class="h">老師 softmax(z/T)</span><span class="h">學生 softmax(z/T)</span>
      ${CLASSES.map((c, i) => `<span>${c}</span>${bar(hard[i], css('--muted'))}${bar(L.pt[i], css('--c2'))}${bar(L.ps[i], css('--c1'))}`).join('')}`;

    const entropy = p => -p.reduce((s, v) => s + (v > 0 ? v * Math.log2(v) : 0), 0);
    const pt1 = softmax(teacher, 1);
    $('#kdMetrics').innerHTML = `
      <div class="metric"><div class="k">老師分佈的熵（T=${L.T}）</div><div class="v">${entropy(L.pt).toFixed(2)} bits</div><div class="s">越大 = 越「軟」，暗知識越明顯</div></div>
      <div class="metric"><div class="k">老師：老虎 ÷ 汽車</div><div class="v">${(pt1[1] / pt1[3]).toFixed(0)}×</div><div class="s">在 T=1 下，「像老虎」比「像汽車」可能幾倍</div></div>
      <div class="metric"><div class="k">硬標籤 CE（T=1）</div><div class="v">${L.ce.toFixed(3)}</div></div>
      <div class="metric"><div class="k">KL(老師‖學生)（T=${L.T}）</div><div class="v">${L.kl.toFixed(4)}</div></div>
      <div class="metric"><div class="k">總損失</div><div class="v">${L.total.toFixed(3)}</div><div class="s">α·CE + (1−α)·T²·KL</div></div>`;
    $('#kdFormula').innerHTML =
      `L = <span class="hl">${L.a.toFixed(2)}</span> × ${L.ce.toFixed(3)} + (1 − ${L.a.toFixed(2)}) × <span class="hl">${L.T}²</span> × ${L.kl.toFixed(4)} = <b>${L.total.toFixed(3)}</b>`;
  }

  // 對學生 logits 做一步梯度下降：∂L/∂z = α(p − y) + (1−α)·T·(p_s^T − p_t^T)
  function step() {
    const L = losses();
    const lr = 0.5;
    student.forEach((_, i) => {
      const g = L.a * (L.ps1[i] - (i === TRUE ? 1 : 0)) + (1 - L.a) * L.T * (L.ps[i] - L.pt[i]);
      student[i] = Math.max(-5, Math.min(12, student[i] - lr * g));
    });
    syncSliders('#kdStudent', student);
    render();
  }

  $('#kdStep').addEventListener('click', step);
  $('#kdTrain').addEventListener('click', () => {
    if (timer) return;
    let n = 0;
    timer = setInterval(() => {
      step();
      if (++n >= 60) { clearInterval(timer); timer = null; }
    }, 40);
  });
  $('#kdReset').addEventListener('click', () => {
    clearInterval(timer); timer = null;
    STUDENT0.forEach((v, i) => { student[i] = v; });
    TEACHER0.forEach((v, i) => { teacher[i] = v; });
    syncSliders('#kdStudent', student);
    syncSliders('#kdTeacher', teacher);
    render();
  });

  buildSliders('#kdTeacher', teacher, '--c2');
  buildSliders('#kdStudent', student, '--c1');
  render();
  App.onRedraw(render);
});

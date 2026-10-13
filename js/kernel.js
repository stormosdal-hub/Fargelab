/*
 * kernel.js – kernels og cv2.filter2D for Kernel-modus i bildekortet
 *
 * Ferdige kernels (box, Gauss, Sobel …) og en JavaScript-kopi av
 * cv2.filter2D(src, -1, kernel) for 8-bits bilder:
 *   - korrelasjon: kernelen legges over bildet slik den står (den snus ikke)
 *   - utenfor bildet speiles det uten å gjenta kantpikselen (BORDER_REFLECT_101,
 *     standard i OpenCV): −1 blir 1, og w blir w − 2
 *   - summen regnes i 32-bits flyttall i samme rekkefølge som OpenCV, rundes til
 *     nærmeste heltall (halve til partall) og klippes til 0–255
 * Med abs: true blir resultatet |summen|, som
 * cv2.convertScaleAbs(cv2.filter2D(src, cv2.CV_32F, kernel)).
 * node test/kernel.js sjekker at tallene er de samme som i OpenCV.js.
 *
 * En kernel er { id, k, num, den }: k × k vekter num / den, rad for rad.
 *
 * Bruk:
 *   const kern = Kernel.make('gauss', 5, 0);
 *   const ut = Kernel.filter(src, W, H, region, kern, { channels: [0, 1, 2], abs: false });
 *   // src = { data, w, h, x, y, stride }: piksler lest fra bildet, der (x, y) er hjørnet
 *   // i hele bildet (W × H). region = { x, y, w, h } er pikslene som regnes ut.
 *   Kernel.filterCv(cv, ...)   samme, men med cv.filter2D (raskere for store områder)
 */
(function (root) {
  'use strict';

  const f32 = Math.fround;

  /* ---------- Ferdige kernels ---------- */
  // cv2.getGaussianKernel(n, sigma): faste tall for n = 1, 3, 5 og 7 når sigma <= 0
  const SMALL_GAUSS = { 1: [1], 3: [1, 2, 1], 5: [1, 4, 6, 4, 1], 7: [2, 7, 14, 18, 14, 7, 2] };

  // Gir { num, den } for den endimensjonale Gauss-kernelen, som cv2.getGaussianKernel
  function gaussian1d(n, sigma) {
    if (!(sigma > 0) && SMALL_GAUSS[n]) {
      const t = SMALL_GAUSS[n];
      return { num: t.slice(), den: t.reduce((a, b) => a + b, 0) };
    }
    const s = sigma > 0 ? sigma : ((n - 1) * 0.5 - 1) * 0.3 + 0.8;
    const scale2X = -0.5 / (s * s);
    const v = [];
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const x = i - (n - 1) * 0.5;
      const t = Math.exp(scale2X * x * x);
      v.push(t);
      sum += t;
    }
    const inv = 1 / sum;
    return { num: v.map(t => t * inv), den: 1 };
  }

  const fill = (k, f) => Array.from({ length: k * k }, (_, i) => f(Math.floor(i / k), i % k));

  // make(k, sigma) gir { num, den }. builtin gir OpenCV-funksjonen som gjør det samme, hvis den finnes.
  const PRESETS = [
    {
      id: 'box', navn: 'Box-filter (gjennomsnitt)', sizes: [3, 5, 7],
      make: k => ({ num: fill(k, () => 1), den: k * k }),
      builtin: k => `cv2.blur(img, (${k}, ${k}))`,
      about: 'Gjennomsnittet av alle pikslene under kernelen. Bildet blir uskarpt, og jo større kernel, jo mer.'
    },
    {
      id: 'gauss', navn: 'Gauss', sizes: [3, 5, 7], sigma: true,
      make: (k, sigma) => {
        const g = gaussian1d(k, sigma);
        return { num: fill(k, (i, j) => g.num[i] * g.num[j]), den: g.den * g.den };
      },
      builtin: (k, sigma) => `cv2.GaussianBlur(img, (${k}, ${k}), ${sigma > 0 ? sigma : 0})`,
      about: 'Vektet gjennomsnitt der pikslene nær midten teller mest. Mykere uskarphet enn box-filteret. σ = 0 betyr at OpenCV velger σ ut fra størrelsen.'
    },
    {
      id: 'skarp', navn: 'Skarphet', sizes: [3],
      make: () => ({ num: [0, -1, 0, -1, 5, -1, 0, -1, 0], den: 1 }),
      about: 'Midten ganget med 5, minus de fire naboene. Forskjeller blir større, så kanter blir skarpere. Vektene summerer til 1, så flater er uendret.'
    },
    {
      id: 'sobelx', navn: 'Sobel x', sizes: [3],
      make: () => ({ num: [-1, 0, 1, -2, 0, 2, -1, 0, 1], den: 1 }),
      builtin: () => 'cv2.Sobel(img, -1, 1, 0, ksize=3)',
      about: 'Høyre side minus venstre side: finner loddrette kanter. Kanter fra lyst til mørkt gir negative tall. Velg absoluttverdi for å se dem.'
    },
    {
      id: 'sobely', navn: 'Sobel y', sizes: [3],
      make: () => ({ num: [-1, -2, -1, 0, 0, 0, 1, 2, 1], den: 1 }),
      builtin: () => 'cv2.Sobel(img, -1, 0, 1, ksize=3)',
      about: 'Nedre del minus øvre del: finner vannrette kanter. Kanter fra lyst til mørkt gir negative tall. Velg absoluttverdi for å se dem.'
    },
    {
      id: 'laplace', navn: 'Laplace', sizes: [3],
      make: () => ({ num: [0, 1, 0, 1, -4, 1, 0, 1, 0], den: 1 }),
      builtin: () => 'cv2.Laplacian(img, -1)',
      about: 'De fire naboene minus fire ganger midten (den andrederiverte). Flater blir 0, og kanter gir utslag i alle retninger.'
    },
    {
      id: 'kanter', navn: 'Kanter (8 naboer)', sizes: [3],
      make: () => ({ num: [-1, -1, -1, -1, 8, -1, -1, -1, -1], den: 1 }),
      about: 'Åtte ganger midten minus alle de åtte naboene. Flater blir 0, og kanter i alle retninger kommer fram.'
    },
    {
      id: 'preg', navn: 'Preg (emboss)', sizes: [3],
      make: () => ({ num: [-2, -1, 0, -1, 1, 1, 0, 1, 2], den: 1 }),
      about: 'Nede til høyre minus oppe til venstre, pluss midten. Ser ut som et relieff med lys fra ett hjørne.'
    },
    {
      id: 'bevegelse', navn: 'Bevegelsesuskarphet', sizes: [3, 5, 7],
      make: k => ({ num: fill(k, (i, j) => (i === j ? 1 : 0)), den: k }),
      about: 'Gjennomsnitt langs diagonalen, som om kameraet beveget seg på skrå mens bildet ble tatt.'
    },
    {
      id: 'identitet', navn: 'Identitet', sizes: [3],
      make: () => ({ num: [0, 0, 0, 0, 1, 0, 0, 0, 0], den: 1 }),
      about: 'Bare midten teller, med vekt 1. Bildet blir som før. Fint å starte fra når du lager din egen kernel.'
    }
  ];
  const preset = id => PRESETS.find(p => p.id === id) || null;

  function make(id, k, sigma = 0) {
    const p = preset(id);
    const kk = p.sizes.includes(k) ? k : p.sizes[0];
    const { num, den } = p.make(kk, sigma);
    return { id, k: kk, num: Float64Array.from(num), den, sigma: p.sigma ? sigma : null };
  }

  // Vektene som 32-bits flyttall, som OpenCV bruker dem
  function weights(kern) {
    const w = new Float32Array(kern.k * kern.k);
    for (let i = 0; i < w.length; i++) w[i] = kern.num[i] / kern.den;
    return w;
  }

  /* ---------- Regning som i OpenCV ---------- */
  // Speiling uten å gjenta kantpikselen, som cv2.borderInterpolate med BORDER_REFLECT_101
  function reflect101(p, n) {
    if (n === 1) return 0;
    while (p < 0 || p >= n) p = p < 0 ? -p : 2 * n - 2 - p;
    return p;
  }
  // Som cvRound: nærmeste heltall, og halve til partall (2,5 → 2, 3,5 → 4)
  function roundEven(x) {
    const r = Math.round(x);
    return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
  }
  const sat8 = v => (v < 0 ? 0 : v > 255 ? 255 : v);

  // Summen for én piksel, nøyaktig som OpenCV: vekter som ikke er 0, rad for rad,
  // i 32-bits flyttall. at(dx, dy) gir verdien i nabopikselen.
  function sumAt(wts, k, at) {
    const h = (k - 1) / 2;
    let s = 0;
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) {
        const w = wts[i * k + j];
        if (w !== 0) s = f32(s + f32(w * at(j - h, i - h)));
      }
    }
    return s;
  }
  const finish = (s, abs) => sat8(roundEven(abs ? Math.abs(s) : s));

  // Koordinatene i src for kolonnene og radene regionen trenger, med speiling i kanten av bildet
  function lookups(src, W, H, region, h) {
    const cols = new Int32Array(region.w + 2 * h), rows = new Int32Array(region.h + 2 * h);
    for (let i = 0; i < cols.length; i++) cols[i] = reflect101(region.x - h + i, W) - src.x;
    for (let i = 0; i < rows.length; i++) rows[i] = reflect101(region.y - h + i, H) - src.y;
    return { cols, rows };
  }

  // JavaScript-kopien av cv2.filter2D. Gir pikslene i regionen med samme kanaler
  // som src (stride per piksel). Kanaler som ikke er i channels, kopieres uendret.
  function filter(src, W, H, region, kern, { channels, abs = false }) {
    const k = kern.k, h = (k - 1) / 2, wts = weights(kern), st = src.stride, sw = src.w, d = src.data;
    const taps = [];   // [dx, dy, vekt] for vektene som ikke er 0, rad for rad
    for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) if (wts[i * k + j] !== 0) taps.push(j, i, wts[i * k + j]);
    const { cols, rows } = lookups(src, W, H, region, h);
    const out = new Uint8ClampedArray(region.w * region.h * st);
    for (let y = 0; y < region.h; y++) {
      for (let x = 0; x < region.w; x++) {
        const o = (y * region.w + x) * st;
        const c0 = (rows[y + h] * sw + cols[x + h]) * st;
        for (let c = 0; c < st; c++) out[o + c] = d[c0 + c];
        for (const c of channels) {
          let s = 0;
          for (let t = 0; t < taps.length; t += 3) {
            s = f32(s + f32(taps[t + 2] * d[(rows[y + taps[t + 1]] * sw + cols[x + taps[t]]) * st + c]));
          }
          out[o + c] = finish(s, abs);
        }
      }
    }
    return out;
  }

  // Samme som filter, men med cv.filter2D fra OpenCV.js. Kanten er allerede speilet
  // i bufferet som sendes inn, så bare pikslene inni brukes.
  function filterCv(cv, src, W, H, region, kern, { channels, abs = false }) {
    const k = kern.k, h = (k - 1) / 2, st = src.stride, nc = channels.length;
    const pw = region.w + 2 * h, ph = region.h + 2 * h;
    const { cols, rows } = lookups(src, W, H, region, h);
    const buf = new Uint8Array(pw * ph * nc);
    for (let y = 0; y < ph; y++) {
      const row = rows[y] * src.w;
      for (let x = 0; x < pw; x++) {
        const s = (row + cols[x]) * st, o = (y * pw + x) * nc;
        for (let c = 0; c < nc; c++) buf[o + c] = src.data[s + channels[c]];
      }
    }
    const mats = [];
    const keep = m => { mats.push(m); return m; };
    try {
      const m = keep(cv.matFromArray(ph, pw, nc === 3 ? cv.CV_8UC3 : nc === 4 ? cv.CV_8UC4 : cv.CV_8UC1, buf));
      const kmat = keep(cv.matFromArray(k, k, cv.CV_32F, Array.from(weights(kern))));
      const dst = keep(new cv.Mat());
      const anchor = new cv.Point(-1, -1);
      if (abs) {
        const tmp = keep(new cv.Mat());
        cv.filter2D(m, tmp, cv.CV_32F, kmat, anchor, 0, cv.BORDER_REFLECT_101);
        cv.convertScaleAbs(tmp, dst);
      } else {
        cv.filter2D(m, dst, -1, kmat, anchor, 0, cv.BORDER_REFLECT_101);
      }
      const dd = dst.data;
      const out = new Uint8ClampedArray(region.w * region.h * st);
      for (let y = 0; y < region.h; y++) {
        for (let x = 0; x < region.w; x++) {
          const o = (y * region.w + x) * st;
          const c0 = (rows[y + h] * src.w + cols[x + h]) * st;
          for (let c = 0; c < st; c++) out[o + c] = src.data[c0 + c];
          const q = ((y + h) * pw + x + h) * nc;
          for (let c = 0; c < nc; c++) out[o + channels[c]] = dd[q + c];
        }
      }
      return out;
    } finally {
      mats.forEach(m => m.delete());
    }
  }

  /* ---------- Visning ---------- */
  // Tall i kernelen: heltall som de er, ellers med opptil 4 gjeldende sifre
  function fmtNum(x) {
    if (Number.isInteger(x)) return String(x);
    const s = Math.abs(x) >= 1 ? x.toFixed(3) : x.toPrecision(4);
    return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
  }

  // Python-koden for kernelen, slik du kan skrive den i Python-fanen.
  // name: filnavnet. gray: bildet gjøres grått først. thresh/maxval: cv2.threshold etterpå.
  // x, y og value: pikselen under markøren og verdien den får.
  function python(kern, { name = 'bilde.png', gray = false, abs = false, thresh = null, maxval = null, x = null, y = null, value = null } = {}) {
    const p = preset(kern.id);
    const k = kern.k;
    const q = s => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
    const lines = ['import cv2', 'import numpy as np', '', `img = cv2.imread(${q(name)})`];
    if (gray) lines.push('img = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)');
    if (p && p.id === 'gauss' && kern.den === 1) {
      lines.push(`g = cv2.getGaussianKernel(${k}, ${kern.sigma})`, 'kernel = g @ g.T');
    } else {
      const cells = Array.from(kern.num, String);   // nøyaktige tall, så Python gir det samme
      const w = Math.max(...cells.map(c => c.length));
      const rowsTxt = [];
      for (let i = 0; i < k; i++) rowsTxt.push('[' + cells.slice(i * k, i * k + k).map(c => c.padStart(w)).join(', ') + ']');
      const head = 'kernel = np.array([';
      const body = rowsTxt.map((r, i) => (i ? ' '.repeat(head.length) : head) + r + (i < k - 1 ? ',' : '], np.float32)')).join('\n');
      lines.push(body + (kern.den !== 1 ? ` / ${String(kern.den)}` : ''));
    }
    if (abs) {
      lines.push('ut = cv2.convertScaleAbs(cv2.filter2D(img, cv2.CV_32F, kernel))  # |summen|');
    } else {
      lines.push('ut = cv2.filter2D(img, -1, kernel)  # negative tall blir 0');
    }
    if (p && p.builtin && !abs) {
      const sigma = kern.sigma || 0;
      lines.push(`# Det samme som ${p.builtin(k, sigma)}` + (p.id === 'box' || p.id === 'gauss' ? ' (kan avvike med 1)' : ''));
    }
    if (thresh !== null) lines.push(`_, ut = cv2.threshold(ut, ${thresh}, ${maxval}, cv2.THRESH_BINARY)`);
    if (x !== null) {
      // Som numpy skriver det: tallene høyrestilt med lik bredde
      const w = Array.isArray(value) ? Math.max(...value.map(n => String(n).length)) : 0;
      const v = Array.isArray(value) ? '[' + value.map(n => String(n).padStart(w)).join(' ') + ']' : String(value);
      lines.push('', `x, y = ${x}, ${y}`, `print(ut[y, x])  # ${v}`);
    }
    return lines.join('\n');
  }

  // Det samme med opencv.js i nettleseren
  function javascript(kern, { gray = false, abs = false, thresh = null, maxval = null, x = null, y = null, value = null } = {}) {
    const k = kern.k;
    const vals = Array.from(kern.num, String).join(', ');
    const lines = [
      '// <img id="bilde" src="…">',
      "let img = cv.imread('bilde');  // RGBA",
      'let src = new cv.Mat(), ut = new cv.Mat();',
      gray ? 'cv.cvtColor(img, src, cv.COLOR_RGBA2GRAY);' : 'cv.cvtColor(img, src, cv.COLOR_RGBA2BGR);',
      `let kernel = cv.matFromArray(${k}, ${k}, cv.CV_32F, [${vals}]${kern.den !== 1 ? `.map(v => v / ${String(kern.den)})` : ''});`
    ];
    if (abs) lines.push('let tmp = new cv.Mat();', 'cv.filter2D(src, tmp, cv.CV_32F, kernel);', 'cv.convertScaleAbs(tmp, ut);  // |summen|');
    else lines.push('cv.filter2D(src, ut, -1, kernel);  // negative tall blir 0');
    if (thresh !== null) lines.push(`cv.threshold(ut, ut, ${thresh}, ${maxval}, cv.THRESH_BINARY);`);
    if (x !== null) {
      const v = Array.isArray(value) ? '[' + value.join(', ') + ']' : String(value);
      lines.push('', `let x = ${x}, y = ${y};`, `console.log(${Array.isArray(value) ? 'Array.from(ut.ucharPtr(y, x))' : 'ut.ucharPtr(y, x)[0]'});  // ${v}`);
    }
    lines.push(`img.delete(); src.delete(); ut.delete(); kernel.delete();${abs ? ' tmp.delete();' : ''}`);
    return lines.join('\n');
  }

  const api = { PRESETS, preset, make, weights, gaussian1d, reflect101, roundEven, sumAt, finish, filter, filterCv, fmtNum, python, javascript };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Kernel = api;
})(typeof self !== 'undefined' ? self : this);

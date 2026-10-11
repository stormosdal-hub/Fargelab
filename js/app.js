/*
 * app.js – Fargelab for BGR og HSV
 *
 * Innhold (i rekkefølge):
 *   Motor         convert(): bruker cv.cvtColor når OpenCV.js er klar, ellers hsv-kopi.js
 *   Tilstand      st.bgr, st.hsv, hvilken modell du endret sist (st.source)
 *                 og om fargen er hentet fra en piksel i bildet (st.from)
 *   Glidebrytere  bygges fra CH-tabellen
 *   Fargekart     tegner canvas-kartene og håndterer klikk, dra og piltaster
 *   3D-visninger  RGB-kuben (kube3d.js) og HSV-sylinderen (sylinder3d.js)
 *   Bilde         markøren i bildet (bilde.js) setter fargen
 *   Oppsett       kortene kan flyttes og endres (oppsett.js)
 *   Python        Python-fanen (python.js) får fargen og bildet herfra
 *   Kode          Python- og opencv.js-eksempel, pluss fram-og-tilbake-kontrollen
 *   Hovedtegning  render() oppdaterer alt, maks én gang per skjermbilde
 *   Lasting       henter lib/opencv.js (eller jsDelivr som reserve)
 */
(() => {
  'use strict';

  const { bgr2hsvJS, hsv2bgrJS, bgr2grayJS } = window.HsvKopi;

  /* ---------- Motor: OpenCV.js når den er klar, ellers JS-kopien ---------- */
  const engine = { cv: null, state: 'loading', scriptLoadedAt: 0 };

  // dir: 'bgr2hsv', 'hsv2bgr' eller 'bgr2gray' (gir én kanal ut)
  const CV_CODES = { bgr2hsv: 'COLOR_BGR2HSV', hsv2bgr: 'COLOR_HSV2BGR', bgr2gray: 'COLOR_BGR2GRAY' };
  const JS_COPIES = { bgr2hsv: bgr2hsvJS, hsv2bgr: hsv2bgrJS, bgr2gray: bgr2grayJS };

  function convert(arr, n, dir) {
    const cv = engine.cv;
    if (cv) {
      let src = null, dst = null;
      try {
        src = cv.matFromArray(1, n, cv.CV_8UC3, arr);
        dst = new cv.Mat();
        cv.cvtColor(src, dst, cv[CV_CODES[dir]]);
        return new Uint8Array(dst.data);
      } catch (err) {
        console.warn('OpenCV.js feilet, bytter til JS-kopien', err);
        engine.cv = null;
        setStatus('failed');
      } finally {
        if (src) src.delete();
        if (dst) dst.delete();
      }
    }
    return JS_COPIES[dir](arr, n);
  }
  const bgr2hsv = c => Array.from(convert(Uint8Array.from(c), 1, 'bgr2hsv'));
  const hsv2bgr = c => Array.from(convert(Uint8Array.from(c), 1, 'hsv2bgr'));
  const bgr2gray = c => convert(Uint8Array.from(c), 1, 'bgr2gray')[0];

  const $ = id => document.getElementById(id);
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const fmt = a => '[' + a.join(', ') + ']';
  const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

  const statusEl = $('status'), statusText = $('statusText');
  function setStatus(state, where) {
    engine.state = state;
    statusEl.dataset.state = state;
    statusText.textContent = {
      loading: `Laster OpenCV.js fra ${where || 'lib/opencv.js'}. Så lenge regner siden med en JavaScript-kopi av algoritmen, som gir de samme tallene.`,
      ready: `OpenCV.js 4.10 er lastet fra ${where || 'lib/opencv.js'}. Alle konverteringer går gjennom cv.cvtColor.`,
      failed: 'OpenCV.js kunne ikke startes. Sjekk at lib/opencv.js finnes. Siden regner med JavaScript-kopien av algoritmen, som gir de samme tallene.'
    }[state];
  }

  /* ---------- Tilstand ---------- */
  const st = { bgr: [200, 150, 30], hsv: [0, 0, 0], source: 'bgr', from: null };
  st.hsv = bgr2hsv(st.bgr);

  // from = { x, y, name, orig, gray, binary, thresh, maxval } når fargen er hentet
  // fra en piksel i bildet. orig er pikselens egen BGR. gray er gråtonen (i
  // gråtone- og binær modus), binary er 0 eller maxval (i binær modus), ellers null.
  function setFromBGR(c, from = null) {
    st.bgr = c.map(x => clamp(Math.round(x), 0, 255));
    st.hsv = bgr2hsv(st.bgr);
    st.source = 'bgr';
    st.from = from;
    schedule();
  }
  function setFromHSV(c) {
    st.hsv = [clamp(Math.round(c[0]), 0, 179), clamp(Math.round(c[1]), 0, 255), clamp(Math.round(c[2]), 0, 255)];
    st.bgr = hsv2bgr(st.hsv);
    st.source = 'hsv';
    st.from = null;
    schedule();
  }

  /* ---------- Glidebrytere ---------- */
  const CH = {
    bgr: [
      { key: 'B', name: 'blå', max: 255, cls: 'ch-b' },
      { key: 'G', name: 'grønn', max: 255, cls: 'ch-g' },
      { key: 'R', name: 'rød', max: 255, cls: 'ch-r' }
    ],
    hsv: [
      { key: 'H', name: 'nyanse', max: 179, cls: '' },
      { key: 'S', name: 'metning', max: 255, cls: '' },
      { key: 'V', name: 'lysstyrke', max: 255, cls: '' }
    ]
  };
  const ui = { bgr: [], hsv: [] };

  function buildSliders(space, container) {
    CH[space].forEach((ch, i) => {
      const row = document.createElement('div');
      row.className = 'srow';
      const id = `${space}-${i}`;
      row.innerHTML =
        `<label class="sl" for="${id}"><span class="sl-key ${ch.cls}">${ch.key}</span><span class="sl-name">${ch.name}</span></label>` +
        `<input type="range" id="${id}" min="0" max="${ch.max}" step="1">` +
        `<input type="number" class="nbox num" id="${id}-n" min="0" max="${ch.max}" step="1" inputmode="numeric" aria-label="${ch.key} (${ch.name}), verdi 0 til ${ch.max}">`;
      container.appendChild(row);
      const range = row.querySelector('input[type=range]');
      const num = row.querySelector('input[type=number]');
      const apply = val => {
        const c = st[space].slice();
        c[i] = val;
        space === 'bgr' ? setFromBGR(c) : setFromHSV(c);
      };
      range.addEventListener('input', () => apply(Number(range.value)));
      num.addEventListener('input', () => {
        if (num.value === '') return;
        const v = Number(num.value);
        if (Number.isFinite(v)) apply(clamp(Math.round(v), 0, ch.max));
      });
      num.addEventListener('change', () => { num.dataset.force = '1'; schedule(); });
      num.addEventListener('blur', () => { num.dataset.force = '1'; schedule(); });
      ui[space].push({ range, num, max: ch.max });
    });
  }
  buildSliders('bgr', $('bgrSliders'));
  buildSliders('hsv', $('hsvSliders'));

  /* ---------- Forhåndsvalgte farger ---------- */
  const PRESETS = [
    ['Rød', [0, 0, 255]], ['Oransje', [0, 165, 255]], ['Gul', [0, 255, 255]], ['Grønn', [0, 255, 0]],
    ['Cyan', [255, 255, 0]], ['Blå', [255, 0, 0]], ['Lilla', [128, 0, 128]], ['Magenta', [255, 0, 255]],
    ['Rosa', [203, 192, 255]], ['Brun', [42, 42, 165]], ['Hvit', [255, 255, 255]], ['Grå', [128, 128, 128]], ['Svart', [0, 0, 0]]
  ];
  const presetBox = $('presets');
  const presetButtons = PRESETS.map(([name, bgr]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.setAttribute('aria-pressed', 'false');
    btn.innerHTML = `<span class="dot" style="background:rgb(${bgr[2]},${bgr[1]},${bgr[0]})"></span>${name}`;
    btn.addEventListener('click', () => setFromBGR(bgr));
    presetBox.appendChild(btn);
    return { btn, bgr };
  });
  const rnd = document.createElement('button');
  rnd.type = 'button';
  rnd.className = 'chip random';
  rnd.innerHTML = '<span class="dot"></span>Tilfeldig';
  rnd.addEventListener('click', () => setFromBGR([0, 0, 0].map(() => Math.floor(Math.random() * 256))));
  presetBox.appendChild(rnd);

  /* ---------- Fargekart ---------- */
  const BGR_AXES = {
    b: { fixed: 0, x: 2, y: 1 },
    g: { fixed: 1, x: 2, y: 0 },
    r: { fixed: 2, x: 1, y: 0 }
  };
  const HSV_MODES = {
    sv: { fixed: 0, x: 1, y: 2, w: 256, polar: false },
    hs: { fixed: 2, x: 0, y: 1, w: 180, polar: false },
    hv: { fixed: 1, x: 0, y: 2, w: 180, polar: false },
    wheel: { fixed: 2, w: 256, polar: true }
  };
  const BGR_KEYS = ['B', 'G', 'R'], HSV_KEYS = ['H', 'S', 'V'];
  const BGR_CLS = ['ch-b', 'ch-g', 'ch-r'];

  const bgrModeSel = $('bgrMode'), hsvModeSel = $('hsvMode');
  const maps = {
    bgr: { canvas: $('bgrMap'), ctx: $('bgrMap').getContext('2d'), key: '', img: null },
    hsv: { canvas: $('hsvMap'), ctx: $('hsvMap').getContext('2d'), key: '', img: null, buf: null, alpha: null }
  };
  function ensureImg(m, w, h) {
    if (!m.img || m.canvas.width !== w || m.canvas.height !== h) {
      m.canvas.width = w; m.canvas.height = h;
      m.img = m.ctx.createImageData(w, h);
    }
  }

  function renderBGRMap() {
    const mode = bgrModeSel.value, ax = BGR_AXES[mode];
    if (!ax) return;
    const fixedVal = st.bgr[ax.fixed];
    const key = `${mode}:${fixedVal}`;
    const m = maps.bgr;
    if (m.key === key) return;
    m.key = key;
    ensureImg(m, 256, 256);
    const d = m.img.data, c = [0, 0, 0];
    c[ax.fixed] = fixedVal;
    for (let py = 0; py < 256; py++) {
      c[ax.y] = 255 - py;
      for (let px = 0; px < 256; px++) {
        c[ax.x] = px;
        const k = (py * 256 + px) * 4;
        d[k] = c[2]; d[k + 1] = c[1]; d[k + 2] = c[0]; d[k + 3] = 255;
      }
    }
    m.ctx.putImageData(m.img, 0, 0);
  }

  function renderHSVMap() {
    const modeName = hsvModeSel.value, mode = HSV_MODES[modeName];
    if (!mode) return;
    const fixedVal = st.hsv[mode.fixed];
    const key = `${modeName}:${fixedVal}:${engine.cv ? 'cv' : 'js'}`;
    const m = maps.hsv;
    if (m.key === key) return;
    m.key = key;
    const w = mode.w, h = 256, n = w * h;
    ensureImg(m, w, h);
    if (!m.buf || m.buf.length !== n * 3) { m.buf = new Uint8Array(n * 3); m.alpha = new Uint8Array(n); }
    const buf = m.buf, alpha = m.alpha;
    if (mode.polar) {
      for (let py = 0; py < h; py++) {
        const dy = (128 - (py + 0.5)) / 128;
        for (let px = 0; px < w; px++) {
          const dx = (px + 0.5 - 128) / 128;
          const r = Math.hypot(dx, dy);
          let deg = Math.atan2(dy, dx) * 180 / Math.PI;
          if (deg < 0) deg += 360;
          const i = py * w + px, o = i * 3;
          buf[o] = Math.round(deg / 2) % 180;
          buf[o + 1] = Math.min(255, Math.round(r * 255));
          buf[o + 2] = fixedVal;
          alpha[i] = clamp(Math.round(((1 - r) * 128 + 0.5) * 255), 0, 255);
        }
      }
    } else {
      const c = [0, 0, 0];
      c[mode.fixed] = fixedVal;
      for (let py = 0; py < h; py++) {
        c[mode.y] = 255 - py;
        for (let px = 0; px < w; px++) {
          c[mode.x] = px;
          const o = (py * w + px) * 3;
          buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2];
        }
      }
    }
    const bgr = convert(buf, n, 'hsv2bgr');
    const d = m.img.data;
    for (let i = 0; i < n; i++) {
      const o = i * 3, k = i * 4;
      d[k] = bgr[o + 2]; d[k + 1] = bgr[o + 1]; d[k + 2] = bgr[o];
      d[k + 3] = mode.polar ? alpha[i] : 255;
    }
    m.ctx.putImageData(m.img, 0, 0);
  }

  function updateAxes() {
    const ax = BGR_AXES[bgrModeSel.value];
    if (ax) {
      const yN = $('bgrYName'), xN = $('bgrXName');
      yN.textContent = BGR_KEYS[ax.y]; yN.className = 'axis-name ' + BGR_CLS[ax.y];
      xN.textContent = BGR_KEYS[ax.x]; xN.className = 'axis-name ' + BGR_CLS[ax.x];
      $('bgrCaption').textContent = `Kartet viser alle farger med ${BGR_KEYS[ax.fixed]} = ${st.bgr[ax.fixed]}. Flytt ${BGR_KEYS[ax.fixed]}-glidebryteren for å bla gjennom RGB-kuben.`;
    } else {
      const [b, g, r] = st.bgr;
      $('bgrCaption').textContent = `Dra i kuben for å snu den. De fargede rammene viser flatene B = ${b}, G = ${g} og R = ${r}. De krysser hverandre i fargen du har valgt.`;
    }

    const modeName = hsvModeSel.value, mode = HSV_MODES[modeName];
    if (!mode) {
      const [h, s, v] = st.hsv;
      $('hsvCaption').textContent = `Dra i sylinderen for å snu den. H er vinkelen rundt, S er avstanden fra midten og V er høyden. Flatene H = ${h}, S = ${s} og V = ${v} møtes i fargen du har valgt.`;
      return;
    }
    $('hsvMapBox').classList.toggle('polar', mode.polar);
    const fk = HSV_KEYS[mode.fixed], fv = st.hsv[mode.fixed];
    if (mode.polar) {
      $('hsvCaption').textContent = `Vinkelen rundt hjulet er H (0 til 179) og avstanden fra midten er S (0 til 255). V er låst til ${fv}.`;
    } else {
      $('hsvYName').textContent = HSV_KEYS[mode.y];
      $('hsvXName').textContent = HSV_KEYS[mode.x];
      $('hsvXMax').textContent = mode.x === 0 ? '179' : '255';
      const hint = fk === 'H' ? `Flytt H-glidebryteren for å bytte nyanse.` : `Flytt ${fk}-glidebryteren for å endre den.`;
      $('hsvCaption').textContent = `Kartet viser alle farger med ${fk} = ${fv}. ${hint}`;
    }
  }

  function placeMarkers() {
    const ax = BGR_AXES[bgrModeSel.value], bm = $('bgrMarker');
    if (ax) {
      bm.style.left = ((st.bgr[ax.x] + 0.5) / 256 * 100) + '%';
      bm.style.top = ((255 - st.bgr[ax.y] + 0.5) / 256 * 100) + '%';
    }

    const mode = HSV_MODES[hsvModeSel.value], hm = $('hsvMarker');
    if (!mode) return;
    if (mode.polar) {
      const a = st.hsv[0] * 2 * Math.PI / 180, r = st.hsv[1] / 255;
      hm.style.left = (50 + Math.cos(a) * r * 50) + '%';
      hm.style.top = (50 - Math.sin(a) * r * 50) + '%';
    } else {
      hm.style.left = ((st.hsv[mode.x] + 0.5) / mode.w * 100) + '%';
      hm.style.top = ((255 - st.hsv[mode.y] + 0.5) / 256 * 100) + '%';
    }
  }

  function attachMap(frame, onPick, onKey) {
    let dragging = false;
    const pick = e => {
      const r = frame.getBoundingClientRect();
      onPick(clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1));
    };
    frame.addEventListener('pointerdown', e => {
      dragging = true;
      try { frame.setPointerCapture(e.pointerId); } catch (_) {}
      frame.focus({ preventScroll: true });
      pick(e);
      e.preventDefault();
    });
    frame.addEventListener('pointermove', e => { if (dragging) pick(e); });
    frame.addEventListener('pointerup', () => { dragging = false; });
    frame.addEventListener('pointercancel', () => { dragging = false; });
    frame.addEventListener('keydown', e => {
      const step = e.shiftKey ? 10 : 1;
      const delta = { ArrowRight: [step, 0], ArrowLeft: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
      if (!delta) return;
      e.preventDefault();
      onKey(delta[0], delta[1]);
    });
  }

  attachMap($('bgrFrame'),
    (fx, fy) => {
      const ax = BGR_AXES[bgrModeSel.value], c = st.bgr.slice();
      if (!ax) return;
      c[ax.x] = clamp(Math.floor(fx * 256), 0, 255);
      c[ax.y] = 255 - clamp(Math.floor(fy * 256), 0, 255);
      setFromBGR(c);
    },
    (dx, dy) => {
      const ax = BGR_AXES[bgrModeSel.value], c = st.bgr.slice();
      if (!ax) return;
      c[ax.x] += dx; c[ax.y] += dy;
      setFromBGR(c);
    });

  attachMap($('hsvFrame'),
    (fx, fy) => {
      const mode = HSV_MODES[hsvModeSel.value], c = st.hsv.slice();
      if (!mode) return;
      if (mode.polar) {
        const dx = fx * 2 - 1, dy = 1 - fy * 2;
        const r = Math.min(1, Math.hypot(dx, dy));
        let deg = Math.atan2(dy, dx) * 180 / Math.PI;
        if (deg < 0) deg += 360;
        c[0] = Math.round(deg / 2) % 180;
        c[1] = Math.round(r * 255);
      } else {
        c[mode.x] = clamp(Math.floor(fx * mode.w), 0, mode.w - 1);
        c[mode.y] = 255 - clamp(Math.floor(fy * 256), 0, 255);
      }
      setFromHSV(c);
    },
    (dx, dy) => {
      const mode = HSV_MODES[hsvModeSel.value], c = st.hsv.slice();
      if (!mode) return;
      if (mode.polar) {
        c[0] = ((c[0] + dx) % 180 + 180) % 180;
        c[1] += dy;
      } else {
        c[mode.x] += dx; c[mode.y] += dy;
      }
      setFromHSV(c);
    });

  bgrModeSel.addEventListener('change', schedule);
  hsvModeSel.addEventListener('change', schedule);

  /* ---------- 3D-visninger ---------- */
  // Lages først når de skal vises. Mangler three.js eller WebGL, går panelet
  // tilbake til det vanlige fargekartet.
  function setup3D({ select, fallback, factory, host, cut, labels, reset, failText }) {
    const view = { instance: null, failed: false };
    view.ensure = () => {
      if (view.instance || view.failed) return view.instance;
      try {
        if (!window.Scene3D || !window[factory]) throw new Error(`${factory} er ikke lastet`);
        view.instance = window[factory].create($(host));
        view.instance.setCut($(cut).checked);
        view.instance.setLabels($(labels).checked);
      } catch (err) {
        console.warn('3D-visningen kunne ikke startes:', err);
        view.failed = true;
        const opt = select.querySelector('option[value="3d"]');
        if (opt) { opt.disabled = true; opt.textContent = failText; }
        select.value = fallback;
      }
      return view.instance;
    };
    $(cut).addEventListener('change', e => { if (view.instance) view.instance.setCut(e.target.checked); });
    $(labels).addEventListener('change', e => { if (view.instance) view.instance.setLabels(e.target.checked); });
    $(reset).addEventListener('click', () => { if (view.instance) view.instance.resetView(); });
    return view;
  }
  const cube3d = setup3D({
    select: bgrModeSel, fallback: 'b', factory: 'Kube3D',
    host: 'cubeHost', cut: 'cubeCut', labels: 'cubeCorners', reset: 'cubeReset',
    failText: '3D-kube (krever WebGL og lib/three.min.js)'
  });
  const cyl3d = setup3D({
    select: hsvModeSel, fallback: 'sv', factory: 'Sylinder3D',
    host: 'cylHost', cut: 'cylCut', labels: 'cylNames', reset: 'cylReset',
    failText: '3D-sylinder (krever WebGL og lib/three.min.js)'
  });

  /* ---------- Python-fanen ---------- */
  // python.js kjører Python i nettleseren. import fargelab i et skript gir
  // fargen, bildet og markøren slik de står her når du trykker Kjør.
  let bildeFil = null;   // filnavnet til bildet i Bilde-kortet, slik det heter i Python-mappen
  const python = window.Python ? window.Python.create({
    context: () => ({
      bgr: st.bgr, hsv: st.hsv, bilde: bildeFil,
      piksel: st.from ? [st.from.x, st.from.y] : null
    })
  }) : null;

  /* ---------- Bilde ---------- */
  // Markøren i bildet setter fargen som BGR, akkurat som om du dro i glidebryterne.
  // I gråtonemodus er fargen [Y, Y, Y], der Y er gråtonen OpenCV gir pikselen.
  // I binær modus er den [v, v, v], der v er 0 eller maxval fra cv2.threshold.
  const bilde = window.Bilde ? window.Bilde.create({
    bgr2hsv,
    bgr2gray,
    onPick: p => {
      const v = p.binary !== null ? p.binary : p.gray;
      setFromBGR(v === null ? p.bgr : [v, v, v], {
        x: p.x, y: p.y, name: p.name, orig: p.bgr,
        gray: p.gray, binary: p.binary, thresh: p.thresh, maxval: p.maxval
      });
    },
    // Bildet legges også i Python-mappen, så cv2.imread(navn) virker i Python-fanen.
    // Bilder fra bilder/ kommer dit av seg selv (med server.py).
    onFile: (file, info) => {
      bildeFil = info.fromFolder ? info.name : python ? python.addFile(file) : file.name;
      return bildeFil;
    },
    // Mappen bilder/ i prosjektet, når siden er startet med server.py
    folder: window.Mapper ? {
      ready: Mapper.available(),
      list: async () => (await Mapper.list('bilder')).map(f => f.navn).filter(Mapper.isImage),
      open: async navn => new File([(await Mapper.read('bilder', navn)).data], navn, { type: Mapper.imageType(navn) }),
      save: async file => {
        const navn = Mapper.uniqueName(file.name || 'bilde.png', (await Mapper.list('bilder')).map(f => f.navn));
        await Mapper.write('bilder', navn, await file.arrayBuffer(), { mtime: 'ny' });
        return navn;
      }
    } : null,
    onClear: () => { bildeFil = null; if (st.from) { st.from = null; schedule(); } }
  }) : null;

  /* ---------- Oppsett av kortene ---------- */
  // Kortene kan flyttes og endres (oppsett.js). Dette er standardoppsettet.
  if (window.Oppsett) window.Oppsett.create({
    board: $('board'),
    cards: { bilde: $('imgPanel'), bgr: $('bgrPanel'), hsv: $('hsvPanel') },
    defaults: [
      [{ id: 'bilde', span: 12, h: null }],
      [{ id: 'bgr', span: 6, h: null }, { id: 'hsv', span: 6, h: null }]
    ],
    resetBtn: $('layoutReset'),
    live: $('boardLive')
  });

  /* ---------- Kode og rundtur ---------- */
  let lang = 'py';
  document.querySelectorAll('.seg button').forEach(btn => {
    btn.addEventListener('click', () => {
      lang = btn.dataset.lang;
      document.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
      schedule();
    });
  });
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const npPad = a => {
    const w = Math.max(...a.map(x => String(x).length));
    return a.map(x => String(x).padStart(w, ' ')).join(' ');
  };
  const npFmt = a => '[[[' + npPad(a) + ']]]';
  const pyStr = s => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  const cm = s => `<span class="cm">${esc(s)}</span>`;

  // Når fargen er hentet fra bildet, vises koden for å lese samme piksel i OpenCV
  function renderPixelCode() {
    const { x, y, name, gray, orig, binary, thresh, maxval } = st.from;
    let html;
    if (binary !== null) {
      // Binær modus: gråtone, så cv2.threshold med THRESH_BINARY
      if (lang === 'py') {
        html = esc(`import cv2\n\nimg = cv2.imread(${pyStr(name)})  `) + cm('# leses som BGR') +
          esc(`\ngray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)\n_, binary = cv2.threshold(gray, ${thresh}, ${maxval}, cv2.THRESH_BINARY)\n\nx, y = ${x}, ${y}\nprint(gray[y, x])    `) + cm(`# ${gray}`) +
          esc(`\nprint(binary[y, x])  `) + cm(`# ${binary}`);
      } else {
        html = cm(`// <img id="bilde" src="${name}">`) +
          esc(`\nlet img = cv.imread('bilde');  `) + cm('// RGBA') +
          esc(`\nlet gray = new cv.Mat(), binary = new cv.Mat();\ncv.cvtColor(img, gray, cv.COLOR_RGBA2GRAY);\ncv.threshold(gray, binary, ${thresh}, ${maxval}, cv.THRESH_BINARY);\n\nlet x = ${x}, y = ${y};\nconsole.log(binary.ucharPtr(y, x)[0]);  `) + cm(`// ${binary}`) +
          esc(`\nimg.delete(); gray.delete(); binary.delete();`);
      }
      $('code').innerHTML = html;
      return;
    }
    if (gray !== null) {
      // Gråtonemodus: samme piksel lest fra cv2.cvtColor(..., COLOR_BGR2GRAY)
      if (lang === 'py') {
        html = esc(`import cv2\n\nimg = cv2.imread(${pyStr(name)})  `) + cm('# leses som BGR') +
          esc(`\ngray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)\n\nx, y = ${x}, ${y}\nprint(img[y, x])   `) + cm(`# [${npPad(orig)}]`) +
          esc(`\nprint(gray[y, x])  `) + cm(`# ${gray}`);
      } else {
        html = cm(`// <img id="bilde" src="${name}">`) +
          esc(`\nlet img = cv.imread('bilde');  `) + cm('// RGBA') +
          esc(`\nlet gray = new cv.Mat();\ncv.cvtColor(img, gray, cv.COLOR_RGBA2GRAY);\n\nlet x = ${x}, y = ${y};\nconsole.log(gray.ucharPtr(y, x)[0]);  `) + cm(`// ${gray}`) +
          esc(`\nimg.delete(); gray.delete();`);
      }
      $('code').innerHTML = html;
      return;
    }
    if (lang === 'py') {
      html = esc(`import cv2\n\nimg = cv2.imread(${pyStr(name)})  `) + cm('# leses som BGR') +
        esc(`\nhsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)\n\nx, y = ${x}, ${y}\nprint(img[y, x])  `) + cm(`# [${npPad(st.bgr)}]`) +
        esc(`\nprint(hsv[y, x])  `) + cm(`# [${npPad(st.hsv)}]`);
    } else {
      html = cm(`// <img id="bilde" src="${name}">`) +
        esc(`\nlet img = cv.imread('bilde');  `) + cm('// RGBA') +
        esc(`\nlet bgr = new cv.Mat(), hsv = new cv.Mat();\ncv.cvtColor(img, bgr, cv.COLOR_RGBA2BGR);\ncv.cvtColor(bgr, hsv, cv.COLOR_BGR2HSV);\n\nlet x = ${x}, y = ${y};\nconsole.log(Array.from(bgr.ucharPtr(y, x)));  `) + cm('// ' + fmt(st.bgr)) +
        esc(`\nconsole.log(Array.from(hsv.ucharPtr(y, x)));  `) + cm('// ' + fmt(st.hsv)) +
        esc(`\nimg.delete(); bgr.delete(); hsv.delete();`);
    }
    $('code').innerHTML = html;
  }

  function renderCode() {
    if (st.from) { renderPixelCode(); return; }
    const fromBGR = st.source === 'bgr';
    const inp = fromBGR ? st.bgr : st.hsv, out = fromBGR ? st.hsv : st.bgr;
    const code = fromBGR ? 'COLOR_BGR2HSV' : 'COLOR_HSV2BGR';
    const inName = fromBGR ? 'bgr' : 'hsv', outName = fromBGR ? 'hsv' : 'bgr';
    let html;
    if (lang === 'py') {
      html = esc(`import cv2\nimport numpy as np\n\n${inName} = np.uint8([[[${inp.join(', ')}]]])\n${outName} = cv2.cvtColor(${inName}, cv2.${code})\nprint(${outName})  `) +
        `<span class="cm">${esc('# ' + npFmt(out))}</span>`;
    } else {
      html = esc(`let src = cv.matFromArray(1, 1, cv.CV_8UC3, [${inp.join(', ')}]);\nlet dst = new cv.Mat();\ncv.cvtColor(src, dst, cv.${code});\nconsole.log(Array.from(dst.data));  `) +
        `<span class="cm">${esc('// ' + fmt(out))}</span>` + esc(`\nsrc.delete(); dst.delete();`);
    }
    $('code').innerHTML = html;
  }

  function renderRoundTrip() {
    const chain = $('chain'), txt = $('rtText');
    if (st.source === 'bgr') {
      const back = hsv2bgr(st.hsv), ok = same(back, st.bgr);
      chain.innerHTML =
        `<dt>Valgt BGR</dt><dd>${fmt(st.bgr)}</dd>` +
        `<dt>Til HSV</dt><dd>${fmt(st.hsv)}</dd>` +
        `<dt>Tilbake til BGR</dt><dd>${fmt(back)}<span class="verdict">${ok ? 'samme' : 'litt annerledes'}</span></dd>`;
      txt.textContent = ok
        ? 'Denne fargen overlever turen fra BGR til HSV og tilbake uten endring.'
        : `Avviket kommer av avrunding. H har bare 180 trinn i OpenCV, så ikke alle BGR-farger kan treffes helt eksakt når de går via HSV.`;
    } else {
      const back = bgr2hsv(st.bgr), ok = same(back, st.hsv);
      chain.innerHTML =
        `<dt>Valgt HSV</dt><dd>${fmt(st.hsv)}</dd>` +
        `<dt>Til BGR</dt><dd>${fmt(st.bgr)}</dd>` +
        `<dt>Tilbake til HSV</dt><dd>${fmt(back)}<span class="verdict">${ok ? 'samme' : 'endret'}</span></dd>`;
      let reason;
      if (ok) reason = 'Disse HSV-verdiene overlever turen via BGR og tilbake uten endring.';
      else if (st.hsv[2] === 0) reason = 'Når V er 0 er fargen svart, og da betyr verken H eller S noe. OpenCV setter dem til 0 på veien tilbake.';
      else if (back[1] === 0) reason = 'Fargen ble grå i BGR (alle tre kanaler er like), og da betyr H ingenting. OpenCV setter H og S til 0 på veien tilbake.';
      else reason = 'Avviket kommer av avrunding. BGR har bare 256 trinn per kanal, så flere nabo-verdier i HSV havner på samme BGR-farge.';
      txt.textContent = reason;
    }
  }

  /* ---------- Hovedtegning ---------- */
  function relLum(r, g, b) {
    const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }

  function renderSliders(space) {
    const vals = st[space];
    ui[space].forEach((u, i) => {
      if (Number(u.range.value) !== vals[i]) u.range.value = vals[i];
      const typing = document.activeElement === u.num && !u.num.dataset.force && Number(u.num.value) === vals[i];
      if (!typing) u.num.value = vals[i];
      delete u.num.dataset.force;
    });
  }

  function renderTracks(rgbCss) {
    const [b, g, r] = st.bgr;
    ui.bgr.forEach((u, i) => {
      const lo = [b, g, r], hi = [b, g, r];
      lo[i] = 0; hi[i] = 255;
      u.range.style.setProperty('--track', `linear-gradient(90deg, rgb(${lo[2]},${lo[1]},${lo[0]}), rgb(${hi[2]},${hi[1]},${hi[0]}))`);
      u.range.style.setProperty('--thumb', rgbCss);
    });

    const stops = [
      Array.from({ length: 19 }, (_, k) => Math.min(179, k * 10)),
      Array.from({ length: 9 }, (_, k) => Math.min(255, k * 32)),
      Array.from({ length: 9 }, (_, k) => Math.min(255, k * 32))
    ];
    const total = stops.reduce((s, a) => s + a.length, 0);
    const arr = new Uint8Array(total * 3);
    let p = 0;
    stops.forEach((list, ch) => list.forEach(val => {
      const c = st.hsv.slice(); c[ch] = val;
      arr[p++] = c[0]; arr[p++] = c[1]; arr[p++] = c[2];
    }));
    const out = convert(arr, total, 'hsv2bgr');
    let q = 0;
    ui.hsv.forEach((u, ch) => {
      const parts = stops[ch].map(val => {
        const o = q * 3; q++;
        return `rgb(${out[o + 2]},${out[o + 1]},${out[o]}) ${(val / u.max * 100).toFixed(2)}%`;
      });
      u.range.style.setProperty('--track', `linear-gradient(90deg, ${parts.join(', ')})`);
      u.range.style.setProperty('--thumb', rgbCss);
    });
  }

  let pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(render);
  }

  function render() {
    pending = false;
    const [b, g, r] = st.bgr, [h, s, v] = st.hsv;
    const rgbCss = `rgb(${r},${g},${b})`;

    const hero = $('hero');
    hero.style.background = rgbCss;
    const L = relLum(r, g, b);
    hero.style.setProperty('--hero-ink', (L + 0.05) / 0.05 >= 1.05 / (L + 0.05) ? '#000' : '#fff');
    $('roBGR').textContent = fmt(st.bgr);
    $('roHSV').textContent = fmt(st.hsv);
    $('roStd').textContent = `${h * 2}°, ${Math.round(s / 255 * 100)} %, ${Math.round(v / 255 * 100)} %`;
    $('roHex').textContent = '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
    $('roPixBox').hidden = !st.from;
    if (st.from) {
      const kind = st.from.binary !== null ? ', binær' : st.from.gray !== null ? ', gråtone' : '';
      $('roPix').textContent = `x ${st.from.x}, y ${st.from.y}${kind}`;
    }
    if (bilde) bilde.sync(!!st.from);

    renderSliders('bgr');
    renderSliders('hsv');
    renderTracks(rgbCss);
    const cubeOn = bgrModeSel.value === '3d' && !!cube3d.ensure();
    $('bgrMapBox').hidden = cubeOn;
    $('cube3dBox').hidden = !cubeOn;
    $('cubeControls').hidden = !cubeOn;
    if (cubeOn) cube3d.instance.update(st.bgr);
    const cylOn = hsvModeSel.value === '3d' && !!cyl3d.ensure();
    $('hsvMapBox').hidden = cylOn;
    $('cyl3dBox').hidden = !cylOn;
    $('cylControls').hidden = !cylOn;
    if (cylOn) cyl3d.instance.update(st.hsv, st.bgr);
    renderBGRMap();
    renderHSVMap();
    updateAxes();
    placeMarkers();

    const bridge = $('bridge');
    bridge.dataset.dir = st.source;
    $('bridgeLabel').textContent = st.source === 'bgr' ? 'BGR2HSV' : 'HSV2BGR';

    renderCode();
    renderRoundTrip();
    presetButtons.forEach(pb => pb.btn.setAttribute('aria-pressed', String(same(pb.bgr, st.bgr))));
  }

  render();

  /* ---------- Lasting av OpenCV.js ---------- */
  // Prøver den lokale filen først, og jsDelivr hvis den mangler.
  // Skriptet lastes herfra (ikke med en <script>-tagg i index.html) slik at
  // siden vises med en gang og kan bytte kilde hvis en fil ikke finnes.
  const OPENCV_SOURCES = [
    { url: 'lib/opencv.js', name: 'lib/opencv.js' },
    { url: 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js', name: 'jsDelivr' }
  ];
  let activeSource = OPENCV_SOURCES[0].name;
  let waitTimer = null;

  function loadOpenCV(i) {
    if (i >= OPENCV_SOURCES.length) { setStatus('failed'); return; }
    const source = OPENCV_SOURCES[i];
    activeSource = source.name;
    setStatus('loading', source.name);
    const script = document.createElement('script');
    script.src = source.url;
    script.async = true;
    script.onload = () => waitForRuntime(performance.now());
    script.onerror = () => { script.remove(); loadOpenCV(i + 1); };
    document.body.appendChild(script);
  }

  // Skriptfilen er lastet, men WebAssembly-delen må også starte før cv.Mat finnes.
  let thenHooked = false;
  function waitForRuntime(loadedAt) {
    clearTimeout(waitTimer);
    const c = window.cv;
    if (c && typeof c.Mat === 'function' && typeof c.cvtColor === 'function') { onCvReady(c); return; }
    // Enkelte bygg eksporterer et Promise i stedet for selve modulen.
    // (Emscripten-moduler har også en egen then(), så vi kobler oss på bare én gang.)
    if (c && typeof c.then === 'function' && !thenHooked) {
      thenHooked = true;
      c.then(mod => { if (mod && mod !== c && typeof mod.Mat === 'function') window.cv = mod; });
    }
    if (performance.now() - loadedAt > 20000) { setStatus('failed'); return; }
    waitTimer = setTimeout(() => waitForRuntime(loadedAt), 100);
  }

  function onCvReady(cv) {
    try {
      const test = cv.matFromArray(1, 1, cv.CV_8UC3, [255, 0, 0]), out = new cv.Mat();
      cv.cvtColor(test, out, cv.COLOR_BGR2HSV);
      const okTest = out.data[0] === 120 && out.data[1] === 255 && out.data[2] === 255;
      test.delete(); out.delete();
      if (!okTest) throw new Error('uventet testresultat');
    } catch (err) {
      console.warn(err);
      setStatus('failed');
      return;
    }
    engine.cv = cv;
    setStatus('ready', activeSource);
    maps.hsv.key = '';
    if (st.source === 'bgr') setFromBGR(st.bgr, st.from); else setFromHSV(st.hsv);
  }

  loadOpenCV(0);
})();

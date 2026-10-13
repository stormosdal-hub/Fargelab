/*
 * bilde.js – hent farger fra et bilde
 *
 * Du kan velge en fil, slippe et bilde hvor som helst på siden eller lime
 * det inn med Ctrl+V. En markør viser hvilken piksel som er valgt:
 *   - klikk eller dra i bildet for å flytte den
 *   - piltastene flytter én piksel (Shift gir 10)
 *   - luppen viser 15 × 15 piksler rundt markøren, og et klikk i luppen
 *     velger nabopikselen du klikket på
 *
 * Fargene leses fra en kopi av bildet i full oppløsning, ikke fra det
 * forminskede bildet du ser. Bildet dekodes med colorSpaceConversion: 'none',
 * slik at en innebygd fargeprofil (for eksempel Display P3) ikke regnes om.
 * Det er det samme som cv2.imread gjør. EXIF-rotasjon brukes, som i OpenCV.
 *
 * Gråtonemodus: bildet og luppen vises i gråtoner, og pikselen får en
 * gråtone Y i tillegg til BGR. Y regnes ut som cv2.cvtColor(..., COLOR_BGR2GRAY).
 *
 * Kernel-modus: cv2.filter2D med en kernel (kernel.js) i en linse rundt
 * markøren, i luppen og som tall før og etter i et panel under bildet.
 *
 * Ingenting lastes opp. Bildet blir værende i nettleseren.
 *
 * Bruk:
 *   const bilde = Bilde.create({
 *     bgr2hsv,           // regner om én farge, til tallene ved luppen
 *     bgr2gray,          // gir gråtonen (0–255) til én farge
 *     cv: () => cv,      // OpenCV.js når den er klar, ellers null (valgfri, gjør Kernel-linsen raskere)
 *     onPick(p)  { ... }, // p = { x, y, bgr: [b, g, r], gray, binary, thresh, maxval, kernel, kernelInfo, alpha, name }
 *                         // gray er null når gråtonemodus er av, binary osv. når binær modus er av.
 *                         // kernel er verdien etter kernelen ([b, g, r] eller grå), ellers null.
 *     onFile(file, info) { ... }, // et nytt bilde er lest inn eller lagret i bilder/.
 *                         // info = { fromFolder, name }. Gir filnavnet som skal brukes.
 *     folder: { ready, list(), open(navn), save(file) }  // mappen bilder/ (valgfri, krever server.py)
 *     onClear()  { ... }  // bildet ble fjernet
 *   });
 *   bilde.sync(linked);   // true når fargekartene viser pikselen under markøren
 */
(function (root) {
  'use strict';

  // Større bilder skaleres ned. Først prøves 36 MP, så 16 MP (grensen i Safari).
  const MAX_PIXELS = [36e6, 16e6];
  const LOUPE_N = 15;                  // luppen viser 15 × 15 piksler
  const HALF = (LOUPE_N - 1) / 2;      // markøren ligger i rute nr. 7

  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const fmt = a => '[' + a.join(', ') + ']';
  const isImage = f => f && (!f.type || f.type.startsWith('image/'));

  /* ---------- Lese filen ---------- */
  // Gir { src, release }. src kan tegnes med drawImage, release frigjør minnet.
  async function decode(file) {
    if (typeof root.createImageBitmap === 'function') {
      // Eldre nettlesere kjenner ikke alle valgene og kaster TypeError. Da prøver vi neste.
      const tries = [
        { colorSpaceConversion: 'none', imageOrientation: 'from-image' },
        { colorSpaceConversion: 'none' }
      ];
      for (const opts of tries) {
        try {
          const bmp = await root.createImageBitmap(file, opts);
          return { src: bmp, w: bmp.width, h: bmp.height, release: () => bmp.close() };
        } catch (_) { /* prøv neste */ }
      }
    }
    // Reserve: et vanlig <img>-element (her regner nettleseren om fargeprofilen)
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.src = url;
    try {
      await el.decode();
    } catch (err) {
      URL.revokeObjectURL(url);
      throw err;
    }
    return { src: el, w: el.naturalWidth, h: el.naturalHeight, release: () => URL.revokeObjectURL(url) };
  }

  // Tegner bildet i et lerret i full oppløsning, så hver piksel kan leses av.
  function rasterize(dec) {
    let lastErr = null;
    for (const max of MAX_PIXELS) {
      const k = Math.min(1, Math.sqrt(max / (dec.w * dec.h)));
      const w = Math.max(1, Math.floor(dec.w * k)), h = Math.max(1, Math.floor(dec.h * k));
      try {
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('fikk ikke laget et lerret');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(dec.src, 0, 0, w, h);
        ctx.getImageData(0, 0, 1, 1);  // kaster hvis lerretet ble for stort
        return { canvas, ctx, w, h, scaledFrom: k < 1 ? [dec.w, dec.h] : null };
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  function create(cfg) {
    const $ = id => document.getElementById(id);
    const panel = $('imgPanel'), sub = $('imgSub'), msg = $('imgMsg');
    const pickBtn = $('imgPick'), clearBtn = $('imgClear'), fileInput = $('imgFile');
    const folderSel = $('imgFolderSel'), saveFolderBtn = $('imgSaveFolder');
    let folderOk = false;   // true når mappen bilder/ kan brukes (server.py)
    const body = $('imgBody'), hint = $('imgHint'), stage = $('imgStage');
    const frame = $('imgFrame'), view = $('imgView'), marker = $('imgMarker');
    const loupe = $('imgLoupe'), lctx = loupe.getContext('2d');
    const grayBox = $('imgGrayBox'), grayToggle = $('imgGray');
    const binBox = $('imgBinBox'), binToggle = $('imgBin'), threshPanel = $('imgThresh');
    const tRange = $('imgT'), tNum = $('imgTn'), mRange = $('imgM'), mNum = $('imgMn');
    const out = {
      xy: $('imgXY'), swatch: $('imgSwatch'), bgr: $('imgBGR'), hsv: $('imgHSV'),
      grayDt: $('imgGrayDt'), grayDd: $('imgGrayDd'), graySwatch: $('imgGraySwatch'), gray: $('imgGrayVal'),
      binDt: $('imgBinDt'), binDd: $('imgBinDd'), binSwatch: $('imgBinSwatch'), bin: $('imgBinVal'),
      kernDt: $('imgKernDt'), kernDd: $('imgKernDd'), kernSwatch: $('imgKernSwatch'), kern: $('imgKernVal'),
      grayNote: $('imgGrayNote'), binNote: $('imgBinNote'),
      alpha: $('imgAlpha'), link: $('imgLink'), apply: $('imgApply')
    };
    // Kernel-modus: linsen over bildet og panelet med kernelen og pikslene før og etter
    const K = root.Kernel;
    const kernBox = $('imgKernBox'), kernToggle = $('imgKern'), kernPanel = $('imgKernel'), lens = $('imgLens');
    const kp = {
      type: $('kernType'), size: $('kernSize'), sigmaBox: $('kernSigmaBox'), sigma: $('kernSigma'), sigmaVal: $('kernSigmaVal'),
      neg: $('kernNeg'), area: $('kernArea'), chBox: $('kernChBox'), about: $('kernAbout'),
      before: $('kernBefore'), beforeSub: $('kernBeforeSub'), matrix: $('kernMatrix'), matSub: $('kernMatSub'),
      den: $('kernDen'), after: $('kernAfter'), afterSub: $('kernAfterSub'), calc: $('kernCalc'), code: $('kernCode')
    };
    const subEmpty = sub.textContent;
    // Samme regler som OpenCV, brukt på hele bildet og luppen (se hsv-kopi.js)
    const { gray1, binary1 } = root.HsvKopi;

    let img = null;                    // { canvas, ctx, w, h, scaledFrom, name }
    const pos = { x: 0, y: 0 };
    let pixel = null;                  // siste piksel som ble lest av
    let linked = false;
    let grayMode = grayToggle.checked;
    // Binær modus: cv2.threshold(grå, thresh, maxval, THRESH_BINARY). Bruker alltid gråtone.
    let binMode = binToggle.checked;
    let thresh = Number(tRange.value), maxval = Number(mRange.value);
    let loadToken = 0;
    // Kernel-modus: cv2.filter2D med kernelen kern på bildet rundt markøren (kernel.js)
    let kernMode = !!K && kernToggle.checked;
    let kern = K ? K.make('box', Number(kp.size.value) || 3) : null;
    let kernAbs = kp.neg.value === 'abs';
    let kernCh = 'R';         // kanalen tallene viser i fargebilder
    let focusCell = null;     // [rad, kolonne] i Etter som du peker på, ellers midten

    const filtered = () => grayMode || binMode;           // vises bildet i gråtoner?
    const tone = v => (binMode ? binary1(v, thresh, maxval) : v);
    // Kanaler i et RGBA-lerret til verdien som vises i gråtone- eller binær modus
    const toneRGBA = (d, k) => tone(gray1(d[k + 2], d[k + 1], d[k]));

    function showMsg(text, kind) {
      msg.hidden = !text;
      msg.textContent = text || '';
      msg.dataset.kind = kind || '';
    }

    /* ---------- Laste inn og fjerne ---------- */
    // fromFolder: bildet er åpnet fra mappen bilder/
    async function load(file, { fromFolder = false } = {}) {
      const token = ++loadToken;
      let name = file.name || 'bilde.png';
      showMsg(`Leser ${name} …`);
      let dec = null, made;
      try {
        dec = await decode(file);
        if (token !== loadToken) return;
        made = rasterize(dec);
      } catch (err) {
        if (token !== loadToken) return;
        console.warn('Bildet kunne ikke leses:', err);
        showMsg(`Klarte ikke å åpne ${name}. Prøv et bilde i PNG-, JPEG-, WebP- eller GIF-format.`, 'error');
        return;
      } finally {
        if (dec) dec.release();
      }

      if (img) img.canvas.width = img.canvas.height = 0;
      if (cfg.onFile) name = cfg.onFile(file, { fromFolder, name }) || name;
      img = { ...made, name, file, fromFolder };
      panel.classList.add('has-image');
      body.hidden = false;
      hint.hidden = false;
      clearBtn.hidden = false;
      grayBox.hidden = false;
      binBox.hidden = false;
      threshPanel.hidden = !binMode;
      kernBox.hidden = !K;
      kernPanel.hidden = !kernMode;
      lensCache = fullCache = null;
      pickBtn.textContent = 'Bytt bilde';
      describe();
      showMsg('');
      layout(true);
      pos.x = Math.floor(img.w / 2);
      pos.y = Math.floor(img.h / 2);
      pick();
      frame.focus({ preventScroll: true });
      const reduce = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
      panel.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    }

    // Undertittelen: filnavn, størrelse og om bildet ligger i bilder/
    function describe() {
      const name = img.fromFolder ? `bilder/${img.name}` : img.name;
      sub.textContent = img.scaledFrom
        ? `${name}, skalert ned fra ${img.scaledFrom[0]} × ${img.scaledFrom[1]} til ${img.w} × ${img.h} piksler. Koordinatene gjelder den nedskalerte versjonen.`
        : `${name}, ${img.w} × ${img.h} piksler`;
      saveFolderBtn.hidden = !folderOk || img.fromFolder;
    }

    function clear() {
      loadToken++;
      if (img) img.canvas.width = img.canvas.height = 0;
      img = null;
      pixel = null;
      view.width = view.height = 0;
      panel.classList.remove('has-image');
      body.hidden = true;
      hint.hidden = true;
      clearBtn.hidden = true;
      saveFolderBtn.hidden = true;
      grayBox.hidden = true;
      binBox.hidden = true;
      threshPanel.hidden = true;
      kernBox.hidden = true;
      kernPanel.hidden = true;
      lens.hidden = true;
      lensCache = fullCache = null;
      viewData = viewGray = null;
      pickBtn.textContent = 'Velg bilde';
      sub.textContent = subEmpty;
      showMsg('');
      pickBtn.focus();
      cfg.onClear();
    }

    /* ---------- Plassering av bildet ---------- */
    // Bildet tegnes på nytt i akkurat den størrelsen det vises i. Forminsket
    // bilde blir glattet, forstørret bilde får skarpe piksler.
    // Har du valgt en fast høyde på kortet (oppsett.js), setter CSS --fit-fixed
    // på stage, og da fyller bildet den høyden.
    function layout(force) {
      if (!img) return;
      const availW = stage.clientWidth;
      if (!availW) return;
      const fixed = getComputedStyle(stage).getPropertyValue('--fit-fixed').trim() === '1';
      const maxH = fixed ? Math.max(1, stage.clientHeight) : clamp(root.innerHeight * 0.55, 240, 520);
      const k = Math.min(availW / img.w, maxH / img.h, 64);
      const cssW = Math.max(1, Math.round(img.w * k)), cssH = Math.max(1, Math.round(img.h * k));
      frame.style.width = cssW + 'px';
      frame.style.height = cssH + 'px';
      const dpr = root.devicePixelRatio || 1;
      const pw = Math.round(cssW * dpr), ph = Math.round(cssH * dpr);
      if (!force && view.width === pw && view.height === ph) return;
      view.width = pw; view.height = ph;
      const ctx = view.getContext('2d');
      ctx.imageSmoothingEnabled = pw < img.w;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img.canvas, 0, 0, pw, ph);
      viewData = viewGray = null;
      if (filtered()) {
        // Gråtonen regnes ut på det ferdig skalerte bildet. Både skalering og
        // gråtone er vektede gjennomsnitt, så det blir likt (pluss/minus
        // avrunding) som å gjøre bildet grått først. Tallene ved luppen leses
        // fra originalen. Gråtonene huskes, så terskelen kan endres raskt.
        viewData = ctx.getImageData(0, 0, pw, ph);
        const d = viewData.data;
        viewGray = new Uint8Array(pw * ph);
        for (let i = 0, k = 0; i < viewGray.length; i++, k += 4) viewGray[i] = gray1(d[k + 2], d[k + 1], d[k]);
        paintFiltered();
      }
    }
    let viewData = null, viewGray = null;   // det viste bildet og gråtonene i det

    // Maler det viste bildet i gråtone eller binært ut fra gråtonene i viewGray
    function paintFiltered() {
      if (!viewData) return;
      const d = viewData.data;
      for (let i = 0, k = 0; i < viewGray.length; i++, k += 4) d[k] = d[k + 1] = d[k + 2] = tone(viewGray[i]);
      view.getContext('2d').putImageData(viewData, 0, 0);
    }
    let layoutQueued = false;
    function queueLayout() {
      if (layoutQueued) return;
      layoutQueued = true;
      requestAnimationFrame(() => { layoutQueued = false; layout(false); if (pixel) scheduleDraw(); });
    }
    if (root.ResizeObserver) new ResizeObserver(queueLayout).observe(stage);
    root.addEventListener('resize', queueLayout);

    /* ---------- Markøren ---------- */
    // Gråtone, verdien etter kernelen og binærverdi for pikselen, ut fra modus, thresh og maxval.
    // kernel er [B, G, R] eller en gråtone, og binærverdien regnes da av den.
    function derive(p) {
      p.gray = filtered() ? cfg.bgr2gray(p.bgr) : null;
      p.kernel = null;
      p.kernelInfo = null;
      if (kernMode && img) {
        const { out, src } = applyKernel({ x: p.x, y: p.y, w: 1, h: 1 });
        p.kernel = src.stride === 4 ? [out[2], out[1], out[0]] : out[0];
        p.kernelInfo = { kern, gray: kernGray(), abs: kernAbs };
      }
      p.binary = binMode ? binary1(p.kernel !== null ? p.kernel : p.gray, thresh, maxval) : null;
      p.thresh = binMode ? thresh : null;
      p.maxval = binMode ? maxval : null;
      return p;
    }

    function pick() {
      const d = img.ctx.getImageData(pos.x, pos.y, 1, 1).data;
      pixel = derive({ x: pos.x, y: pos.y, bgr: [d[2], d[1], d[0]], alpha: d[3], name: img.name });
      cfg.onPick(pixel);
      scheduleDraw();
    }

    // Etter at modus eller terskel er endret: viser fargekartene pikselen, får
    // de den nye verdien med en gang. Ellers oppdateres bare tallene ved luppen.
    function refresh() {
      if (!pixel) return;
      if (linked) pick();
      else { derive(pixel); scheduleDraw(); }
    }

    grayToggle.addEventListener('change', () => {
      grayMode = grayToggle.checked;
      if (!img) return;
      layout(true);
      refresh();
    });

    binToggle.addEventListener('change', () => {
      binMode = binToggle.checked;
      // Binær bruker alltid gråtone, så Gråtone-valget har ingen virkning så lenge
      grayToggle.disabled = binMode;
      grayBox.classList.toggle('is-disabled', binMode);
      if (!img) return;
      threshPanel.hidden = !binMode;
      layout(true);
      refresh();
    });

    /* ---------- Glidebryterne for thresh og maxval ---------- */
    function paintTracks() {
      const p = ((thresh + 1) / 256 * 100).toFixed(2);
      // Alt til venstre for tommelen blir 0, alt til høyre blir maxval
      tRange.style.setProperty('--track', `linear-gradient(90deg, #000 0 ${p}%, rgb(${maxval},${maxval},${maxval}) ${p}% 100%)`);
      tRange.style.setProperty('--thumb', `rgb(${thresh},${thresh},${thresh})`);
      mRange.style.setProperty('--track', 'linear-gradient(90deg, #000, #fff)');
      mRange.style.setProperty('--thumb', `rgb(${maxval},${maxval},${maxval})`);
    }
    let threshQueued = false;
    function setThreshold(t, m) {
      thresh = clamp(Math.round(t), 0, 255);
      maxval = clamp(Math.round(m), 0, 255);
      tRange.value = thresh;
      mRange.value = maxval;
      if (document.activeElement !== tNum) tNum.value = thresh;
      if (document.activeElement !== mNum) mNum.value = maxval;
      paintTracks();
      if (threshQueued) return;
      threshQueued = true;
      requestAnimationFrame(() => {
        threshQueued = false;
        paintFiltered();
        refresh();
      });
    }
    tRange.addEventListener('input', () => setThreshold(Number(tRange.value), maxval));
    mRange.addEventListener('input', () => setThreshold(thresh, Number(mRange.value)));
    [[tNum, v => setThreshold(v, maxval)], [mNum, v => setThreshold(thresh, v)]].forEach(([num, apply]) => {
      num.addEventListener('input', () => {
        if (num.value === '') return;
        const v = Number(num.value);
        if (Number.isFinite(v)) apply(v);
      });
      num.addEventListener('blur', () => { tNum.value = thresh; mNum.value = maxval; });
    });
    // Nettleseren kan huske avkrysninger og verdier fra forrige gang siden var åpen
    tNum.value = thresh;
    mNum.value = maxval;
    grayToggle.disabled = binMode;
    grayBox.classList.toggle('is-disabled', binMode);
    paintTracks();

    /* ---------- Kernel-modus ---------- */
    // cv2.filter2D med kernelen på bildet: i en linse rundt markøren (eller på hele
    // bildet), i luppen, og som tall i panelet under bildet. I gråtone- og binær
    // modus virker kernelen på gråtonen, og binær modus bruker terskelen på resultatet.
    const kernGray = () => grayMode || binMode;
    const RGBA_CH = { B: 2, G: 1, R: 0 };   // plassen til kanalen i RGBA fra lerretet
    const nb = (x, d = 3) => x.toLocaleString('nb-NO', { maximumFractionDigits: d });

    // Pikslene i et område pluss en marg, klippet til bildet. I gråtone- og binær
    // modus regnes gråtonen ut først, som cv2.cvtColor(..., COLOR_BGR2GRAY).
    function readSrc(x0, y0, w, h, pad) {
      const sx = clamp(x0 - pad, 0, img.w - 1), sy = clamp(y0 - pad, 0, img.h - 1);
      const ex = clamp(x0 + w + pad, sx + 1, img.w), ey = clamp(y0 + h + pad, sy + 1, img.h);
      const rgba = img.ctx.getImageData(sx, sy, ex - sx, ey - sy).data;
      const src = { data: rgba, w: ex - sx, h: ey - sy, x: sx, y: sy, stride: 4 };
      if (!kernGray()) return src;
      const g = new Uint8Array(src.w * src.h);
      for (let i = 0, k = 0; i < g.length; i++, k += 4) g[i] = gray1(rgba[k + 2], rgba[k + 1], rgba[k]);
      return { ...src, data: g, stride: 1 };
    }

    // Området etter kernelen: { src, out }, der out har samme kanaler som src.
    // Store områder regnes med cv.filter2D når OpenCV.js er klar. Tallene er de
    // samme som med JavaScript-kopien (se test/kernel.js), men det går raskere.
    function applyKernel(region) {
      const src = readSrc(region.x, region.y, region.w, region.h, (kern.k - 1) / 2);
      const opts = { channels: src.stride === 4 ? [0, 1, 2] : [0], abs: kernAbs };
      const cv = cfg.cv ? cfg.cv() : null;
      if (cv && region.w * region.h > 4096) {
        try {
          return { src, out: K.filterCv(cv, src, img.w, img.h, region, kern, opts) };
        } catch (err) {
          console.warn('cv.filter2D feilet, bruker JavaScript-kopien', err);
        }
      }
      return { src, out: K.filter(src, img.w, img.h, region, kern, opts) };
    }

    // Resultatet som RGBA til lerretet. Gråtoner blir grå piksler, og withTone
    // bruker terskelen i binær modus.
    function toRGBA(out, stride, n, withTone) {
      if (stride === 4) return out;
      const d = new Uint8ClampedArray(n * 4);
      for (let i = 0; i < n; i++) {
        const v = withTone ? tone(out[i]) : out[i];
        d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
        d[i * 4 + 3] = 255;
      }
      return d;
    }
    // Til luppen, som bruker terskelen selv
    function kernelRGBA(region) {
      const { out, src } = applyKernel(region);
      return toRGBA(out, src.stride, region.w * region.h, false);
    }

    /* Linsen: bildet etter kernelen i en firkant rundt markøren, tegnet over bildet */
    const lensBuf = document.createElement('canvas');
    let lensCache = null, fullCache = null;   // så det samme ikke regnes ut to ganger
    const kernKey = () => [kern.k, Array.from(kern.num).join(','), kern.den, kernAbs, kernGray(), binMode ? `${thresh}/${maxval}` : ''].join('|');

    function drawLens() {
      if (!kernMode || !img || !pixel || !view.width) { lens.hidden = true; return; }
      lens.hidden = false;
      if (lens.width !== view.width || lens.height !== view.height) { lens.width = view.width; lens.height = view.height; }
      const c = lens.getContext('2d');
      c.clearRect(0, 0, lens.width, lens.height);
      const sc = view.width / img.w;   // lerretspiksler per bildepiksel
      c.imageSmoothingEnabled = sc < 1;
      c.imageSmoothingQuality = 'high';
      const key = kernKey();

      if (kp.area.value === 'all') {
        // Hele bildet regnes ut én gang i full oppløsning, og skaleres som bildet under
        if (!fullCache || fullCache.key !== key || fullCache.img !== img) {
          const { out, src } = applyKernel({ x: 0, y: 0, w: img.w, h: img.h });
          const canvas = document.createElement('canvas');
          canvas.width = img.w;
          canvas.height = img.h;
          canvas.getContext('2d').putImageData(new ImageData(toRGBA(out, src.stride, img.w * img.h, true), img.w, img.h), 0, 0);
          fullCache = { key, img, canvas };
        }
        c.drawImage(fullCache.canvas, 0, 0, lens.width, lens.height);
        return;
      }

      // Linsen er like stor på skjermen uansett bildet, men høyst 257 × 257 bildepiksler
      // (129 × 129 før OpenCV.js er klar), så den følger markøren uten å hakke
      const dpr = root.devicePixelRatio || 1;
      const cap = cfg.cv && cfg.cv() ? 128 : 64;
      const r = clamp(Math.round(Number(kp.area.value) / 2 * dpr / sc), 1, cap);
      const x0 = Math.max(0, pixel.x - r), y0 = Math.max(0, pixel.y - r);
      const region = { x: x0, y: y0, w: Math.min(img.w, pixel.x + r + 1) - x0, h: Math.min(img.h, pixel.y + r + 1) - y0 };
      const rkey = `${key}|${region.x},${region.y},${region.w},${region.h}`;
      if (!lensCache || lensCache.key !== rkey || lensCache.img !== img) {
        const { out, src } = applyKernel(region);
        lensCache = { key: rkey, img, data: new ImageData(toRGBA(out, src.stride, region.w * region.h, true), region.w, region.h) };
      }
      lensBuf.width = region.w;
      lensBuf.height = region.h;
      lensBuf.getContext('2d').putImageData(lensCache.data, 0, 0);
      const X = region.x * sc, Y = region.y * sc, W = region.w * sc, H = region.h * sc;
      c.drawImage(lensBuf, X, Y, W, H);
      c.lineWidth = 3 * dpr;
      c.strokeStyle = 'rgba(0,0,0,.75)';
      c.strokeRect(X, Y, W, H);
      c.lineWidth = 1.25 * dpr;
      c.strokeStyle = '#fff';
      c.strokeRect(X, Y, W, H);
    }

    /* Panelet: kernelen, og pikslene før og etter */
    if (K) {
      K.PRESETS.forEach(p => kp.type.add(new Option(p.navn, p.id)));
      kp.type.add(new Option('Egen (skriv tallene selv)', 'egen'));
    }

    // Størrelse, σ og forklaringen, ut fra kernelen som er valgt
    function syncControls() {
      const p = K.preset(kern.id);
      const sizes = p ? p.sizes : [3, 5, 7];
      Array.from(kp.size.options).forEach(o => { o.disabled = !sizes.includes(Number(o.value)); });
      kp.size.value = String(kern.k);
      kp.size.disabled = sizes.length === 1;
      kp.type.value = kern.id;
      kp.sigmaBox.hidden = !(p && p.sigma);
      const s = Number(kp.sigma.value);
      kp.sigmaVal.textContent = s > 0 ? nb(s, 1) : '0 (auto)';
      kp.matSub.textContent = `(${kern.k} × ${kern.k})`;
      let sum = 0;
      kern.num.forEach(v => { sum += v; });
      sum /= kern.den;
      const what = Math.abs(sum - 1) < 1e-9 ? ', så flater beholder lysstyrken.'
        : Math.abs(sum) < 1e-9 ? ', så flater blir 0, og bare endringer gir utslag.'
          : `, så lysstyrken i flater ganges med ${nb(sum, 4)}.`;
      kp.about.textContent = (p ? p.about : 'Din egen kernel. Skriv tall i rutene (for eksempel 2, -1, 0,5 eller 1/9), og del alle på tallet foran.') +
        ` Vektene summerer til ${nb(sum, 4)}${what}`;
    }

    // Kernelen som rutenett med tall du kan endre. Endrer du et tall, blir det din egen kernel.
    const markWeight = (inp, v) => {
      inp.classList.toggle('zero', v === 0);
      inp.classList.toggle('neg', v < 0);
      inp.classList.remove('bad');
    };
    function renderMatrix() {
      const k = kern.k;
      const vals = Array.from(kern.num, K.fmtNum);
      kp.matrix.style.setProperty('--n', k);
      kp.matrix.style.setProperty('--w', Math.max(2, ...vals.map(v => v.length)) + 1.5 + 'ch');
      kp.matrix.replaceChildren(...vals.map((v, i) => {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.inputMode = 'decimal';
        inp.spellcheck = false;
        inp.className = 'kern-w num';
        inp.value = v;
        inp.dataset.i = i;
        inp.setAttribute('aria-label', `Vekt i rad ${Math.floor(i / k) + 1}, kolonne ${i % k + 1}`);
        markWeight(inp, kern.num[i]);
        return inp;
      }));
      kp.den.value = K.fmtNum(kern.den);
      kp.den.classList.remove('bad');
    }

    // Tall i rutene: 2, -1, 0,5 eller en brøk som 1/9
    function parseNum(s) {
      s = String(s).trim().replace(/,/g, '.').replace(/[−–]/g, '-');
      const m = /^([-+]?\d*\.?\d+)\s*\/\s*([-+]?\d*\.?\d+)$/.exec(s);
      const v = m ? Number(m[1]) / Number(m[2]) : s === '' ? NaN : Number(s);
      return Number.isFinite(v) ? v : NaN;
    }

    function kernChanged({ rebuild = true } = {}) {
      lensCache = fullCache = null;
      if (rebuild) renderMatrix();
      syncControls();
      if (img) refresh();
    }
    function fromPreset() {
      if (kp.type.value === 'egen') {
        kern = { ...kern, id: 'egen', sigma: null };
        kernChanged({ rebuild: false });
        return;
      }
      kern = K.make(kp.type.value, Number(kp.size.value), Number(kp.sigma.value));
      kernChanged();
    }

    // Før og Etter: (k + 2) × (k + 2) piksler rundt markøren, så du ser naboene også
    let gridN = 0;
    function buildGrid(el, n) {
      el.style.setProperty('--n', n);
      el.replaceChildren(...Array.from({ length: n * n }, () => {
        const s = document.createElement('span');
        s.className = 'kern-cell num';
        return s;
      }));
    }
    // Bak tallet: kanalens farge (B, G eller R) eller grått, med tekst som synes
    function paintCell(el, v, ch) {
      const rgb = ch === 'B' ? [0, 0, v] : ch === 'G' ? [0, v, 0] : ch === 'R' ? [v, 0, 0] : [v, v, v];
      el.style.background = `rgb(${rgb.join(',')})`;
      el.style.color = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2] > 140 ? '#000' : '#fff';
    }

    function drawKernelPanel() {
      if (!kernMode || !img || !pixel) return;
      const k = kern.k, h = (k - 1) / 2, n = k + 2, m = (n - 1) / 2;
      if (gridN !== n) { buildGrid(kp.before, n); buildGrid(kp.after, n); gridN = n; }
      const gray = kernGray(), ch = gray ? null : kernCh;
      kp.chBox.hidden = gray;
      kp.beforeSub.textContent = gray ? '(gråtone)' : `(kanal ${kernCh})`;
      kp.afterSub.textContent = binMode ? '(gråtone, før terskelen)' : gray ? '(gråtone)' : `(kanal ${kernCh})`;

      // Pikslene i vinduet, pluss margen kernelen trenger
      const wx0 = pixel.x - m, wy0 = pixel.y - m;
      const src = readSrc(wx0, wy0, n, n, h);
      const st = src.stride, c = st === 4 ? RGBA_CH[kernCh] : 0;
      const inside = (x, y) => x >= 0 && y >= 0 && x < img.w && y < img.h;
      // Utenfor bildet: speilet, som OpenCV gjør (BORDER_REFLECT_101)
      const valAt = (x, y) => src.data[((K.reflect101(y, img.h) - src.y) * src.w + K.reflect101(x, img.w) - src.x) * st + c];

      // Etter: pikslene i vinduet som ligger i bildet
      const ax0 = Math.max(0, wx0), ay0 = Math.max(0, wy0);
      const region = { x: ax0, y: ay0, w: Math.min(img.w, wx0 + n) - ax0, h: Math.min(img.h, wy0 + n) - ay0 };
      const after = K.filter(src, img.w, img.h, region, kern, { channels: st === 4 ? [0, 1, 2] : [0], abs: kernAbs });
      const afterAt = (x, y) => after[((y - ay0) * region.w + (x - ax0)) * st + c];

      // Ruten i Etter som forklares: den du peker på, ellers midten
      let [fi, fj] = focusCell || [m, m];
      if (!inside(wx0 + fj, wy0 + fi)) [fi, fj] = [m, m];

      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const x = wx0 + j, y = wy0 + i, inImg = inside(x, y), idx = i * n + j;
          const b = kp.before.children[idx], a = kp.after.children[idx];
          const v = valAt(x, y);
          b.textContent = v;
          paintCell(b, v, ch);
          b.classList.toggle('out', !inImg);
          b.classList.toggle('foot', Math.abs(i - fi) <= h && Math.abs(j - fj) <= h);
          b.classList.toggle('focus', i === fi && j === fj);
          b.title = inImg ? `(${x}, ${y})` : `Utenfor bildet: speilet fra (${K.reflect101(x, img.w)}, ${K.reflect101(y, img.h)})`;
          if (inImg) {
            const w = afterAt(x, y);
            a.textContent = w;
            paintCell(a, w, ch);
            a.title = `(${x}, ${y})`;
          } else {
            a.textContent = '';
            a.style.background = a.style.color = '';
            a.title = 'Utenfor bildet';
          }
          a.classList.toggle('out', !inImg);
          a.classList.toggle('focus', i === fi && j === fj);
        }
      }
      explain(wx0 + fj, wy0 + fi, valAt, afterAt(wx0 + fj, wy0 + fi), gray);
      kp.code.textContent = K.python(kern, {
        name: img.name, gray, abs: kernAbs, thresh: binMode ? thresh : null, maxval,
        x: pixel.x, y: pixel.y, value: binMode ? pixel.binary : pixel.kernel
      });
    }

    // Utregningen for én piksel: produktene, summen, delingen og avrundingen
    function explain(x, y, valAt, result, gray) {
      const k = kern.k, h = (k - 1) / 2, terms = [];
      let sum = 0, ints = true;
      for (let a = 0; a < k; a++) {
        for (let b = 0; b < k; b++) {
          const w = kern.num[a * k + b];
          if (w === 0) continue;
          const v = valAt(x + b - h, y + a - h);
          terms.push(w === 1 ? String(v) : `${v}·${w < 0 ? `(${nb(w, 4)})` : nb(w, 4)}`);
          sum += v * w;
          if (!Number.isInteger(w)) ints = false;
        }
      }
      const who = gray ? 'Gråtonen' : `Kanal ${kernCh}`;
      if (!terms.length) { kp.calc.textContent = `${who} i (${x}, ${y}): alle vektene er 0, så resultatet blir 0.`; return; }
      const exact = sum / kern.den;
      let txt = `${who} i (${x}, ${y}): `;
      txt += terms.length <= 9
        ? `${terms.join(' + ')} = ${nb(sum, ints ? 0 : 3)}`
        : `summen av ${terms.length} produkter (verdi · vekt) er ${nb(sum, ints ? 0 : 3)}`;
      if (kern.den !== 1) txt += `, delt på ${nb(kern.den, 4)} er ${nb(exact, 3)}`;
      txt += ` → ${result}`;
      const notes = [];
      if (kernAbs && exact < 0) notes.push('absoluttverdien');
      else if (!kernAbs && exact < -0.5) notes.push('negative tall blir 0');
      if ((kernAbs ? Math.abs(exact) : exact) > 255.5) notes.push('tall over 255 blir 255');
      if (Math.abs(exact % 1) === 0.5) notes.push('halve rundes til partall');
      else if (!notes.length && !Number.isInteger(exact)) notes.push('rundet av');
      kp.calc.textContent = txt + (notes.length ? ` (${notes.join(', ')})` : '') + '.';
    }

    if (K) {
      kernToggle.addEventListener('change', () => {
        kernMode = kernToggle.checked;
        kernPanel.hidden = !kernMode || !img;
        lensCache = fullCache = null;
        if (!kernMode) lens.hidden = true;
        refresh();
      });
      kp.type.addEventListener('change', fromPreset);
      kp.sigma.addEventListener('input', fromPreset);
      kp.size.addEventListener('change', () => {
        if (kern.id !== 'egen') { fromPreset(); return; }
        // Egen kernel: tallene beholdes i midten, og kanten fylles med 0
        const k = Number(kp.size.value), old = kern.k, d = (k - old) / 2;
        const num = new Float64Array(k * k);
        for (let i = 0; i < k; i++) {
          for (let j = 0; j < k; j++) {
            const oi = i - d, oj = j - d;
            if (oi >= 0 && oi < old && oj >= 0 && oj < old) num[i * k + j] = kern.num[oi * old + oj];
          }
        }
        kern = { ...kern, k, num };
        kernChanged();
      });
      kp.matrix.addEventListener('input', e => {
        const inp = e.target.closest('input');
        if (!inp) return;
        const v = parseNum(inp.value);
        if (Number.isNaN(v)) { inp.classList.add('bad'); return; }
        markWeight(inp, v);
        const num = Float64Array.from(kern.num);
        num[Number(inp.dataset.i)] = v;
        kern = { ...kern, id: 'egen', num, sigma: null };
        kernChanged({ rebuild: false });
      });
      kp.den.addEventListener('input', () => {
        const v = parseNum(kp.den.value);
        if (Number.isNaN(v) || v === 0) { kp.den.classList.add('bad'); return; }
        kp.den.classList.remove('bad');
        kern = { ...kern, id: 'egen', den: v, sigma: null };
        kernChanged({ rebuild: false });
      });
      kp.neg.addEventListener('change', () => { kernAbs = kp.neg.value === 'abs'; kernChanged({ rebuild: false }); });
      kp.area.addEventListener('change', () => { lensCache = fullCache = null; scheduleDraw(); });
      kp.chBox.addEventListener('click', e => {
        const b = e.target.closest('button[data-ch]');
        if (!b) return;
        kernCh = b.dataset.ch;
        kp.chBox.querySelectorAll('button[data-ch]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        drawKernelPanel();
      });
      // Pek på en rute i Etter for å se utregningen for den. Klikk i Før eller Etter flytter markøren dit.
      kp.after.addEventListener('pointerover', e => {
        const cell = e.target.closest('.kern-cell');
        if (!cell) return;
        const i = Array.prototype.indexOf.call(kp.after.children, cell);
        const f = [Math.floor(i / gridN), i % gridN];
        if (focusCell && focusCell[0] === f[0] && focusCell[1] === f[1]) return;
        focusCell = f;
        drawKernelPanel();
      });
      kp.after.addEventListener('pointerleave', () => { focusCell = null; drawKernelPanel(); });
      [kp.before, kp.after].forEach(el => el.addEventListener('click', e => {
        const cell = e.target.closest('.kern-cell');
        if (!cell || !pixel) return;
        const i = Array.prototype.indexOf.call(el.children, cell), m = (gridN - 1) / 2;
        moveTo(pixel.x + (i % gridN) - m, pixel.y + Math.floor(i / gridN) - m);
      }));
      renderMatrix();
      syncControls();
    }

    function moveTo(x, y) {
      if (!img) return;
      x = clamp(x, 0, img.w - 1);
      y = clamp(y, 0, img.h - 1);
      if (linked && pixel && x === pos.x && y === pos.y) return;
      pos.x = x; pos.y = y;
      pick();
    }

    let dragging = false;
    const fromPointer = e => {
      const r = frame.getBoundingClientRect();
      moveTo(Math.floor((e.clientX - r.left) / r.width * img.w), Math.floor((e.clientY - r.top) / r.height * img.h));
    };
    frame.addEventListener('pointerdown', e => {
      if (!img) return;
      dragging = true;
      try { frame.setPointerCapture(e.pointerId); } catch (_) {}
      frame.focus({ preventScroll: true });
      fromPointer(e);
      e.preventDefault();
    });
    frame.addEventListener('pointermove', e => { if (dragging && img) fromPointer(e); });
    frame.addEventListener('pointerup', () => { dragging = false; });
    frame.addEventListener('pointercancel', () => { dragging = false; });
    frame.addEventListener('keydown', e => {
      if (!img) return;
      const step = e.shiftKey ? 10 : 1;
      const d = { ArrowRight: [step, 0], ArrowLeft: [-step, 0], ArrowDown: [0, step], ArrowUp: [0, -step] }[e.key];
      if (!d) return;
      e.preventDefault();
      moveTo(pos.x + d[0], pos.y + d[1]);
    });

    loupe.addEventListener('click', e => {
      if (!img) return;
      const r = loupe.getBoundingClientRect();
      const i = clamp(Math.floor((e.clientX - r.left) / r.width * LOUPE_N), 0, LOUPE_N - 1);
      const j = clamp(Math.floor((e.clientY - r.top) / r.height * LOUPE_N), 0, LOUPE_N - 1);
      moveTo(pos.x + i - HALF, pos.y + j - HALF);
    });

    out.apply.addEventListener('click', () => { if (img) pick(); });

    /* ---------- Tegning av markør, lupp og tall ---------- */
    let drawPending = false;
    function scheduleDraw() {
      if (drawPending) return;
      drawPending = true;
      requestAnimationFrame(draw);
    }

    // Hver piksel tegnes som en egen rute med fillRect, så rutene blir like
    // store og fargene nøyaktig de samme som i bildet.
    function drawLoupe() {
      const dpr = root.devicePixelRatio || 1;
      const size = Math.max(LOUPE_N, Math.round(loupe.clientWidth * dpr));
      if (loupe.width !== size) { loupe.width = size; loupe.height = size; }
      const L = i => Math.round(i * size / LOUPE_N);   // kant nr. i, i lerretspiksler
      const x0 = pixel.x - HALF, y0 = pixel.y - HALF;
      const sx = Math.max(0, x0), sy = Math.max(0, y0);
      const ex = Math.min(img.w, x0 + LOUPE_N), ey = Math.min(img.h, y0 + LOUPE_N);
      const rw = ex - sx;
      // I Kernel-modus viser luppen pikslene etter kernelen
      const d = kernMode ? kernelRGBA({ x: sx, y: sy, w: rw, h: ey - sy }) : img.ctx.getImageData(sx, sy, rw, ey - sy).data;

      lctx.clearRect(0, 0, size, size);
      for (let y = sy; y < ey; y++) {
        const ya = L(y - y0), yb = L(y - y0 + 1);
        for (let x = sx; x < ex; x++) {
          const xa = L(x - x0), xb = L(x - x0 + 1);
          const k = ((y - sy) * rw + (x - sx)) * 4;
          if (d[k + 3] < 255) {
            // Sjakkbrett bak gjennomsiktige piksler
            const xm = (xa + xb) >> 1, ym = (ya + yb) >> 1;
            lctx.fillStyle = '#fff';
            lctx.fillRect(xa, ya, xb - xa, yb - ya);
            lctx.fillStyle = '#c8c8c8';
            lctx.fillRect(xa, ya, xm - xa, ym - ya);
            lctx.fillRect(xm, ym, xb - xm, yb - ym);
          }
          const a = d[k + 3] / 255;
          if (filtered()) {
            const v = toneRGBA(d, k);
            lctx.fillStyle = `rgba(${v},${v},${v},${a})`;
          } else {
            lctx.fillStyle = `rgba(${d[k]},${d[k + 1]},${d[k + 2]},${a})`;
          }
          lctx.fillRect(xa, ya, xb - xa, yb - ya);
        }
      }

      // Rutenett mellom pikslene
      lctx.lineWidth = 1;
      lctx.strokeStyle = 'rgba(128,128,128,.35)';
      lctx.beginPath();
      for (let i = 1; i < LOUPE_N; i++) {
        const p = L(i) + 0.5;
        lctx.moveTo(p, 0); lctx.lineTo(p, size);
        lctx.moveTo(0, p); lctx.lineTo(size, p);
      }
      lctx.stroke();

      // Ramme rundt pikselen under markøren
      const a = L(HALF), b = L(HALF + 1);
      lctx.lineWidth = 3 * dpr;
      lctx.strokeStyle = 'rgba(0,0,0,.85)';
      lctx.strokeRect(a, a, b - a, b - a);
      lctx.lineWidth = 1.25 * dpr;
      lctx.strokeStyle = '#fff';
      lctx.strokeRect(a, a, b - a, b - a);

      if (kernMode) {
        // Stiplet ramme rundt pikslene kernelen dekker når den regner ut pikselen under markøren
        const h = (kern.k - 1) / 2, fa = L(HALF - h), fb = L(HALF + h + 1);
        lctx.setLineDash([4 * dpr, 3 * dpr]);
        lctx.lineWidth = 3 * dpr;
        lctx.strokeStyle = 'rgba(0,0,0,.8)';
        lctx.strokeRect(fa, fa, fb - fa, fb - fa);
        lctx.lineWidth = 1.5 * dpr;
        lctx.strokeStyle = '#ffd60a';
        lctx.strokeRect(fa, fa, fb - fa, fb - fa);
        lctx.setLineDash([]);
      }
    }

    function draw() {
      drawPending = false;
      if (!img || !pixel) return;
      marker.style.left = ((pixel.x + 0.5) / img.w * 100) + '%';
      marker.style.top = ((pixel.y + 0.5) / img.h * 100) + '%';
      drawLoupe();
      drawLens();
      drawKernelPanel();

      const [b, g, r] = pixel.bgr;
      out.xy.textContent = `x ${pixel.x}, y ${pixel.y}`;
      out.swatch.style.background = `rgb(${r},${g},${b})`;
      out.bgr.textContent = fmt(pixel.bgr);
      out.hsv.textContent = fmt(cfg.bgr2hsv(pixel.bgr));
      const showGray = pixel.gray !== null, showBin = pixel.binary !== null, showKern = pixel.kernel !== null;
      out.kernDt.hidden = out.kernDd.hidden = !showKern;
      if (showKern) {
        const kv = pixel.kernel, rgb = Array.isArray(kv) ? [kv[2], kv[1], kv[0]] : [kv, kv, kv];
        out.kern.textContent = Array.isArray(kv) ? fmt(kv) : String(kv);
        out.kernSwatch.style.background = `rgb(${rgb.join(',')})`;
      }
      out.grayDt.hidden = out.grayDd.hidden = !showGray;
      out.grayNote.hidden = !showGray || showBin;
      out.binDt.hidden = out.binDd.hidden = out.binNote.hidden = !showBin;
      if (showGray) {
        out.gray.textContent = String(pixel.gray);
        out.graySwatch.style.background = `rgb(${pixel.gray},${pixel.gray},${pixel.gray})`;
      }
      if (showBin) {
        // Med kernel brukes terskelen på verdien etter kernelen
        const v = pixel.binary, base = showKern ? pixel.kernel : pixel.gray, over = base > pixel.thresh;
        const what = showKern ? `Etter kernelen ${base}` : `Grå ${base}`;
        out.bin.textContent = String(v);
        out.binSwatch.style.background = `rgb(${v},${v},${v})`;
        out.binNote.textContent = over
          ? `${what} > thresh ${pixel.thresh}, så pikselen får maxval = ${pixel.maxval}.`
          : `${what} ≤ thresh ${pixel.thresh}, så pikselen blir 0.`;
      }
      out.alpha.hidden = pixel.alpha === 255;
      if (pixel.alpha !== 255) {
        out.alpha.textContent = `Pikselen er ${pixel.alpha === 0 ? 'helt' : 'delvis'} gjennomsiktig (alfa = ${pixel.alpha}). ` +
          'Nettleseren kan ha endret fargeverdiene her, så cv2.imread kan gi andre tall.';
      }
      const kernBGR = showKern ? (Array.isArray(pixel.kernel) ? pixel.kernel : [pixel.kernel, pixel.kernel, pixel.kernel]) : null;
      out.link.textContent = !linked
        ? 'Fargekartene viser en annen farge nå.'
        : showBin
          ? `Fargekartene viser binærverdien som BGR [${pixel.binary}, ${pixel.binary}, ${pixel.binary}].`
          : showKern
            ? `Fargekartene viser verdien etter kernelen som BGR ${fmt(kernBGR)}.`
            : showGray
              ? `Fargekartene viser gråtonen som BGR [${pixel.gray}, ${pixel.gray}, ${pixel.gray}].`
              : 'Fargekartene viser denne pikselen.';
      out.apply.hidden = linked;
    }

    /* ---------- Velge, slippe og lime inn ---------- */
    pickBtn.addEventListener('click', () => fileInput.click());

    /* ---------- Mappen bilder/ (med server.py) ---------- */
    // Listen hentes på nytt når du åpner den, så nye bilder i mappen kommer med
    async function refreshFolder() {
      if (!folderOk) return;
      let names;
      try { names = await cfg.folder.list(); } catch (_) { return; }
      const keep = folderSel.value;
      folderSel.length = 1;
      names.forEach(n => folderSel.add(new Option(n, n)));
      folderSel.options[0].textContent = names.length ? `Fra bilder/ (${names.length}) …` : 'Fra bilder/ (tom)';
      folderSel.value = names.includes(keep) ? keep : '';
    }
    if (cfg.folder) {
      cfg.folder.ready.then(ok => {
        folderOk = ok;
        folderSel.hidden = !ok;
        if (img) describe();
        refreshFolder();
      });
      folderSel.addEventListener('pointerdown', refreshFolder);
      folderSel.addEventListener('focus', refreshFolder);
      root.addEventListener('focus', refreshFolder);
      folderSel.addEventListener('change', async () => {
        const navn = folderSel.value;
        folderSel.value = '';
        if (!navn) return;
        try {
          load(await cfg.folder.open(navn), { fromFolder: true });
        } catch (err) {
          showMsg(`Klarte ikke å åpne bilder/${navn}: ${err.message}`, 'error');
        }
      });
      saveFolderBtn.addEventListener('click', async () => {
        if (!img || img.fromFolder) return;
        try {
          const navn = await cfg.folder.save(img.file);
          img.name = cfg.onFile ? cfg.onFile(img.file, { fromFolder: true, name: navn }) || navn : navn;
          img.fromFolder = true;
          describe();
          showMsg(`Lagret som bilder/${navn}.`);
          if (linked) pick();   // kodeeksempelet får det nye filnavnet
          refreshFolder();
        } catch (err) {
          showMsg(`Klarte ikke å lagre i bilder/: ${err.message}`, 'error');
        }
      });
    }
    clearBtn.addEventListener('click', clear);
    fileInput.addEventListener('change', () => {
      const f = fileInput.files && fileInput.files[0];
      fileInput.value = '';   // så samme fil kan velges igjen
      if (f) load(f);
    });

    // Et bilde kan slippes hvor som helst på siden. Bildepanelet markeres mens du drar.
    // Gjelder bare når Fargelab-fanen vises (Python-fanen tar imot filer selv).
    const onLab = () => panel.getClientRects().length > 0;
    const hasFiles = e => onLab() && !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    let dragDepth = 0;
    document.addEventListener('dragenter', e => {
      if (!hasFiles(e)) return;
      dragDepth++;
      panel.classList.add('drop');
    });
    document.addEventListener('dragleave', e => {
      if (!hasFiles(e)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) panel.classList.remove('drop');
    });
    document.addEventListener('dragover', e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    document.addEventListener('drop', e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth = 0;
      panel.classList.remove('drop');
      const files = Array.from(e.dataTransfer.files || []);
      const f = files.find(isImage);
      if (f) load(f);
      else if (files.length) showMsg(`${files[0].name} ser ikke ut til å være et bilde.`, 'error');
    });

    document.addEventListener('paste', e => {
      if (!onLab()) return;
      const items = e.clipboardData ? Array.from(e.clipboardData.items || []) : [];
      const f = items.filter(it => it.kind === 'file').map(it => it.getAsFile()).find(isImage);
      if (!f) return;
      e.preventDefault();
      load(f);
    });

    return {
      sync(on) {
        if (on === linked) return;
        linked = on;
        if (pixel) scheduleDraw();
      },
      load,
      clear
    };
  }

  root.Bilde = { create };
})(typeof self !== 'undefined' ? self : this);

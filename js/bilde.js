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
 * Ingenting lastes opp. Bildet blir værende i nettleseren.
 *
 * Bruk:
 *   const bilde = Bilde.create({
 *     bgr2hsv,           // regner om én farge, til tallene ved luppen
 *     bgr2gray,          // gir gråtonen (0–255) til én farge
 *     onPick(p)  { ... }, // p = { x, y, bgr: [b, g, r], gray, binary, thresh, maxval, alpha, name }
 *                         // gray er null når gråtonemodus er av, binary osv. når binær modus er av
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
      grayNote: $('imgGrayNote'), binNote: $('imgBinNote'),
      alpha: $('imgAlpha'), link: $('imgLink'), apply: $('imgApply')
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
      requestAnimationFrame(() => { layoutQueued = false; layout(false); if (pixel) drawLoupe(); });
    }
    if (root.ResizeObserver) new ResizeObserver(queueLayout).observe(stage);
    root.addEventListener('resize', queueLayout);

    /* ---------- Markøren ---------- */
    // Gråtone og binærverdi for pikselen, ut fra modus, thresh og maxval
    function derive(p) {
      p.gray = filtered() ? cfg.bgr2gray(p.bgr) : null;
      p.binary = binMode ? binary1(p.gray, thresh, maxval) : null;
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
      const d = img.ctx.getImageData(sx, sy, rw, ey - sy).data;

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
    }

    function draw() {
      drawPending = false;
      if (!img || !pixel) return;
      marker.style.left = ((pixel.x + 0.5) / img.w * 100) + '%';
      marker.style.top = ((pixel.y + 0.5) / img.h * 100) + '%';
      drawLoupe();

      const [b, g, r] = pixel.bgr;
      out.xy.textContent = `x ${pixel.x}, y ${pixel.y}`;
      out.swatch.style.background = `rgb(${r},${g},${b})`;
      out.bgr.textContent = fmt(pixel.bgr);
      out.hsv.textContent = fmt(cfg.bgr2hsv(pixel.bgr));
      const showGray = pixel.gray !== null, showBin = pixel.binary !== null;
      out.grayDt.hidden = out.grayDd.hidden = !showGray;
      out.grayNote.hidden = !showGray || showBin;
      out.binDt.hidden = out.binDd.hidden = out.binNote.hidden = !showBin;
      if (showGray) {
        out.gray.textContent = String(pixel.gray);
        out.graySwatch.style.background = `rgb(${pixel.gray},${pixel.gray},${pixel.gray})`;
      }
      if (showBin) {
        const v = pixel.binary, over = pixel.gray > pixel.thresh;
        out.bin.textContent = String(v);
        out.binSwatch.style.background = `rgb(${v},${v},${v})`;
        out.binNote.textContent = over
          ? `Grå ${pixel.gray} > thresh ${pixel.thresh}, så pikselen får maxval = ${pixel.maxval}.`
          : `Grå ${pixel.gray} ≤ thresh ${pixel.thresh}, så pikselen blir 0.`;
      }
      out.alpha.hidden = pixel.alpha === 255;
      if (pixel.alpha !== 255) {
        out.alpha.textContent = `Pikselen er ${pixel.alpha === 0 ? 'helt' : 'delvis'} gjennomsiktig (alfa = ${pixel.alpha}). ` +
          'Nettleseren kan ha endret fargeverdiene her, så cv2.imread kan gi andre tall.';
      }
      out.link.textContent = !linked
        ? 'Fargekartene viser en annen farge nå.'
        : showBin
          ? `Fargekartene viser binærverdien som BGR [${pixel.binary}, ${pixel.binary}, ${pixel.binary}].`
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

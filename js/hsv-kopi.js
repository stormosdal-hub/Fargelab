/*
 * hsv-kopi.js
 * JavaScript-kopi av OpenCVs 8-bits fargekonvertering:
 *   COLOR_BGR2HSV  og  COLOR_HSV2BGR  (H 0–179, S og V 0–255)
 *   COLOR_BGR2GRAY                    (0–255)
 * og av cv2.threshold med THRESH_BINARY for én verdi (binary1).
 *
 * Brukes når OpenCV.js ikke er lastet ennå, eller ikke kan startes.
 * Koden følger OpenCVs C++-implementasjon (color_hsv.simd.hpp og
 * color_rgb.simd.hpp) og gir de samme tallene. Kjør  node test/sammenlign.js
 * for å kontrollere det.
 *
 * Funksjonene tar en flat Uint8Array med n piksler * 3 kanaler. bgr2hsvJS og
 * hsv2bgrJS returnerer en ny Uint8Array i samme format, bgr2grayJS en
 * Uint8Array med n verdier (én kanal).
 *
 * Virker både i nettleseren (window.HsvKopi) og i Node (require).
 */
(function (root) {
  'use strict';

  /* ---------- BGR -> HSV (heltallsversjon, som i OpenCV) ---------- */
  // OpenCV slår opp i tabeller i stedet for å dele. Tallene er skalert med 2^12.
  const HSV_SHIFT = 12;
  const SDIV = new Int32Array(256); // 255 / v
  const HDIV = new Int32Array(256); // 180 / (6 * diff)
  for (let i = 1; i < 256; i++) {
    SDIV[i] = Math.round((255 << HSV_SHIFT) / i);
    HDIV[i] = Math.round((180 << HSV_SHIFT) / (6 * i));
  }

  function bgr2hsvJS(src, n) {
    const dst = new Uint8Array(n * 3);
    for (let i = 0; i < n; i++) {
      const o = i * 3, b = src[o], g = src[o + 1], r = src[o + 2];
      const v = Math.max(b, g, r);          // V = største kanal
      const vmin = Math.min(b, g, r);
      const diff = v - vmin;
      const vr = v === r ? -1 : 0;          // -1 = alle bit satt (brukes som maske)
      const vg = v === g ? -1 : 0;

      // S = diff / V, skalert til 0–255
      const s = (diff * SDIV[v] + (1 << (HSV_SHIFT - 1))) >> HSV_SHIFT;

      // H avhenger av hvilken kanal som er størst
      let h = (vr & (g - b)) + (~vr & ((vg & (b - r + 2 * diff)) + (~vg & (r - g + 4 * diff))));
      h = (h * HDIV[diff] + (1 << (HSV_SHIFT - 1))) >> HSV_SHIFT;
      if (h < 0) h += 180;

      dst[o] = h; dst[o + 1] = s; dst[o + 2] = v;
    }
    return dst;
  }

  /* ---------- HSV -> BGR (flyttall med 32 bit, som i OpenCV) ---------- */
  const f32 = Math.fround;
  // OpenCV avrunder x.5 til nærmeste partall (cvRound)
  const roundEven = x => {
    const r = Math.round(x);
    return (Math.abs(x % 1) === 0.5 && r % 2 !== 0) ? r - 1 : r;
  };
  const sat8 = x => Math.min(255, Math.max(0, roundEven(x)));
  // Hvilken av tab[0..3] som blir B, G og R i hver av de seks sektorene på fargehjulet
  const SECTOR = [[1, 3, 0], [1, 0, 2], [3, 0, 1], [0, 2, 1], [0, 1, 3], [2, 1, 0]];
  const HSCALE = f32(6 / 180);
  const INV255 = f32(1 / 255);

  function hsv2bgrJS(src, n) {
    const dst = new Uint8Array(n * 3), tab = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      let h = src[o];
      const s = f32(src[o + 1] * INV255);
      const v = f32(src[o + 2] * INV255);
      let b, g, r;
      if (s === 0) {
        b = g = r = v;                      // grå: H spiller ingen rolle
      } else {
        h = f32(h * HSCALE);                // 0–180 blir 0–6
        h = f32(h % 6);
        let sector = Math.floor(h);
        h = f32(h - sector);                // posisjon inne i sektoren, 0–1
        if (sector < 0 || sector >= 6) { sector = 0; h = 0; }
        tab[0] = v;
        tab[1] = f32(v * f32(1 - s));
        tab[2] = f32(v * f32(1 - f32(s * h)));
        tab[3] = f32(v * f32(1 - f32(s * f32(1 - h))));
        b = tab[SECTOR[sector][0]];
        g = tab[SECTOR[sector][1]];
        r = tab[SECTOR[sector][2]];
      }
      dst[o] = sat8(f32(b * 255));
      dst[o + 1] = sat8(f32(g * 255));
      dst[o + 2] = sat8(f32(r * 255));
    }
    return dst;
  }

  /* ---------- BGR -> gråtone (heltallsversjon, som i OpenCV 4) ---------- */
  // Y = 0,114 B + 0,587 G + 0,299 R, med vektene skalert med 2^15 og avrundet.
  // Å runde av 0,299 R + 0,587 G + 0,114 B med flyttall gir 1 for lite eller
  // for mye for rundt 21 000 av de 16,7 millioner fargene.
  const GRAY_SHIFT = 15;
  const BY15 = 3735, GY15 = 19235, RY15 = 9798;
  const gray1 = (b, g, r) => (b * BY15 + g * GY15 + r * RY15 + (1 << (GRAY_SHIFT - 1))) >> GRAY_SHIFT;

  function bgr2grayJS(src, n) {
    const dst = new Uint8Array(n);
    for (let i = 0, o = 0; i < n; i++, o += 3) dst[i] = gray1(src[o], src[o + 1], src[o + 2]);
    return dst;
  }

  /* ---------- Terskel: cv2.threshold med THRESH_BINARY (8 bit) ---------- */
  // dst = maxval der src > thresh, ellers 0. Med hele tall fra 0 til 255 for
  // thresh og maxval er dette nøyaktig det OpenCV gjør med 8-bits bilder.
  const binary1 = (v, thresh, maxval) => (v > thresh ? maxval : 0);

  const api = { bgr2hsvJS, hsv2bgrJS, bgr2grayJS, gray1, binary1 };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HsvKopi = api;
})(typeof self !== 'undefined' ? self : this);

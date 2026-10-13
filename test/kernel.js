/*
 * kernel.js (test)
 * Kontrollerer at js/kernel.js gir nøyaktig de samme tallene som
 * cv.filter2D i OpenCV.js:
 *   - alle de ferdige kernelene i alle størrelser, Gauss med flere σ
 *   - negative tall som blir 0 (ddepth=-1) og absoluttverdi (convertScaleAbs)
 *   - tilfeldige egne kernels med desimaltall
 *   - farge (3 kanaler) og gråtone (1 kanal), på hele bildet og på utsnitt
 *     helt ut i kanten, der pikslene utenfor bildet speiles (BORDER_REFLECT_101)
 *
 * Kjør fra prosjektmappen:   node test/kernel.js
 */
'use strict';

const path = require('path');
const Kernel = require(path.join(__dirname, '..', 'js', 'kernel.js'));

// Et tilfeldig, men likt bilde hver gang
function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function image(W, H, nc, rand) {
  const d = new Uint8Array(W * H * nc);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (let c = 0; c < nc; c++) {
        // Glatte overganger, skarpe kanter og støy, så alle slags summer forekommer
        const v = (x * 7 + y * 3 * (c + 1)) % 256;
        const edge = ((x >> 3) + (y >> 3)) % 2 ? 200 : 30;
        d[(y * W + x) * nc + c] = rand() < 0.3 ? Math.floor(rand() * 256) : rand() < 0.5 ? v : edge;
      }
    }
  }
  return d;
}

// Fasit: cv.filter2D på hele bildet
function opencv(cv, data, W, H, nc, kern, abs) {
  const src = cv.matFromArray(H, W, nc === 3 ? cv.CV_8UC3 : cv.CV_8UC1, data);
  const kmat = cv.matFromArray(kern.k, kern.k, cv.CV_32F, Array.from(Kernel.weights(kern)));
  const dst = new cv.Mat(), tmp = new cv.Mat();
  const anchor = new cv.Point(-1, -1);
  if (abs) {
    cv.filter2D(src, tmp, cv.CV_32F, kmat, anchor, 0, cv.BORDER_REFLECT_101);
    cv.convertScaleAbs(tmp, dst);
  } else {
    cv.filter2D(src, dst, -1, kmat, anchor, 0, cv.BORDER_REFLECT_101);
  }
  const out = Uint8Array.from(dst.data);
  [src, kmat, dst, tmp].forEach(m => m.delete());
  return out;
}

function main(cv) {
  const rand = rng(12345);
  const kernels = [];
  for (const p of Kernel.PRESETS) {
    for (const k of p.sizes) {
      for (const sigma of p.sigma ? [0, 0.5, 1, 1.5, 2.3, 5] : [0]) kernels.push(Kernel.make(p.id, k, sigma));
    }
  }
  for (let n = 0; n < 40; n++) {
    const k = [3, 5, 7][n % 3];
    const num = Float64Array.from({ length: k * k }, () => (rand() < 0.25 ? 0 : Math.round((rand() * 6 - 3) * 1000) / 1000));
    kernels.push({ id: 'egen', k, num, den: [1, 3, 7, 9, 16][n % 5], sigma: null });
  }

  let cases = 0, values = 0, mismatches = 0;
  const examples = [];
  const sizes = [[37, 23], [5, 4], [1, 9], [64, 48]];
  for (const [W, H] of sizes) {
    for (const nc of [3, 1]) {
      const data = image(W, H, nc, rand);
      const channels = nc === 3 ? [0, 1, 2] : [0];
      const full = { data, w: W, h: H, x: 0, y: 0, stride: nc };
      for (const kern of kernels) {
        for (const abs of [false, true]) {
          const truth = opencv(cv, data, W, H, nc, kern, abs);
          // Hele bildet, og utsnitt som ligger i hvert hjørne og midt i bildet
          const regions = [{ x: 0, y: 0, w: W, h: H }];
          if (W > 6 && H > 6) {
            regions.push({ x: 0, y: 0, w: 4, h: 3 }, { x: W - 5, y: H - 4, w: 5, h: 4 }, { x: 2, y: 1, w: W - 4, h: H - 3 });
          }
          for (const region of regions) {
            // Bare pikslene regionen trenger, som når bildekortet leser et utsnitt av bildet
            const h = (kern.k - 1) / 2;
            const sx = Math.max(0, region.x - h), sy = Math.max(0, region.y - h);
            const ex = Math.min(W, region.x + region.w + h), ey = Math.min(H, region.y + region.h + h);
            const part = new Uint8Array((ex - sx) * (ey - sy) * nc);
            for (let y = sy; y < ey; y++) part.set(data.subarray((y * W + sx) * nc, (y * W + ex) * nc), (y - sy) * (ex - sx) * nc);
            const src = (region.w === W && region.h === H) ? full : { data: part, w: ex - sx, h: ey - sy, x: sx, y: sy, stride: nc };
            const outs = [['JS', Kernel.filter(src, W, H, region, kern, { channels, abs })],
              ['filterCv', Kernel.filterCv(cv, src, W, H, region, kern, { channels, abs })]];
            for (const [name, out] of outs) {
              cases++;
              for (let y = 0; y < region.h; y++) {
                for (let x = 0; x < region.w; x++) {
                  for (let c = 0; c < nc; c++) {
                    values++;
                    const a = out[(y * region.w + x) * nc + c], b = truth[((region.y + y) * W + region.x + x) * nc + c];
                    if (a !== b) {
                      mismatches++;
                      if (examples.length < 8) examples.push(`  ${name} ${kern.id} ${kern.k}×${kern.k} σ=${kern.sigma} abs=${abs} ${W}×${H}×${nc} (${region.x + x}, ${region.y + y}) kanal ${c}: JS ${a}, OpenCV ${b}`);
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  console.log(`${kernels.length} kernels, ${cases.toLocaleString('nb-NO')} utregninger, ${values.toLocaleString('nb-NO')} verdier.`);
  if (mismatches === 0) {
    console.log('Alle verdiene er identiske med cv.filter2D i OpenCV.js.');
  } else {
    console.log(`${mismatches} verdier er forskjellige, for eksempel:\n${examples.join('\n')}`);
    process.exitCode = 1;
  }

  // getGaussianKernel med σ > 0: samme formel som OpenCV (sjekket mot cv2 i Python)
  const g = Kernel.gaussian1d(5, 1.5).num.map(v => v.toFixed(8));
  console.log('Gauss 5, σ = 1,5:', g.join(' '));
}

const cvp = require(path.join(__dirname, '..', 'lib', 'opencv.js'));
(async () => {
  const cv = cvp instanceof Promise ? await cvp : cvp;
  if (!cv.Mat) await new Promise(r => { cv.onRuntimeInitialized = r; });
  main(cv);
})();

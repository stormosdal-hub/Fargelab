/*
 * sammenlign.js
 * Kontrollerer at js/hsv-kopi.js gir nøyaktig de samme tallene som OpenCV.js
 * for ALLE farger:
 *   BGR -> HSV:  256 * 256 * 256 = 16 777 216 farger
 *   HSV -> BGR:  180 * 256 * 256 = 11 796 480 kombinasjoner
 *   BGR -> grå:  256 * 256 * 256 = 16 777 216 farger
 *   Terskel:     256 * 256 * 256 = 16 777 216 kombinasjoner av gråtone,
 *                thresh og maxval (cv2.threshold med THRESH_BINARY)
 *
 * Kjør fra prosjektmappen:   node test/sammenlign.js
 * Krever Node.js 16 eller nyere. Tar vanligvis under et minutt.
 */
'use strict';

const path = require('path');
const cv = require(path.join(__dirname, '..', 'lib', 'opencv.js'));
const { bgr2hsvJS, hsv2bgrJS, bgr2grayJS, binary1 } = require(path.join(__dirname, '..', 'js', 'hsv-kopi.js'));

// outCh er antall kanaler i svaret: 3 for HSV og BGR, 1 for gråtone
function compare(label, firstMax, code, fill, jsFn, outCh = 3) {
  const n = 256 * 256;
  const input = new Uint8Array(n * 3);
  let mismatches = 0;
  const examples = [];

  for (let a = 0; a < firstMax; a++) {
    // Én skive om gangen: første kanal fast, de to andre går gjennom 0–255
    for (let x = 0, k = 0; x < 256; x++) {
      for (let y = 0; y < 256; y++, k += 3) fill(input, k, a, x, y);
    }
    const src = cv.matFromArray(1, n, cv.CV_8UC3, input);
    const dst = new cv.Mat();
    cv.cvtColor(src, dst, code);
    const fromCv = dst.data;
    const fromJs = jsFn(input, n);

    for (let i = 0; i < n; i++) {
      const k = i * 3, o = i * outCh;
      let differs = false;
      for (let c = 0; c < outCh; c++) if (fromCv[o + c] !== fromJs[o + c]) differs = true;
      if (differs) {
        mismatches++;
        if (examples.length < 5) {
          examples.push(`  inn [${input.slice(k, k + 3).join(', ')}]  OpenCV [${fromCv.slice(o, o + outCh).join(', ')}]  JS [${fromJs.slice(o, o + outCh).join(', ')}]`);
        }
      }
    }
    src.delete();
    dst.delete();
    if (a % 32 === 31 || a === firstMax - 1) {
      process.stdout.write(`\r${label}: ${Math.round((a + 1) / firstMax * 100)} %`);
    }
  }

  const total = firstMax * n;
  process.stdout.write('\n');
  if (mismatches === 0) {
    console.log(`  Alle ${total.toLocaleString('nb-NO')} verdier er identiske.\n`);
  } else {
    console.log(`  ${mismatches} av ${total.toLocaleString('nb-NO')} verdier er forskjellige, for eksempel:`);
    console.log(examples.join('\n') + '\n');
  }
  return mismatches;
}

// cv2.threshold(gray, thresh, maxval, THRESH_BINARY) for alle gråtoner,
// alle thresh og alle maxval fra 0 til 255
function compareThreshold() {
  const src = cv.matFromArray(1, 256, cv.CV_8UC1, Array.from({ length: 256 }, (_, v) => v));
  const dst = new cv.Mat();
  let mismatches = 0;
  const examples = [];
  for (let t = 0; t < 256; t++) {
    for (let m = 0; m < 256; m++) {
      cv.threshold(src, dst, t, m, cv.THRESH_BINARY);
      for (let v = 0; v < 256; v++) {
        const js = binary1(v, t, m);
        if (dst.data[v] !== js) {
          mismatches++;
          if (examples.length < 5) examples.push(`  grå ${v}, thresh ${t}, maxval ${m}  OpenCV ${dst.data[v]}  JS ${js}`);
        }
      }
    }
    if (t % 32 === 31) process.stdout.write(`\rTerskel: ${Math.round((t + 1) / 256 * 100)} %`);
  }
  src.delete();
  dst.delete();
  process.stdout.write('\n');
  if (mismatches === 0) console.log(`  Alle ${(256 ** 3).toLocaleString('nb-NO')} verdier er identiske.\n`);
  else console.log(`  ${mismatches} verdier er forskjellige, for eksempel:\n${examples.join('\n')}\n`);
  return mismatches;
}

function run() {
  console.log('OpenCV.js er klar. Sammenligner med js/hsv-kopi.js …\n');

  const bad =
    compare('BGR -> HSV', 256, cv.COLOR_BGR2HSV,
      (arr, k, b, g, r) => { arr[k] = b; arr[k + 1] = g; arr[k + 2] = r; },
      bgr2hsvJS) +
    compare('HSV -> BGR', 180, cv.COLOR_HSV2BGR,
      (arr, k, h, s, v) => { arr[k] = h; arr[k + 1] = s; arr[k + 2] = v; },
      hsv2bgrJS) +
    compare('BGR -> grå', 256, cv.COLOR_BGR2GRAY,
      (arr, k, b, g, r) => { arr[k] = b; arr[k + 1] = g; arr[k + 2] = r; },
      bgr2grayJS, 1) +
    compareThreshold();

  console.log(bad === 0 ? 'Resultat: JavaScript-kopien stemmer med OpenCV.' : 'Resultat: fant avvik.');
  process.exit(bad === 0 ? 0 : 1);
}

if (cv.Mat) run();
else cv.onRuntimeInitialized = run;

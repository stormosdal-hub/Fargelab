/*
 * sylinder3d.js – HSV-sylinderen («kaken») i 3D (bygger på scene3d.js og three.js)
 *
 * Slik ligger HSV i sylinderen:
 *   H (0–179 i OpenCV) = vinkelen rundt. Vinkel i grader = H * 2.
 *   S (0–255)          = avstanden fra midten. 0 i sentrum, 255 ytterst.
 *   V (0–255)          = høyden. 0 i bunnen (svart), 255 på toppen.
 *
 * Fargen regnes ut i fragment-shaderen fra posisjonen på flaten, så hver
 * piksel får nøyaktig den HSV-fargen som hører til stedet.
 *
 * Kakebiten: fra fargen du har valgt fjernes en bit som går 90° rundt (fra H
 * og mot kameraet), ut til kanten (S større enn valgt) og opp til toppen
 * (V større enn valgt). De tre snittflatene er H = h, S = s og V = v, og de
 * møtes akkurat i den valgte fargen.
 *
 * Bruk:  const kake = Sylinder3D.create(element);  kake.update([h, s, v], [b, g, r]);
 */
(function (root) {
  'use strict';

  const RADIUS = 1.25;
  const HALF_H = 0.8;
  const TAU = Math.PI * 2;
  const WEDGE = Math.PI / 2;                        // kakebiten er 90°
  const SEG_PER_TURN = 120;                         // oppdeling av buede flater
  const H_TICKS = [0, 30, 60, 90, 120, 150];        // hver 60°
  const SV_TICKS = [0, 51, 102, 153, 204, 255];
  const HUE_NAMES = [['Rød', 0], ['Gul', 30], ['Grønn', 60], ['Cyan', 90], ['Blå', 120], ['Magenta', 150]];

  const hueAngle = H => H * 2 * Math.PI / 180;
  // (vinkel, radius 0–1, høyde 0–1) -> [x, y, z]
  const cyl = (t, r, y) => [r * RADIUS * Math.cos(t), (y * 2 - 1) * HALF_H, -r * RADIUS * Math.sin(t)];
  const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));   // til (-π, π]

  const VERTEX_SHADER = `
    varying vec3 vPos;
    void main() {
      vPos = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`;

  // Standard HSV -> RGB. h, s og v er 0–1.
  const FRAGMENT_SHADER = `
    uniform float uRadius;
    uniform float uHalfH;
    varying vec3 vPos;
    vec3 hsv2rgb(float h, float s, float v) {
      vec3 k = mod(vec3(5.0, 3.0, 1.0) + h * 6.0, 6.0);
      return v - v * s * clamp(min(k, 4.0 - k), 0.0, 1.0);
    }
    void main() {
      float s = clamp(length(vPos.xz) / uRadius, 0.0, 1.0);
      float h = fract(atan(-vPos.z, vPos.x) / 6.28318530718);
      float v = clamp((vPos.y + uHalfH) / (2.0 * uHalfH), 0.0, 1.0);
      gl_FragColor = vec4(hsv2rgb(h, s, v), 1.0);
    }`;

  function create(host) {
    const s3 = root.Scene3D.create(host, {
      ariaLabel: 'HSV-sylinder i 3D. Dra med musen eller bruk piltastene for å snu den.',
      // Kameraet ser mot H ≈ 150° (mellom grønn og cyan), som på det klassiske bildet
      view: { theta: hueAngle(75) + Math.PI / 2, phi: 0.52 },
      distance: 8.2,
      lookAtY: -0.12,
      beforeRender,
      afterRender,
      onTheme: applyTheme
    });
    const { THREE, scene, camera, view } = s3;

    /* ---------- Tilstand ---------- */
    let hsv = [0, 0, 0];
    let bgr = [0, 0, 0];
    let cut = true;
    let showNames = false;
    let solidKey = '';

    /* ---------- Selve sylinderen ---------- */
    const solid = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.ShaderMaterial({
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        uniforms: { uRadius: { value: RADIUS }, uHalfH: { value: HALF_H } },
        side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
      })
    );
    const grid = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 })
    );
    scene.add(solid, grid);

    // Sylinderen deles i 8 blokker: kakebiten / resten (vinkel), innenfor / utenfor S
    // (radius) og under / over V (høyde). Blokken i kakebiten, utenfor S og på
    // kamerasiden av V fjernes. Bare flater som vender mot luft blir tegnet.
    function buildSolid(wedgeStart, cutTop) {
      const sN = hsv[1] / 255, vN = hsv[2] / 255;
      const T = [[wedgeStart, wedgeStart + WEDGE], [wedgeStart + WEDGE, wedgeStart + TAU]];
      const R = [[0, sN], [sN, 1]];
      const Y = [[0, vN], [vN, 1]];
      const removedY = cutTop ? 1 : 0;

      const exists = (ti, ri, yi) => {
        if (ri < 0 || ri > 1 || yi < 0 || yi > 1) return false;
        ti = ((ti % 2) + 2) % 2;
        if (R[ri][1] - R[ri][0] <= 1e-9 || Y[yi][1] - Y[yi][0] <= 1e-9) return false;
        return !(cut && ti === 0 && ri === 1 && yi === removedY);
      };
      const shift = (b, axis, d) => axis === 't' ? [b[0] + d, b[1], b[2]]
        : axis === 'r' ? [b[0], b[1] + d, b[2]] : [b[0], b[1], b[2] + d];
      // Har blokken b en synlig flate på siden (axis, d)?
      const faceOn = (b, axis, d) => {
        if (!exists(...b)) return false;
        if (axis === 'r' && d < 0 && R[b[1]][0] <= 1e-9) return false;   // ingen flate i sentrum
        return !exists(...shift(b, axis, d));
      };

      const pos = [], lines = [];
      const tri = (a, b, c) => pos.push(...a, ...b, ...c);
      const quad = (a, b, c, d) => { tri(a, b, c); tri(a, c, d); };
      const line = (a, b) => lines.push(...a, ...b);
      const arc = (t0, t1, fn) => {
        const n = Math.max(2, Math.ceil((t1 - t0) / TAU * SEG_PER_TURN));
        for (let k = 0; k < n; k++) line(fn(t0 + (t1 - t0) * k / n), fn(t0 + (t1 - t0) * (k + 1) / n));
      };
      const hueTicksIn = (t0, t1) => {
        const out = [];
        H_TICKS.forEach(H => {
          for (let k = -1; k <= 2; k++) {
            const t = hueAngle(H) + k * TAU;
            if (t > t0 + 1e-6 && t < t1 - 1e-6) out.push(t);
          }
        });
        return out;
      };
      const svTicksIn = (a, b) => SV_TICKS.map(x => x / 255).filter(x => x > a + 1e-6 && x < b - 1e-6);

      for (let ti = 0; ti < 2; ti++) for (let ri = 0; ri < 2; ri++) for (let yi = 0; yi < 2; yi++) {
        const b = [ti, ri, yi];
        if (!exists(...b)) continue;
        const [t0, t1] = T[ti], [r0, r1] = R[ri], [y0, y1] = Y[yi];
        const n = Math.max(2, Math.ceil((t1 - t0) / TAU * SEG_PER_TURN));
        const tAt = k => t0 + (t1 - t0) * k / n;

        for (const axis of ['y', 'r', 't']) {
          for (const d of [-1, 1]) {
            if (!faceOn(b, axis, d)) continue;
            // En kant tegnes bare der flaten faktisk slutter (ikke der den fortsetter i naboblokken)
            const edge = (e, side) => !faceOn(shift(b, e, side), axis, d);

            if (axis === 'y') {                       // topp / bunn (V konstant)
              const yc = d > 0 ? y1 : y0;
              for (let k = 0; k < n; k++) {
                quad(cyl(tAt(k), r0, yc), cyl(tAt(k), r1, yc), cyl(tAt(k + 1), r1, yc), cyl(tAt(k + 1), r0, yc));
              }
              svTicksIn(r0, r1).forEach(r => arc(t0, t1, t => cyl(t, r, yc)));
              hueTicksIn(t0, t1).forEach(t => line(cyl(t, r0, yc), cyl(t, r1, yc)));
              if (r0 > 0 && edge('r', -1)) arc(t0, t1, t => cyl(t, r0, yc));
              if (edge('r', 1)) arc(t0, t1, t => cyl(t, r1, yc));
              if (edge('t', -1)) line(cyl(t0, r0, yc), cyl(t0, r1, yc));
              if (edge('t', 1)) line(cyl(t1, r0, yc), cyl(t1, r1, yc));
            } else if (axis === 'r') {                // buet vegg (S konstant)
              const rc = d > 0 ? r1 : r0;
              for (let k = 0; k < n; k++) {
                quad(cyl(tAt(k), rc, y0), cyl(tAt(k + 1), rc, y0), cyl(tAt(k + 1), rc, y1), cyl(tAt(k), rc, y1));
              }
              svTicksIn(y0, y1).forEach(y => arc(t0, t1, t => cyl(t, rc, y)));
              hueTicksIn(t0, t1).forEach(t => line(cyl(t, rc, y0), cyl(t, rc, y1)));
              if (edge('y', -1)) arc(t0, t1, t => cyl(t, rc, y0));
              if (edge('y', 1)) arc(t0, t1, t => cyl(t, rc, y1));
              if (edge('t', -1)) line(cyl(t0, rc, y0), cyl(t0, rc, y1));
              if (edge('t', 1)) line(cyl(t1, rc, y0), cyl(t1, rc, y1));
            } else {                                  // flat side i kakebiten (H konstant)
              const tc = d > 0 ? t1 : t0;
              quad(cyl(tc, r0, y0), cyl(tc, r1, y0), cyl(tc, r1, y1), cyl(tc, r0, y1));
              svTicksIn(r0, r1).forEach(r => line(cyl(tc, r, y0), cyl(tc, r, y1)));
              svTicksIn(y0, y1).forEach(y => line(cyl(tc, r0, y), cyl(tc, r1, y)));
              if (edge('r', -1)) line(cyl(tc, r0, y0), cyl(tc, r0, y1));
              if (edge('r', 1)) line(cyl(tc, r1, y0), cyl(tc, r1, y1));
              if (edge('y', -1)) line(cyl(tc, r0, y0), cyl(tc, r1, y0));
              if (edge('y', 1)) line(cyl(tc, r0, y1), cyl(tc, r1, y1));
            }
          }
        }
      }

      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      solid.geometry.dispose();
      solid.geometry = sg;

      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
      grid.geometry.dispose();
      grid.geometry = gg;
    }

    /* ---------- Rammer der H = h, S = s og V = v treffer sylinderen ---------- */
    // Hvit kjerne med mørk kant, så de synes både på lyse og mørke farger.
    const frameCore = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const frameEdge = new THREE.MeshBasicMaterial({ color: 0x111111, side: THREE.BackSide });
    const CORE_R = 0.011, EDGE_R = 0.02;

    const straightFrame = () => {
      const core = s3.tube(frameCore, CORE_R), edge = s3.tube(frameEdge, EDGE_R);
      core.renderOrder = 3; edge.renderOrder = 2;
      scene.add(edge, core);
      return { set(a, b) { s3.setTube(core, a, b); s3.setTube(edge, a, b); } };
    };
    const ringFrame = () => {
      const core = new THREE.Mesh(new THREE.BufferGeometry(), frameCore);
      const edge = new THREE.Mesh(new THREE.BufferGeometry(), frameEdge);
      core.renderOrder = 3; edge.renderOrder = 2;
      [core, edge].forEach(m => { m.rotation.x = -Math.PI / 2; scene.add(m); });
      let radius = -1;
      return {
        set(r, y) {
          const visible = r > 1e-4;
          core.visible = edge.visible = visible;
          if (!visible) return;
          if (Math.abs(r - radius) > 1e-6) {
            radius = r;
            core.geometry.dispose(); edge.geometry.dispose();
            core.geometry = new THREE.TorusGeometry(r, CORE_R, 8, SEG_PER_TURN);
            edge.geometry = new THREE.TorusGeometry(r, EDGE_R, 8, SEG_PER_TURN);
          }
          core.position.y = edge.position.y = y;
        }
      };
    };
    const hFrame = [straightFrame(), straightFrame(), straightFrame()];   // topp, ytterkant, bunn
    const sFrame = [ringFrame(), ringFrame()];                          // topp og bunn
    const vFrame = ringFrame();                                         // rundt veggen

    /* ---------- Punktet (den valgte fargen) ---------- */
    const marker = s3.marker();

    /* ---------- Aksene ---------- */
    const inkMesh = new THREE.MeshBasicMaterial({ color: 0x777777 });
    const inkLine = new THREE.LineBasicMaterial({ color: 0x777777 });
    const knobWhite = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const RING_R = RADIUS + 0.2;
    const makeKnob = () => {
      const outer = s3.sphere(knobWhite, 0.06), inner = s3.sphere(inkMesh, 0.045);
      inner.renderOrder = 1;
      scene.add(outer, inner);
      return { set(q) { outer.position.set(...q); inner.position.set(...q); } };
    };
    const makeLines = count => {
      const l = new THREE.LineSegments(new THREE.BufferGeometry(), inkLine);
      l.geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 6), 3));
      scene.add(l);
      return {
        set(i, a, b) { const arr = l.geometry.attributes.position.array; arr.set(a, i * 6); arr.set(b, i * 6 + 3); },
        done() { l.geometry.attributes.position.needsUpdate = true; }
      };
    };

    // H: en ring med pil rundt foten av sylinderen
    const hRing = new THREE.Mesh(new THREE.TorusGeometry(RING_R, 0.009, 8, SEG_PER_TURN, TAU * 346 / 360), inkMesh);
    hRing.rotation.x = -Math.PI / 2;
    const hArrow = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.16, 16), inkMesh);
    scene.add(hRing, hArrow);
    const hTicks = makeLines(H_TICKS.length), hKnob = makeKnob(), hLink = makeLines(1);

    // S: en linje fra midten og ut, over toppen, i retning av valgt H
    const sShaft = s3.tube(inkMesh, 0.009);
    const sArrow = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.16, 16), inkMesh);
    scene.add(sShaft, sArrow);
    const sTicks = makeLines(SV_TICKS.length), sKnob = makeKnob(), sLink = makeLines(1);

    // V: en loddrett linje ved siden av sylinderen
    const vShaft = s3.tube(inkMesh, 0.009);
    const vArrow = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.16, 16), inkMesh);
    scene.add(vShaft, vArrow);
    const vTicks = makeLines(SV_TICKS.length), vKnob = makeKnob(), vLink = makeLines(1);

    const pointArrow = (mesh, q, dir) => {
      mesh.position.set(...q);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dir).normalize());
    };

    /* ---------- Tekst ---------- */
    const hLabels = H_TICKS.map(t => s3.label('s3d-tick num', String(t)));
    const sLabels = SV_TICKS.map(t => s3.label('s3d-tick num', String(t)));
    const vLabels = SV_TICKS.map(t => s3.label('s3d-tick num', String(t)));
    const hVal = s3.label('s3d-val num', ''), sVal = s3.label('s3d-val num', ''), vVal = s3.label('s3d-val num', '');
    const nameLabels = HUE_NAMES.map(([name]) => s3.label('s3d-name', name));
    const whiteLabel = s3.label('s3d-name', 'Hvit'), blackLabel = s3.label('s3d-name', 'Svart');

    function applyTheme() {
      const theme = s3.theme();
      inkMesh.color.set(theme.ink2);
      inkLine.color.set(theme.ink2);
    }
    applyTheme();

    /* ---------- Tegning ---------- */
    let geo = {};   // posisjoner som også brukes av etikettene

    function beforeRender() {
      const [H, S, V] = hsv;
      const h = hueAngle(H), sN = S / 255, vN = V / 255;
      const above = s3.cameraAbove;

      // Kakebiten skal åpne seg mot kameraet
      const cameraHue = view.theta - Math.PI / 2;
      const wedgeStart = wrapAngle(cameraHue - h) >= 0 ? h : h - WEDGE;
      const key = `${hsv.join(',')}|${wedgeStart.toFixed(4)}|${above}|${cut}`;
      if (key !== solidKey) { buildSolid(wedgeStart, above); solidKey = key; }

      // rammer
      hFrame[0].set(cyl(h, 0, 1), cyl(h, 1.008, 1));
      hFrame[1].set(cyl(h, 1.008, 0), cyl(h, 1.008, 1));
      hFrame[2].set(cyl(h, 0, 0), cyl(h, 1.008, 0));
      sFrame[0].set(sN * RADIUS, HALF_H);
      sFrame[1].set(sN * RADIUS, -HALF_H);
      vFrame.set(RADIUS * 1.004, (vN * 2 - 1) * HALF_H);

      marker.set(cyl(h, sN, vN), bgr[2], bgr[1], bgr[0]);

      // H-ringen ligger ved foten (eller ved toppen hvis du ser nedenfra)
      const ringY = above ? 0 : 1;
      const ringDrop = above ? -0.1 : 0.1;      // litt under foten, så tallene ikke kolliderer med V-aksen
      const ringAt = (t, extra = 0) => { const q = cyl(t, (RING_R + extra) / RADIUS, ringY); q[1] += ringDrop; return q; };
      hRing.position.y = (above ? -HALF_H : HALF_H) + ringDrop;
      const arrowT = TAU * 353 / 360;
      pointArrow(hArrow, ringAt(arrowT), [-Math.sin(arrowT), 0, -Math.cos(arrowT)]);
      H_TICKS.forEach((t, i) => hTicks.set(i, ringAt(hueAngle(t)), ringAt(hueAngle(t), 0.07)));
      hTicks.done();
      hKnob.set(ringAt(h));
      hLink.set(0, ringAt(h), cyl(h, 1, ringY));
      hLink.done();

      // S-aksen over toppen, langs valgt H
      const capY = above ? 1 : 0;
      const lift = above ? 0.16 : -0.16;
      const sAt = (r, extra = 0) => { const q = cyl(h, r, capY); q[1] += lift + extra; return q; };
      s3.setTube(sShaft, sAt(0), sAt(1.04));
      pointArrow(sArrow, sAt(1.1), [Math.cos(h), 0, -Math.sin(h)]);
      SV_TICKS.forEach((t, i) => sTicks.set(i, sAt(t / 255), sAt(t / 255, above ? 0.06 : -0.06)));
      sTicks.done();
      sKnob.set(sAt(sN));
      sLink.set(0, sAt(sN), cyl(h, sN, capY));
      sLink.done();

      // V-aksen til høyre for sylinderen, sett fra kameraet
      const right = [Math.cos(view.theta), 0, -Math.sin(view.theta)];
      const vR = RING_R + 0.34;
      const vAt = (y, extra = 0) => [right[0] * (vR + extra), (y * 2 - 1) * HALF_H, right[2] * (vR + extra)];
      s3.setTube(vShaft, vAt(0), vAt(1.04));
      pointArrow(vArrow, vAt(1.1), [0, 1, 0]);
      SV_TICKS.forEach((t, i) => vTicks.set(i, vAt(t / 255), vAt(t / 255, 0.07)));
      vTicks.done();
      vKnob.set(vAt(vN));
      vLink.set(0, vAt(vN), [right[0] * RADIUS, (vN * 2 - 1) * HALF_H, right[2] * RADIUS]);
      vLink.done();

      geo = { h, sN, vN, ringAt, sAt, vAt, right, above };
    }

    function afterRender() {
      const [H, S, V] = hsv;
      const { h, sN, vN, ringAt, sAt, vAt, right, above } = geo;
      const hueDist = (a, b) => { const d = Math.abs(a - b) % 180; return Math.min(d, 180 - d); };

      H_TICKS.forEach((t, i) => {
        const q = ringAt(hueAngle(t));
        const out = [Math.cos(hueAngle(t)), 0, -Math.sin(hueAngle(t))];
        s3.place(hLabels[i], s3.beside(q, out, 16), hueDist(t, H) > 12 && !s3.isHidden(q, solid));
      });
      hVal.textContent = `H = ${H}`;
      s3.place(hVal, s3.beside(ringAt(h), [Math.cos(h), 0, -Math.sin(h)], 22));

      const up = [0, above ? 1 : -1, 0];
      // bare 0 og 255 på S-aksen, ellers blir det trangt over toppen
      SV_TICKS.forEach((t, i) => s3.place(sLabels[i], s3.beside(sAt(t / 255), up, 14), (t === 0 || t === 255) && Math.abs(t - S) > 32));
      sVal.textContent = `S = ${S}`;
      s3.place(sVal, s3.beside(sAt(sN), up, 18));

      SV_TICKS.forEach((t, i) => s3.place(vLabels[i], s3.beside(vAt(t / 255), right, 16), Math.abs(t - V) > 32));
      vVal.textContent = `V = ${V}`;
      s3.place(vVal, s3.beside(vAt(vN), right, 22));

      const names = [...nameLabels, whiteLabel, blackLabel];
      names.forEach(el => { el.style.display = showNames ? '' : 'none'; });
      if (showNames) {
        // fargenavnene står utenfor tallene på H-ringen
        HUE_NAMES.forEach(([, Ht], i) => {
          const t = hueAngle(Ht), q = ringAt(t);
          s3.place(nameLabels[i], s3.beside(q, [Math.cos(t), 0, -Math.sin(t)], 36), hueDist(Ht, H) > 12 && !s3.isHidden(q, solid));
        });
        // Hvit og Svart står i midten, på motsatt side av S-aksen
        const top = cyl(0, 0, 1), bottom = cyl(0, 0, 0), away = [-Math.cos(h), 0, Math.sin(h)];
        s3.place(whiteLabel, s3.beside(top, away, 22), !s3.isHidden(top, solid));
        s3.place(blackLabel, s3.beside(bottom, away, 22), !s3.isHidden(bottom, solid));
      }
    }

    return {
      update(newHsv, newBgr) { hsv = newHsv.slice(); bgr = newBgr.slice(); s3.draw(); },
      setCut(on) { cut = !!on; s3.draw(); },
      setLabels(on) { showNames = !!on; s3.draw(); },
      resetView() { s3.resetView(); }
    };
  }

  root.Sylinder3D = { create };
})(typeof self !== 'undefined' ? self : this);

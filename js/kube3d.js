/*
 * kube3d.js – RGB-kuben i 3D (bygger på scene3d.js og three.js)
 *
 * Koordinater i scenen: x = B, y = G, z = R. Kuben går fra -1 til 1,
 * så verdien 0 ligger på -1 og 255 på 1. Da havner hvitt i hjørnet
 * nærmest deg og svart bakerst, slik som på det klassiske bildet.
 *
 * Det som tegnes:
 *   - Kuben, farget med vertex-farger. Fargen i et punkt er en lineær
 *     funksjon av posisjonen, så interpolasjonen mellom hjørnene er eksakt.
 *   - Hjørnet mot kameraet skjæres ut fra fargen du har valgt og ut til
 *     kanten. De tre snittflatene er B = b, G = g og R = r, og de møtes
 *     akkurat i den valgte fargen.
 *   - Fargede rammer rundt kuben der hver snittflate ligger.
 *   - Tre akser med verdier fra 0 til 255. Aksene flytter seg til de
 *     kantene som er synlige når du snur kuben.
 *
 * Bruk:  const kube = Kube3D.create(element);  kube.update([b, g, r]);
 */
(function (root) {
  'use strict';

  const TICKS = [0, 51, 102, 153, 204, 255];   // 5 ruter per side, som på bildet
  const AXIS_GAP = 0.2;                         // avstand fra kubekanten ut til aksen
  const KEYS = ['B', 'G', 'R'];
  const CORNERS = [
    { name: 'Svart', q: [-1, -1, -1] }, { name: 'Blå', q: [1, -1, -1] },
    { name: 'Grønn', q: [-1, 1, -1] }, { name: 'Rød', q: [-1, -1, 1] },
    { name: 'Cyan', q: [1, 1, -1] }, { name: 'Magenta', q: [1, -1, 1] },
    { name: 'Gul', q: [-1, 1, 1] }, { name: 'Hvit', q: [1, 1, 1] }
  ];

  const toCoord = v => v / 255 * 2 - 1;
  const sign = v => (v >= 0 ? 1 : -1);

  function create(host) {
    const s3 = root.Scene3D.create(host, {
      ariaLabel: 'RGB-kube i 3D. Dra med musen eller bruk piltastene for å snu den.',
      view: { theta: Math.PI / 4, phi: 0.46 },
      distance: 8.1,
      lookAtY: -0.2,
      beforeRender,
      afterRender,
      onTheme: applyTheme
    });
    const { THREE, scene, camera } = s3;

    /* ---------- Tilstand ---------- */
    let bgr = [0, 0, 0];
    let cut = true;
    let showCorners = false;
    let solidKey = '';
    let s = [1, 1, 1];            // hvilken side av kuben kameraet er på (+1/-1 per akse)
    let p = [0, 0, 0];            // valgt farge som koordinat

    /* ---------- Selve kuben ---------- */
    const solid = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })
    );
    const grid = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 })
    );
    scene.add(solid, grid);

    // Deler kuben i 8 bokser med planene gjennom punktet p, og fjerner boksen i
    // hjørnet mot kameraet. Bare flater som vender ut mot luft blir tegnet.
    function buildSolid() {
      const bounds = [[-1, p[0], 1], [-1, p[1], 1], [-1, p[2], 1]];
      const removed = s.map(v => (v > 0 ? 1 : 0));
      const exists = idx => {
        for (let a = 0; a < 3; a++) {
          if (idx[a] < 0 || idx[a] > 1) return false;
          if (bounds[a][idx[a] + 1] - bounds[a][idx[a]] <= 1e-9) return false;
        }
        return !(cut && idx[0] === removed[0] && idx[1] === removed[1] && idx[2] === removed[2]);
      };

      const pos = [], col = [], lines = [];
      const pushPoint = q => {
        pos.push(q[0], q[1], q[2]);
        // posisjon -> farge: R = z, G = y, B = x
        col.push((q[2] + 1) / 2, (q[1] + 1) / 2, (q[0] + 1) / 2);
      };

      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) {
        const idx = [i, j, k];
        if (!exists(idx)) continue;
        const min = [bounds[0][i], bounds[1][j], bounds[2][k]];
        const max = [bounds[0][i + 1], bounds[1][j + 1], bounds[2][k + 1]];

        for (let a = 0; a < 3; a++) {
          for (const dir of [-1, 1]) {
            const n = idx.slice();
            n[a] += dir;
            if (exists(n)) continue;          // naboboksen dekker flaten

            const u = (a + 1) % 3, v = (a + 2) % 3;
            const w = dir > 0 ? max[a] : min[a];
            const pt = (cu, cv) => { const q = [0, 0, 0]; q[a] = w; q[u] = cu; q[v] = cv; return q; };
            const quad = [pt(min[u], min[v]), pt(max[u], min[v]), pt(max[u], max[v]), pt(min[u], max[v])];
            const order = dir > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];   // mot klokka sett utenfra
            order.forEach(o => pushPoint(quad[o]));

            // rutenett og kanter på flaten
            const line = (q1, q2) => lines.push(q1[0], q1[1], q1[2], q2[0], q2[1], q2[2]);
            const us = new Set([min[u], max[u]]), vs = new Set([min[v], max[v]]);
            TICKS.forEach(t => {
              const tc = toCoord(t);
              if (tc > min[u] && tc < max[u]) us.add(tc);
              if (tc > min[v] && tc < max[v]) vs.add(tc);
            });
            us.forEach(cu => line(pt(cu, min[v]), pt(cu, max[v])));
            vs.forEach(cv => line(pt(min[u], cv), pt(max[u], cv)));
          }
        }
      }

      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      sg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      solid.geometry.dispose();
      solid.geometry = sg;

      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
      grid.geometry.dispose();
      grid.geometry = gg;
    }

    /* ---------- Rammer der planene B = b, G = g og R = r treffer kuben ---------- */
    const channelMats = [0, 1, 2].map(() => new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const frames = [0, 1, 2].map(a => {
      const u = (a + 1) % 3, v = (a + 2) % 3;
      const pieces = [];
      [[u, v], [v, u]].forEach(([along, across]) => {
        [-1, 1].forEach(side => {
          const m = s3.tube(channelMats[a], 0.014);
          m.renderOrder = 2;
          scene.add(m);
          pieces.push({ mesh: m, along, across, side });
        });
      });
      return pieces;
    });

    /* ---------- Punktet (den valgte fargen) ---------- */
    const marker = s3.marker();

    /* ---------- Aksene ---------- */
    const inkMat = new THREE.LineBasicMaterial({ color: 0x777777 });
    const axes = [0, 1, 2].map(a => {
      const mat = channelMats[a];
      const shaft = s3.tube(mat, 0.009);
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.16, 16), mat);
      if (a === 0) arrow.rotation.set(0, 0, -Math.PI / 2);
      else if (a === 2) arrow.rotation.set(Math.PI / 2, 0, 0);
      const ticks = new THREE.LineSegments(new THREE.BufferGeometry(), inkMat);
      ticks.geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(TICKS.length * 6), 3));
      const knobOuter = s3.sphere(new THREE.MeshBasicMaterial({ color: 0xffffff }), 0.06);
      const knob = s3.sphere(mat, 0.045);
      knob.renderOrder = 1;
      const link = new THREE.Line(new THREE.BufferGeometry(), inkMat);
      link.geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
      scene.add(shaft, arrow, ticks, knobOuter, knob, link);
      return { shaft, arrow, ticks, knob, knobOuter, link };
    });

    /* ---------- Tekst ---------- */
    const axisLabels = [0, 1, 2].map(a => ({
      ticks: TICKS.map(t => s3.label('s3d-tick num', String(t))),
      value: s3.label(`s3d-val num ch-${KEYS[a].toLowerCase()}`, '')
    }));
    const cornerLabels = CORNERS.map(c => s3.label('s3d-name', c.name));

    function applyTheme() {
      const theme = s3.theme();
      [theme.b, theme.g, theme.r].forEach((c, a) => channelMats[a].color.set(c));
      inkMat.color.set(theme.ink2);
    }
    applyTheme();

    // Hvilken kant hver akse skal ligge langs, gitt hvilken side kameraet er på.
    // Svaret er +1/-1 for de to andre koordinatene (0 for aksens egen retning).
    function axisEdge(a) {
      const e = [0, 0, 0];
      if (a === 0) { e[1] = -s[1]; e[2] = s[2]; }   // B langs bunnkanten mot deg
      if (a === 1) { e[0] = s[0]; e[2] = -s[2]; }   // G langs en loddrett kant i profil
      if (a === 2) { e[0] = s[0]; e[1] = -s[1]; }   // R langs den andre bunnkanten
      return e;
    }
    // Punkt på aksen a ved koordinaten coord, litt utenfor kubekanten
    function onAxis(a, coord, extra = 0) {
      const e = axisEdge(a), q = [0, 0, 0];
      for (let d = 0; d < 3; d++) q[d] = d === a ? coord : e[d] * (1 + AXIS_GAP + extra);
      return q;
    }

    /* ---------- Tegning ---------- */
    function beforeRender() {
      s = [sign(camera.position.x), sign(camera.position.y), sign(camera.position.z)];
      p = bgr.map(toCoord);

      const key = `${bgr.join(',')}|${s.join(',')}|${cut}`;
      if (key !== solidKey) { buildSolid(); solidKey = key; }

      frames.forEach((pieces, a) => pieces.forEach(pc => {
        const q1 = [0, 0, 0];
        q1[a] = p[a];
        q1[pc.across] = pc.side;
        const q2 = q1.slice();
        q1[pc.along] = -1.014;
        q2[pc.along] = 1.014;
        s3.setTube(pc.mesh, q1, q2);
      }));

      marker.set(p, bgr[2], bgr[1], bgr[0]);

      axes.forEach((ax, a) => {
        s3.setTube(ax.shaft, onAxis(a, -1), onAxis(a, 1.08));
        const tip = onAxis(a, 1.14);
        ax.arrow.position.set(tip[0], tip[1], tip[2]);

        const arr = ax.ticks.geometry.attributes.position.array;
        TICKS.forEach((t, i) => {
          arr.set(onAxis(a, toCoord(t)), i * 6);
          arr.set(onAxis(a, toCoord(t), 0.07), i * 6 + 3);
        });
        ax.ticks.geometry.attributes.position.needsUpdate = true;

        const qv = onAxis(a, p[a]);
        ax.knob.position.set(...qv);
        ax.knobOuter.position.set(...qv);
        const edge = axisEdge(a);
        edge[a] = p[a];
        const la = ax.link.geometry.attributes.position.array;
        la.set(qv, 0);
        la.set(edge, 3);
        ax.link.geometry.attributes.position.needsUpdate = true;
      });
    }

    function afterRender() {
      axes.forEach((ax, a) => {
        const out = axisEdge(a);
        const L = axisLabels[a];
        TICKS.forEach((t, i) => {
          s3.place(L.ticks[i], s3.beside(onAxis(a, toCoord(t)), out, 16), Math.abs(t - bgr[a]) > 32);
        });
        L.value.textContent = `${KEYS[a]} = ${bgr[a]}`;
        s3.place(L.value, s3.beside(onAxis(a, p[a]), out, 20));
      });

      cornerLabels.forEach((el, i) => {
        if (!showCorners) { el.style.display = 'none'; return; }
        el.style.display = '';
        const q = CORNERS[i].q;
        // hjørner som ligger bak kuben skjules
        s3.place(el, s3.beside(q, q, 14), !s3.isHidden(q, solid));
      });
    }

    return {
      update(newBgr) { bgr = newBgr.slice(); s3.draw(); },
      setCut(on) { cut = !!on; s3.draw(); },
      setLabels(on) { showCorners = !!on; s3.draw(); },
      resetView() { s3.resetView(); }
    };
  }

  root.Kube3D = { create };
})(typeof self !== 'undefined' ? self : this);

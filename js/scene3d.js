/*
 * scene3d.js – felles grunnlag for 3D-visningene (kube3d.js og sylinder3d.js)
 *
 * Tar seg av det som er likt for kuben og sylinderen:
 *   - three.js-renderer uten gamma-omregning, så 0–255-verdier vises uendret
 *   - kamera som går i bane rundt midten (dra med mus/finger, eller piltaster)
 *   - HTML-etiketter oppå lerretet (tall på aksene, verdier, navn)
 *   - små hjelpere for tynne rør, punktmarkør og synlighetstest
 *
 * Bruk:
 *   const s3 = Scene3D.create(element, {
 *     ariaLabel, view: { theta, phi }, distance, lookAtY,
 *     beforeRender(s3) { ... flytt objekter ... },
 *     afterRender(s3)  { ... plasser etiketter ... },
 *     onTheme(s3)      { ... les farger fra CSS ... }
 *   });
 */
(function (root) {
  'use strict';

  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

  function create(host, cfg) {
    const THREE = root.THREE;
    if (!THREE) throw new Error('three.js er ikke lastet (lib/three.min.js)');

    // Fargene skal vises nøyaktig som 0–255-verdiene, uten gamma-omregning.
    THREE.ColorManagement.enabled = false;

    const canvas = document.createElement('canvas');
    canvas.className = 's3d-canvas';
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', cfg.ariaLabel);
    const labelLayer = document.createElement('div');
    labelLayer.className = 's3d-labels';
    labelLayer.setAttribute('aria-hidden', 'true');

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    host.append(canvas, labelLayer);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    const view = { ...cfg.view };
    const vec = new THREE.Vector3();
    const size2 = new THREE.Vector2();
    const raycaster = new THREE.Raycaster();
    const unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 10, 1, false);
    const unitSphere = new THREE.SphereGeometry(1, 24, 16);
    const UP = new THREE.Vector3(0, 1, 0);

    const s3 = {
      THREE, scene, camera, view,
      width: 0,
      height: 0,
      cameraAbove: true,

      /* ---------- etiketter ---------- */
      label(cls, text) {
        const el = document.createElement('span');
        el.className = cls;
        el.textContent = text;
        labelLayer.appendChild(el);
        return el;
      },

      // 3D-punkt -> piksler på lerretet
      project(q) {
        vec.set(q[0], q[1], q[2]).project(camera);
        return [(vec.x + 1) / 2 * s3.width, (1 - vec.y) / 2 * s3.height];
      },

      // Punktet flyttet px piksler i den retningen dir peker på skjermen
      beside(q, dir, px) {
        const a = s3.project(q);
        const b = s3.project([q[0] + dir[0] * 0.3, q[1] + dir[1] * 0.3, q[2] + dir[2] * 0.3]);
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const len = Math.hypot(dx, dy) || 1;
        return [a[0] + dx / len * px, a[1] + dy / len * px];
      },

      // Plasserer en etikett med midten i xy, men holder den innenfor lerretet.
      place(el, xy, visible = true) {
        if (!visible) { el.style.opacity = '0'; return; }
        if (!el._w || el._text !== el.textContent) {
          el._w = el.offsetWidth; el._h = el.offsetHeight; el._text = el.textContent;
        }
        const hw = el._w / 2 + 2, hh = el._h / 2 + 2;
        const x = clamp(xy[0], hw, Math.max(hw, s3.width - hw)) - el._w / 2;
        const y = clamp(xy[1], hh, Math.max(hh, s3.height - hh)) - el._h / 2;
        el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        el.style.opacity = '';
      },

      // Ligger punktet q bak flaten til mesh, sett fra kameraet?
      isHidden(q, mesh) {
        const target = new THREE.Vector3(q[0], q[1], q[2]);
        const dir = target.clone().sub(camera.position);
        const dist = dir.length();
        raycaster.set(camera.position, dir.normalize());
        const hit = raycaster.intersectObject(mesh, false)[0];
        return !!hit && hit.distance < dist - 0.04;
      },

      /* ---------- farger fra CSS ---------- */
      theme() {
        const cs = getComputedStyle(host);
        const get = (name, fallback) => (cs.getPropertyValue(name).trim() || fallback);
        return {
          b: get('--b', '#2257DD'), g: get('--g', '#137A38'), r: get('--r', '#C4261C'),
          ink: get('--ink', '#1F1F1F'), ink2: get('--ink-2', '#595959')
        };
      },

      /* ---------- geometri-hjelpere ---------- */
      // Tynt rør (sylinder) med gitt tykkelse. Plasseres med setTube.
      tube(material, radius) {
        const m = new THREE.Mesh(unitCylinder, material);
        m.scale.set(radius, 1, radius);
        return m;
      },
      setTube(mesh, p1, p2) {
        const a = new THREE.Vector3(...p1), b = new THREE.Vector3(...p2);
        const dir = b.clone().sub(a);
        const len = dir.length() || 1e-6;
        mesh.position.copy(a).add(b).multiplyScalar(0.5);
        mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
        mesh.scale.y = len;
      },
      sphere(material, radius) {
        const m = new THREE.Mesh(unitSphere, material);
        m.scale.setScalar(radius);
        return m;
      },

      // Svart-hvit ring med den valgte fargen i midten. Tegnes alltid øverst.
      marker() {
        const layers = [[0x000000, 0.085], [0xffffff, 0.07], [0x000000, 0.052]].map(([color, r], i) => {
          const m = s3.sphere(new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false }), r);
          m.renderOrder = 10 + i;
          scene.add(m);
          return m;
        });
        return {
          set(q, r255, g255, b255) {
            layers.forEach(m => m.position.set(q[0], q[1], q[2]));
            layers[2].material.color.setRGB(r255 / 255, g255 / 255, b255 / 255);
          }
        };
      }
    };

    /* ---------- tegning ---------- */
    function draw() {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      s3.width = w;
      s3.height = h;

      const dpr = Math.min(root.devicePixelRatio || 1, 2);
      if (renderer.getPixelRatio() !== dpr) renderer.setPixelRatio(dpr);
      const size = renderer.getSize(size2);
      if (size.x !== w || size.y !== h) renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();

      const cp = Math.cos(view.phi);
      camera.position.set(
        cfg.distance * cp * Math.sin(view.theta),
        cfg.distance * Math.sin(view.phi),
        cfg.distance * cp * Math.cos(view.theta)
      );
      s3.cameraAbove = camera.position.y >= 0;
      camera.lookAt(0, (cfg.lookAtY || 0) * (s3.cameraAbove ? 1 : -1), 0);
      camera.updateMatrixWorld();

      cfg.beforeRender(s3);
      renderer.render(scene, camera);
      cfg.afterRender(s3);
    }

    let pending = false;
    function requestDraw() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => { pending = false; draw(); });
    }
    s3.draw = draw;
    s3.requestDraw = requestDraw;
    s3.resetView = () => { Object.assign(view, cfg.view); draw(); };

    /* ---------- snu med mus, finger eller piltaster ---------- */
    let drag = null;
    canvas.addEventListener('pointerdown', e => {
      drag = { x: e.clientX, y: e.clientY };
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      host.classList.add('dragging');
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', e => {
      if (!drag) return;
      view.theta -= (e.clientX - drag.x) * 0.009;
      view.phi = clamp(view.phi + (e.clientY - drag.y) * 0.009, -1.45, 1.45);
      drag = { x: e.clientX, y: e.clientY };
      requestDraw();
    });
    const endDrag = () => { drag = null; host.classList.remove('dragging'); };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('keydown', e => {
      const step = e.shiftKey ? 0.26 : 0.087;
      const d = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
      if (!d) return;
      e.preventDefault();
      view.theta += d[0];
      view.phi = clamp(view.phi + d[1], -1.45, 1.45);
      requestDraw();
    });

    new ResizeObserver(requestDraw).observe(host);
    const themeChanged = () => { if (cfg.onTheme) cfg.onTheme(s3); requestDraw(); };
    if (root.matchMedia) root.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', themeChanged);
    new MutationObserver(themeChanged).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });

    return s3;
  }

  root.Scene3D = { create };
})(typeof self !== 'undefined' ? self : this);

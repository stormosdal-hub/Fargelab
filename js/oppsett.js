/*
 * oppsett.js – kort du kan flytte og endre størrelsen på
 *
 * Kortene (Bilde, BGR og HSV) ligger i rader. Hver rad er delt i 12 kolonner,
 * og hvert kort er et antall kolonner bredt (span). Oppsettet lagres i
 * nettleseren (localStorage), så det er likt neste gang du åpner siden.
 *
 * Flytte:  dra i håndtaket ⠿ eller i tittelen.
 *   - Slipper du kortet på venstre eller høyre del av et annet kort, havner
 *     det ved siden av. Er det ikke plass i raden, deles bredden likt.
 *   - Slipper du det på midten av et kort, havner det i en egen rad over
 *     eller under.
 *   - Esc avbryter. Nær toppen eller bunnen av vinduet ruller siden av seg selv.
 *   - Med tastaturet: sett fokus på håndtaket og bruk piltastene.
 *
 * Endre størrelse:  dra i hjørnet nede til høyre, eller i høyre eller nedre kant.
 *   - Bredden går i hele kolonner. Står det et kort til høyre, flytter du
 *     skillet mellom dem, så raden blir like bred.
 *   - Høyden gjelder bildet, kartet eller 3D-visningen i kortet (elementet
 *     med klassen .fit). Resten av kortet tilpasser seg.
 *   - Dobbeltklikk på hjørnet eller nedre kant gir automatisk høyde igjen.
 *   - Med tastaturet: sett fokus på hjørnet og bruk piltastene.
 *
 * På smale skjermer (under 881 px) ligger kortene under hverandre, og
 * oppsettet brukes ikke.
 *
 * Bruk:
 *   Oppsett.create({
 *     board,                       // elementet som holder radene
 *     cards: { bilde, bgr, hsv },  // kortene, med id som nøkkel
 *     defaults: [[{ id: 'bilde', span: 12, h: null }], ...],
 *     resetBtn, live               // knapp for å tilbakestille, og aria-live-felt
 *   });
 */
(function (root) {
  'use strict';

  const COLS = 12;
  const MIN_SPAN = 3;
  const MAX_PER_ROW = COLS / MIN_SPAN;
  const MIN_H = 140, MAX_H = 2400;            // høyden på .fit, i CSS-piksler
  const STORE_KEY = 'fargelab.oppsett.v1';
  const WIDE = '(min-width: 881px)';          // samme grense som i style.css

  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const copy = rows => rows.map(row => row.map(it => ({ ...it })));
  const reduceMotion = () => !!root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const GRIP_SVG = '<svg viewBox="0 0 10 16" aria-hidden="true" fill="currentColor">' +
    '<circle cx="2.5" cy="2.5" r="1.5"/><circle cx="7.5" cy="2.5" r="1.5"/>' +
    '<circle cx="2.5" cy="8" r="1.5"/><circle cx="7.5" cy="8" r="1.5"/>' +
    '<circle cx="2.5" cy="13.5" r="1.5"/><circle cx="7.5" cy="13.5" r="1.5"/></svg>';
  const CORNER_SVG = '<svg viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">' +
    '<path d="M16 6 6 16M16 11l-5 5"/></svg>';

  function create(cfg) {
    const { board, cards, defaults, resetBtn, live } = cfg;
    const ids = Object.keys(cards);
    const wide = root.matchMedia ? root.matchMedia(WIDE) : { matches: true };
    const names = {};
    ids.forEach(id => { names[id] = (cards[id].querySelector('h2') || {}).textContent || id; });

    /* ---------- Modellen: rader med { id, span, h } ---------- */
    function valid(rows) {
      if (!Array.isArray(rows)) return false;
      const seen = new Set();
      for (const row of rows) {
        if (!Array.isArray(row) || !row.length || row.length > MAX_PER_ROW) return false;
        let sum = 0;
        for (const it of row) {
          if (!it || !cards[it.id] || seen.has(it.id)) return false;
          if (!Number.isInteger(it.span) || it.span < MIN_SPAN || it.span > COLS) return false;
          if (it.h !== null && !(Number.isFinite(it.h) && it.h >= MIN_H && it.h <= MAX_H)) return false;
          seen.add(it.id);
          sum += it.span;
        }
        if (sum > COLS) return false;
      }
      return seen.size === ids.length;
    }

    function loadSaved() {
      try {
        const rows = JSON.parse(root.localStorage.getItem(STORE_KEY));
        return valid(rows) ? rows : null;
      } catch (_) {
        return null;
      }
    }
    const isDefault = () => JSON.stringify(layout) === JSON.stringify(defaults);
    function save() {
      try {
        if (isDefault()) root.localStorage.removeItem(STORE_KEY);
        else root.localStorage.setItem(STORE_KEY, JSON.stringify(layout));
      } catch (_) { /* privat vindu eller blokkert lagring: oppsettet gjelder bare nå */ }
      if (resetBtn) resetBtn.hidden = isDefault();
    }

    let layout = loadSaved() || copy(defaults);

    function locate(id) {
      for (let r = 0; r < layout.length; r++) {
        const i = layout[r].findIndex(it => it.id === id);
        if (i >= 0) return { r, i, row: layout[r], item: layout[r][i] };
      }
      return null;
    }
    // Tar kortet ut av raden sin. En tom rad forsvinner.
    function take(id) {
      const p = locate(id);
      p.row.splice(p.i, 1);
      if (!p.row.length) layout.splice(p.r, 1);
      return p.item;
    }
    // Får et nytt kort plass i raden? Først brukes ledig plass, ellers deles raden likt.
    function fitRow(row, added) {
      const others = row.reduce((s, it) => (it === added ? s : s + it.span), 0);
      const free = COLS - others;
      if (added.span <= free) return;
      if (free >= MIN_SPAN) { added.span = free; return; }
      const n = row.length, base = Math.floor(COLS / n);
      row.forEach((it, k) => { it.span = base + (k < COLS % n ? 1 : 0); });
    }
    // zone: 'left' eller 'right' = ved siden av target, 'above' eller 'below' = egen rad
    function moveInModel(id, targetId, zone) {
      if (id === targetId) return;
      const item = take(id);
      const t = locate(targetId);
      if ((zone === 'left' || zone === 'right') && t.row.length < MAX_PER_ROW) {
        t.row.splice(t.i + (zone === 'right' ? 1 : 0), 0, item);
        fitRow(t.row, item);
      } else {
        const below = zone === 'below' || zone === 'right';
        layout.splice(t.r + (below ? 1 : 0), 0, [item]);
      }
    }
    // Ny bredde. Står det et kort til høyre, flyttes skillet mellom dem.
    function setSpan(p, s) {
      const nb = p.row[p.i + 1];
      if (nb) {
        const pair = p.item.span + nb.span;
        s = clamp(s, MIN_SPAN, pair - MIN_SPAN);
        nb.span = pair - s;
      } else {
        const others = p.row.reduce((sum, it) => (it === p.item ? sum : sum + it.span), 0);
        s = clamp(s, MIN_SPAN, COLS - others);
      }
      p.item.span = s;
    }

    /* ---------- Fra modell til side ---------- */
    function apply() {
      layout.forEach((row, r) => {
        let rowEl = board.children[r];
        if (!rowEl) {
          rowEl = document.createElement('div');
          rowEl.className = 'board-row';
          board.appendChild(rowEl);
        }
        row.forEach((it, i) => {
          const card = cards[it.id];
          if (rowEl.children[i] !== card) rowEl.insertBefore(card, rowEl.children[i] || null);
          card.style.setProperty('--span', it.span);
          card.classList.toggle('fixed-h', it.h !== null);
          if (it.h !== null) card.style.setProperty('--fit-h', it.h + 'px');
          else card.style.removeProperty('--fit-h');
        });
      });
      while (board.children.length > layout.length) board.lastElementChild.remove();
      if (resetBtn) resetBtn.hidden = isDefault();
    }

    // Lar kortene gli til de nye plassene sine (FLIP-animasjon)
    function animateMove(mutate) {
      const before = new Map(ids.map(id => [id, cards[id].getBoundingClientRect()]));
      mutate();
      if (reduceMotion()) return;
      ids.forEach(id => {
        const a = before.get(id), b = cards[id].getBoundingClientRect();
        const dx = a.left - b.left, dy = a.top - b.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
        cards[id].animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
          { duration: 240, easing: 'cubic-bezier(.2, .7, .3, 1)' }
        );
      });
    }

    function announce(text) {
      if (!live) return;
      live.textContent = '';
      setTimeout(() => { live.textContent = text; }, 30);
    }
    function whereIs(id) {
      const p = locate(id);
      return `${names[id]} ligger i rad ${p.r + 1} av ${layout.length}, plass ${p.i + 1} av ${p.row.length}.`;
    }
    const fitOf = card => {
      const fit = card.querySelector('.fit');
      return fit && fit.getClientRects().length ? fit : null;
    };

    /* ---------- Rulling når pekeren er nær kanten av vinduet ---------- */
    // Ruller bare når du drar mot kanten (startY er der du tok tak), så siden
    // ikke begynner å rulle bare fordi du tar tak i et hjørne nederst i vinduet.
    function autoScroll(getY, startY, onScroll) {
      let raf = 0;
      const tick = () => {
        const y = getY(), edge = 70, vh = root.innerHeight;
        let v = 0;
        if (y < edge && y < startY - 8) v = -Math.ceil((edge - y) / 4);
        else if (y > vh - edge && y > startY + 8) v = Math.ceil((y - (vh - edge)) / 4);
        if (v) {
          const before = root.scrollY;
          root.scrollBy(0, v);
          if (root.scrollY !== before) onScroll();
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }

    /* ---------- Flytte med pekeren ---------- */
    const mark = document.createElement('div');
    mark.className = 'drop-mark';
    mark.hidden = true;
    document.body.appendChild(mark);

    // Finner kortet nærmest pekeren og hvilken del av det pekeren er over
    function findTarget(dragId, x, y) {
      let best = null, bestD = Infinity;
      ids.forEach(id => {
        if (id === dragId) return;
        const r = cards[id].getBoundingClientRect();
        const d = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
        if (d < bestD) { bestD = d; best = { id, r }; }
      });
      if (!best) return null;
      const fx = clamp((x - best.r.left) / best.r.width, 0, 1);
      const fy = clamp((y - best.r.top) / best.r.height, 0, 1);
      const zone = fx < 0.3 ? 'left' : fx > 0.7 ? 'right' : fy < 0.5 ? 'above' : 'below';
      // Vis bare et merke hvis slippet faktisk endrer noe
      const saved = copy(layout);
      moveInModel(dragId, best.id, zone);
      const changed = JSON.stringify(layout) !== JSON.stringify(saved);
      layout = saved;
      return changed ? { id: best.id, zone, r: best.r } : null;
    }

    function showMark(t) {
      mark.hidden = !t;
      if (!t) return;
      const rowEl = cards[t.id].parentElement;
      const gap = parseFloat(getComputedStyle(rowEl).columnGap) || 20;
      const rowGap = parseFloat(getComputedStyle(board).rowGap) || 20;
      const p = locate(t.id);
      let box;
      if ((t.zone === 'left' || t.zone === 'right') && p.row.length < MAX_PER_ROW) {
        const x = t.zone === 'left' ? t.r.left - gap / 2 : t.r.right + gap / 2;
        box = { left: x - 2, top: t.r.top, width: 4, height: t.r.height };
      } else {
        const rr = rowEl.getBoundingClientRect();
        const below = t.zone === 'below' || t.zone === 'right';
        const y = below ? rr.bottom + rowGap / 2 : rr.top - rowGap / 2;
        box = { left: rr.left, top: y - 2, width: rr.width, height: 4 };
      }
      Object.assign(mark.style, {
        left: box.left + 'px', top: box.top + 'px', width: box.width + 'px', height: box.height + 'px'
      });
    }

    function startDrag(e, id, handle) {
      if (!wide.matches || e.button !== 0) return;
      const card = cards[id];
      const start = { x: e.clientX, y: e.clientY, sx: root.scrollX, sy: root.scrollY };
      let last = { x: e.clientX, y: e.clientY };
      let active = false, target = null, stopScroll = null;
      try { handle.setPointerCapture(e.pointerId); } catch (_) {}

      const update = () => {
        const dx = last.x - start.x + root.scrollX - start.sx;
        const dy = last.y - start.y + root.scrollY - start.sy;
        card.style.transform = `translate(${dx}px, ${dy}px)`;
        target = findTarget(id, last.x, last.y);
        showMark(target);
      };
      const onMove = ev => {
        last = { x: ev.clientX, y: ev.clientY };
        if (!active) {
          if (Math.hypot(last.x - start.x, last.y - start.y) < 5) return;
          active = true;
          card.classList.add('is-dragging');
          document.body.classList.add('card-dragging');
          stopScroll = autoScroll(() => last.y, start.y, update);
          root.addEventListener('scroll', update, { passive: true });
        }
        update();
      };
      const finish = commit => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onCancel);
        root.removeEventListener('keydown', onKey, true);
        if (!active) return;
        stopScroll();
        root.removeEventListener('scroll', update);
        mark.hidden = true;
        document.body.classList.remove('card-dragging');
        const t = commit ? target : null;
        animateMove(() => {
          card.classList.remove('is-dragging');
          card.style.transform = '';
          if (t) {
            moveInModel(id, t.id, t.zone);
            apply();
            save();
          }
        });
        if (t) announce(whereIs(id));
      };
      const onUp = () => finish(true);
      const onCancel = () => finish(false);
      const onKey = ev => {
        if (ev.key !== 'Escape') return;
        ev.preventDefault();
        ev.stopPropagation();
        finish(false);
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onCancel);
      root.addEventListener('keydown', onKey, true);
    }

    /* ---------- Flytte med tastaturet ---------- */
    function nudge(id, key) {
      const p = locate(id);
      const before = JSON.stringify(layout);
      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        const j = p.i + (key === 'ArrowLeft' ? -1 : 1);
        if (j < 0 || j >= p.row.length) return false;
        [p.row[p.i], p.row[j]] = [p.row[j], p.row[p.i]];
      } else {
        const up = key === 'ArrowUp';
        const other = layout[p.r + (up ? -1 : 1)];
        if (!other && p.row.length === 1) return false;
        const item = take(id);
        if (!other) {
          if (up) layout.unshift([item]); else layout.push([item]);
        } else if (other.length >= MAX_PER_ROW) {
          layout.splice(layout.indexOf(other) + (up ? 1 : 0), 0, [item]);
        } else {
          if (up) other.push(item); else other.unshift(item);
          fitRow(other, item);
        }
      }
      return JSON.stringify(layout) !== before;
    }

    /* ---------- Endre størrelse ---------- */
    let badge = null;
    function showBadge(card, it) {
      if (!badge) { badge = document.createElement('div'); badge.className = 'rz-badge'; }
      if (badge.parentElement !== card) card.appendChild(badge);
      badge.textContent = `${it.span} av ${COLS} kolonner` + (it.h !== null ? ` · ${it.h} px høy` : '');
    }
    const hideBadge = () => { if (badge) badge.remove(); };

    function startResize(e, id, axis, handle) {
      if (!wide.matches || e.button !== 0) return;
      e.preventDefault();
      const card = cards[id];
      const fit = fitOf(card);
      if (axis === 'y' && !fit) return;
      const p0 = locate(id);
      const startSpan = p0.item.span;
      const startH = p0.item.h !== null ? p0.item.h : fit ? Math.round(fit.getBoundingClientRect().height) : null;
      const rowEl = card.parentElement;
      const gap = parseFloat(getComputedStyle(rowEl).columnGap) || 0;
      const unit = (rowEl.clientWidth + gap) / COLS;
      const start = { x: e.clientX, y: e.clientY, sy: root.scrollY };
      let last = { x: e.clientX, y: e.clientY };
      try { handle.setPointerCapture(e.pointerId); } catch (_) {}
      card.classList.add('resizing');
      document.body.classList.add('card-resizing');

      const update = () => {
        const p = locate(id);
        if (axis !== 'y') setSpan(p, startSpan + Math.round((last.x - start.x) / unit));
        if (axis !== 'x' && startH !== null) {
          p.item.h = clamp(Math.round(startH + last.y - start.y + root.scrollY - start.sy), MIN_H, MAX_H);
        }
        apply();
        showBadge(card, p.item);
      };
      const stopScroll = axis !== 'x' ? autoScroll(() => last.y, start.y, update) : () => {};
      const onMove = ev => { last = { x: ev.clientX, y: ev.clientY }; update(); };
      const onUp = () => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        stopScroll();
        card.classList.remove('resizing');
        document.body.classList.remove('card-resizing');
        hideBadge();
        save();
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
      showBadge(card, p0.item);
    }

    function autoHeight(id) {
      const p = locate(id);
      if (p.item.h === null) return;
      p.item.h = null;
      apply();
      save();
      announce(`${names[id]} har automatisk høyde igjen.`);
    }

    /* ---------- Håndtak på hvert kort ---------- */
    ids.forEach(id => {
      const card = cards[id];
      const head = card.querySelector('.panel-head');
      const main = head.firstElementChild;
      const startBox = document.createElement('div');
      startBox.className = 'head-start';
      const grip = document.createElement('button');
      grip.type = 'button';
      grip.className = 'card-grip';
      grip.innerHTML = GRIP_SVG;
      grip.setAttribute('aria-label', `Flytt kortet ${names[id]}`);
      grip.title = 'Dra for å flytte kortet. Med tastaturet: piltastene.';
      head.insertBefore(startBox, main);
      startBox.append(grip, main);

      startBox.addEventListener('pointerdown', e => startDrag(e, id, startBox));
      grip.addEventListener('keydown', e => {
        if (!wide.matches || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
        e.preventDefault();
        let moved = false;
        animateMove(() => {
          moved = nudge(id, e.key);
          if (moved) { apply(); save(); }
        });
        grip.focus({ preventScroll: true });
        grip.scrollIntoView({ block: 'nearest' });
        announce(moved ? whereIs(id) : `${names[id]} kan ikke flyttes lenger den veien.`);
      });

      const edgeX = document.createElement('div');
      edgeX.className = 'rz rz-x';
      edgeX.title = 'Dra for å endre bredden';
      const edgeY = document.createElement('div');
      edgeY.className = 'rz rz-y';
      edgeY.title = 'Dra for å endre høyden. Dobbeltklikk for automatisk høyde.';
      const corner = document.createElement('button');
      corner.type = 'button';
      corner.className = 'rz rz-xy';
      corner.innerHTML = CORNER_SVG;
      corner.setAttribute('aria-label', `Endre størrelsen på kortet ${names[id]}`);
      corner.title = 'Dra for å endre størrelsen. Dobbeltklikk for automatisk høyde. Med tastaturet: piltastene.';
      card.append(edgeX, edgeY, corner);

      edgeX.addEventListener('pointerdown', e => startResize(e, id, 'x', edgeX));
      edgeY.addEventListener('pointerdown', e => startResize(e, id, 'y', edgeY));
      corner.addEventListener('pointerdown', e => startResize(e, id, 'xy', corner));
      edgeY.addEventListener('dblclick', () => autoHeight(id));
      corner.addEventListener('dblclick', () => autoHeight(id));
      corner.addEventListener('keydown', e => {
        if (!wide.matches) return;
        const p = locate(id);
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          setSpan(p, p.item.span + (e.key === 'ArrowLeft' ? -1 : 1));
          announce(`Bredde ${p.item.span} av ${COLS} kolonner.`);
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          const fit = fitOf(card);
          if (!fit) return;
          const h = p.item.h !== null ? p.item.h : Math.round(fit.getBoundingClientRect().height);
          const step = e.shiftKey ? 80 : 20;
          p.item.h = clamp(h + (e.key === 'ArrowUp' ? -step : step), MIN_H, MAX_H);
          announce(`Høyde ${p.item.h} piksler.`);
        } else {
          return;
        }
        e.preventDefault();
        apply();
        save();
      });
    });

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        animateMove(() => { layout = copy(defaults); apply(); save(); });
        announce('Oppsettet er tilbakestilt.');
      });
    }

    apply();
    return { reset: () => resetBtn && resetBtn.click() };
  }

  root.Oppsett = { create };
})(typeof self !== 'undefined' ? self : this);

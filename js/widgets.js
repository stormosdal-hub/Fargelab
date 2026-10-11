/*
 * widgets.js – tegner widgets fra ipywidgets (glidebrytere, knapper …) i utdataene
 *
 * Python (ipywidgets.py i widgets-py.js) sender en beskrivelse av hver widget:
 *   { id, kind, props }   kind er IntSlider, FloatSlider, Checkbox, Dropdown,
 *                         RadioButtons, Button, Text, Textarea, ColorPicker,
 *                         Label, HBox, VBox, Output eller Popup
 * Når du endrer en widget, kalles send({ id, kind: 'value' | 'click', value }),
 * og python.js sender endringen tilbake til Python. Klikk i bilder fra
 * cv2.imshow (med cv2.setMouseCallback) sendes som { id: vindusnavn, kind: 'mouse' }.
 *
 * Output-områder kan få utdata før de er vist (for eksempel fra interact),
 * så de lages første gang noen trenger dem.
 *
 * Bruk:
 *   Widgets.render(spec, send)   gir elementet som skal inn i utdataene
 *   Widgets.update(id, props)    Python har endret en egenskap
 *   Widgets.outputSink(id)       mottaker for utdata til et Output-område
 *   Widgets.clearOutput(id, wait)
 *   Widgets.snapshot(id)         utdataene i widgeten nå (til lagring i .ipynb)
 *   Widgets.mouse(figur, send)   bilde fra cv2.imshow med cv2.setMouseCallback (send = null: av)
 *   Widgets.detachAll()          Python er startet på nytt: widgetene virker ikke lenger
 */
(function (root) {
  'use strict';

  const views = new Map();     // id → Set med visninger (samme widget kan vises flere ganger)
  const outputs = new Map();   // Output-id → { el, items, clearPending }
  let uid = 0;

  const el = (tag, className, text) => {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
  };
  const describe = (box, text) => { box.textContent = text || ''; };

  // Antall desimaler fra readout_format (for eksempel '.2f') eller fra step
  function decimals(props) {
    const m = /\.(\d+)f/.exec(props.readout_format || '');
    if (m) return Number(m[1]);
    const step = Number(props.step) || 1;
    return step >= 1 ? 0 : Math.min(6, Math.ceil(-Math.log10(step) - 1e-9));
  }

  // Fargenavn som «black» og «red» blir #rrggbb, som <input type="color"> trenger
  function toHex(color) {
    const c = document.createElement('canvas').getContext('2d');
    c.fillStyle = '#000000';
    c.fillStyle = color || '#000000';
    return /^#[0-9a-f]{6}$/i.test(c.fillStyle) ? c.fillStyle : '#000000';
  }

  /* ---------- Hver type widget ---------- */
  function slider(spec, send) {
    const isFloat = spec.kind === 'FloatSlider';
    const root_ = el('div', 'wg wg-slider');
    const id = 'wg' + ++uid;
    const label = el('label', 'wg-desc');
    label.htmlFor = id;
    const input = el('input');
    input.type = 'range';
    input.id = id;
    const readout = el('output', 'wg-readout num');
    root_.append(label, input, readout);
    const props = {};
    const show = () => {
      readout.textContent = Number(input.value).toFixed(isFloat ? decimals(props) : 0);
      const p = ((input.value - input.min) / ((input.max - input.min) || 1) * 100).toFixed(2);
      input.style.setProperty('--track', `linear-gradient(90deg, var(--ink-2) 0 ${p}%, var(--line) ${p}% 100%)`);
    };
    const value = () => (isFloat ? Number(input.value) : Math.round(Number(input.value)));
    input.addEventListener('input', () => {
      show();
      if (props.continuous_update !== false) send({ id: spec.id, kind: 'value', value: value() });
    });
    input.addEventListener('change', () => {
      if (props.continuous_update === false) send({ id: spec.id, kind: 'value', value: value() });
    });
    return {
      el: root_,
      apply(p) {
        Object.assign(props, p);
        if ('min' in p) input.min = p.min;
        if ('max' in p) input.max = p.max;
        if ('step' in p) input.step = p.step;
        if ('value' in p || 'min' in p || 'max' in p || 'step' in p) input.value = props.value;
        describe(label, props.description);
        input.disabled = !!props.disabled;
        readout.hidden = props.readout === false;
        show();
      }
    };
  }

  function checkbox(spec, send) {
    const root_ = el('label', 'wg wg-check');
    const input = el('input');
    input.type = 'checkbox';
    const text = el('span', 'wg-check-text');
    root_.append(input, text);
    input.addEventListener('change', () => send({ id: spec.id, kind: 'value', value: input.checked }));
    return {
      el: root_,
      apply(p) {
        if ('value' in p) input.checked = !!p.value;
        if ('description' in p) text.textContent = p.description || '';
        if ('disabled' in p) input.disabled = !!p.disabled;
      }
    };
  }

  function dropdown(spec, send) {
    const root_ = el('div', 'wg wg-select');
    const id = 'wg' + ++uid;
    const label = el('label', 'wg-desc');
    label.htmlFor = id;
    const select = el('select');
    select.id = id;
    root_.append(label, select);
    let index = null;
    select.addEventListener('change', () => {
      index = Number(select.value);
      send({ id: spec.id, kind: 'value', value: index });
    });
    return {
      el: root_,
      apply(p) {
        if ('options' in p) {
          select.textContent = '';
          p.options.forEach((text, i) => select.add(new Option(text, String(i))));
        }
        if ('index' in p) index = p.index;
        if ('index' in p || 'options' in p) select.value = index == null ? '' : String(index);
        if ('description' in p) describe(label, p.description);
        if ('disabled' in p) select.disabled = !!p.disabled;
      }
    };
  }

  function radios(spec, send) {
    const root_ = el('fieldset', 'wg wg-radios');
    const legend = el('legend', 'wg-desc');
    const list = el('div', 'wg-radio-list');
    root_.append(legend, list);
    const name = 'wg-radio-' + ++uid;
    let index = null, disabled = false;
    return {
      el: root_,
      apply(p) {
        if ('index' in p) index = p.index;
        if ('disabled' in p) disabled = !!p.disabled;
        if ('options' in p) {
          list.textContent = '';
          p.options.forEach((text, i) => {
            const lab = el('label', 'wg-check');
            const input = el('input');
            input.type = 'radio';
            input.name = name;
            input.value = String(i);
            input.addEventListener('change', () => send({ id: spec.id, kind: 'value', value: i }));
            lab.append(input, el('span', 'wg-check-text', text));
            list.appendChild(lab);
          });
        }
        list.querySelectorAll('input').forEach(input => {
          input.checked = Number(input.value) === index;
          input.disabled = disabled;
        });
        if ('description' in p) describe(legend, p.description);
      }
    };
  }

  function button(spec, send) {
    const b = el('button', 'btn wg-button');
    b.type = 'button';
    b.addEventListener('click', () => send({ id: spec.id, kind: 'click' }));
    return {
      el: b,
      apply(p) {
        if ('description' in p) b.textContent = p.description || 'Knapp';
        if ('disabled' in p) b.disabled = !!p.disabled;
        if ('tooltip' in p) b.title = p.tooltip || '';
        if ('button_style' in p) {
          b.classList.toggle('btn-primary', ['primary', 'success', 'info', 'warning'].includes(p.button_style));
          b.classList.toggle('btn-danger', p.button_style === 'danger');
        }
      }
    };
  }

  function text(spec, send) {
    const root_ = el('div', 'wg wg-text');
    const id = 'wg' + ++uid;
    const label = el('label', 'wg-desc');
    label.htmlFor = id;
    const input = el(spec.kind === 'Textarea' ? 'textarea' : 'input');
    input.id = id;
    if (input.tagName === 'INPUT') input.type = 'text';
    input.spellcheck = false;
    root_.append(label, input);
    let continuous = true;
    input.addEventListener('input', () => { if (continuous) send({ id: spec.id, kind: 'value', value: input.value }); });
    input.addEventListener('change', () => { if (!continuous) send({ id: spec.id, kind: 'value', value: input.value }); });
    return {
      el: root_,
      apply(p) {
        if ('value' in p && input.value !== p.value) input.value = p.value;
        if ('placeholder' in p) input.placeholder = p.placeholder || '';
        if ('continuous_update' in p) continuous = p.continuous_update !== false;
        if ('description' in p) describe(label, p.description);
        if ('disabled' in p) input.disabled = !!p.disabled;
      }
    };
  }

  function color(spec, send) {
    const root_ = el('div', 'wg wg-color');
    const id = 'wg' + ++uid;
    const label = el('label', 'wg-desc');
    label.htmlFor = id;
    const input = el('input');
    input.type = 'color';
    input.id = id;
    const code = el('code', 'wg-readout num');
    root_.append(label, input, code);
    input.addEventListener('input', () => { code.textContent = input.value; send({ id: spec.id, kind: 'value', value: input.value }); });
    return {
      el: root_,
      apply(p) {
        if ('value' in p) { input.value = toHex(p.value); code.textContent = p.value; }
        if ('description' in p) describe(label, p.description);
        if ('disabled' in p) input.disabled = !!p.disabled;
      }
    };
  }

  function label(spec) {
    const span = el('span', 'wg wg-label');
    return { el: span, apply(p) { if ('value' in p) span.textContent = p.value; } };
  }

  function box(spec, send) {
    const div = el('div', `wg-box ${spec.kind === 'HBox' ? 'wg-hbox' : 'wg-vbox'}`);
    const view = {
      el: div,
      children: [],
      apply(p) {
        if (!('children' in p)) return;
        view.children = p.children.map(c => c.id);
        div.replaceChildren(...p.children.map(c => build(c, send).el));
      }
    };
    return view;
  }

  // Popup (bare i Fargelab): et vindu over siden med widgetene i children. Det legges
  // ved siden av der du sist klikket, så det du klikket på, ikke blir skjult.
  // Lukker du det med ×, Esc eller et klikk utenfor, får Python open = False.
  let lastPointer = null;
  if (typeof document !== 'undefined') {
    document.addEventListener('pointerdown', e => { lastPointer = { x: e.clientX, y: e.clientY, t: Date.now() }; }, true);
  }

  // Til høyre for klikket, ellers til venstre, under eller over. Får det ikke plass
  // noe sted uten å dekke klikket, legges det så nær som mulig.
  function placePopup(dlg) {
    dlg.style.inset = dlg.style.margin = '';
    const p = lastPointer;
    if (!p || Date.now() - p.t > 5000) return;   // ingen klikk nylig: midt på skjermen
    const w = dlg.offsetWidth, h = dlg.offsetHeight, gap = 64, pad = 8;
    const W = innerWidth, H = innerHeight;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
    const side = clamp(p.y - 40, pad, H - h - pad), mid = clamp(p.x - w / 2, pad, W - w - pad);
    const spots = [
      [p.x + gap, side], [p.x - gap - w, side],   // til høyre, til venstre
      [mid, p.y + gap], [mid, p.y - gap - h]      // under, over
    ];
    const fits = ([x, y]) => x >= pad && x + w <= W - pad && y >= pad && y + h <= H - pad;
    const [x, y] = spots.find(fits) || [clamp(p.x + gap, pad, W - w - pad), side];
    dlg.style.margin = '0';
    dlg.style.inset = `${y}px auto auto ${x}px`;
  }

  function popup(spec, send) {
    const holder = el('span', 'wg-popup-holder');   // plassen i utdataene (vises ikke)
    const dlg = el('dialog', 'wg-popup');
    dlg.tabIndex = -1;                              // fokus på vinduet, ikke på ×
    const inner = el('div', 'wg-popup-inner');      // fyller vinduet, så et klikk på dlg er utenfor
    const head = el('div', 'wg-popup-head');
    const title = el('strong', 'wg-popup-title');
    const x = el('button', 'py-close', '×');
    x.type = 'button';
    x.title = 'Lukk (Esc)';
    x.setAttribute('aria-label', 'Lukk');
    const body = el('div', 'wg-box wg-vbox');
    head.append(title, x);
    inner.append(head, body);
    dlg.appendChild(inner);
    holder.appendChild(dlg);

    // want: om Python vil ha vinduet åpent. Lukker du det (×, Esc, klikk utenfor),
    // får Python open = False med en gang. close-hendelsen kommer ikke før siden
    // tegnes på nytt, så den brukes bare som reserve.
    let want = false, downOutside = false;
    const tellPython = () => {
      if (!want) return;   // Python har lukket det selv, eller vet det allerede
      want = false;
      send({ id: spec.id, kind: 'value', value: false });
    };
    const closeByUser = () => { dlg.close(); tellPython(); };
    x.addEventListener('click', closeByUser);
    dlg.addEventListener('pointerdown', e => { downOutside = e.target === dlg; });
    dlg.addEventListener('click', e => { if (e.target === dlg && downOutside) closeByUser(); });
    dlg.addEventListener('cancel', tellPython);   // Esc: vinduet lukker seg selv etterpå
    dlg.addEventListener('close', () => { if (!dlg.open) tellPython(); });

    const closeQuietly = () => { want = false; if (dlg.open) dlg.close(); };
    const sync = () => {
      if (want && !dlg.open && holder.isConnected) {
        dlg.showModal();
        dlg.focus();
        placePopup(dlg);
      }
      else if (!want && dlg.open) dlg.close();
    };
    const view = {
      el: holder,
      children: [],
      closeQuietly,
      apply(p) {
        if ('title' in p) title.textContent = p.title || '';
        if ('children' in p) {
          view.children = p.children.map(c => c.id);
          body.replaceChildren(...p.children.map(c => build(c, send).el));
        }
        if ('open' in p) {
          want = !!p.open;
          sync();
          if (want && !holder.isConnected) setTimeout(sync, 0);   // ikke lagt i utdataene ennå
        }
      }
    };
    return view;
  }

  function outputArea(id) {
    let o = outputs.get(id);
    if (!o) {
      o = { el: el('div', 'wg-output'), items: [], clearPending: false };
      outputs.set(id, o);
    }
    return o;
  }

  function output(spec) {
    return { el: outputArea(spec.id).el, apply() {} };
  }

  const KINDS = {
    IntSlider: slider, FloatSlider: slider, Checkbox: checkbox, Dropdown: dropdown,
    RadioButtons: radios, Button: button, Text: text, Textarea: text, ColorPicker: color,
    Label: label, HBox: box, VBox: box, Output: output, Popup: popup
  };

  function build(spec, send) {
    const make = KINDS[spec.kind];
    const view = make ? make(spec, send) : { el: el('span', 'wg wg-label', `(${spec.kind} finnes ikke i Fargelab)`), apply() {} };
    view.kind = spec.kind;
    view.el.dataset.widget = spec.id;
    if (!views.has(spec.id)) views.set(spec.id, new Set());
    views.get(spec.id).add(view);
    view.apply(spec.props || {});
    return view;
  }

  // Visninger som ikke lenger er på siden (cellen er kjørt på nytt), glemmes
  function prune() {
    views.forEach((set, id) => {
      set.forEach(v => { if (!v.el.isConnected) set.delete(v); });
      if (!set.size) views.delete(id);
    });
    mice.forEach(fig => { if (!fig.isConnected) mice.delete(fig); });
  }

  /* ---------- Bilder fra cv2.imshow med cv2.setMouseCallback ---------- */
  // Hendelsene har samme tall som i OpenCV: cv2.EVENT_MOUSEMOVE (0),
  // EVENT_LBUTTONDOWN (1), EVENT_RBUTTONDOWN (2), EVENT_MBUTTONDOWN (3),
  // EVENT_xBUTTONUP (4–6) og EVENT_LBUTTONDBLCLK (7). flags har knappene som
  // holdes nede (EVENT_FLAG_LBUTTON 1, RBUTTON 2, MBUTTON 4), og Ctrl (8),
  // Shift (16) og Alt (32). x og y er piksler i bildet, selv om det vises mindre.
  const mice = new Set();   // figurer som sender musehendelser til Python nå
  const DOWN = [1, 3, 2];   // e.button 0, 1, 2 (venstre, midtre, høyre) → EVENT_xBUTTONDOWN

  function mouse(fig, send) {
    let m = fig._mouse;
    if (!m) {
      if (!send) return;
      m = fig._mouse = { send: null };
      const img = fig.querySelector('img');
      img.draggable = false;
      const emit = (e, event) => {
        const r = img.getBoundingClientRect();
        if (!m.send || !r.width || !img.naturalWidth) return;
        const x = Math.min(img.naturalWidth - 1, Math.max(0, Math.floor((e.clientX - r.left) * img.naturalWidth / r.width)));
        const y = Math.min(img.naturalHeight - 1, Math.max(0, Math.floor((e.clientY - r.top) * img.naturalHeight / r.height)));
        const flags = (e.buttons & 7) | (e.ctrlKey || e.metaKey ? 8 : 0) | (e.shiftKey ? 16 : 0) | (e.altKey ? 32 : 0);
        m.send({ id: fig.dataset.window, kind: 'mouse', value: [event, x, y, flags] });
      };
      img.addEventListener('pointerdown', e => {
        if (!m.send || e.button > 2) return;
        e.preventDefault();
        img.setPointerCapture(e.pointerId);   // slipper du utenfor bildet, kommer EVENT_xBUTTONUP likevel
        emit(e, DOWN[e.button]);
      });
      img.addEventListener('pointerup', e => { if (e.button <= 2) emit(e, DOWN[e.button] + 3); });
      img.addEventListener('pointermove', e => emit(e, 0));
      img.addEventListener('dblclick', e => emit(e, 7));
      img.addEventListener('contextmenu', e => { if (m.send) e.preventDefault(); });   // høyreklikk går til Python
    }
    m.send = send;
    fig.classList.toggle('py-mouse', !!send);
    if (send) { fig.title = ''; mice.add(fig); } else mice.delete(fig);
  }

  /* ---------- Det python.js og notatbok.js bruker ---------- */
  function render(spec, send) {
    prune();
    return build(spec, send).el;
  }

  function update(id, props) {
    const set = views.get(id);
    if (set) set.forEach(v => v.apply(props));
  }

  function clearOutput(id, wait) {
    const o = outputArea(id);
    if (wait) { o.clearPending = true; return; }
    o.el.textContent = '';
    o.items = [];
    o.clearPending = false;
  }

  // Utdata til et Output-område. cv2.imshow med samme navn bytter ut bildet.
  function outputSink(id) {
    const o = outputArea(id);
    return {
      add(item) {
        if (o.clearPending) clearOutput(id, false);
        const i = item.type === 'image' && item.window ? o.items.findIndex(x => x.type === 'image' && x.window && x.title === item.title) : -1;
        if (i >= 0) o.items[i] = item; else o.items.push(item);
        root.Utdata.append(o.el, item);
      },
      clear(wait) { clearOutput(id, wait); }
    };
  }

  // Tekst og bilder som vises i widgeten nå, i rekkefølge (til lagring i .ipynb)
  function snapshot(id) {
    const set = views.get(id);
    const view = set && set.values().next().value;
    if (!view || view.kind === 'Popup') return [];   // et pop-up-vindu lagres ikke
    if (view.kind === 'Output') {
      const o = outputs.get(id);
      return o ? o.items.flatMap(it => (it.type === 'widget' ? snapshot(it.view.id) : [it])) : [];
    }
    return (view.children || []).flatMap(snapshot);
  }

  function close(id) {
    const set = views.get(id);
    if (set) set.forEach(v => v.el.remove());
    views.delete(id);
  }

  function detachAll() {
    views.forEach(set => set.forEach(v => {
      if (v.closeQuietly) v.closeQuietly();   // pop-up-vinduer lukkes
      v.el.classList.add('wg-dead');
      v.el.title = 'Python er startet på nytt. Kjør cellen igjen for å bruke denne.';
      v.el.querySelectorAll('input, select, button, textarea').forEach(c => { c.disabled = true; });
      if (v.el.matches('button')) v.el.disabled = true;
    }));
    views.clear();
    mice.forEach(fig => {
      mouse(fig, null);
      fig.title = 'Python er startet på nytt. Kjør cellen igjen for å klikke i bildet.';
    });
  }

  root.Widgets = { render, update, outputSink, clearOutput, snapshot, close, detachAll, mouse };
})(typeof self !== 'undefined' ? self : this);

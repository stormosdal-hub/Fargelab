/*
 * notatbok.js – notatbøker i Python-fanen, som i Google Colab og Jupyter
 *
 * En notatbok er en liste med celler:
 *   - Kodeceller kjøres én og én i samme Python-navnerom, så variabler fra én
 *     celle kan brukes i den neste. Utdata vises rett under cellen: tekst,
 *     bilder (cv2.imshow og plt.show), verdien av siste uttrykk og feil.
 *   - Tekstceller skrives i Markdown (overskrifter, fet og kursiv skrift,
 *     lister, lenker og kode). Dobbeltklikk på teksten for å redigere den.
 *
 * Notatboken lagres som .ipynb (nbformat 4.5), samme format som Colab,
 * Jupyter og VS Code bruker, med utdata og bilder. Utdata av typer appen ikke
 * kan vise (for eksempel HTML fra Colab), tas vare på og lagres uendret.
 *
 * Taster i en celle:
 *   Shift+Enter   kjør og gå til neste celle (lager en ny hvis det er den siste)
 *   Ctrl+Enter    kjør og bli stående
 *   Alt+Enter     kjør og lag en ny celle under
 *   Ctrl+S        lagre
 *   Pil opp/ned   gå til forrige/neste celle fra første/siste linje
 *   Esc           gå ut av editoren
 *
 * Bruk:
 *   const nb = Notatbok.create({
 *     host,                      // elementet notatboken tegnes i
 *     kernel,                    // { run(kode, filnavn, sink), reset(), stop() }, se python.js
 *     codeMirror,                // () => Promise<CodeMirror eller null>
 *     ask,                       // dialoger (se python.js)
 *     onChange, onSave           // kalles når noe endres, og ved Ctrl+S
 *   });
 *   await nb.load(ipynbTekst);  nb.toJSON();  nb.runAll();  nb.dirty();  nb.markSaved();
 */
(function (root) {
  'use strict';

  const PLAY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>';
  const STOP_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor"/></svg>';

  /* ---------- Markdown ---------- */
  // En liten og trygg Markdown-tolk: all tekst escapes først, så legges et fåtall
  // tagger til. Lenker må starte med http:// eller https://.
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function inline(s) {
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
    s = esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, '$1<em>$2</em>')
      .replace(/(^|[^\w])_(?!\s)(.+?)_(?!\w)/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => '<code>' + esc(codes[i]) + '</code>');
  }
  function markdown(src) {
    const lines = src.replace(/\r\n?/g, '\n').split('\n');
    let html = '', para = [], list = null;
    const flush = () => { if (para.length) { html += '<p>' + inline(para.join(' ')) + '</p>'; para = []; } };
    const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*```/.test(line)) {
        flush(); closeList();
        const code = [];
        for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
        html += '<pre><code>' + esc(code.join('\n')) + '</code></pre>';
        continue;
      }
      const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      if (h) { flush(); closeList(); html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; continue; }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); closeList(); html += '<hr>'; continue; }
      const ul = /^\s*[-*+]\s+(.*)$/.exec(line), ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
      if (ul || ol) {
        flush();
        const tag = ul ? 'ul' : 'ol';
        if (list !== tag) { closeList(); html += `<${tag}>`; list = tag; }
        html += `<li>${inline((ul || ol)[1])}</li>`;
        continue;
      }
      const quote = /^\s*>\s?(.*)$/.exec(line);
      if (quote) { flush(); closeList(); html += `<blockquote>${inline(quote[1])}</blockquote>`; continue; }
      if (!line.trim()) { flush(); closeList(); continue; }
      closeList();
      para.push(line.trim());
    }
    flush(); closeList();
    return html;
  }

  /* ---------- .ipynb ---------- */
  const splitLines = text => (text ? text.split(/(?<=\n)/) : []);
  const joinText = v => (Array.isArray(v) ? v.join('') : v || '');
  const stripAnsi = s => s.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
  const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  function outputsFromJSON(outputs) {
    const items = [];
    for (const o of outputs || []) {
      if (o.output_type === 'stream') {
        items.push({ type: 'stream', name: o.name === 'stderr' ? 'stderr' : 'stdout', text: joinText(o.text).replace(/\n$/, '') });
      } else if (o.output_type === 'error') {
        const tb = (o.traceback || []).map(stripAnsi).join('\n');
        items.push({ type: 'error', text: tb || `${o.ename}: ${o.evalue}` });
      } else if (o.output_type === 'execute_result' || o.output_type === 'display_data') {
        const d = o.data || {};
        if (d['image/png']) {
          const title = (o.metadata && o.metadata.fargelab && o.metadata.fargelab.tittel) || 'Bilde';
          items.push({ type: 'image', b64: joinText(d['image/png']).replace(/\s/g, ''), title });
        } else if (d['text/plain'] && Object.keys(d).length === 1) {
          items.push({ type: 'result', text: joinText(d['text/plain']) });
        } else {
          // HTML, LaTeX og lignende fra Colab/Jupyter: vises som tekst og lagres uendret
          items.push({ type: 'raw', json: o, text: joinText(d['text/plain']) || `(${Object.keys(d).join(', ')})` });
        }
      }
    }
    return items;
  }

  function outputsToJSON(cell) {
    const out = [];
    // Widgets kan ikke lagres levende. Det de viser nå (bilder og tekst), lagres i stedet.
    const items = cell.outputs.flatMap(o => (o.type === 'widget' ? (root.Widgets ? root.Widgets.snapshot(o.view.id) : []) : [o]));
    for (const o of items) {
      if (o.type === 'stream') {
        const last = out[out.length - 1];
        if (last && last.output_type === 'stream' && last.name === o.name) { last.text += '\n' + o.text; continue; }
        out.push({ output_type: 'stream', name: o.name, text: o.text });
      } else if (o.type === 'result') {
        out.push({ output_type: 'execute_result', execution_count: cell.count, data: { 'text/plain': splitLines(o.text) }, metadata: {} });
      } else if (o.type === 'image') {
        out.push({ output_type: 'display_data', data: { 'image/png': o.b64, 'text/plain': [`<${o.title}>`] }, metadata: { fargelab: { tittel: o.title } } });
      } else if (o.type === 'error') {
        const ls = o.text.split('\n');
        const m = /^([A-Za-z_][\w.]*)(?::\s?(.*))?$/.exec(ls[ls.length - 1] || '');
        out.push({ output_type: 'error', ename: m ? m[1] : 'Error', evalue: m ? m[2] || '' : '', traceback: ls });
      } else if (o.type === 'raw') {
        out.push(o.json);
      }
    }
    // Strømtekst lagres som linjer med linjeskift, slik Jupyter gjør
    out.forEach(o => { if (o.output_type === 'stream') o.text = splitLines(o.text + '\n'); });
    return out;
  }

  // En ny notatbok: en tekstcelle og en kodecelle
  function template() {
    return JSON.stringify({
      cells: [
        { cell_type: 'markdown', id: newId(), metadata: {}, source: splitLines('# Ny notatbok\n\nSkriv kode i cellene under, og kjør dem med **Shift+Enter**.') },
        { cell_type: 'code', id: newId(), metadata: {}, execution_count: null, outputs: [],
          source: splitLines('import cv2\nimport numpy as np\nimport matplotlib.pyplot as plt\n\nimg = cv2.imread("eksempel.png")\nimg.shape') }
      ],
      metadata: { kernelspec: { name: 'python3', display_name: 'Python 3 (Pyodide)', language: 'python' }, language_info: { name: 'python' } },
      nbformat: 4,
      nbformat_minor: 5
    }, null, 1) + '\n';
  }

  /* ---------- Notatboken ---------- */
  function create(cfg) {
    const host = cfg.host;
    let cells = [];
    let meta = {};
    let version = 0, savedVersion = 0;
    let execCount = 0;
    let CM = null;
    let queue = Promise.resolve(), queueGen = 0;

    const changed = () => { version++; if (cfg.onChange) cfg.onChange(); };

    host.textContent = '';
    const list = document.createElement('div');
    list.className = 'nb-cells';
    const endBar = insertBar(null, true);
    host.append(insertBar(null, false, true), list, endBar);

    // «+ Kode  + Tekst». after = cellen den nye skal komme etter (null = først, eller sist for endBar)
    function insertBar(after, isEnd, isTop) {
      const bar = document.createElement('div');
      bar.className = 'nb-insert' + (isEnd ? ' nb-insert-end' : '') + (isTop ? ' nb-insert-top' : '');
      [['code', '+ Kode'], ['markdown', '+ Tekst']].forEach(([type, label]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn';
        b.textContent = label;
        b.addEventListener('click', () => {
          const pos = isEnd ? cells[cells.length - 1] || null : isTop ? null : bar.cell;
          addCell(type, '', { after: pos, top: isTop && !isEnd, focus: true });
        });
        bar.appendChild(b);
      });
      bar.cell = after;
      return bar;
    }

    /* ---------- Editorer ---------- */
    function keys(cell) {
      const pass = () => (CM ? CM.Pass : undefined);
      return {
        'Shift-Enter': () => runAndAdvance(cell),
        'Ctrl-Enter': () => run(cell),
        'Cmd-Enter': () => run(cell),
        'Alt-Enter': () => { run(cell); addCell('code', '', { after: cell, focus: true }); },
        'Ctrl-S': () => cfg.onSave && cfg.onSave(),
        'Cmd-S': () => cfg.onSave && cfg.onSave(),
        'Ctrl-/': 'toggleComment',
        'Cmd-/': 'toggleComment',
        Tab: c => (c.somethingSelected() ? c.indentSelection('add') : c.execCommand('insertSoftTab')),
        'Shift-Tab': c => c.indentSelection('subtract'),
        Up: c => {
          if (c.getCursor().line > 0 || c.somethingSelected()) return pass();
          const prev = cells[cells.indexOf(cell) - 1];
          if (!prev) return pass();
          focusCell(prev, 'end');
          return undefined;
        },
        Down: c => {
          if (c.getCursor().line < c.lastLine() || c.somethingSelected()) return pass();
          const next = cells[cells.indexOf(cell) + 1];
          if (!next) return pass();
          focusCell(next, 'start');
          return undefined;
        },
        Esc: () => cell.el.focus()
      };
    }

    function makeEditor(cell, text) {
      const box = cell.el.querySelector('.nb-editor');
      if (CM) {
        const ed = CM(box, {
          value: text,
          mode: cell.type === 'code' ? 'python' : null,
          theme: 'fargelab',
          lineNumbers: cell.type === 'code',
          lineWrapping: cell.type === 'markdown',
          indentUnit: 4,
          tabSize: 4,
          indentWithTabs: false,
          matchBrackets: cell.type === 'code',
          autoCloseBrackets: cell.type === 'code',
          viewportMargin: Infinity,
          extraKeys: keys(cell)
        });
        ed.getInputField().setAttribute('aria-label', cell.type === 'code' ? 'Python-kode i cellen' : 'Markdown-tekst i cellen');
        ed.on('change', changed);
        ed.on('focus', () => select(cell));
        return {
          get: () => ed.getValue(),
          focus(where) {
            ed.focus();
            if (where === 'end') ed.setCursor(ed.lastLine(), ed.getLine(ed.lastLine()).length);
            else if (where === 'start') ed.setCursor(0, 0);
          },
          refresh: () => ed.refresh()
        };
      }
      // Uten CodeMirror: et tekstfelt som vokser med innholdet
      const ta = document.createElement('textarea');
      ta.className = 'nb-textarea';
      ta.spellcheck = false;
      ta.value = text;
      ta.setAttribute('aria-label', cell.type === 'code' ? 'Python-kode i cellen' : 'Markdown-tekst i cellen');
      const grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; };
      ta.addEventListener('input', () => { grow(); changed(); });
      ta.addEventListener('focus', () => select(cell));
      ta.addEventListener('keydown', e => {
        const mod = e.ctrlKey || e.metaKey;
        if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); runAndAdvance(cell); }
        else if (e.key === 'Enter' && mod) { e.preventDefault(); run(cell); }
        else if (e.key === 'Enter' && e.altKey) { e.preventDefault(); run(cell); addCell('code', '', { after: cell, focus: true }); }
        else if (mod && (e.key === 's' || e.key === 'S')) { e.preventDefault(); if (cfg.onSave) cfg.onSave(); }
        else if (e.key === 'Tab' && !e.shiftKey && !mod) {
          e.preventDefault();
          if (!document.execCommand('insertText', false, '    ')) ta.setRangeText('    ', ta.selectionStart, ta.selectionEnd, 'end');
        } else if (e.key === 'Escape') cell.el.focus();
      });
      box.appendChild(ta);
      setTimeout(grow, 0);
      return {
        get: () => ta.value,
        focus(where) {
          ta.focus();
          const p = where === 'start' ? 0 : ta.value.length;
          if (where) ta.setSelectionRange(p, p);
        },
        refresh: grow
      };
    }

    /* ---------- Celler ---------- */
    function makeCell(type, text, { id, metadata, count = null, outputs = [] } = {}) {
      const cell = { id: id || newId(), type, metadata: metadata || {}, count: type === 'code' ? count : null, outputs: [], state: 'idle', editing: false };
      const item = document.createElement('div');
      item.className = 'nb-item';
      const el = document.createElement('div');
      el.className = `nb-cell nb-${type}`;
      el.tabIndex = -1;
      el.setAttribute('aria-label', type === 'code' ? 'Kodecelle' : 'Tekstcelle');
      el.innerHTML =
        '<div class="nb-gutter"></div>' +
        '<div class="nb-body"><div class="nb-editor"></div></div>' +
        '<div class="nb-tools" role="toolbar" aria-label="Cellen">' +
        '<button type="button" class="nb-tool" data-act="up" title="Flytt opp" aria-label="Flytt cellen opp">↑</button>' +
        '<button type="button" class="nb-tool" data-act="down" title="Flytt ned" aria-label="Flytt cellen ned">↓</button>' +
        '<button type="button" class="nb-tool nb-tool-del" data-act="del" title="Slett cellen" aria-label="Slett cellen">Slett</button>' +
        '</div>';
      const gutter = el.querySelector('.nb-gutter'), body = el.querySelector('.nb-body');
      cell.el = el;
      cell.item = item;

      if (type === 'code') {
        const runBtn = document.createElement('button');
        runBtn.type = 'button';
        runBtn.className = 'nb-run';
        runBtn.innerHTML = PLAY_SVG;
        runBtn.addEventListener('click', () => (cell.state === 'running' ? cfg.kernel.stop() : run(cell)));
        const countEl = document.createElement('span');
        countEl.className = 'nb-count num';
        gutter.append(runBtn, countEl);
        cell.runBtn = runBtn;
        cell.countEl = countEl;
        const out = document.createElement('div');
        out.className = 'nb-out';
        body.appendChild(out);
        cell.outEl = out;
      } else {
        const view = document.createElement('div');
        view.className = 'nb-md';
        view.addEventListener('dblclick', () => edit(cell));
        body.insertBefore(view, body.firstChild);
        cell.view = view;
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'nb-tool';
        editBtn.dataset.act = 'edit';
        editBtn.textContent = 'Rediger';
        editBtn.title = 'Rediger teksten (eller dobbeltklikk)';
        el.querySelector('.nb-tools').prepend(editBtn);
      }

      el.querySelector('.nb-tools').addEventListener('click', e => {
        const act = e.target.closest('[data-act]');
        if (!act) return;
        if (act.dataset.act === 'up') move(cell, -1);
        else if (act.dataset.act === 'down') move(cell, 1);
        else if (act.dataset.act === 'del') removeCell(cell);
        else if (act.dataset.act === 'edit') edit(cell);
      });
      el.addEventListener('mousedown', () => select(cell));
      el.addEventListener('keydown', e => {
        // Når selve cellen har fokus (etter Esc): Enter går inn i editoren igjen
        if (e.target !== el) return;
        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) { e.preventDefault(); type === 'markdown' ? edit(cell) : cell.editor.focus(); }
        else if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); runAndAdvance(cell); }
        else if (e.key === 'ArrowUp' && cells.indexOf(cell) > 0) { e.preventDefault(); cells[cells.indexOf(cell) - 1].el.focus(); }
        else if (e.key === 'ArrowDown' && cells.indexOf(cell) < cells.length - 1) { e.preventDefault(); cells[cells.indexOf(cell) + 1].el.focus(); }
      });
      el.addEventListener('focus', () => select(cell));

      const bar = insertBar(cell);
      item.append(el, bar);
      cell.editor = makeEditor(cell, text);
      outputs.forEach(o => addOutput(cell, o));
      if (type === 'code') renderState(cell);
      else if (text.trim()) renderMarkdown(cell);
      else edit(cell, false);
      return cell;
    }

    function renderState(cell) {
      cell.countEl.textContent = cell.state === 'idle' ? `[${cell.count == null ? ' ' : cell.count}]` : '[*]';
      cell.el.dataset.state = cell.state;
      cell.runBtn.innerHTML = cell.state === 'running' ? STOP_SVG : PLAY_SVG;
      const label = cell.state === 'running' ? 'Stopp (starter Python på nytt)' : cell.state === 'waiting' ? 'Venter på tur' : 'Kjør cellen (Ctrl+Enter)';
      cell.runBtn.title = label;
      cell.runBtn.setAttribute('aria-label', label);
    }

    function renderMarkdown(cell) {
      const text = cell.editor.get();
      cell.view.innerHTML = text.trim() ? markdown(text) : '<p class="nb-md-empty">Tom tekstcelle. Dobbeltklikk for å skrive.</p>';
      cell.editing = false;
      cell.el.classList.remove('editing');
    }
    function edit(cell, focus = true) {
      cell.editing = true;
      cell.el.classList.add('editing');
      cell.editor.refresh();
      if (focus) cell.editor.focus('end');
    }

    function select(cell) {
      cells.forEach(c => c.el.classList.toggle('selected', c === cell));
    }
    function focusCell(cell, where) {
      select(cell);
      if (cell.type === 'markdown' && !cell.editing) { cell.el.focus(); return; }
      cell.editor.focus(where);
      cell.el.scrollIntoView({ block: 'nearest' });
    }

    function addCell(type, text, { after = null, top = false, focus = false } = {}) {
      const cell = makeCell(type, text);
      const index = top ? 0 : after ? cells.indexOf(after) + 1 : cells.length;
      cells.splice(index, 0, cell);
      list.insertBefore(cell.item, list.children[index] || null);
      cell.editor.refresh();
      if (focus) {
        if (type === 'markdown') edit(cell);
        else cell.editor.focus();
        cell.el.scrollIntoView({ block: 'nearest' });
      }
      changed();
      return cell;
    }

    async function removeCell(cell) {
      if (cell.editor.get().trim() && cfg.ask) {
        const r = await cfg.ask({
          title: 'Slette cellen?', text: 'Innholdet og utdataene i cellen blir borte.',
          buttons: [{ label: 'Slett', value: 'del', danger: true }, { label: 'Avbryt', value: 'cancel', primary: true }]
        });
        if (r.value !== 'del') return;
      }
      const i = cells.indexOf(cell);
      cells.splice(i, 1);
      cell.item.remove();
      if (!cells.length) addCell('code', '', { focus: true });
      else focusCell(cells[Math.min(i, cells.length - 1)], 'start');
      changed();
    }

    function move(cell, dir) {
      const i = cells.indexOf(cell), j = i + dir;
      if (j < 0 || j >= cells.length) return;
      [cells[i], cells[j]] = [cells[j], cells[i]];
      if (dir < 0) list.insertBefore(cell.item, cells[i].item);
      else list.insertBefore(cells[i].item, cell.item);
      cell.editor.refresh();
      cell.el.scrollIntoView({ block: 'nearest' });
      changed();
    }

    /* ---------- Utdata ---------- */
    function addOutput(cell, item) {
      if (!cell.outEl) return;
      if (cell.clearPending) clearCellOutputs(cell);
      // cv2.imshow med samme vindusnavn bytter ut bildet (Utdata gjør det samme på siden)
      const i = item.type === 'image' && item.window
        ? cell.outputs.findIndex(o => o.type === 'image' && o.window && o.title === item.title) : -1;
      if (i >= 0) cell.outputs[i] = item; else cell.outputs.push(item);
      if (item.type === 'raw') root.Utdata.append(cell.outEl, { type: 'result', text: item.text });
      else root.Utdata.append(cell.outEl, item);
    }
    function clearCellOutputs(cell) {
      cell.outputs = [];
      cell.clearPending = false;
      if (cell.outEl) cell.outEl.textContent = '';
    }
    // Mottaker for utdata fra en celle. clear(true) venter med å tømme til noe nytt kommer.
    const cellSink = cell => ({
      add: item => addOutput(cell, item),
      clear(wait) { if (wait) cell.clearPending = true; else clearCellOutputs(cell); }
    });

    /* ---------- Kjøre ---------- */
    // Cellene kjøres én om gangen i rekkefølgen du trykker. «Kjør alle» stopper ved første feil.
    function run(cell) {
      if (cell.type === 'markdown') { renderMarkdown(cell); return Promise.resolve(true); }
      if (cell.state !== 'idle') return Promise.resolve(false);
      const gen = queueGen;
      cell.state = 'waiting';
      renderState(cell);
      const p = queue.then(() => (gen === queueGen ? execute(cell) : idle(cell)));
      queue = p.catch(() => false);
      return p;
    }
    function idle(cell) {
      cell.state = 'idle';
      renderState(cell);
      return false;
    }
    async function execute(cell) {
      cell.state = 'running';
      renderState(cell);
      clearCellOutputs(cell);
      const n = ++execCount;
      const res = await cfg.kernel.run(cell.editor.get(), `celle ${n}`, cellSink(cell));
      if (res.stopped) {
        idle(cell);
        return false;
      }
      cell.count = n;
      if (res.error) addOutput(cell, { type: 'error', text: res.error });
      idle(cell);
      changed();
      return res.ok;
    }

    function runAndAdvance(cell) {
      run(cell);
      const next = cells[cells.indexOf(cell) + 1];
      if (next) focusCell(next, 'start');
      else addCell('code', '', { after: cell, focus: true });
    }

    async function runAll() {
      cells.filter(c => c.type === 'markdown').forEach(renderMarkdown);
      const gen = queueGen;
      for (const cell of cells.filter(c => c.type === 'code')) {
        if (gen !== queueGen) return false;
        const ok = await run(cell);
        if (!ok) { cancel(); return false; }
      }
      return true;
    }

    // Avbryter køen. Cellen som kjører nå, stoppes av kernel.stop() i python.js.
    function cancel() {
      queueGen++;
      cells.forEach(c => { if (c.state === 'waiting') idle(c); });
    }
    // Python er startet på nytt (Stopp eller Start på nytt): variablene er borte
    function kernelRestarted() {
      cancel();
      execCount = 0;
      cells.forEach(c => { if (c.type === 'code' && c.state !== 'idle') idle(c); });
    }

    function clearOutputs() {
      cells.forEach(c => { if (c.type === 'code') { clearCellOutputs(c); c.count = null; renderState(c); } });
      changed();
    }

    /* ---------- Laste og lagre ---------- */
    async function load(text) {
      CM = await cfg.codeMirror();
      let data;
      try {
        data = JSON.parse(text);
      } catch (_) {
        throw new Error('Filen er ikke en gyldig notatbok (ugyldig JSON).');
      }
      if (!data || !Array.isArray(data.cells)) throw new Error('Filen er ikke en notatbok (mangler cells).');
      cancel();
      cells = [];
      list.textContent = '';
      meta = data.metadata || {};
      execCount = 0;
      data.cells.forEach(c => {
        const type = c.cell_type === 'code' ? 'code' : 'markdown';
        const cell = makeCell(type, joinText(c.source), {
          id: typeof c.id === 'string' ? c.id : undefined,
          metadata: c.metadata,
          count: Number.isInteger(c.execution_count) ? c.execution_count : null,
          outputs: type === 'code' ? outputsFromJSON(c.outputs) : []
        });
        cells.push(cell);
        list.appendChild(cell.item);
      });
      if (!cells.length) {
        const cell = makeCell('code', '');
        cells.push(cell);
        list.appendChild(cell.item);
      }
      refresh();
      version = savedVersion = 0;
    }

    function toJSON() {
      const nb = {
        cells: cells.map(c => {
          const base = { cell_type: c.type, id: c.id, metadata: c.metadata, source: splitLines(c.editor.get()) };
          if (c.type !== 'code') return base;
          return { ...base, execution_count: c.count == null ? null : c.count, outputs: outputsToJSON(c) };
        }),
        metadata: {
          ...meta,
          kernelspec: meta.kernelspec || { name: 'python3', display_name: 'Python 3 (Pyodide)', language: 'python' },
          language_info: meta.language_info || { name: 'python' }
        },
        nbformat: 4,
        nbformat_minor: 5
      };
      return JSON.stringify(nb, null, 1) + '\n';
    }

    function refresh() {
      cells.forEach(c => c.editor.refresh());
    }

    return {
      load,
      toJSON,
      runAll,
      cancel,
      kernelRestarted,
      clearOutputs,
      refresh,
      addCell: (type, text) => {
        const sel = cells.find(c => c.el.classList.contains('selected'));
        return addCell(type, text, { after: sel || cells[cells.length - 1] || null, focus: true });
      },
      focus: () => cells[0] && focusCell(cells[0], 'start'),
      dirty: () => version !== savedVersion,
      markSaved: () => { savedVersion = version; },
      touch: changed
    };
  }

  root.Notatbok = { create, template, markdown };
})(typeof self !== 'undefined' ? self : this);

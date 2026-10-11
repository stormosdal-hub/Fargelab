/*
 * utdata.js – viser utdata fra Python: tekst, bilder, verdier og feil
 *
 * Brukes av Python-fanen, både under Utdata for skript og under hver celle i
 * en notatbok. Et utdataelement er et vanlig objekt, nær formatet i .ipynb:
 *
 *   { type: 'stream', name: 'stdout' | 'stderr', text }   print() og advarsler
 *   { type: 'image', b64, title, window, send }            PNG fra cv2.imshow og plt.show
 *   { type: 'result', text }                               repr() av siste uttrykk i en celle
 *   { type: 'error', text }                                feilmelding med traceback
 *   { type: 'info', text }                                 melding fra appen (lagres ikke)
 *   { type: 'widget', view, send }                         glidebrytere, knapper osv. (widgets.js)
 *
 * Bilder fra cv2.imshow har window: true. Vises et nytt bilde med samme
 * vindusnavn, byttes det gamle ut, slik det gjør i et OpenCV-vindu. Har
 * vinduet cv2.setMouseCallback, har bildet send, og klikk i det går til Python.
 *
 * Bruk:  Utdata.append(beholder, element)
 */
(function (root) {
  'use strict';

  function append(container, item) {
    if (item.type === 'stream') {
      // Linjer fra samme strøm samles i én <pre>
      const last = container.lastElementChild;
      if (last && last.dataset.stream === item.name) {
        last.append('\n' + item.text);
        return last;
      }
      return addPre(container, 'py-' + item.name, item.text, item.name);
    }
    if (item.type === 'result') return addPre(container, 'py-result', item.text);
    if (item.type === 'error') return addPre(container, 'py-stderr py-error', item.text);
    if (item.type === 'info') {
      const p = document.createElement('p');
      p.className = 'py-info';
      p.textContent = item.text;
      container.appendChild(p);
      return p;
    }
    if (item.type === 'image') {
      const title = item.title || 'Bilde';
      let fig = item.window ? Array.from(container.children).find(c => c.dataset.window === title) : null;
      if (fig) setImage(fig, item.b64, title);
      else {
        fig = addImage(container, item.b64, title);
        if (item.window) fig.dataset.window = title;
      }
      // cv2.setMouseCallback: klikk og bevegelser i bildet sendes til Python
      if (item.window && root.Widgets) root.Widgets.mouse(fig, item.send || null);
      return fig;
    }
    if (item.type === 'widget' && root.Widgets) {
      const view = root.Widgets.render(item.view, item.send);
      container.appendChild(view);
      return view;
    }
    return null;
  }

  function addPre(container, className, text, stream) {
    const pre = document.createElement('pre');
    pre.className = className;
    if (stream) pre.dataset.stream = stream;
    pre.textContent = text;
    container.appendChild(pre);
    return pre;
  }

  function addImage(container, b64, title) {
    const fig = document.createElement('figure');
    fig.append(new Image(), document.createElement('figcaption'));
    setImage(fig, b64, title);
    container.appendChild(fig);
    return fig;
  }

  // Setter (eller bytter) bildet i en figur
  function setImage(fig, b64, title) {
    const img = fig.querySelector('img'), cap = fig.querySelector('figcaption');
    img.alt = title;
    if (!cap.textContent) cap.textContent = title;
    img.onload = () => {
      cap.textContent = `${title} · ${img.naturalWidth} × ${img.naturalHeight}`;
      // Små bilder forstørres med skarpe piksler, så du ser hver piksel
      const small = img.naturalWidth < 160;
      img.style.width = small ? img.naturalWidth * Math.ceil(160 / img.naturalWidth) + 'px' : '';
      img.classList.toggle('pixelated', small);
    };
    img.src = 'data:image/png;base64,' + b64;
  }

  root.Utdata = { append };
})(typeof self !== 'undefined' ? self : this);

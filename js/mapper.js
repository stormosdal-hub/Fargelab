/*
 * mapper.js – lese og skrive filer i mappene skript/ og bilder/ i prosjektet
 *
 * Virker bare når siden er startet med server.py (python server.py). Med
 * python -m http.server eller dobbeltklikk på index.html finnes ikke API-et,
 * og Mapper.available() gir false.
 *
 * Alle kall sender headeren X-Fargelab: 1, som server.py krever.
 *
 * Bruk:
 *   if (await Mapper.available()) {
 *     const filer = await Mapper.list('skript');             // [{ navn, storrelse, mtime }]
 *     const { text, mtime } = await Mapper.readText('skript', 'a.py');
 *     await Mapper.write('skript', 'a.py', tekst, { mtime }); // feiler med err.status 409 hvis filen er endret
 *   }
 */
(function (root) {
  'use strict';

  const HEADERS = { 'X-Fargelab': '1' };
  const IMAGE_TYPES = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
    gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif', ico: 'image/x-icon'
  };
  const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

  let infoPromise = null;
  function available() {
    if (!infoPromise) {
      infoPromise = /^https?:$/.test(location.protocol)
        ? fetch('api/info', { headers: HEADERS, cache: 'no-store' })
          .then(r => (r.ok ? r.json() : null))
          .then(j => !!(j && j.ok))
          .catch(() => false)
        : Promise.resolve(false);
    }
    return infoPromise;
  }

  const url = (mappe, navn) => 'api/filer/' + encodeURIComponent(mappe) + (navn == null ? '' : '/' + encodeURIComponent(navn));

  async function call(method, mappe, navn, { body, headers } = {}) {
    const r = await fetch(url(mappe, navn), { method, body, cache: 'no-store', headers: { ...HEADERS, ...headers } });
    if (!r.ok) {
      let info = {};
      try { info = await r.json(); } catch (_) { /* ikke JSON */ }
      const err = new Error(info.melding || info.feil || `Serveren svarte ${r.status}`);
      err.status = r.status;
      err.info = info;
      throw err;
    }
    return r;
  }

  const list = async mappe => (await call('GET', mappe)).json();

  async function read(mappe, navn) {
    const r = await call('GET', mappe, navn);
    return { data: await r.arrayBuffer(), mtime: r.headers.get('X-Fargelab-Mtime') };
  }
  async function readText(mappe, navn) {
    const r = await call('GET', mappe, navn);
    return { text: await r.text(), mtime: r.headers.get('X-Fargelab-Mtime') };
  }

  // mtime: lagre bare hvis filen ikke er endret siden da. 'ny': bare hvis filen ikke finnes.
  async function write(mappe, navn, data, { mtime } = {}) {
    const headers = mtime ? { 'X-Fargelab-Mtime': String(mtime) } : {};
    return (await call('PUT', mappe, navn, { body: data, headers })).json();
  }
  const rename = async (mappe, navn, nyttNavn) =>
    (await call('POST', mappe, navn, { body: JSON.stringify({ nyttNavn }), headers: { 'Content-Type': 'application/json' } })).json();
  const remove = async (mappe, navn) => (await call('DELETE', mappe, navn)).json();

  // Samme regler som valid_name i server.py. Gir en feilmelding, eller null hvis navnet er greit.
  function nameError(navn) {
    if (!navn) return 'Skriv et filnavn.';
    if (navn.length > 150) return 'Navnet er for langt.';
    if (navn !== navn.trim()) return 'Navnet kan ikke starte eller slutte med mellomrom.';
    if (navn.startsWith('.') || navn.endsWith('.')) return 'Navnet kan ikke starte eller slutte med punktum.';
    if (/[<>:"/\\|?*\u0000-\u001f]/.test(navn)) return 'Navnet kan ikke inneholde < > : " / \\ | ? *';
    if (RESERVED.test(navn)) return 'Det navnet er reservert i Windows.';
    return null;
  }

  // «foto.png» blir «foto-2.png» osv. hvis navnet er tatt
  function uniqueName(navn, taken) {
    const lower = new Set(Array.from(taken, n => n.toLowerCase()));
    if (!lower.has(navn.toLowerCase())) return navn;
    const dot = navn.lastIndexOf('.');
    const stem = dot > 0 ? navn.slice(0, dot) : navn, ext = dot > 0 ? navn.slice(dot) : '';
    for (let i = 2; ; i++) {
      const candidate = `${stem}-${i}${ext}`;
      if (!lower.has(candidate.toLowerCase())) return candidate;
    }
  }

  const ext = navn => (navn.split('.').pop() || '').toLowerCase();
  const isImage = navn => ext(navn) in IMAGE_TYPES;
  const imageType = navn => IMAGE_TYPES[ext(navn)] || '';

  root.Mapper = { available, list, read, readText, write, rename, remove, nameError, uniqueName, isImage, imageType };
})(typeof self !== 'undefined' ? self : this);

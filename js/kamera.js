/*
 * kamera.js – kamera og direktestrømmer til Python-fanen
 *
 * Python kjører i bakgrunnen og har ikke tilgang til kamera eller WebRTC. Når
 * Python kaller cv2.VideoCapture(0) eller cv2.VideoCapture(adresse), åpner
 * denne fila strømmen på siden, og cap.read() får det neste bildet herfra:
 *
 *   - Webkamera (UVC): cv2.VideoCapture(0), (1) … med getUserMedia. Nettleseren
 *     spør om lov første gang. Siden må være åpnet fra localhost eller https.
 *   - IP-kamera gjennom MediaMTX over WebRTC (WHEP), som i openCV_webStream:
 *       http://127.0.0.1:8889/cam/whep  (eller uten /whep)
 *       rtsp://127.0.0.1:8554/cam       (gjøres om til WHEP på port 8889)
 *     Nettleseren kan ikke lese RTSP selv, så MediaMTX må hente strømmen fra kameraet.
 *
 * Hvert kamera spilles i et skjult <video>-element. frame() venter på neste bilde
 * fra kameraet (som read() i OpenCV) og gir det som RGBA. Kameraene vises som
 * knapper i host-elementet, og et trykk stopper kameraet.
 *
 * Bruk:
 *   const kam = Kamera.create({ host })
 *   await kam.open(id, kilde)     → { ok, width, height, fps, navn } eller { ok: false, feil }
 *   await kam.frame(id)           → { ok, width, height, data } (data er en ArrayBuffer med RGBA)
 *   await kam.set(id, { width, height, fps })
 *   kam.close(id); kam.closeAll()
 */
(function (root) {
  'use strict';

  const OPEN_TIMEOUT = 15000;    // så lenge vi venter på at en strøm kommer i gang
  const FRAME_TIMEOUT = 1000;    // venter vi lenger på et nytt bilde, brukes det forrige

  const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);

  // Adressen til WHEP. rtsp://vert:8554/sti blir http://vert:8889/sti/whep (portene MediaMTX bruker).
  function whepUrl(kilde) {
    let u = String(kilde).trim();
    const rtsp = /^rtsps?:\/\/(?:[^@/]*@)?([^/:]+)(?::(\d+))?\/(.+)$/i.exec(u);
    if (rtsp) {
      if (rtsp[2] && rtsp[2] !== '8554') {
        throw new Error('Nettleseren kan ikke lese RTSP direkte. Start MediaMTX med kameraet som kilde (som start.bat i openCV_webStream), ' +
          'og bruk adressen til MediaMTX: rtsp://127.0.0.1:8554/navn eller http://127.0.0.1:8889/navn/whep.');
      }
      u = `http://${rtsp[1]}:8889/${rtsp[3]}`;
    }
    u = u.replace(/^whep:\/\//i, 'http://').replace(/\/+$/, '');
    if (!/\/whep$/i.test(u)) u += '/whep';
    return u;
  }

  // Venter til ICE er ferdig, så tilbudet har adressene våre (høyst ms)
  function waitForIce(pc, ms) {
    return new Promise(resolve => {
      if (pc.iceGatheringState === 'complete') { resolve(); return; }
      const timer = setTimeout(done, ms);
      function check() { if (pc.iceGatheringState === 'complete') done(); }
      function done() {
        clearTimeout(timer);
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      }
      pc.addEventListener('icegatheringstatechange', check);
    });
  }

  // WebRTC fra MediaMTX: gir { stream, pc, session }
  async function openWhep(url) {
    const pc = new RTCPeerConnection({ iceServers: [] });   // kamera og MediaMTX er på det lokale nettet
    pc.addTransceiver('video', { direction: 'recvonly' });
    const gotTrack = new Promise(resolve => {
      pc.ontrack = ev => resolve(ev.streams[0] || new MediaStream([ev.track]));
    });
    try {
      await pc.setLocalDescription(await pc.createOffer());
      await waitForIce(pc, 1500);
      let resp;
      try {
        resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: pc.localDescription.sdp });
      } catch (_) {
        throw new Error(`Fikk ikke kontakt med ${url}. Kjører MediaMTX?`);
      }
      if (!resp.ok) {
        const body = (await resp.text()).slice(0, 200);
        throw new Error(`MediaMTX svarte ${resp.status}${body ? ': ' + body : ''}. Stemmer navnet på strømmen?`);
      }
      const loc = resp.headers.get('Location');
      const session = loc ? new URL(loc, url).toString() : null;
      await pc.setRemoteDescription({ type: 'answer', sdp: await resp.text() });
      const stream = await withTimeout(gotTrack, OPEN_TIMEOUT, 'Fikk ikke video fra MediaMTX. Sender kameraet til MediaMTX?');
      return { stream, pc, session };
    } catch (err) {
      pc.close();
      throw err;
    }
  }

  // Webkamera nummer index (0 er standardkameraet). Som i OpenCV ber vi om 640 × 480.
  async function openUvc(index) {
    const md = navigator.mediaDevices;
    if (!md || !md.getUserMedia) {
      throw new Error('Nettleseren gir ikke tilgang til kamera her. Åpne siden fra http://localhost:8000 (server.py) eller https.');
    }
    const video = { width: { ideal: 640 }, height: { ideal: 480 } };
    if (index > 0) {
      // Listen over kameraer har navn og id først etter at du har gitt lov
      let list = (await md.enumerateDevices()).filter(d => d.kind === 'videoinput');
      if (!list.some(d => d.deviceId)) {
        (await md.getUserMedia({ video: true })).getTracks().forEach(t => t.stop());
        list = (await md.enumerateDevices()).filter(d => d.kind === 'videoinput');
      }
      if (index >= list.length) throw new Error(`Fant ikke kamera ${index}. Nettleseren ser ${list.length} kamera${list.length === 1 ? '' : 'er'} (0–${list.length - 1}).`);
      video.deviceId = { exact: list[index].deviceId };
    }
    try {
      return await md.getUserMedia({ video, audio: false });
    } catch (err) {
      const why = {
        NotAllowedError: 'Du (eller nettleseren) sa nei til kameraet. Gi siden lov i adressefeltet og prøv igjen.',
        NotFoundError: 'Fant ikke noe kamera.',
        NotReadableError: 'Kameraet er i bruk av et annet program.',
        OverconstrainedError: 'Kameraet støtter ikke det som ble bedt om.'
      }[err && err.name];
      throw new Error(why || `Kameraet kunne ikke åpnes (${err && err.message || err}).`);
    }
  }

  function create({ host } = {}) {
    const cams = new Map();     // id → kamera
    // De skjulte <video>-elementene ligger i et lite felt utenfor skjermen, så nettleseren spiller dem av
    const stage = document.createElement('div');
    stage.style.cssText = 'position:fixed;left:-10px;top:0;width:2px;height:2px;overflow:hidden;opacity:0;pointer-events:none';
    stage.setAttribute('aria-hidden', 'true');
    document.body.appendChild(stage);

    function render() {
      if (!host) return;
      host.textContent = '';
      host.hidden = cams.size === 0;
      cams.forEach(cam => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn py-cam' + (cam.live ? ' live' : '');
        b.title = `Stopp ${cam.navn}. cap.read() gir da False, så en løkke med «if not ok: break» stopper.`;
        const dot = document.createElement('span');
        dot.className = 'py-cam-dot';
        dot.setAttribute('aria-hidden', 'true');
        const size = cam.width ? ` · ${cam.width} × ${cam.height}` : '';
        b.append(dot, `${cam.navn}${size}`, Object.assign(document.createElement('span'), { className: 'py-cam-stop', textContent: 'Stopp' }));
        b.addEventListener('click', () => close(cam.id));
        host.appendChild(b);
      });
    }

    async function open(id, kilde) {
      const isUvc = typeof kilde === 'number';
      const cam = {
        id, kilde, live: false, width: 0, height: 0, fps: 0,
        navn: isUvc ? `Kamera ${kilde}` : String(kilde).replace(/^\w+:\/\//, '').replace(/\/whep$/i, ''),
        stream: null, pc: null, session: null, video: null, canvas: null, ctx: null, closed: false
      };
      cams.set(id, cam);
      render();
      try {
        if (isUvc) {
          cam.stream = await openUvc(kilde);
        } else {
          const w = await openWhep(whepUrl(kilde));
          Object.assign(cam, w);
          cam.pc.addEventListener('connectionstatechange', () => {
            const s = cam.pc && cam.pc.connectionState;
            if (s === 'failed' || s === 'closed' || s === 'disconnected') { cam.live = false; render(); }
          });
        }
        if (cam.closed) { stopStream(cam); return { ok: false, feil: 'Kameraet ble stoppet.' }; }
        const v = document.createElement('video');
        v.muted = true;
        v.playsInline = true;
        v.autoplay = true;
        v.srcObject = cam.stream;
        stage.appendChild(v);
        cam.video = v;
        await withTimeout(new Promise((resolve, reject) => {
          const ready = () => (v.readyState >= 2 && v.videoWidth ? resolve() : null);
          v.addEventListener('loadeddata', ready);
          v.addEventListener('resize', ready);
          v.addEventListener('error', () => reject(new Error('Videoen kunne ikke spilles av.')));
          ready();
        }), OPEN_TIMEOUT, 'Fikk ikke bilde fra strømmen.');
        v.play().catch(() => {});
        cam.stream.getVideoTracks().forEach(t => t.addEventListener('ended', () => { cam.live = false; render(); }));
        const s = cam.stream.getVideoTracks()[0]?.getSettings() || {};
        cam.width = v.videoWidth;
        cam.height = v.videoHeight;
        cam.fps = s.frameRate || 30;
        cam.canvas = document.createElement('canvas');
        cam.ctx = cam.canvas.getContext('2d', { willReadFrequently: true });
        cam.live = true;
        render();
        return { ok: true, width: cam.width, height: cam.height, fps: cam.fps, navn: cam.navn };
      } catch (err) {
        close(id);
        return { ok: false, feil: err.message || String(err) };
      }
    }

    // Neste bilde fra kameraet, som RGBA
    async function frame(id) {
      const cam = cams.get(id);
      if (!cam || !cam.live || !cam.video) return { ok: false };
      const v = cam.video;
      await new Promise(resolve => {
        const timer = setTimeout(resolve, FRAME_TIMEOUT);
        if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => { clearTimeout(timer); resolve(); });
        else setTimeout(() => { clearTimeout(timer); resolve(); }, 1000 / (cam.fps || 30));
      });
      if (!cam.live || v.readyState < 2 || !v.videoWidth) return { ok: false };
      const w = v.videoWidth, h = v.videoHeight;
      if (cam.canvas.width !== w || cam.canvas.height !== h) {
        cam.canvas.width = w;
        cam.canvas.height = h;
        if (cam.width !== w || cam.height !== h) { cam.width = w; cam.height = h; render(); }
      }
      cam.ctx.drawImage(v, 0, 0, w, h);
      return { ok: true, width: w, height: h, data: cam.ctx.getImageData(0, 0, w, h).data.buffer };
    }

    // cap.set(cv2.CAP_PROP_FRAME_WIDTH, …) og lignende. Bare webkamera kan endres.
    async function set(id, { width, height, fps }) {
      const cam = cams.get(id);
      const track = cam && cam.live && cam.stream.getVideoTracks()[0];
      if (!track || typeof cam.kilde !== 'number') return { ok: false };
      const c = {};
      if (width) c.width = { ideal: width };
      if (height) c.height = { ideal: height };
      if (fps) c.frameRate = { ideal: fps };
      try { await track.applyConstraints(c); } catch (_) { return { ok: false }; }
      // Den nye størrelsen kommer med neste bilde
      await new Promise(r => setTimeout(r, 300));
      const s = track.getSettings();
      cam.fps = s.frameRate || cam.fps;
      cam.width = cam.video.videoWidth || s.width || cam.width;
      cam.height = cam.video.videoHeight || s.height || cam.height;
      render();
      return { ok: true, width: cam.width, height: cam.height, fps: cam.fps };
    }

    function stopStream(cam) {
      if (cam.stream) cam.stream.getTracks().forEach(t => t.stop());
      if (cam.pc) { try { cam.pc.close(); } catch (_) { /* allerede lukket */ } }
      if (cam.session) fetch(cam.session, { method: 'DELETE', keepalive: true }).catch(() => {});
      if (cam.video) { cam.video.srcObject = null; cam.video.remove(); }
      cam.stream = cam.pc = cam.session = cam.video = null;
    }

    function close(id) {
      const cam = cams.get(id);
      if (!cam) return;
      cam.closed = true;
      cam.live = false;
      stopStream(cam);
      cams.delete(id);
      render();
    }

    function closeAll() { Array.from(cams.keys()).forEach(close); }

    root.addEventListener('pagehide', closeAll);
    return { open, frame, set, close, closeAll, whepUrl };
  }

  root.Kamera = { create, whepUrl };
})(typeof self !== 'undefined' ? self : this);

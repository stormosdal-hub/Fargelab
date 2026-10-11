/*
 * python.js – Python-fanen: skriv og kjør Python med OpenCV, numpy og matplotlib
 *
 * Python kjører i Pyodide (CPython kompilert til WebAssembly) i en egen
 * Web Worker, så siden ikke fryser mens et skript går. Pyodide og pakkene
 * lastes fra lib/pyodide når fanen åpnes første gang, så det virker uten
 * internett når siden kjøres fra en lokal webserver. Ellers hentes de fra
 * jsDelivr (se PYODIDE_SOURCES).
 *
 * Tilpasset nettleseren:
 *   - cv2.imshow(navn, bilde) og plt.show() viser bildene under Utdata.
 *     cv2.waitKey, cv2.destroyAllWindows og lignende gjør ingenting.
 *     Figurer som ikke er vist når skriptet er ferdig, vises til slutt.
 *   - Skriptet kjører i mappen /home/pyodide. Der ligger testbilde.png,
 *     bildet fra Fargelab-fanen og filer du legger til selv. Filer skriptet
 *     lagrer, kan lastes ned.
 *   - import fargelab gir fargen og bildet du har valgt i Fargelab-fanen.
 *   - Pakker fra Pyodide (scipy, pandas, scikit-image …) lastes automatisk
 *     når skriptet importerer dem.
 *   - input() virker ikke, fordi skriptet kjører i bakgrunnen.
 *   - Stopp avslutter workeren og starter Python på nytt. Filer du har lagt
 *     til, sendes inn igjen. Filer skriptet har laget, forsvinner.
 *
 * Workeren lages fra en blob (ikke en egen .js-fil), slik at den også virker
 * når index.html er åpnet direkte fra disken (file://). Pyodide 314 krever
 * en modul-worker.
 *
 * Editoren er CodeMirror 5 fra lib/codemirror (eller cdnjs). Kan den ikke
 * lastes, brukes et vanlig tekstfelt. Skriptet lagres i nettleseren
 * (localStorage) mens du skriver.
 *
 * Bruk:
 *   const python = Python.create({ context: () => ({ bgr, hsv, bilde, piksel }) });
 *   python.addFile(file, navn)   // legger en fil i Python-mappen, gir filnavnet
 */
(function (root) {
  'use strict';

  // Pyodide og CodeMirror hentes fra lib/ først, og fra nettet bare hvis det
  // ikke går. lib/pyodide/ har kjernen og numpy, OpenCV og matplotlib med
  // avhengigheter. I lib/pyodide/pyodide-lock.json peker alle andre pakker på
  // jsDelivr, så de kan lastes når du er på nett.
  // Merk: Åpnes index.html direkte fra disken (file://), lar ikke nettleseren
  // skript lese lokale filer med fetch. Da hentes Pyodide fra jsDelivr i stedet.
  const PYODIDE_SOURCES = [
    { base: 'lib/pyodide/', name: 'lib/pyodide' },
    { base: 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/', name: 'cdn.jsdelivr.net' }
  ];
  const CM_SOURCES = ['lib/codemirror/', 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.21/'];
  const STORE_KEY = 'fargelab.python.skript';

  /* ---------- Python-kode som kjøres én gang når Python har startet ---------- */
  const PRELUDE = `
import os, sys
# Hjelpefilene holdes utenfor arbeidsmappen, så den bare har filene dine:
# fargelab.py ligger i /fargelab, og matplotlib lagrer innstillingene i /tmp.
os.environ.setdefault("MPLCONFIGDIR", "/tmp/matplotlib")
os.makedirs("/fargelab", exist_ok=True)
sys.path.insert(0, "/fargelab")
# fargelab.py skrives på nytt før hver kjøring, så .pyc-filer kunne gitt gamle verdier
sys.dont_write_bytecode = True

import io, base64, builtins, warnings
import numpy as np
import cv2
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import _fargelab_bro

# window=True: bildet hører til et OpenCV-vindu og byttes ut neste gang det vises.
# mouse=True: vinduet har cv2.setMouseCallback, så klikk i bildet sendes tilbake.
def _send_png(png, title, window=False, mouse=False):
    _fargelab_bro.bilde(base64.b64encode(png).decode("ascii"), str(title), bool(window), bool(mouse))

# Matplotlib i Pyodide varsler om en intern utfasing når figuren tegnes.
# Den gjelder ikke koden din, så den skjules her.
def _figur_png(fig):
    buf = io.BytesIO()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", matplotlib.MatplotlibDeprecationWarning)
        fig.savefig(buf, format="png", dpi=100, bbox_inches="tight")
    return buf.getvalue()

def _fargelab_vis_figurer():
    for num in plt.get_fignums():
        fig = plt.figure(num)
        _send_png(_figur_png(fig), fig.get_label() or f"Figur {num}")
    plt.close("all")

def _fargelab_vis_figur(fig):
    _send_png(_figur_png(fig), fig.get_label() or "Figur")
    plt.close(fig)

def _show(*args, **kwargs):
    _fargelab_vis_figurer()

plt.show = _show

# cv2.imshow viser bildet under Utdata. Viser du et nytt bilde med samme
# vindusnavn, byttes det gamle ut, som i et OpenCV-vindu. Som i vanlig OpenCV
# ganges flyttall med 255, og 16-bits bilder deles på 256.
def _imshow(winname, mat):
    img = np.asarray(mat)
    if img.dtype == np.bool_:
        img = img.astype(np.uint8) * 255
    elif img.dtype.kind == "f":
        img = np.clip(img * 255.0, 0, 255).round().astype(np.uint8)
    elif img.dtype == np.uint16:
        img = (img >> 8).astype(np.uint8)
    elif img.dtype != np.uint8:
        img = np.clip(img, 0, 255).astype(np.uint8)
    ok, png = cv2.imencode(".png", img)
    if not ok:
        raise ValueError("cv2.imshow: klarte ikke å lage et bilde av dataene")
    _send_png(png.tobytes(), winname, True, str(winname) in _mus)

cv2.imshow = _imshow
cv2.waitKey = lambda delay=0: -1
cv2.waitKeyEx = lambda delay=0: -1
cv2.pollKey = lambda: -1
cv2.destroyAllWindows = lambda: None
cv2.destroyWindow = lambda winname: None
cv2.namedWindow = lambda winname, flags=None: None
cv2.resizeWindow = lambda *args, **kwargs: None
cv2.moveWindow = lambda *args, **kwargs: None

def _input(prompt=""):
    raise RuntimeError("input() virker ikke her, fordi skriptet kjører i bakgrunnen i nettleseren. Skriv verdien rett i koden i stedet.")

builtins.input = _input

# Hjelpefunksjoner som ipywidgets.py (i widgets-py.js) bruker
import types
_hjelp = types.ModuleType("_fargelab_hjelp")
_hjelp.send_png = _send_png
_hjelp.vis_figurer = _fargelab_vis_figurer
_hjelp.vis_figur = _fargelab_vis_figur
sys.modules["_fargelab_hjelp"] = _hjelp

# Widgets som i Colab. display() virker uten import, som i Jupyter.
import ipywidgets
builtins.display = ipywidgets.display

# cv2.createTrackbar blir en glidebryter under cellen. Callbacken kjører hver
# gang du drar i den, og cv2.imshow i callbacken bytter ut bildet i vinduet.
_trackbars = {}

def _trackbar(trackbarname, winname):
    try:
        return _trackbars[(winname, trackbarname)]
    except KeyError:
        raise KeyError(f"Finner ingen trackbar {trackbarname!r} i vinduet {winname!r}. Lag den med cv2.createTrackbar først.") from None

def _createTrackbar(trackbarName, windowName, value, count, onChange=None):
    slider = ipywidgets.IntSlider(value=value, min=0, max=count, description=trackbarName)
    if onChange is not None:
        slider.observe(lambda change: onChange(change["new"]), names="value")
    _trackbars[(windowName, trackbarName)] = slider
    ipywidgets.display(slider)

def _setTrackbarPos(trackbarname, winname, pos):
    _trackbar(trackbarname, winname).value = pos

def _setTrackbarMin(trackbarname, winname, minval):
    _trackbar(trackbarname, winname).min = minval

def _setTrackbarMax(trackbarname, winname, maxval):
    _trackbar(trackbarname, winname).max = maxval

cv2.createTrackbar = _createTrackbar
cv2.getTrackbarPos = lambda trackbarname, winname: _trackbar(trackbarname, winname).value
cv2.setTrackbarPos = _setTrackbarPos
cv2.setTrackbarMin = _setTrackbarMin
cv2.setTrackbarMax = _setTrackbarMax

# cv2.setMouseCallback: klikker du i et bilde fra cv2.imshow, kalles funksjonen
# med (event, x, y, flags, param), som i et OpenCV-vindu. x og y er piksler i
# bildet. Bevegelser som kommer tett, slås sammen til den siste posisjonen.
# Kall den før cv2.imshow, så bildet tar imot klikk.
_mus = {}

def _setMouseCallback(windowName, onMouse, param=None):
    _mus[str(windowName)] = (onMouse, param)

cv2.setMouseCallback = _setMouseCallback

# Kalles når du endrer en widget eller klikker i et bilde i nettleseren
def _fargelab_widget_event(widget_id, kind, value=None):
    if kind == "mouse":
        if widget_id in _mus:
            onMouse, param = _mus[widget_id]
            event, x, y, flags = (int(v) for v in value.to_py())
            onMouse(event, x, y, flags, param)
        return
    ipywidgets._event(widget_id, kind, value)

# Variabler-panelet: variablene i et navnerom som JSON, med type, størrelse,
# verdi og et lite bilde av numpy-tabeller som ser ut som bilder. Navn som
# starter med _ skjules alltid, og moduler, funksjoner og klasser hvis ikke
# alle=True. fjern er navnet på en variabel som skal slettes først, eller None.
import reprlib, inspect, json

_kort = reprlib.Repr()
_kort.maxstring = _kort.maxother = 200
_kort.maxlist = _kort.maxtuple = _kort.maxset = _kort.maxfrozenset = _kort.maxdict = 10
_kort.maxlevel = 3

def _tall(x):
    return format(x, ".4g") if isinstance(x, (float, np.floating)) else str(x)

def _miniatyr(a):
    if a.ndim not in (2, 3) or (a.ndim == 3 and a.shape[2] not in (1, 3, 4)):
        return None
    h, w = a.shape[:2]
    if min(h, w) < 8 or not (a.dtype in (np.uint8, np.uint16, np.bool_) or a.dtype.kind == "f"):
        return None
    # Som cv2.imshow: flyttall ganges med 255, og 16-bits bilder deles på 256
    if a.dtype == np.bool_:
        img = a.astype(np.uint8) * 255
    elif a.dtype.kind == "f":
        img = np.clip(np.nan_to_num(a) * 255.0, 0, 255).astype(np.uint8)
    elif a.dtype == np.uint16:
        img = (a >> 8).astype(np.uint8)
    else:
        img = a
    s = 96 / max(h, w)
    if s < 1:
        img = cv2.resize(img, (max(1, round(w * s)), max(1, round(h * s))), interpolation=cv2.INTER_AREA)
    ok, png = cv2.imencode(".png", img)
    return base64.b64encode(png.tobytes()).decode("ascii") if ok else None

def _storrelse(v):
    if isinstance(v, np.ndarray):
        return "%s %s" % (v.shape, v.dtype)
    if isinstance(v, str):
        return "%d tegn" % len(v)
    if isinstance(v, (bytes, bytearray)):
        return "%d byte" % len(v)
    if isinstance(v, np.generic):
        return ""
    shape = getattr(v, "shape", None)
    if isinstance(shape, tuple):
        return str(shape)
    if isinstance(v, (list, tuple, dict, set, frozenset, range)):
        return "%d element%s" % (len(v), "" if len(v) == 1 else "er")
    return ""

def _verdi(v):
    if isinstance(v, np.ndarray):
        if v.size == 0:
            return "tom"
        if v.size <= 12:
            return " ".join(np.array2string(v, separator=", ").split())
        if v.dtype == np.bool_:
            return "%d av %d er True" % (np.count_nonzero(v), v.size)
        if v.dtype.kind in "uif":
            return "min %s, maks %s, snitt %s" % (_tall(v.min()), _tall(v.max()), _tall(v.mean()))
    if isinstance(v, np.generic):
        return str(v)
    return " ".join(_kort.repr(v).split())

def _fargelab_variabler(ns, alle=False, fjern=None):
    if fjern:
        ns.pop(fjern, None)
    ut = []
    for navn in sorted((n for n in ns if isinstance(n, str)), key=str.lower):
        if navn.startswith("_"):
            continue
        v = ns[navn]
        if not alle and (isinstance(v, types.ModuleType) or inspect.isroutine(v) or inspect.isclass(v)):
            continue
        rad = {"navn": navn, "type": type(v).__name__, "storrelse": "", "verdi": "", "bilde": None}
        try:
            rad["storrelse"] = _storrelse(v)
            rad["verdi"] = _verdi(v)
            if isinstance(v, np.ndarray):
                rad["bilde"] = _miniatyr(v)
        except Exception as e:
            rad["verdi"] = "(kan ikke vises: %s)" % type(e).__name__
        ut.append(rad)
        if len(ut) >= 500:
            break
    return json.dumps(ut)

# Kjører én celle i en notatbok og gir repr() av siste uttrykk, som i Colab og
# Jupyter. Slutter cellen med semikolon, vises ingenting. await virker i cellene.
# Er siste uttrykk en widget (eller noe annet med _ipython_display_), vises den.
async def _fargelab_celle(kode, ns, filnavn):
    from pyodide.code import eval_code_async
    verdi = await eval_code_async(kode, ns, filename=filnavn)
    if verdi is None:
        return None
    if callable(getattr(verdi, "_ipython_display_", None)):
        verdi._ipython_display_()
        return None
    return repr(verdi)

# testbilde.png finnes alltid, så eksemplene virker uten at du har åpnet et bilde
def _lag_testbilde():
    h, w = 240, 360
    hsv = np.zeros((h, w, 3), np.uint8)
    hsv[..., 0] = np.linspace(0, 179, w).astype(np.uint8)[None, :]
    hsv[..., 1] = 255
    hsv[..., 2] = np.linspace(255, 70, h).astype(np.uint8)[:, None]
    img = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)
    cv2.circle(img, (90, 120), 50, (255, 255, 255), -1)
    cv2.rectangle(img, (220, 70), (320, 170), (40, 40, 40), -1)
    cv2.imwrite("testbilde.png", img)

_lag_testbilde()
`;

  /* ---------- Eksempler ---------- */
  const EXAMPLES = [
    {
      id: 'start', name: 'Kom i gang',
      code: `# Python med OpenCV, numpy og matplotlib, rett i nettleseren.
# Trykk Kjør (eller Ctrl+Enter). Det du skriver ut med print() havner under Utdata.
import sys
import cv2
import numpy as np

print("Python", sys.version.split()[0])
print("OpenCV", cv2.__version__)
print("numpy", np.__version__)

# Samme konvertering som i Fargelab-fanen
bgr = np.uint8([[[200, 150, 30]]])
hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
print("BGR", bgr[0, 0], "-> HSV", hsv[0, 0])

# cv2.imshow viser bildet under Utdata
img = cv2.imread("testbilde.png")
cv2.imshow("testbilde.png", img)
`
    },
    {
      id: 'fargelab', name: 'Fargen fra Fargelab',
      code: `# Modulen fargelab gir deg det du har valgt i Fargelab-fanen.
import cv2
import numpy as np
import fargelab

print("Valgt farge (BGR):", fargelab.bgr)
print("Samme farge i HSV:", fargelab.hsv)
print("Bilde:", fargelab.bilde)
print("Markør (x, y):", fargelab.piksel)

# En flate på 120 × 300 piksler i fargen du har valgt
flate = np.zeros((120, 300, 3), np.uint8)
flate[:] = fargelab.bgr
cv2.imshow("Valgt farge", flate)
`
    },
    {
      id: 'terskel', name: 'Gråtone og terskel',
      code: `# Gråtone og cv2.threshold på bildet fra Fargelab-fanen (eller testbildet)
import cv2
import fargelab

img = cv2.imread(fargelab.bilde or "testbilde.png")
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

thresh, maxval = 127, 255
_, binary = cv2.threshold(gray, thresh, maxval, cv2.THRESH_BINARY)

# Med THRESH_OTSU finner OpenCV en terskel selv
otsu_t, otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
print("Otsu valgte terskelen", otsu_t)

cv2.imshow("Gråtone", gray)
cv2.imshow(f"Binær, thresh = {thresh}", binary)
cv2.imshow(f"Otsu, thresh = {otsu_t:.0f}", otsu)
`
    },
    {
      id: 'inrange', name: 'Maske rundt valgt farge (inRange)',
      code: `# Finn piksler med omtrent samme farge som den du har valgt i Fargelab-fanen
import cv2
import numpy as np
import fargelab

img = cv2.imread(fargelab.bilde or "testbilde.png")
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)

h, s, v = fargelab.hsv
dh, ds, dv = 10, 80, 80   # hvor mye hver kanal kan avvike

lav_s, hoy_s = max(s - ds, 0), min(s + ds, 255)
lav_v, hoy_v = max(v - dv, 0), min(v + dv, 255)

# H går rundt: rødt ligger både nær 0 og nær 179, og da trengs to masker
if h - dh < 0 or h + dh > 179:
    maske1 = cv2.inRange(hsv, (0, lav_s, lav_v), ((h + dh) % 180, hoy_s, hoy_v))
    maske2 = cv2.inRange(hsv, ((h - dh) % 180, lav_s, lav_v), (179, hoy_s, hoy_v))
    maske = cv2.bitwise_or(maske1, maske2)
else:
    maske = cv2.inRange(hsv, (h - dh, lav_s, lav_v), (h + dh, hoy_s, hoy_v))

treff = cv2.bitwise_and(img, img, mask=maske)
print(f"{np.count_nonzero(maske)} av {maske.size} piksler er med i masken")
cv2.imshow("Maske", maske)
cv2.imshow("Treff", treff)
`
    },
    {
      id: 'histogram', name: 'Histogram med matplotlib',
      code: `# Bildet og et histogram per kanal med matplotlib
import cv2
import matplotlib.pyplot as plt
import fargelab

img = cv2.imread(fargelab.bilde or "testbilde.png")

fig, (a1, a2) = plt.subplots(1, 2, figsize=(10, 3.6))
a1.imshow(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))   # matplotlib vil ha RGB
a1.set_title("Bildet")
a1.axis("off")

for i, farge in enumerate(("b", "g", "r")):
    hist = cv2.calcHist([img], [i], None, [256], [0, 256])
    a2.plot(hist, color=farge, label=farge.upper())
a2.set_xlim(0, 255)
a2.set_title("Histogram per kanal")
a2.legend()
plt.show()
`
    },
    {
      id: 'hjul', name: 'Fargehjul med numpy',
      code: `# Et HSV-fargehjul laget med numpy og gjort om til BGR med OpenCV
import cv2
import numpy as np

n = 300
y, x = np.mgrid[-1:1:n * 1j, -1:1:n * 1j]
r = np.hypot(x, y)
grader = (np.degrees(np.arctan2(-y, x)) + 360) % 360

hsv = np.zeros((n, n, 3), np.uint8)
hsv[..., 0] = (grader / 2).astype(np.uint8)            # OpenCV: H = grader / 2
hsv[..., 1] = (np.clip(r, 0, 1) * 255).astype(np.uint8)
hsv[..., 2] = np.where(r <= 1, 255, 0)

bgr = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)
cv2.imshow("Fargehjul, V = 255", bgr)
`
    },
    {
      id: 'canny', name: 'Kanter med Canny, og lagre fil',
      code: `# Finn kanter og lagre resultatet som en fil du kan laste ned
import cv2
import fargelab

img = cv2.imread(fargelab.bilde or "testbilde.png")
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
blur = cv2.GaussianBlur(gray, (5, 5), 0)
kanter = cv2.Canny(blur, 50, 150)

cv2.imshow("Kanter (Canny 50, 150)", kanter)
cv2.imwrite("kanter.png", kanter)
print("Lagret kanter.png. Trykk Filer øverst til høyre for å se den.")
`
    },
    {
      id: 'interact', name: 'Glidebrytere med interact',
      code: `# Glidebrytere og avkrysningsbokser med interact, som i Colab og Jupyter.
# Dra i glidebryterne under, så kjører funksjonen på nytt.
import cv2
from ipywidgets import interact

img = cv2.imread("eksempel.png")
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

@interact(thresh=(0, 255), maxval=(0, 255), inverter=False)
def terskel(thresh=127, maxval=255, inverter=False):
    typ = cv2.THRESH_BINARY_INV if inverter else cv2.THRESH_BINARY
    _, binary = cv2.threshold(gray, thresh, maxval, typ)
    cv2.imshow("binær", binary)
    print(f"{(binary > 0).mean():.0%} av pikslene er over 0")
`
    },
    {
      id: 'trackbar', name: 'Trackbar som i OpenCV',
      code: `# cv2.createTrackbar blir en glidebryter. Callbacken kjører når du drar i den,
# og cv2.imshow med samme vindusnavn bytter ut bildet, som i et OpenCV-vindu.
import cv2

img = cv2.imread("eksempel.png")
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)

def oppdater(_):
    h = cv2.getTrackbarPos("H", "maske")
    bredde = cv2.getTrackbarPos("bredde", "maske")
    lav = (max(h - bredde, 0), 80, 80)
    hoy = (min(h + bredde, 179), 255, 255)
    maske = cv2.inRange(hsv, lav, hoy)
    cv2.imshow("maske", cv2.bitwise_and(img, img, mask=maske))

cv2.namedWindow("maske")
cv2.createTrackbar("H", "maske", 60, 179, oppdater)
cv2.createTrackbar("bredde", "maske", 10, 40, oppdater)
oppdater(0)
`
    },
    {
      id: 'knapper', name: 'Knapper og nedtrekksliste',
      code: `# Knapper, nedtrekkslister og et Output-område med ipywidgets
import cv2
import ipywidgets as widgets

img = cv2.imread("eksempel.png")
effekt = widgets.Dropdown(options=["Gråtone", "Kanter", "Uskarp"], description="Effekt")
speil = widgets.Checkbox(description="Speilvend")
knapp = widgets.Button(description="Vis bildet", button_style="primary")
ut = widgets.Output()

def vis(_):
    with ut:
        ut.clear_output(wait=True)
        if effekt.value == "Gråtone":
            bilde = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        elif effekt.value == "Kanter":
            bilde = cv2.Canny(img, 50, 150)
        else:
            bilde = cv2.GaussianBlur(img, (15, 15), 0)
        if speil.value:
            bilde = cv2.flip(bilde, 1)
        cv2.imshow(effekt.value, bilde)

knapp.on_click(vis)
display(widgets.HBox([effekt, speil, knapp]), ut)
`
    }
  ];

  /* ---------- Koden som kjører inne i workeren ---------- */
  // Funksjonen gjøres om til tekst og startes som en egen modul, så den kan
  // ikke bruke noe utenfor seg selv. Alt den trenger, får den som argumenter.
  // SOURCES er Pyodide-kildene i rekkefølge, med fulle adresser. MODULES er
  // Python-filene fra widgets-py.js (filnavn → kildekode).
  function workerMain(SOURCES, PRELUDE, MODULES) {
    const MAX_LINES = 5000;
    let py = null, buf = [], timer = 0, lines = 0, cut = false;
    // Navnerommet til notatboken: variablene lever fra celle til celle til du starter på nytt.
    // scriptNs er navnerommet fra siste skript, som Variabler-panelet viser til neste kjøring.
    let nbGlobals = null, scriptNs = null, runCell = null, widgetEvent = null, listVars = null;

    // Utskrift samles og sendes i små porsjoner, så siden ikke drukner i meldinger
    const flush = () => {
      clearTimeout(timer);
      timer = 0;
      if (buf.length) { postMessage({ type: 'out', items: buf }); buf = []; }
    };
    const out = (stream, text) => {
      if (cut) return;
      if (++lines > MAX_LINES) {
        cut = true;
        buf.push({ stream: 'info', text: `Utdataene er kuttet etter ${MAX_LINES} linjer.` });
        flush();
        return;
      }
      buf.push({ stream, text });
      if (!timer) timer = setTimeout(flush, 40);
    };
    const status = (state, text) => postMessage({ type: 'status', state, text });

    // Tar bort linjene fra Pyodide og Fargelab selv, så feilmeldingen starter i koden din.
    // Uten filnavn (hendelser fra widgets) starter den i første linje som er din.
    const internal = l => /File "(<exec>|<oppsett for nettleseren>|\/lib\/python|\/fargelab\/)/.test(l) || l.includes('/_pyodide/');
    const cleanTraceback = (msg, filename) => {
      const ls = String(msg).replace(/\s+$/, '').split('\n');
      let i = filename ? ls.findIndex(l => l.includes(`File "${filename}"`)) : -1;
      if (i < 0) i = ls.findIndex(l => /^\s*File "/.test(l) && !internal(l));
      if (i < 0) i = ls.findIndex(l => l.includes('File "<exec>"'));
      return i > 0 && /^Traceback/.test(ls[0]) ? [ls[0], ...ls.slice(i)].join('\n') : ls.join('\n');
    };

    // Filer fra mappen bilder/: navn → endringstid i Python-mappen da de ble lagt inn.
    // Endrer et skript en slik fil, merkes den som endret, så originalen kan legges inn igjen.
    const fromFolder = new Map();
    const listFiles = () => {
      const fs = py.FS, files = [];
      for (const name of fs.readdir('.')) {
        if (name.startsWith('.') || name === '__pycache__') continue;
        const st = fs.stat(name);
        if (!fs.isFile(st.mode)) continue;
        const folder = fromFolder.has(name);
        files.push({ name, size: st.size, folder, changed: folder && fromFolder.get(name) !== st.mtime.getTime() });
      }
      files.sort((a, b) => a.name.localeCompare(b.name));
      postMessage({ type: 'files', files });
    };

    const ready = (async () => {
      // Prøver kildene i rekkefølge: først lib/pyodide, så jsDelivr
      let source = null, lastErr = null;
      for (const s of SOURCES) {
        try {
          status('loading', `Laster Python (Pyodide) fra ${s.name} …`);
          const { loadPyodide } = await import(s.base + 'pyodide.mjs');
          py = await loadPyodide({ indexURL: s.base });
          source = s;
          break;
        } catch (err) {
          lastErr = err;
          py = null;
        }
      }
      if (!py) throw lastErr;
      py.setStdout({ batched: s => out('stdout', s) });
      py.setStderr({ batched: s => out('stderr', s) });
      py.setStdin({ error: true });
      status('loading', 'Laster numpy, OpenCV og matplotlib …');
      await py.loadPackage(['numpy', 'opencv-python', 'matplotlib'], { messageCallback: () => {} });
      py.registerJsModule('_fargelab_bro', {
        bilde(b64, title, window, mouse) { flush(); postMessage({ type: 'image', b64, title, window: !!window, mouse: !!mouse }); },
        widget(json) { flush(); postMessage({ type: 'widget', op: JSON.parse(json) }); }
      });
      // ipywidgets.py og IPython/ legges i /fargelab, som oppstartskoden setter først i sys.path
      py.FS.mkdirTree('/fargelab/IPython');
      for (const [name, src] of Object.entries(MODULES)) py.FS.writeFile('/fargelab/' + name, src);
      status('loading', 'Starter OpenCV og matplotlib …');
      await py.runPythonAsync(PRELUDE, { filename: '<oppsett for nettleseren>' });
      runCell = py.globals.get('_fargelab_celle');
      widgetEvent = py.globals.get('_fargelab_widget_event');
      listVars = py.globals.get('_fargelab_variabler');
      const versions = py.runPython(
        'import sys, cv2, numpy\n' +
        'f"Python {sys.version.split()[0]}, OpenCV {cv2.__version__} og numpy {numpy.__version__}"');
      status('ready', `Python er klar: ${versions}. Lastet fra ${source.name}.`);
      listFiles();
    })();
    ready.catch(err => status('failed',
      `Python kunne ikke startes (${err && err.message || err}). Start siden med en lokal webserver (python -m http.server), eller koble til internett så Pyodide kan hentes fra cdn.jsdelivr.net.`));

    self.onmessage = async e => {
      const m = e.data;
      try {
        await ready;
      } catch (_) {
        if (m.type === 'run') postMessage({ type: 'done', ok: false, error: 'Python er ikke startet. Se meldingen øverst.', ms: 0 });
        return;
      }
      if (m.type === 'file') {
        py.FS.writeFile(m.name, new Uint8Array(m.data));
        if (m.folder) fromFolder.set(m.name, py.FS.stat(m.name).mtime.getTime());
        else fromFolder.delete(m.name);
        listFiles();
      } else if (m.type === 'remove') {
        try { py.FS.unlink(m.name); } catch (_) { /* finnes ikke */ }
        fromFolder.delete(m.name);
        listFiles();
      } else if (m.type === 'read') {
        let data = null;
        try { data = py.FS.readFile(m.name); } catch (_) { /* filen er borte */ }
        postMessage({ type: 'fileData', name: m.name, purpose: m.purpose, data }, data ? [data.buffer] : []);
      } else if (m.type === 'reset') {
        if (nbGlobals) { nbGlobals.destroy(); nbGlobals = null; }
      } else if (m.type === 'vars') {
        // Variabler-panelet: variablene i notatboken, eller fra siste kjøring av et skript
        const ns = m.scope === 'script' ? scriptNs : nbGlobals;
        let list = [], error = null;
        try {
          if (ns) list = JSON.parse(listVars(ns, !!m.all, m.remove || null));
        } catch (err) {
          error = String(err && err.message || err).trim().split('\n').pop();
        }
        postMessage({ type: 'vars', ready: true, list, error });
      } else if (m.type === 'run') {
        lines = 0;
        cut = false;
        const t0 = performance.now();
        let ns = null, error = null;
        try {
          if (m.mode === 'event') {
            // Du har endret en widget: Python kaller observe- og on_click-funksjonene
            widgetEvent(m.event.id, m.event.kind, m.event.value === undefined ? null : m.event.value);
          } else {
            // Pakker skriptet importerer (for eksempel scipy) lastes ved behov
            await py.loadPackagesFromImports(m.code, { messageCallback: () => {}, errorCallback: s => out('stderr', s) });
            // fargelab.py lages på nytt hver gang, med verdiene fra Fargelab-fanen
            py.FS.writeFile('/fargelab/fargelab.py', m.module);
            // reload oppdaterer modulen der den er, så celler som har importert den, får de nye verdiene
            await py.runPythonAsync('import sys, importlib\nif "fargelab" in sys.modules:\n    importlib.reload(sys.modules["fargelab"])');
            if (m.mode === 'cell') {
              // En celle i notatboken: samme navnerom hver gang, og verdien av siste uttrykk vises
              if (!nbGlobals) {
                nbGlobals = py.globals.get('dict')();
                nbGlobals.set('__name__', '__main__');
              }
              const value = await runCell(m.code, nbGlobals, m.filename);
              if (typeof value === 'string') { flush(); postMessage({ type: 'result', text: value }); }
            } else {
              // Hvert skript får et nytt, tomt navnerom, som når du kjører python skript.py
              ns = py.globals.get('dict')();
              ns.set('__name__', '__main__');
              await py.runPythonAsync(m.code, { globals: ns, filename: m.filename });
            }
          }
        } catch (err) {
          error = cleanTraceback(err && err.message || err, m.filename);
        } finally {
          try { await py.runPythonAsync('_fargelab_vis_figurer()'); } catch (_) { /* ingen figurer */ }
          // Variablene fra skriptet tas vare på til neste kjøring, så Variabler-panelet kan vise dem
          if (ns) {
            if (scriptNs) scriptNs.destroy();
            scriptNs = ns;
          }
        }
        flush();
        postMessage({ type: 'done', ok: !error, error, ms: performance.now() - t0 });
        listFiles();
      }
    };
  }

  /* ---------- Fanen ---------- */
  const NEW_SCRIPT = `import cv2
import numpy as np

img = cv2.imread("eksempel.png")
cv2.imshow("eksempel.png", img)
`;
  const LAST_FILE_KEY = 'fargelab.python.sistefil';
  const MIGRATED_KEY = 'fargelab.python.flyttet-til-skript';
  const MAX_SYNC_BYTES = 100 * 1024 * 1024;   // større filer i bilder/ legges ikke i Python-mappen

  function create(cfg) {
    const $ = id => document.getElementById(id);
    const Mapper = root.Mapper;
    const panel = $('panelPy');
    const runBtn = $('pyRun'), stopBtn = $('pyStop'), clearBtn = $('pyClear');
    const exampleSel = $('pyExamples'), openBtn = $('pyOpen'), openInput = $('pyOpenFile'), saveBtn = $('pySave');
    const statusEl = $('pyStatus'), statusText = $('pyStatusText');
    const outEl = $('pyOut'), filesEl = $('pyFiles'), addBtn = $('pyAddFiles'), fileInput = $('pyFileInput');
    // Filer-vinduet og knappen øverst til høyre som åpner det
    const filesDialog = $('pyFilesDialog'), filesBtn = $('pyFilesBtn'), filesCount = $('pyFilesCount');
    const filesClose = $('pyFilesClose'), filesMsg = $('pyFilesMsg');
    const title = $('hPyEd'), ta = $('pyCode'), grid = $('pyGrid'), nbHost = $('pyNotebook'), msgEl = $('pyMsg');
    const nbRestartBtn = $('pyNbRestart'), nbClearBtn = $('pyNbClear');
    // Fillinjen over editoren og merknadene (brukes med server.py)
    const fileBar = $('pyFileBar'), fileSel = $('pyFileSel'), fileState = $('pyFileState');
    const newBtn = $('pyNew'), saveFileBtn = $('pySaveFile'), renameBtn = $('pyRename'), deleteBtn = $('pyDelete');
    const folderNote = $('pyFolderNote'), filesCaption = $('pyFilesCaption'), filesFolderCaption = $('pyFilesFolderCaption');
    // Variabler-panelet til høyre, og knappen som åpner det
    const varsPanel = $('pyVars'), varsBtn = $('pyVarsBtn'), varsClose = $('pyVarsClose');
    const varsAll = $('pyVarsAll'), varsList = $('pyVarsList'), varsScope = $('pyVarsScope'), varsCount = $('pyVarsCount');
    let varsTimer = 0, varsBusy = false, varsAgain = false;

    let worker = null, workerState = 'idle', started = false, cm = null;
    let running = false, runStart = 0;
    let fileList = [];
    const files = new Map();       // filer du har lagt til uten server.py: navn → bytes

    // Med server.py: skript/ og bilder/ i prosjektet
    let folders = false;
    let scripts = [];              // filene i skript/: [{ navn, storrelse, mtime }]
    // Filen som er åpen. kind er 'py' (skript) eller 'ipynb' (notatbok).
    let doc = { name: 'skript.py', kind: 'py', mtime: null, isNew: true, saved: '' };
    let notebook = null;           // notatboken (notatbok.js), lages lenger ned
    const kindOf = name => (/\.ipynb$/i.test(name) ? 'ipynb' : 'py');
    const bilderSent = new Map();  // filer fra bilder/ som ligger i Python-mappen: navn → mtime
    let bilderNames = [];          // navnene i bilder/ (til fargelab.bilder)

    function setStatus(state, text) {
      workerState = state;
      statusEl.dataset.state = state;
      statusText.textContent = text;
      if (state === 'ready' || state === 'failed') refreshVars();
    }
    const fmtSec = ms => (ms / 1000).toLocaleString('nb-NO', { maximumFractionDigits: 2 }) + ' s';
    const fmtSize = n => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toLocaleString('nb-NO', { maximumFractionDigits: 1 })} kB`
      : `${(n / 1048576).toLocaleString('nb-NO', { maximumFractionDigits: 1 })} MB`;
    const store = (key, value) => { try { root.localStorage.setItem(key, value); } catch (_) { /* privat vindu */ } };
    const recall = key => { try { return root.localStorage.getItem(key); } catch (_) { return null; } };

    /* ---------- Dialoger ---------- */
    // ask({ title, text, input, buttons: [{ label, value, primary, danger }], validate })
    // gir { value, input }. value er null hvis du trykker Esc. validate(tekst) gir en
    // feilmelding eller null, og sjekkes bare for hovedknappen.
    const dlg = $('pyDialog'), dlgTitle = $('pyDialogTitle'), dlgText = $('pyDialogText');
    const dlgField = $('pyDialogField'), dlgInput = $('pyDialogInput'), dlgErr = $('pyDialogErr'), dlgBtns = $('pyDialogBtns');
    let dlgQueue = Promise.resolve();
    function ask(opts) {
      const p = dlgQueue.then(() => showDialog(opts));   // én dialog om gangen
      dlgQueue = p.catch(() => {});
      return p;
    }
    function showDialog({ title: heading, text, input, buttons, validate }) {
      return new Promise(resolve => {
        const prevFocus = document.activeElement;
        const primary = buttons.find(b => b.primary) || buttons[0];
        dlgTitle.textContent = heading;
        dlgText.textContent = text || '';
        dlgText.hidden = !text;
        dlgField.hidden = input === undefined;
        dlgInput.value = input === undefined ? '' : input;
        dlgErr.hidden = true;
        dlgBtns.textContent = '';
        let done = false;
        const finish = value => {
          if (done) return;
          if (value !== null && validate && value === primary.value) {
            const err = validate(dlgInput.value);
            if (err) { dlgErr.textContent = err; dlgErr.hidden = false; dlgInput.focus(); return; }
          }
          done = true;
          dlg.removeEventListener('cancel', onCancel);
          dlgInput.onkeydown = null;
          dlg.close();
          if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true });
          resolve({ value, input: dlgInput.value.trim() });
        };
        const onCancel = e => { e.preventDefault(); finish(null); };
        dlg.addEventListener('cancel', onCancel);
        buttons.forEach(b => {
          const el = document.createElement('button');
          el.type = 'button';
          el.className = 'btn' + (b.primary ? ' btn-primary' : '') + (b.danger ? ' btn-danger' : '');
          el.textContent = b.label;
          el.dataset.value = b.value;
          el.addEventListener('click', () => finish(b.value));
          dlgBtns.appendChild(el);
        });
        dlgInput.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); finish(primary.value); } };
        dlg.showModal();
        if (input !== undefined) {
          dlgInput.focus();
          const dot = dlgInput.value.lastIndexOf('.');
          dlgInput.setSelectionRange(0, dot > 0 ? dot : dlgInput.value.length);
        } else {
          (dlgBtns.querySelector('.btn-primary') || dlgBtns.firstElementChild).focus();
        }
      });
    }
    const showError = (heading, text) => ask({ title: heading, text, buttons: [{ label: 'OK', value: 'ok', primary: true }] });

    /* ---------- Editoren ---------- */
    ta.value = recall(STORE_KEY) !== null ? recall(STORE_KEY) : EXAMPLES[0].code;
    const getCode = () => (cm ? cm.getValue() : ta.value);
    const isNotebook = () => folders && doc.kind === 'ipynb' && !!notebook;
    const dirty = () => folders && (doc.kind === 'ipynb' ? doc.isNew || (!!notebook && notebook.dirty()) : getCode() !== doc.saved);

    let draftTimer = 0;
    function onEdit() {
      if (folders) { updateFileState(); return; }
      // Uten server.py lagres skriptet i nettleseren mens du skriver
      clearTimeout(draftTimer);
      draftTimer = setTimeout(() => store(STORE_KEY, getCode()), 300);
    }
    function setCode(code) {
      if (cm) { cm.setValue(code); cm.clearHistory(); } else ta.value = code;
      onEdit();
    }
    const focusEditor = () => (cm ? cm.focus() : ta.focus());

    // Vanlig tekstfelt (før CodeMirror er lastet, eller hvis den ikke kan lastes)
    ta.addEventListener('input', onEdit);
    ta.addEventListener('keydown', e => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 'Enter') {
        e.preventDefault();
        run();
      } else if (mod && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        saveDoc();
      } else if (e.key === 'Tab' && !e.shiftKey && !mod && !e.altKey) {
        e.preventDefault();
        if (!document.execCommand('insertText', false, '    ')) ta.setRangeText('    ', ta.selectionStart, ta.selectionEnd, 'end');
        onEdit();
      } else if (e.key === 'Escape') {
        runBtn.focus();
      }
    });

    const loadScript = src => new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('kunne ikke laste ' + src));
      document.head.appendChild(s);
    });
    // Laster CodeMirror fra lib/codemirror, eller fra cdnjs hvis filene mangler
    async function loadCodeMirror() {
      let lastErr = null;
      for (const base of CM_SOURCES) {
        try {
          if (!root.CodeMirror) await loadScript(base + 'codemirror.min.js');
          await Promise.all(['mode/python/python.min.js', 'addon/edit/matchbrackets.min.js',
            'addon/edit/closebrackets.min.js', 'addon/comment/comment.min.js'].map(p => loadScript(base + p)));
          const css = document.createElement('link');
          css.rel = 'stylesheet';
          css.href = base + 'codemirror.min.css';
          document.head.appendChild(css);
          return;
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr;
    }
    // Én innlasting, som både skripteditoren og cellene i notatboken venter på
    let cmPromise = null;
    const codeMirror = () => cmPromise || (cmPromise = loadCodeMirror().then(() => root.CodeMirror || null, () => null));
    async function loadEditor() {
      try {
        if (!(await codeMirror())) throw new Error('CodeMirror finnes ikke');
        const hadFocus = document.activeElement === ta;
        cm = root.CodeMirror.fromTextArea(ta, {
          mode: 'python',
          theme: 'fargelab',
          lineNumbers: true,
          indentUnit: 4,
          tabSize: 4,
          indentWithTabs: false,
          matchBrackets: true,
          autoCloseBrackets: true,
          viewportMargin: 20,
          extraKeys: {
            'Ctrl-Enter': () => run(),
            'Cmd-Enter': () => run(),
            'Ctrl-S': () => saveDoc(),
            'Cmd-S': () => saveDoc(),
            'Ctrl-/': 'toggleComment',
            'Cmd-/': 'toggleComment',
            Tab: c => (c.somethingSelected() ? c.indentSelection('add') : c.execCommand('insertSoftTab')),
            'Shift-Tab': c => c.indentSelection('subtract'),
            Esc: () => runBtn.focus()
          }
        });
        cm.getInputField().setAttribute('aria-label', 'Python-kode');
        cm.on('change', onEdit);
        if (hadFocus) cm.focus();
      } catch (err) {
        console.warn('CodeMirror kunne ikke lastes, bruker et vanlig tekstfelt:', err);
      }
    }

    /* ---------- Skript i mappen skript/ ---------- */
    // «navn» blir «navn.py» eller «navn.ipynb», avhengig av hva slags fil det er
    const withExt = (v, kind) => {
      const ext = kind === 'ipynb' ? '.ipynb' : '.py';
      v = v.trim();
      return v.toLowerCase().endsWith(ext) ? v : v.replace(/\.(py|ipynb)$/i, '') + ext;
    };
    const taken = except => scripts.map(f => f.navn).filter(n => n !== except);
    let stateNote = '';

    function updateFileState() {
      if (!folders) return;
      const d = dirty();
      fileState.dataset.dirty = d ? 'true' : 'false';
      fileState.textContent = d ? '● Ikke lagret' : stateNote || (doc.isNew ? '' : 'Lagret i skript/');
      if (d) stateNote = '';
    }
    function note(text) { stateNote = text; updateFileState(); }

    function renderFileSel() {
      fileSel.textContent = '';
      const add = (label, value) => {
        const o = document.createElement('option');
        o.value = value;
        o.textContent = label;
        fileSel.appendChild(o);
      };
      if (doc.isNew) add(`${doc.name} (ikke lagret ennå)`, '\u0000ny');
      scripts.forEach(f => add(f.navn, f.navn));
      fileSel.value = doc.isNew ? '\u0000ny' : doc.name;
    }
    async function refreshScripts() {
      scripts = (await Mapper.list('skript')).filter(f => /\.(py|ipynb)$/i.test(f.navn) && (notebook || kindOf(f.navn) === 'py'));
      renderFileSel();
    }

    // Viser filen: skript i editoren, eller notatbok som celler
    async function loadDoc(d, text) {
      d.kind = kindOf(d.name);
      if (d.kind === 'ipynb') {
        await notebook.load(text);   // kaster en feil hvis filen ikke er en notatbok
        // En annen notatbok får et nytt, tomt navnerom
        if (doc.kind !== 'ipynb' || doc.name !== d.name) resetKernel();
      } else if (cm) {
        cm.setValue(text);
        cm.clearHistory();
      } else {
        ta.value = text;
      }
      doc = d;
      stateNote = '';
      showMode();
      renderFileSel();
      updateFileState();
    }
    const newDoc = (name, text) => loadDoc({ name, mtime: null, isNew: true, saved: '' }, text);

    // Har filen endringer som ikke er lagret, spør vi først. Gir true hvis vi kan gå videre.
    async function confirmLeave() {
      if (!dirty()) return true;
      const r = await ask({
        title: 'Lagre endringene?',
        text: `${doc.name} har endringer som ikke er lagret.`,
        buttons: [{ label: 'Lagre', value: 'save', primary: true }, { label: 'Ikke lagre', value: 'discard' }, { label: 'Avbryt', value: 'cancel' }]
      });
      if (r.value === 'save') return saveDoc();
      return r.value === 'discard';
    }

    async function openScript(name, { ask: askFirst = true } = {}) {
      if (askFirst && !(await confirmLeave())) { renderFileSel(); return false; }
      try {
        const { text, mtime } = await Mapper.readText('skript', name);
        await loadDoc({ name, mtime, isNew: false, saved: text }, text);
        store(LAST_FILE_KEY, name);
        return true;
      } catch (err) {
        await showError('Kunne ikke åpne filen', `${name}: ${err.message}`);
        await refreshScripts().catch(() => {});
        return false;
      }
    }

    async function askName({ heading, text, value, okLabel, except, kind = doc.kind }) {
      const withPy = v => withExt(v, kind);
      const r = await ask({
        title: heading, text, input: value,
        buttons: [{ label: okLabel, value: 'ok', primary: true }, { label: 'Avbryt', value: 'cancel' }],
        validate: v => {
          const n = withPy(v);
          const err = Mapper.nameError(n);
          if (err) return err;
          if (taken(except).some(t => t.toLowerCase() === n.toLowerCase())) return `${n} finnes allerede i skript/.`;
          return null;
        }
      });
      return r.value === 'ok' ? withPy(r.input) : null;
    }

    // Bare én lagring om gangen: trykker du Ctrl+S mens den forrige pågår, venter du på den
    let saving = null;
    function saveDoc() {
      if (!saving) saving = doSave().finally(() => { saving = null; });
      return saving;
    }
    async function doSave() {
      if (!folders) {
        appendInfo('Skriptet lagres automatisk i nettleseren. Start siden med python server.py for å lagre det i mappen skript/, eller bruk Lagre .py.');
        return false;
      }
      const text = doc.kind === 'ipynb' ? notebook.toJSON() : getCode();
      let name = doc.name;
      if (doc.isNew) {
        name = await askName({
          heading: doc.kind === 'ipynb' ? 'Lagre notatboken' : 'Lagre skriptet',
          text: 'Filen lagres i mappen skript/ i prosjektet.', value: name, okLabel: 'Lagre'
        });
        if (!name) return false;
      }
      try {
        const info = await Mapper.write('skript', name, text, { mtime: doc.isNew ? 'ny' : doc.mtime });
        doc = { name, kind: doc.kind, mtime: info.mtime, isNew: false, saved: text };
        if (doc.kind === 'ipynb') notebook.markSaved();
        title.textContent = name;
        store(LAST_FILE_KEY, name);
        await refreshScripts();
        note(`Lagret ${new Date().toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`);
        return true;
      } catch (err) {
        if (err.status === 409 && err.info.feil === 'endret') {
          const r = await ask({
            title: 'Filen er endret på disken',
            text: `${name} er endret utenfor appen etter at du åpnet den, for eksempel i en annen editor.`,
            buttons: [{ label: 'Overskriv', value: 'over', primary: true }, { label: 'Last inn fra disken', value: 'load' }, { label: 'Avbryt', value: 'cancel' }]
          });
          if (r.value === 'over') { doc.mtime = err.info.mtime; return doSave(); }
          if (r.value === 'load') await openScript(name, { ask: false });
          return false;
        }
        if (err.status === 409 && err.info.feil === 'finnes') {
          await showError('Navnet er tatt', err.message);
          await refreshScripts().catch(() => {});
          return doSave();
        }
        await showError('Kunne ikke lagre', err.message);
        return false;
      }
    }

    async function newScript() {
      if (!(await confirmLeave())) return;
      let kind = 'py';
      if (notebook) {
        const t = await ask({
          title: 'Ny fil', text: 'Hva vil du lage i mappen skript/?',
          buttons: [{ label: 'Skript (.py)', value: 'py', primary: true }, { label: 'Notatbok (.ipynb)', value: 'ipynb' }, { label: 'Avbryt', value: 'cancel' }]
        });
        if (t.value !== 'py' && t.value !== 'ipynb') return;
        kind = t.value;
      }
      const name = await askName({
        heading: kind === 'ipynb' ? 'Ny notatbok' : 'Nytt skript', text: 'Filen lages i mappen skript/ i prosjektet.',
        value: Mapper.uniqueName(kind === 'ipynb' ? 'ny_notatbok.ipynb' : 'nytt_skript.py', taken()), okLabel: 'Lag filen', kind
      });
      if (!name) return;
      const content = kind === 'ipynb' ? root.Notatbok.template() : NEW_SCRIPT;
      try {
        const info = await Mapper.write('skript', name, content, { mtime: 'ny' });
        await refreshScripts();
        await loadDoc({ name, mtime: info.mtime, isNew: false, saved: content }, content);
        store(LAST_FILE_KEY, name);
        if (kind === 'ipynb') notebook.focus(); else focusEditor();
      } catch (err) {
        await showError('Kunne ikke lage filen', err.message);
      }
    }

    async function renameScript() {
      const name = await askName({
        heading: 'Gi nytt navn', text: `Nytt navn på ${doc.name}:`, value: doc.name,
        okLabel: 'Gi nytt navn', except: doc.isNew ? undefined : doc.name
      });
      if (!name || name === doc.name) return;
      if (doc.isNew) { doc.name = name; title.textContent = name; renderFileSel(); return; }
      try {
        const info = await Mapper.rename('skript', doc.name, name);
        doc.name = name;
        doc.mtime = info.mtime;
        title.textContent = name;
        store(LAST_FILE_KEY, name);
        await refreshScripts();
        note(`Fikk navnet ${name}`);
      } catch (err) {
        await showError('Kunne ikke gi nytt navn', err.message);
      }
    }

    async function deleteScript() {
      if (doc.isNew) {
        if (!(await confirmLeave())) return;
      } else {
        const r = await ask({
          title: `Slette ${doc.name}?`,
          text: 'Filen flyttes til skript/.papirkurv/, så du kan hente den tilbake senere.',
          buttons: [{ label: 'Slett', value: 'del', danger: true }, { label: 'Avbryt', value: 'cancel', primary: true }]
        });
        if (r.value !== 'del') return;
        try {
          await Mapper.remove('skript', doc.name);
        } catch (err) {
          await showError('Kunne ikke slette', err.message);
          return;
        }
      }
      await refreshScripts().catch(() => {});
      if (scripts.length) await openScript(scripts[0].navn, { ask: false });
      else await newDoc('nytt_skript.py', NEW_SCRIPT);
    }

    // Når du kommer tilbake til siden: les inn filen på nytt hvis den er endret på disken
    async function checkDisk() {
      if (!folders || panel.hidden || doc.isNew) return;
      try {
        await refreshScripts();
        const f = scripts.find(s => s.navn === doc.name);
        if (!f) {
          doc = { ...doc, isNew: true, mtime: null, saved: '' };
          renderFileSel();
          note('');
          updateFileState();
          appendInfo(`${doc.name} finnes ikke lenger i skript/. Trykk Lagre for å lage den på nytt.`);
        } else if (f.mtime !== doc.mtime && !dirty()) {
          const { text, mtime } = await Mapper.readText('skript', doc.name);
          await loadDoc({ ...doc, mtime, saved: text }, text);
          note('Lest inn på nytt fra disken');
        }
      } catch (_) { /* serveren er stoppet */ }
    }

    // Bytter mellom de to måtene å jobbe på: med mappene (server.py) eller i nettleseren
    function applyMode() {
      fileBar.hidden = !folders;
      folderNote.hidden = folders;
      openBtn.hidden = saveBtn.hidden = folders;
      filesCaption.hidden = folders;
      filesFolderCaption.hidden = !folders;
    }

    async function initFolders() {
      folders = !!Mapper && await Mapper.available();
      if (folders) {
        try {
          await refreshScripts();
        } catch (_) {
          folders = false;
        }
      }
      applyMode();
      if (!folders) return;
      doc.saved = getCode();   // det som står i editoren nå, skal ikke gi spørsmål

      // Skriptet du skrev i nettleseren før mappene fantes, lagres som en fil én gang
      const legacy = recall(MIGRATED_KEY) ? null : recall(STORE_KEY);
      store(MIGRATED_KEY, '1');
      if (legacy && legacy.trim() && !EXAMPLES.some(ex => ex.code.trim() === legacy.trim())) {
        const name = Mapper.uniqueName('fra_nettleseren.py', taken());
        try {
          await Mapper.write('skript', name, legacy, { mtime: 'ny' });
          await refreshScripts();
          await openScript(name, { ask: false });
          note(`Skriptet fra nettleseren er lagret som skript/${name}`);
          return;
        } catch (_) { /* åpner en annen fil under */ }
      }
      const last = recall(LAST_FILE_KEY);
      const pick = scripts.find(f => f.navn === last) || scripts[0];
      if (pick) await openScript(pick.navn, { ask: false });
      else await newDoc('kom_i_gang.py', EXAMPLES[0].code);
    }

    // Skript: editor og Utdata ved siden av hverandre. Notatbok: cellene under hverandre.
    function showMode() {
      const nb = isNotebook();
      grid.hidden = nb;
      nbHost.hidden = !nb;
      nbRestartBtn.hidden = nbClearBtn.hidden = !nb;
      runBtn.innerHTML = nb ? '▶ Kjør alle' : '▶ Kjør <kbd>Ctrl+Enter</kbd>';
      runBtn.title = nb ? 'Kjør alle cellene ovenfra og ned. Stopper ved første feil.' : 'Kjør skriptet (Ctrl+Enter)';
      title.textContent = doc.name;
      if (nb) notebook.refresh();
      else if (cm) cm.refresh();
      refreshVars();   // notatbok og skript har hvert sitt navnerom
    }

    /* ---------- Utdata ---------- */
    function showEmpty() {
      outEl.innerHTML = '<p class="py-empty">Trykk Kjør for å kjøre skriptet. Det du skriver ut med <code>print()</code> havner her, og <code>cv2.imshow</code> og <code>plt.show()</code> viser bildene her.</p>';
    }
    showEmpty();
    const clearOutput = () => { outEl.textContent = ''; };
    const scrollOut = () => { outEl.scrollTop = outEl.scrollHeight; };

    // Utdata fra skript havner under Utdata. Hver celle i en notatbok har sin egen mottaker.
    const scriptSink = {
      pending: false,
      add(item) {
        if (outEl.querySelector('.py-empty') || this.pending) { clearOutput(); this.pending = false; }
        const el = root.Utdata.append(outEl, item);
        const img = el && el.querySelector && el.querySelector('img');
        if (img) img.addEventListener('load', scrollOut);
        scrollOut();
      },
      // clear_output() fra Python. wait: tøm først når noe nytt kommer (hindrer blinking).
      clear(wait) { if (wait) this.pending = true; else clearOutput(); }
    };
    let sink = scriptSink;

    /* ---------- Widgets (ipywidgets i widgets-py.js, tegnes av widgets.js) ---------- */
    // Utdata går til sink. Inne i en with-blokk med en Output-widget går de til den,
    // og sinkStack husker hvor de skal tilbake etterpå.
    let sinkStack = [];
    function widgetOp(op) {
      const W = root.Widgets;
      if (!W) return;
      if (op.op === 'display') {
        // Hendelser fra widgeten får utdata samme sted som widgeten ble vist
        const owner = sink;
        sink.add({ type: 'widget', view: op.view, send: ev => sendEvent(ev, owner) });
      } else if (op.op === 'update') {
        W.update(op.id, op.props);
      } else if (op.op === 'target') {
        sinkStack.push(sink);
        sink = W.outputSink(op.id);
      } else if (op.op === 'untarget') {
        if (sinkStack.length) sink = sinkStack.pop();
      } else if (op.op === 'clear') {
        if (op.id) W.clearOutput(op.id, op.wait);
        else if (sink.clear) sink.clear(op.wait);
      } else if (op.op === 'text') {
        sink.add({ type: 'result', text: op.text });
      } else if (op.op === 'close') {
        W.close(op.id);
      }
    }

    // Sender en endring til Python. Drar du i en glidebryter eller beveger musen over
    // et bilde, kommer det mange hendelser tett. Venter den forrige på tur, får den
    // bare den nyeste verdien (eller posisjonen). Klikk slås aldri sammen.
    const waitingEvents = new Map();   // widget og type → siste hendelse i køen som ikke har startet
    let outputSeq = 0;                 // øker for hver melding med utdata fra Python
    function sendEvent(ev, owner) {
      const key = ev.id + ':' + ev.kind;
      const merge = ev.kind === 'value' || (ev.kind === 'mouse' && ev.value[0] === 0);
      const waiting = waitingEvents.get(key);
      if (merge && waiting && waiting.merge) { waiting.event.value = ev.value; return; }
      const entry = { event: { ...ev }, merge };
      waitingEvents.set(key, entry);
      let seq = 0;
      const onStart = () => {
        if (waitingEvents.get(key) === entry) waitingEvents.delete(key);
        seq = outputSeq;
      };
      execute({ mode: 'event', event: entry.event, target: owner, onStart }).then(m => {
        if (m.error) owner.add({ type: 'error', text: m.error });
        // Notatboken er bare endret hvis det kom nye utdata, ikke når du bare beveger musen
        if (isNotebook() && (m.error || outputSeq !== seq)) notebook.touch();
      });
    }

    // Meldinger fra appen (lagret, lagt til osv.): under Utdata for skript, og i en
    // linje over cellene for notatbøker
    let msgTimer = 0;
    function appendInfo(text) {
      if (!isNotebook()) { scriptSink.add({ type: 'info', text }); return; }
      msgEl.textContent = text;
      msgEl.hidden = false;
      clearTimeout(msgTimer);
      msgTimer = setTimeout(() => { msgEl.hidden = true; }, 8000);
    }

    /* ---------- Filer i Python-mappen ---------- */
    const cleanName = n => (String(n || 'fil').replace(/[\\/:*?"<>|]+/g, '_').replace(/^\.+/, '') || 'fil');

    // Melding i Filer-vinduet (vises bare mens det er åpent, ellers holder appendInfo)
    function filesNote(text) {
      filesMsg.textContent = text;
      filesMsg.hidden = !text || !filesDialog.open;
    }

    function renderFiles(list) {
      fileList = list;
      filesCount.hidden = false;
      filesCount.textContent = String(list.length);
      filesBtn.setAttribute('aria-label', `Filer (${list.length})`);
      filesEl.textContent = '';
      if (!list.length) {
        const li = document.createElement('li');
        li.className = 'py-files-empty';
        li.textContent = 'Ingen filer.';
        filesEl.appendChild(li);
        return;
      }
      const fromLab = cfg.context ? cfg.context().bilde : null;
      list.forEach(f => {
        // Har et skript endret en fil fra bilder/, legges originalen inn igjen før neste kjøring
        if (f.changed) bilderSent.delete(f.name);
        const li = document.createElement('li');
        const name = document.createElement('span');
        name.className = 'num py-file-name';
        name.textContent = f.name;
        const meta = document.createElement('span');
        meta.className = 'py-file-meta';
        const where = f.folder ? (f.changed ? 'fra bilder/, endret av skriptet' : 'fra bilder/')
          : f.name === fromLab ? 'fra Fargelab' : f.name === 'testbilde.png' ? 'følger med' : '';
        meta.textContent = fmtSize(f.size) + (where ? ' · ' + where : '');
        li.append(name, meta);
        if (folders && (!f.folder || f.changed)) {
          li.appendChild(fileButton('Lagre i bilder/', `Lagre ${f.name} i mappen bilder/`, () => worker && worker.postMessage({ type: 'read', name: f.name, purpose: 'bilder' })));
        }
        li.appendChild(fileButton('Last ned', `Last ned ${f.name}`, () => worker && worker.postMessage({ type: 'read', name: f.name, purpose: 'download' })));
        filesEl.appendChild(li);
      });
    }
    function fileButton(label, aria, onClick) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn';
      b.textContent = label;
      b.setAttribute('aria-label', aria);
      b.addEventListener('click', onClick);
      return b;
    }

    function download(name, data) {
      if (!data) return;
      const url = URL.createObjectURL(new Blob([data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    // Lagrer en fil i bilder/. Navnet endres hvis det er tatt, så ingenting blir overskrevet.
    async function saveToBilder(name, data) {
      try {
        const list = await Mapper.list('bilder');
        const navn = Mapper.uniqueName(cleanName(name), list.map(f => f.navn));
        await Mapper.write('bilder', navn, data, { mtime: 'ny' });
        appendInfo(`Lagret som bilder/${navn}.`);
        filesNote(`Lagret som bilder/${navn}.`);
        await syncBilder();
        return navn;
      } catch (err) {
        await showError('Kunne ikke lagre i bilder/', err.message);
        return null;
      }
    }

    function sendFile(name, bytes) {
      const copy = bytes.slice();
      worker.postMessage({ type: 'file', name, data: copy.buffer }, [copy.buffer]);
    }
    // Legger en fil i Python-mappen og gir filnavnet med en gang (lesingen skjer i bakgrunnen).
    // Filer fra bilder/ kommer dit av seg selv og lagres ikke på nytt.
    function addFile(file, { fromFolder = false } = {}) {
      const name = cleanName(file.name);
      if (fromFolder) return name;
      file.arrayBuffer().then(buffer => {
        const bytes = new Uint8Array(buffer);
        files.set(name, bytes);
        if (worker) sendFile(name, bytes);
      });
      return name;
    }

    // «Legg til filer» og filer du slipper på fanen: i bilder/ med server.py, ellers bare i Python-mappen
    async function addUserFiles(list) {
      activate();
      if (!folders) { list.forEach(f => addFile(f)); return; }
      let names;
      try { names = (await Mapper.list('bilder')).map(f => f.navn); } catch (_) { names = []; }
      const saved = [];
      for (const f of list) {
        const navn = Mapper.uniqueName(cleanName(f.name), names);
        try {
          await Mapper.write('bilder', navn, await f.arrayBuffer(), { mtime: 'ny' });
          names.push(navn);
          saved.push(navn);
        } catch (err) {
          await showError('Kunne ikke lagre filen', `${f.name}: ${err.message}`);
        }
      }
      if (saved.length) {
        appendInfo(`Lagt i bilder/: ${saved.join(', ')}.`);
        filesNote(`Lagt i bilder/: ${saved.join(', ')}.`);
      }
      await syncBilder();
    }

    // Legger filene i bilder/ i Python-mappen, så cv2.imread('navn.png') virker uten sti.
    // Bare nye og endrede filer sendes, og filer som er fjernet fra bilder/, fjernes også.
    let syncing = Promise.resolve();
    function syncBilder() {
      syncing = syncing.then(doSync, doSync);
      return syncing;
    }
    async function doSync() {
      if (!folders || !worker) return;
      let list;
      try { list = await Mapper.list('bilder'); } catch (_) { return; }
      bilderNames = list.map(f => f.navn);
      for (const f of list) {
        if (bilderSent.get(f.navn) === f.mtime || f.storrelse > MAX_SYNC_BYTES) continue;
        try {
          const { data, mtime } = await Mapper.read('bilder', f.navn);
          if (!worker) return;
          worker.postMessage({ type: 'file', name: f.navn, data, folder: true }, [data]);
          bilderSent.set(f.navn, mtime);
        } catch (_) { /* filen forsvant underveis */ }
      }
      const present = new Set(bilderNames);
      for (const navn of Array.from(bilderSent.keys())) {
        if (!present.has(navn)) {
          if (worker) worker.postMessage({ type: 'remove', name: navn });
          bilderSent.delete(navn);
        }
      }
    }

    /* ---------- Workeren ---------- */
    function startWorker() {
      // Workeren lages fra en blob og kan ikke løse opp relative adresser selv
      const sources = PYODIDE_SOURCES.map(s => ({ ...s, base: new URL(s.base, document.baseURI).href }));
      const modules = root.FargelabPythonModuler || {};
      const src = `(${workerMain})(${JSON.stringify(sources)}, ${JSON.stringify(PRELUDE)}, ${JSON.stringify(modules)});`;
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      try {
        worker = new Worker(url, { type: 'module' });
      } catch (err) {
        worker = null;
        setStatus('failed', `Nettleseren kunne ikke starte Python i bakgrunnen (${err.message}).`);
        return;
      }
      worker.onmessage = onMessage;
      worker.onerror = e => {
        e.preventDefault();
        setStatus('failed', `Python stoppet med en feil: ${e.message || 'ukjent feil'}. Nettleseren må støtte modul-workere.`);
        if (running) finishRun({ ok: false, error: null, stopped: true, ms: performance.now() - runStart });
        dropVars();
      };
      bilderSent.clear();
      files.forEach((bytes, name) => sendFile(name, bytes));
      syncBilder();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }

    function onMessage(e) {
      const m = e.data;
      if (m.type === 'out' || m.type === 'image' || m.type === 'result' || m.type === 'widget') outputSeq++;
      if (m.type === 'status') setStatus(m.state, m.text);
      else if (m.type === 'out') m.items.forEach(it => sink.add(it.stream === 'info' ? { type: 'info', text: it.text } : { type: 'stream', name: it.stream, text: it.text }));
      else if (m.type === 'image') {
        // Har vinduet cv2.setMouseCallback, sendes klikk i bildet til Python, og utdata
        // fra callbacken havner samme sted som bildet
        const owner = sink;
        sink.add({ type: 'image', b64: m.b64, title: m.title, window: m.window, send: m.mouse ? ev => sendEvent(ev, owner) : null });
      }
      else if (m.type === 'result') sink.add({ type: 'result', text: m.text });
      else if (m.type === 'widget') widgetOp(m.op);
      else if (m.type === 'files') renderFiles(m.files);
      else if (m.type === 'fileData') {
        if (m.purpose === 'bilder') { if (m.data) saveToBilder(m.name, m.data); } else download(m.name, m.data);
      } else if (m.type === 'done') finishRun(m);
      else if (m.type === 'vars') {
        const r = pendingVars;
        pendingVars = null;
        if (r) r(m);
      }
    }

    /* ---------- Kjøre og stoppe ---------- */
    function moduleSource() {
      const c = cfg.context ? cfg.context() : {};
      const list = a => (a ? '[' + a.join(', ') + ']' : 'None');
      const tuple = a => (a ? '(' + a.join(', ') + ')' : 'None');
      const str = s => (s ? JSON.stringify(s) : 'None');
      return [
        '"""Verdier fra Fargelab-fanen. Filen lages på nytt hver gang du kjører et skript."""',
        `bgr = ${list(c.bgr)}  # fargen som er valgt nå: [B, G, R]`,
        `hsv = ${list(c.hsv)}  # samme farge i HSV: [H, S, V], der H går fra 0 til 179`,
        `bilde = ${str(c.bilde)}  # filnavnet til bildet i Bilde-kortet, eller None`,
        `piksel = ${tuple(c.piksel)}  # (x, y) til markøren i bildet, eller None`,
        `bilder = ${JSON.stringify(bilderNames)}  # filene i mappen bilder/ (tom uten server.py)`,
        ''
      ].join('\n');
    }

    let eventTimer = 0;
    function setRunning(on) {
      clearTimeout(eventTimer);
      running = on;
      runBtn.disabled = on;
      stopBtn.disabled = !on;
    }

    // Sørger for at workeren finnes. Kunne ikke Python startes (for eksempel uten nett), prøver vi på nytt.
    function ensureWorker() {
      activate();
      if (worker && workerState === 'failed') { worker.terminate(); worker = null; }
      if (!worker) { setStatus('loading', 'Starter Python på nytt …'); startWorker(); }
      return !!worker;
    }

    // Kjører kode i workeren, én kjøring om gangen. Utdata går til target.
    // mode 'script': nytt navnerom. mode 'cell': notatbokens navnerom.
    // Gir { ok, error, ms }, eller { stopped: true } hvis du trykket Stopp.
    // mode 'vars': Variabler-panelet leser variablene (gir { ready, list, error }).
    let pendingDone = null, pendingVars = null, chain = Promise.resolve(), runMode = null;
    function execute(opts) {
      const p = chain.then(() => doExecute(opts));
      chain = p.catch(() => {});
      return p;
    }
    async function doExecute({ code, mode, filename, target, event, onStart, scope, all, remove }) {
      if (mode === 'vars') {
        // Leser bare navnerommet, så knappene og utdataene røres ikke. Python startes ikke for dette.
        if (!worker || workerState !== 'ready') return { ready: false, list: [] };
        return new Promise(resolve => {
          pendingVars = resolve;
          worker.postMessage({ type: 'vars', scope, all, remove });
        });
      }
      if (!ensureWorker()) return { ok: false, error: null, stopped: true, ms: 0 };
      sink = target;
      sinkStack = [];
      runMode = mode;
      runStart = performance.now();
      if (mode === 'event') {
        // Endringer fra widgets går som regel fort. Kjør og Stopp skifter bare
        // hvis det tar mer enn et øyeblikk, så knappene ikke blinker mens du drar.
        running = true;
        eventTimer = setTimeout(() => { if (running) { runBtn.disabled = true; stopBtn.disabled = false; } }, 400);
      } else {
        setRunning(true);
        if (workerState !== 'ready') target.add({ type: 'info', text: 'Venter på at Python blir klar …' });
        await syncBilder();
        if (!worker || !running) return { ok: false, error: null, stopped: true, ms: 0 };   // stoppet underveis
      }
      if (onStart) onStart();
      return new Promise(resolve => {
        pendingDone = resolve;
        worker.postMessage({ type: 'run', mode, code, filename, event, module: mode === 'event' ? null : moduleSource() });
      });
    }
    function finishRun(m) {
      setRunning(false);
      const done = pendingDone;
      pendingDone = null;
      if (done) done(m);
      // Variablene kan ha endret seg. Mens du drar i en glidebryter, ventes det til du stopper.
      refreshVars(runMode === 'event' ? 300 : 50);
    }
    // Workeren er borte (Stopp eller feil): et svar til Variabler-panelet som venter, kommer aldri
    function dropVars() {
      const r = pendingVars;
      pendingVars = null;
      if (r) r({ ready: false, list: [] });
    }

    async function run() {
      if (isNotebook()) { notebook.runAll(); return; }
      if (running) return;
      clearOutput();
      const m = await execute({ code: getCode(), mode: 'script', filename: doc.name, target: scriptSink });
      if (m.stopped) return;
      if (m.error) scriptSink.add({ type: 'error', text: m.error });
      scriptSink.add({ type: 'info', text: m.ok ? `Ferdig på ${fmtSec(m.ms)}.` : `Stoppet med feil etter ${fmtSec(m.ms)}.` });
    }

    // Stopp: avslutter workeren og starter Python på nytt. Variablene i notatboken blir borte.
    function stop() {
      if (!worker) return;
      worker.terminate();
      worker = null;
      dropVars();
      if (running) {
        const ms = performance.now() - runStart;
        sink.add({ type: 'info', text: `Stoppet etter ${fmtSec(ms)}. Python startes på nytt${isNotebook() ? ', og variablene i notatboken er borte' : ''}.` });
        finishRun({ ok: false, error: null, stopped: true, ms });
      }
      if (notebook) notebook.kernelRestarted();
      if (root.Widgets) root.Widgets.detachAll();   // widgetene hører til Python som er borte
      setStatus('loading', 'Starter Python på nytt …');
      startWorker();
    }

    // Start på nytt: tømmer navnerommet til notatboken (raskt, Python startes ikke på nytt)
    function resetKernel() {
      if (running) { stop(); return; }
      if (worker) worker.postMessage({ type: 'reset' });
      if (notebook) notebook.kernelRestarted();
      if (root.Widgets) root.Widgets.detachAll();
      refreshVars();
    }

    // Det notatboken trenger for å kjøre celler
    const kernel = {
      run: (code, filename, target) => execute({ code, mode: 'cell', filename, target }),
      stop,
      reset: resetKernel
    };
    notebook = root.Notatbok ? root.Notatbok.create({
      host: nbHost, kernel, codeMirror, ask,
      onChange: () => updateFileState(),
      onSave: () => saveDoc()
    }) : null;

    function activate() {
      if (started) {
        if (isNotebook()) notebook.refresh();
        else if (cm) cm.refresh();
        checkDisk();
        return;
      }
      started = true;
      setStatus('loading', 'Starter Python …');
      // Mappene sjekkes før workeren starter, så bildene i bilder/ blir med fra starten
      initFolders().finally(() => { if (!worker) startWorker(); });
      loadEditor();
    }

    /* ---------- Knapper og hendelser ---------- */
    runBtn.addEventListener('click', run);
    stopBtn.addEventListener('click', stop);
    clearBtn.addEventListener('click', showEmpty);
    nbRestartBtn.addEventListener('click', () => {
      resetKernel();
      appendInfo('Python er startet på nytt for notatboken. Variablene er borte, så kjør cellene på nytt.');
    });
    nbClearBtn.addEventListener('click', () => notebook && notebook.clearOutputs());
    newBtn.addEventListener('click', newScript);
    saveFileBtn.addEventListener('click', saveDoc);
    renameBtn.addEventListener('click', renameScript);
    deleteBtn.addEventListener('click', deleteScript);
    fileSel.addEventListener('change', () => {
      const v = fileSel.value;
      if (v === '\u0000ny' || v === doc.name) return;
      openScript(v);
    });
    panel.addEventListener('keydown', e => {
      if (e.defaultPrevented || !(e.ctrlKey || e.metaKey)) return;
      // I en notatbok kjører Ctrl+Enter bare cellen du står i (det tar cellen seg av)
      if (e.key === 'Enter') { if (!isNotebook()) { e.preventDefault(); run(); } }
      else if (e.key === 's' || e.key === 'S') { e.preventDefault(); saveDoc(); }
    });
    root.addEventListener('focus', checkDisk);
    root.addEventListener('beforeunload', e => {
      if (!dirty()) return;
      e.preventDefault();
      e.returnValue = '';
    });

    EXAMPLES.forEach(ex => {
      const o = document.createElement('option');
      o.value = ex.id;
      o.textContent = ex.name;
      exampleSel.appendChild(o);
    });
    const isUntouched = () => {
      const cur = getCode().trim();
      return !cur || EXAMPLES.some(ex => ex.code.trim() === cur);
    };
    exampleSel.addEventListener('change', async () => {
      const ex = EXAMPLES.find(x => x.id === exampleSel.value);
      exampleSel.value = '';
      if (!ex) return;
      if (isNotebook()) {
        // I en notatbok blir eksempelet en ny celle under den du står i
        notebook.addCell('code', ex.code);
        return;
      }
      if (folders) {
        // Eksempelet åpnes som en ny fil. Ctrl+S lagrer den i skript/.
        if (!(await confirmLeave())) return;
        await newDoc(Mapper.uniqueName(ex.id + '.py', taken()), ex.code);
        return;
      }
      if (!isUntouched()) {
        const r = await ask({
          title: 'Bytte ut skriptet?',
          text: `Skriptet i editoren byttes ut med eksempelet «${ex.name}». Det du har skrevet, blir borte.`,
          buttons: [{ label: 'Bytt ut', value: 'ok', primary: true }, { label: 'Avbryt', value: 'cancel' }]
        });
        if (r.value !== 'ok') return;
      }
      setCode(ex.code);
    });

    // Uten server.py: åpne og lagre .py-filer via nettleseren
    openBtn.addEventListener('click', () => openInput.click());
    openInput.addEventListener('change', async () => {
      const f = openInput.files && openInput.files[0];
      openInput.value = '';
      if (!f) return;
      if (!isUntouched()) {
        const r = await ask({
          title: `Åpne ${f.name}?`, text: 'Skriptet som står i editoren nå, blir borte.',
          buttons: [{ label: 'Åpne', value: 'ok', primary: true }, { label: 'Avbryt', value: 'cancel' }]
        });
        if (r.value !== 'ok') return;
      }
      setCode(await f.text());
      doc.name = cleanName(f.name);
      title.textContent = doc.name;
    });
    saveBtn.addEventListener('click', () => download(doc.name, new TextEncoder().encode(getCode())));

    // Filer-vinduet: åpnes med knappen, lukkes med ×, Esc eller et klikk på bakgrunnen.
    // Klikket må både starte og slutte på bakgrunnen, så det ikke lukkes når du
    // merker tekst inne i vinduet og slipper musen utenfor.
    filesBtn.addEventListener('click', () => {
      activate();
      filesNote('');
      filesDialog.showModal();
    });
    filesClose.addEventListener('click', () => filesDialog.close());
    let downOnBackdrop = false;
    filesDialog.addEventListener('pointerdown', e => { downOnBackdrop = e.target === filesDialog; });
    filesDialog.addEventListener('click', e => {
      if (downOnBackdrop && e.target === filesDialog) filesDialog.close();
    });

    /* ---------- Variabler ---------- */
    // Et panel til høyre med variablene i notatboken, eller fra siste kjøring av et skript.
    // Det oppdateres når en celle eller et skript er ferdig, og når du har brukt en widget.
    function varsOpen() { return !varsPanel.hidden; }
    function setVarsOpen(open) {
      varsPanel.hidden = !open;
      varsBtn.setAttribute('aria-expanded', String(open));
      panel.classList.toggle('vars-open', open);   // på brede skjermer flytter innholdet seg til venstre
      if (isNotebook()) notebook.refresh();
      else if (cm) cm.refresh();
      if (open) { activate(); loadVars(); }
    }
    function refreshVars(delay = 50) {
      if (!varsOpen()) return;
      clearTimeout(varsTimer);
      varsTimer = setTimeout(loadVars, delay);
    }
    async function loadVars() {
      if (!varsOpen()) return;
      if (varsBusy) { varsAgain = true; return; }
      varsBusy = true;
      const scope = isNotebook() ? 'cell' : 'script';
      const m = await execute({ mode: 'vars', scope, all: varsAll.checked });
      varsBusy = false;
      renderVars(m, scope);
      if (varsAgain) { varsAgain = false; refreshVars(); }
    }
    async function removeVar(name) {
      const scope = isNotebook() ? 'cell' : 'script';
      renderVars(await execute({ mode: 'vars', scope, all: varsAll.checked, remove: name }), scope);
    }

    function renderVars(m, scope) {
      const nb = scope === 'cell';
      varsScope.textContent = nb
        ? 'Variablene i notatboken. De blir liggende til du trykker «Start på nytt», også om du fjerner dem fra koden.'
        : 'Variablene fra siste gang du kjørte et skript.';
      varsList.textContent = '';
      varsCount.hidden = !(m.ready && !m.error);
      varsCount.textContent = String(m.list.length);
      const note = text => {
        const p = document.createElement('p');
        p.className = 'py-vars-empty';
        p.textContent = text;
        varsList.appendChild(p);
      };
      if (!m.ready) { note(workerState === 'failed' ? 'Python er ikke startet. Se meldingen øverst.' : 'Venter på at Python blir klar …'); return; }
      if (m.error) { note(`Kunne ikke lese variablene: ${m.error}`); return; }
      if (!m.list.length) { note(nb ? 'Ingen variabler ennå. Kjør en celle.' : 'Ingen variabler. Kjør skriptet, så vises variablene det laget.'); return; }
      const ul = document.createElement('ul');
      ul.className = 'py-vars-rows';
      m.list.forEach(v => ul.appendChild(varRow(v)));
      varsList.appendChild(ul);
    }

    // Én variabel: navn, type og størrelse, verdien under, og et lite bilde av bilder.
    // Klikk viser hele verdien og et større bilde.
    function varRow(v) {
      const li = document.createElement('li');
      li.className = 'py-var';
      if (v.bilde) {
        const thumb = document.createElement('span');
        thumb.className = 'py-var-thumb';
        const img = new Image();
        img.alt = '';
        img.onload = () => img.classList.toggle('pixelated', img.naturalWidth < 48 && img.naturalHeight < 48);
        img.src = 'data:image/png;base64,' + v.bilde;
        thumb.appendChild(img);
        li.appendChild(thumb);
      }
      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'py-var-main';
      main.setAttribute('aria-expanded', 'false');
      const top = document.createElement('span');
      top.className = 'py-var-top';
      const name = document.createElement('span');
      name.className = 'py-var-name num';
      name.textContent = v.navn;
      const meta = document.createElement('span');
      meta.className = 'py-var-meta num';
      meta.textContent = [v.type, v.storrelse].filter(Boolean).join(' · ');
      top.append(name, meta);
      const val = document.createElement('span');
      val.className = 'py-var-val num';
      val.textContent = v.verdi;
      main.append(top, val);
      main.addEventListener('click', () => {
        const open = li.classList.toggle('open');
        main.setAttribute('aria-expanded', String(open));
      });
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'py-var-del';
      del.title = 'Slett variabelen fra Python';
      del.setAttribute('aria-label', `Slett ${v.navn}`);
      del.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      del.addEventListener('click', () => removeVar(v.navn));
      li.append(main, del);
      return li;
    }

    varsBtn.addEventListener('click', () => setVarsOpen(!varsOpen()));
    varsClose.addEventListener('click', () => { setVarsOpen(false); varsBtn.focus(); });
    varsAll.addEventListener('change', loadVars);

    addBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const list = Array.from(fileInput.files || []);
      fileInput.value = '';
      if (list.length) addUserFiles(list);
    });

    // Filer som slippes på Python-fanen
    const visible = () => !panel.hidden;
    const hasFiles = e => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    document.addEventListener('dragover', e => {
      if (!visible() || !hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    document.addEventListener('drop', e => {
      if (!visible() || !hasFiles(e)) return;
      e.preventDefault();
      const list = Array.from(e.dataTransfer.files || []);
      if (list.length) addUserFiles(list);
    });

    document.addEventListener('fane', e => { if (e.detail.id === 'python') activate(); });
    if (visible()) activate();

    return { addFile, files: () => fileList };
  }

  root.Python = { create, EXAMPLES };
})(typeof self !== 'undefined' ? self : this);

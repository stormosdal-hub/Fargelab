# Fargelab for BGR og HSV

En liten nettside for å eksperimentere med fargemodellene BGR og HSV slik OpenCV bruker dem. Endrer du en farge i den ene modellen, regnes verdiene i den andre ut med `cv.cvtColor` fra OpenCV.js.

BGR-panelet viser RGB-kuben i 3D, og HSV-panelet viser HSV-sylinderen («kaken»). Du kan snu begge med musen. En bit er skåret ut mot deg, slik at du ser akkurat hvor fargen du har valgt ligger inne i figuren.

I fanen **Python** kan du skrive og kjøre Python-skript og notatbøker (som i Google Colab) med OpenCV, numpy og matplotlib rett i nettleseren.

Alt ligger i mappen, også OpenCV.js, three.js, skrifttypen, Pyodide (Python i nettleseren) og kodeeditoren, så siden virker uten internett. Python-fanen trenger da at du starter siden med en lokal webserver (se under).

## Slik starter du

**Anbefalt:** start den lokale serveren som følger med prosjektet:

```bash
cd fargelab
python server.py
```

Åpne deretter <http://localhost:8000> i nettleseren (eller start med `python server.py --åpne`). På noen maskiner heter kommandoen `python3`. Serveren trenger bare Pythons standardbibliotek. Med den kan Python-fanen lagre skript i mappen `skript/` og bruke bildene i `bilder/` (se under), og alt virker uten nett.

**Andre måter** virker også, men da finnes ikke mappene `skript/` og `bilder/` i appen. Skriptet lagres bare i nettleseren:

- `python -m http.server 8000` eller *Live Server* i Visual Studio Code. Alt virker uten nett.
- Dobbeltklikk på `index.html`. Fargelab-fanen virker uten nett, men Python-fanen henter Pyodide fra internett, fordi nettleseren ikke lar skript lese filer rett fra disken.

Statuslampen under fargebåndet blir grønn når OpenCV.js er startet. Det tar vanligvis et par sekunder, fordi filen er rundt 10 MB.

## Mappestruktur

```
fargelab/
├── index.html            Oppsettet av siden
├── server.py             Lokal webserver: serverer siden og lar appen lese og skrive i skript/ og bilder/
├── skript/               Python-skriptene og notatbøkene dine (lages og lagres i Python-fanen)
│   ├── kom_i_gang.py
│   ├── bgr_kanaler.ipynb
│   ├── notatbok_eksempel.ipynb
│   └── widgets_eksempel.ipynb
├── bilder/               Bildene dine. Python-skriptene finner dem uten sti.
│   └── eksempel.png
├── css/
│   └── style.css         Farger, skrift, oppsett, lyst og mørkt tema
├── js/
│   ├── hsv-kopi.js       JavaScript-kopi av OpenCVs BGR <-> HSV, BGR -> grå og terskel (reserve)
│   ├── scene3d.js        Felles 3D-oppsett: kamera, snurring med musen, etiketter
│   ├── kube3d.js         RGB-kuben i 3D
│   ├── sylinder3d.js     HSV-sylinderen i 3D
│   ├── bilde.js          Bilde med markør og lupp: henter fargen fra én piksel
│   ├── oppsett.js        Kortene: flytte, endre størrelse og lagre oppsettet
│   ├── python.js         Python-fanen: editor, Pyodide i en Web Worker, utdata og filer
│   ├── mapper.js         Leser og skriver i skript/ og bilder/ gjennom server.py
│   ├── notatbok.js       Notatbøker: celler med kode og tekst, lagres som .ipynb
│   ├── utdata.js         Viser utdata (tekst, bilder, verdier og feil) for skript og celler
│   ├── widgets.js        Tegner widgets (glidebrytere, knapper, lister) i utdataene, og klikk i bilder
│   ├── widgets-py.js     Python-modulene ipywidgets og IPython.display som Pyodide får
│   ├── faner.js          Fanene øverst (Fargelab og Python)
│   └── app.js            Glidebrytere, fargekart, kodeeksempel og lasting av OpenCV.js
├── lib/
│   ├── opencv.js         OpenCV.js 4.10 (fra npm-pakken @techstark/opencv-js)
│   ├── three.min.js      three.js r160
│   ├── pyodide/          Pyodide 314.0.7 med numpy, OpenCV og matplotlib (36 MB)
│   ├── codemirror/       CodeMirror 5.65.21, kodeeditoren i Python-fanen
│   ├── LICENSE-opencv-js.txt
│   ├── LICENSE-three.txt
│   ├── LICENSE-pyodide.txt
│   └── LICENSE-codemirror.txt
├── fonts/
│   ├── recursive.woff2   Skrifttypen Recursive
│   └── OFL-recursive.txt
└── test/
    └── sammenlign.js     Sjekker at hsv-kopi.js gir samme tall som OpenCV.js
```

## Hvordan det henger sammen

- `app.js` holder på én farge i begge modeller (`st.bgr` og `st.hsv`), og husker hvilken du endret sist. Kommer fargen fra en piksel i bildet, står koordinatene i `st.from`.
- Endrer du BGR, kjøres `cv.cvtColor(..., cv.COLOR_BGR2HSV)`. Endrer du HSV, kjøres `cv.COLOR_HSV2BGR`.
- Verdiene du selv har stilt inn blir ikke regnet om på nytt. Derfor kan HSV-sliderne stå på for eksempel H = 90 selv om fargen er svart.
- Mens OpenCV.js laster, eller hvis den ikke kan startes, bruker siden `hsv-kopi.js`. Den er skrevet etter OpenCVs C++-kode og gir de samme tallene.
- Finnes ikke `lib/opencv.js`, prøver siden å hente OpenCV.js fra jsDelivr.

## Python-fanen

Velg fanen **Python** øverst. Du kan også gå rett dit med `index.html#python`.

Python kjører i [Pyodide](https://pyodide.org) 314.0.7, som er CPython 3.14 kompilert til WebAssembly. Med følger OpenCV 4.11, numpy 2.4 og matplotlib 3.10. Python starter når du åpner fanen, og det tar omtrent 10 sekunder. Statuslinjen sier hvor Pyodide ble lastet fra. Editoren er [CodeMirror 5](https://codemirror.net/5/). Får den ikke lastet, får du et vanlig tekstfelt i stedet.

### Uten internett

Pyodide ligger i `lib/pyodide/`, med kjernen og numpy, OpenCV og matplotlib med avhengigheter (13 pakker, 36 MB). CodeMirror ligger i `lib/codemirror/`. Siden prøver alltid `lib/` først og bruker nettet bare hvis det ikke går:

- **Lokal webserver** (`python server.py`, `python -m http.server` eller Live Server): alt lastes fra `lib/`, så Python-fanen virker uten nett.
- **Dobbeltklikk på `index.html`** (`file://`): nettleseren lar ikke skript lese filer rett fra disken, så Pyodide hentes fra cdn.jsdelivr.net. CodeMirror lastes fortsatt fra `lib/`.

Bare de 13 pakkene ligger lokalt. I `lib/pyodide/pyodide-lock.json` peker de 344 andre pakkene (for eksempel scipy og pandas) på jsDelivr, så de virker når du er på nett. Låsefilen er en kopi av den offisielle, der bare `file_name` for disse pakkene er gjort om til fulle adresser. Alle pakkefilene ble kontrollert mot sha256-summene i den offisielle låsefilen da de ble lastet ned.

- **Kjør** (eller Ctrl+Enter) kjører skriptet i et nytt, tomt navnerom, som `python skript.py`. Det du skriver ut med `print()` havner under *Utdata*. Feil vises med linjenummer i skriptet ditt.
- **Stopp** avbryter et skript som henger, for eksempel en uendelig løkke. Python starter da på nytt, og det tar noen sekunder.
- **Eksempel** har ferdige skript: gråtone og terskel med Otsu, maske rundt valgt farge med `cv2.inRange`, histogram med matplotlib, fargehjul med numpy og kanter med Canny. De tre siste eksemplene har widgets: glidebrytere med `interact`, trackbars som i OpenCV, og knapper og nedtrekksliste.
- **Skriptene ligger i mappen `skript/`** når du bruker `server.py` (se «Mappene skript/ og bilder/» under). Uten `server.py` lagres skriptet i nettleseren, og **Åpne .py** og **Lagre .py** henter og lagrer det som fil.

### Mappene skript/ og bilder/

Når siden er startet med `python server.py`, kan Python-fanen lese og skrive i to mapper i prosjektet.

**`skript/`** har Python-skriptene (`.py`) og notatbøkene (`.ipynb`) dine. I fillinjen velger du hvilken fil du vil jobbe med:

- **Ny** lager et nytt skript eller en ny notatbok i `skript/`. Du velger navnet, og `.py` eller `.ipynb` legges til av seg selv.
- **Lagre** (eller **Ctrl+S**) lagrer filen. «● Ikke lagret» viser at du har endringer som ikke er lagret, og nettleseren spør før du lukker siden.
- **Gi nytt navn** og **Slett**. Slettede filer flyttes til `skript/.papirkurv/`, så du kan hente dem tilbake.
- Endrer du en fil i en annen editor (for eksempel VS Code), leses den inn på nytt når du går tilbake til siden. Har du også endret den i appen, spør appen før den overskriver noe.
- Et **eksempel** åpnes som en ny fil som ikke er lagret. Trykk Lagre for å legge den i `skript/`.
- Skriptet du hadde i nettleseren før mappen fantes, lagres én gang som `skript/fra_nettleseren.py`.

**`bilder/`** har bildene dine. Alt i mappen ligger der skriptene kjører, så du skriver bare filnavnet:

```python
img = cv2.imread("eksempel.png")       # ligger i bilder/eksempel.png
for navn in fargelab.bilder:            # alle filene i bilder/
    print(navn, cv2.imread(navn).shape)
```

- Legg bilder i mappen med Utforsker/Finder, eller med **Legg til filer** i Filer-vinduet i Python-fanen. De er med neste gang du trykker Kjør. Bilder du fjerner fra mappen, forsvinner også.
- Filer et skript lagrer (for eksempel `cv2.imwrite("kanter.png", …)`), havner først bare i Python-mappen i nettleseren. Åpne **Filer** og trykk **Lagre i bilder/** ved filen for å legge den i `bilder/`.
- Skriptene kan ikke endre filene i `bilder/` på disken. Overskriver et skript en av dem, gjelder det bare til neste kjøring, og da legges originalen inn igjen.
- I Fargelab-fanen har Bilde-kortet listen **Fra bilder/**, så du kan åpne bildene derfra. Et bilde du har limt inn eller valgt fra disken, kan du lagre i mappen med **Lagre i bilder/**.
- Filnavn blir aldri overskrevet når appen lagrer i `bilder/`: finnes `foto.png`, blir det `foto-2.png`.

`server.py` lytter bare på denne maskinen (`localhost`) og tar bare imot forespørsler fra selve appen, så andre nettsider kan ikke lese eller endre filene dine.

### Notatbøker (som i Google Colab)

En notatbok er en `.ipynb`-fil i `skript/` med celler under hverandre. Velg **Ny → Notatbok**, eller åpne `notatbok_eksempel.ipynb`.

- **Kodeceller** kjøres én og én med ▶-knappen. Alle cellene deler de samme variablene, så `img` fra én celle kan brukes i den neste. Tallet ved knappen, for eksempel `[3]`, viser rekkefølgen cellene ble kjørt i.
- **Utdata** havner rett under cellen: `print()`, bilder fra `cv2.imshow` og `plt.show()`, og feilmeldinger. Verdien av siste linje vises av seg selv, slik at `img.shape` gir `(320, 480, 3)`. Avslutt linjen med `;` for å skjule den.
- **Tekstceller** skrives i Markdown: `# Overskrift`, `**fet**`, `*kursiv*`, `` `kode` ``, lister og lenker. Dobbeltklikk for å redigere, og Shift+Enter for å vise teksten ferdig.
- **+ Kode** og **+ Tekst** lager nye celler. Knappene vises mellom cellene når du peker der, og står alltid nederst. Knappene på hver celle flytter den opp eller ned eller sletter den.
- **Kjør alle** kjører cellene ovenfra og ned, og stopper ved første feil. **Start på nytt** tømmer variablene, som «Restart runtime» i Colab. **Tøm utdata** fjerner alle utdataene. **Stopp** (eller ■ på cellen som kjører) avbryter en celle som henger, og da starter Python på nytt.
- **Eksempel** legger eksempelet inn som en ny celle under den du står i.

| Taster i en celle | |
|------|------|
| Shift+Enter | kjør og gå til neste celle (lager en ny hvis det er den siste) |
| Ctrl+Enter | kjør og bli stående |
| Alt+Enter | kjør og lag en ny celle under |
| Ctrl+S | lagre notatboken |
| Pil opp/ned | gå til forrige/neste celle fra første/siste linje |
| Esc | gå ut av editoren |

Notatbøkene lagres i samme format som Colab, Jupyter og VS Code bruker (nbformat 4.5), med utdata og bilder. Du kan altså åpne dem der også, og omvendt. Utdata appen ikke kan vise, for eksempel HTML-tabeller fra pandas i Colab, vises som tekst og tas vare på når du lagrer. Feilmeldinger viser hvilken celle feilen skjedde i, for eksempel `File "celle 5", line 2`.

Notatbøker krever `server.py`, fordi de lagres i mappen `skript/`.

### Variabler

Knappen **Variabler** øverst til høyre åpner et panel med variablene Python har nå, som «Variables» i Colab og Variable Explorer i Spyder:

- **I en notatbok** vises variablene i notatboken. Alle cellene deler dem, så en variabel blir liggende til du trykker **Start på nytt**, også om du fjerner den fra koden. Panelet viser hva som faktisk ligger der.
- **For et skript** vises variablene fra siste gang du kjørte et skript.
- Hver variabel har navn, type og størrelse, for eksempel `ndarray · (320, 480, 3) uint8`, og verdien under. For numpy-tabeller står minste, største og gjennomsnittlige verdi, og bilder får et lite miniatyrbilde. Klikk på en variabel for å se hele verdien og et større bilde.
- **Søppelbøtta** ved en variabel sletter den fra Python, som `del navn`.
- Moduler (`cv2`, `np`), funksjoner og klasser er skjult. Kryss av for **Vis også moduler, funksjoner og klasser** for å se dem. Navn som starter med `_`, vises aldri.
- Panelet oppdateres når en celle eller et skript er ferdig, og når du har brukt en widget. På brede skjermer flytter innholdet seg til venstre, så panelet ikke dekker cellene.

### Bilder og figurer

`cv2.imshow(navn, bilde)` og `plt.show()` viser bildene under *Utdata*. `cv2.waitKey` og `cv2.destroyAllWindows` gjør ingenting, så vanlig OpenCV-kode virker som den er. Figurer du ikke har vist, kommer når skriptet er ferdig. Som i vanlig OpenCV ganges bilder med flyttall med 255, så verdier fra 0 til 1 blir fra svart til hvitt.

### Widgets: glidebrytere, knapper og lister

Widgets vises i utdataene under cellen (eller under *Utdata* for et skript), og Python kjører når du endrer dem. Navnene er de samme som i [ipywidgets](https://ipywidgets.readthedocs.io), så koden virker også i Colab og Jupyter. Åpne `skript/widgets_eksempel.ipynb` for å prøve.

**`@interact`** lager en widget for hvert argument, og kjører funksjonen hver gang du endrer en av dem:

```python
from ipywidgets import interact

@interact(thresh=(0, 255), inverter=False, metode=["THRESH_BINARY", "THRESH_TRUNC"])
def terskel(thresh=127, inverter=False, metode="THRESH_BINARY"):
    _, ut = cv2.threshold(gray, thresh, 255, getattr(cv2, metode))
    cv2.imshow("resultat", ut)
```

| Argument | Blir |
|------|------|
| `(0, 255)` eller `(0, 255, 5)` | glidebryter for heltall (med steg 5) |
| `(0.0, 1.0)` | glidebryter for desimaltall |
| `True` / `False` | avkrysningsboks |
| `["a", "b"]` eller `{"navn": verdi}` | nedtrekksliste |
| `"tekst"` | tekstfelt |
| en widget, for eksempel `widgets.ColorPicker()` | den widgeten |
| `fixed(verdi)` | ingen widget, verdien sendes som den er |

Med `interact_manual` kjører funksjonen bare når du trykker på knappen **Kjør**.

**`cv2.createTrackbar`** blir en glidebryter, og callbacken kjører når du drar i den. `cv2.getTrackbarPos`, `cv2.setTrackbarPos`, `cv2.setTrackbarMin` og `cv2.setTrackbarMax` virker også. Viser du bildet med `cv2.imshow` og samme vindusnavn, byttes bildet ut i stedet for at det kommer et nytt, som i et OpenCV-vindu.

**`cv2.setMouseCallback`** gjør at du kan klikke i et bilde fra `cv2.imshow`, som i et OpenCV-vindu. Funksjonen får `(event, x, y, flags, param)`:

- `event` er `cv2.EVENT_LBUTTONDOWN`, `EVENT_LBUTTONUP`, `EVENT_RBUTTONDOWN`, `EVENT_MBUTTONDOWN`, `EVENT_LBUTTONDBLCLK`, `EVENT_MOUSEMOVE` osv.
- `x` og `y` er piksler i bildet, også når bildet vises mindre enn det er.
- `flags` har knappene du holder nede og Ctrl, Shift og Alt (`cv2.EVENT_FLAG_LBUTTON`, `EVENT_FLAG_SHIFTKEY` osv.).
- Bevegelser som kommer tett, slås sammen til den siste posisjonen.
- Kall `cv2.setMouseCallback` før `cv2.imshow`, så tar bildet imot klikk. Musepekeren blir et kryss over bildet.

Avsnittet «Mal på et sjakkbrett» i `skript/bgr_kanaler.ipynb` er et lite Paint-program. Klikker du på en rute, åpnes et pop-up-vindu (`widgets.Popup`) med glidebrytere for B, G og R, og ruten endres mens du drar.

**Enkeltwidgets** lager du selv og viser med `display(...)`:

| Widget | |
|------|------|
| `IntSlider`, `FloatSlider` | glidebrytere (`value`, `min`, `max`, `step`, `continuous_update`) |
| `Checkbox` | avkrysningsboks |
| `Dropdown`, `RadioButtons` | velg ett av flere (`options`) |
| `Button` | knapp (`on_click`, `button_style="primary"` eller `"danger"`) |
| `Text`, `Textarea` | tekstfelt |
| `ColorPicker` | fargevelger, verdien er `"#rrggbb"` |
| `Label` | tekst |
| `VBox`, `HBox` | stabler widgets under eller ved siden av hverandre |
| `Output` | et område: det du skriver ut eller viser inne i `with ut:`, havner der |
| `Popup` | et lite vindu over siden med widgets i (bare i Fargelab, se under) |

`widget.observe(funksjon, names="value")` kjører funksjonen når verdien endres. `IPython.display` har `display`, `clear_output` og `Image`.

**`widgets.Popup`** finnes bare i Fargelab, ikke i Jupyter og Colab. Det er et lite vindu som legger seg over siden ved siden av der du sist klikket, så det du klikket på, ikke blir skjult:

```python
b = widgets.IntSlider(description="B", max=255)
ok = widgets.Button(description="OK", button_style="primary")
vindu = widgets.Popup([b, ok], title="Velg farge")
vindu.show()     # åpner vinduet
vindu.close()    # lukker det, for eksempel i ok.on_click
```

Du kan også lukke vinduet med ×, Esc eller et klikk utenfor. Da blir `vindu.open` False, og `vindu.observe(funksjon, names="open")` får vite det. Første gang du kaller `show()`, legges vinduet i utdataene der det kalles.

Verdt å vite:

- **tkinter og wxPython virker ikke.** Pyodide kjører i nettleseren, og der finnes ikke vinduer fra operativsystemet. Bruk widgets i stedet.
- **Løkker med `cv2.waitKey` virker ikke.** `while True: ... cv2.waitKey(1)` henger, fordi Python ikke får vite at du har endret noe før koden er ferdig. Skriv koden med en callback (`interact`, `on_click`, `observe` eller trackbar-callbacken) i stedet.
- Når du drar fort i en glidebryter, hopper Python over mellomverdiene den ikke rakk, og kjører med den siste.
- Widgetene virker så lenge siden er åpen og Python ikke er startet på nytt. **Start på nytt** og **Stopp** slår dem av, og da blir de bleke. Kjør cellen igjen for å få dem tilbake.
- En notatbok lagres med et bilde av widgetene slik de stod, og med utdataene de hadde laget.
- Feil i en callback vises i utdataene, med linjenummer i cellen.

### Filer og samspillet med Fargelab-fanen

Knappen **Filer** øverst til høyre i Python-fanen åpner et vindu med filene skriptene kan bruke. Tallet på knappen viser hvor mange det er. Lukk vinduet med ×, Esc eller ved å klikke utenfor det.

Skriptet kjører i mappen `/home/pyodide`. Der ligger:

- alt i mappen `bilder/` i prosjektet (med `server.py`)
- `testbilde.png`, som eksemplene bruker hvis du ikke har åpnet et bilde
- bildet du har åpnet i Bilde-kortet i Fargelab-fanen, med samme filnavn
- filer du legger til med **Legg til filer** eller slipper på Python-fanen

Filer skriptet lagrer, for eksempel med `cv2.imwrite("ut.png", img)`, kommer i listen og kan lastes ned.

`import fargelab` gir verdiene fra Fargelab-fanen slik de står når du trykker Kjør:

| Navn | Innhold |
|------|---------|
| `fargelab.bgr` | fargen som er valgt, `[B, G, R]` |
| `fargelab.hsv` | samme farge i HSV, `[H, S, V]` |
| `fargelab.bilde` | filnavnet til bildet i Bilde-kortet, eller `None` |
| `fargelab.piksel` | `(x, y)` til markøren i bildet, eller `None` |
| `fargelab.bilder` | navnene på filene i `bilder/` (tom liste uten `server.py`) |

`cv2.imread(fargelab.bilde)[y, x]` gir derfor den samme pikselen som markøren står på.

### Begrensninger

- `input()` virker ikke, fordi skriptet kjører i bakgrunnen. Skriv verdiene rett i koden, eller bruk widgets.
- tkinter, wxPython, PyQt og andre biblioteker som åpner egne vinduer virker ikke i nettleseren. Bruk widgets (se over).
- Pakker som følger med Pyodide (for eksempel scipy, pandas og scikit-image) lastes automatisk når skriptet importerer dem. Rene Python-pakker fra PyPI kan du hente med `micropip`. Pakker som trenger C-kode og ikke er bygd for Pyodide, virker ikke.
- Etter **Stopp** forsvinner filer skriptet har laget, hvis du ikke har lagret dem i `bilder/`. Filene i `bilder/` og filer du har lagt til selv, blir lagt inn igjen.
- Uten nett virker bare pakkene som ligger i `lib/pyodide/`. Andre pakker og `micropip` trenger internett.

## Flytt kortene og endre størrelsen

Bilde, BGR og HSV er kort du kan ordne slik du vil. Du kan for eksempel legge BGR-kortet ved siden av bildet og gjøre kuben mindre, så du ser glidebryterne mens du flytter markøren.

- **Flytt et kort:** dra i håndtaket ⠿ eller i tittelen. Slipper du kortet på venstre eller høyre del av et annet kort, havner det ved siden av. Er det ikke plass i raden, deles bredden likt. Slipper du det på midten av et kort, havner det i en egen rad over eller under. En strek viser hvor kortet havner, og Esc avbryter.
- **Endre bredden:** dra i høyre kant eller i hjørnet nede til høyre. Bredden går i hele tolvdeler av raden. Står det et kort til høyre, flytter du skillet mellom dem.
- **Endre høyden:** dra i nedre kant eller i hjørnet. Høyden gjelder bildet, kartet eller 3D-visningen i kortet. Glidebryterne og knappene beholder størrelsen sin. Dobbeltklikk på hjørnet eller nedre kant gir automatisk høyde igjen.
- **Med tastaturet:** sett fokus på ⠿ og bruk piltastene for å flytte kortet, eller sett fokus på hjørnet og bruk piltastene for å endre størrelsen (Shift gir større steg).
- **Tilbakestill oppsett** dukker opp over kortene når oppsettet er endret.

Oppsettet lagres i nettleseren (`localStorage`), så det er likt neste gang du åpner siden. På smale skjermer (under 881 px) ligger kortene alltid under hverandre.

Pilen som viser hvilken vei konverteringen gikk sist (BGR2HSV eller HSV2BGR), står nå i fargebåndet øverst.

## Hent farger fra et bilde

Kortet *Bilde* ligger øverst til vanlig, men kan flyttes som de andre kortene. Du kan åpne et bilde på tre måter:

- klikk **Velg bilde**
- slipp en bildefil hvor som helst på siden
- lim inn et bilde med **Ctrl+V**, for eksempel et skjermklipp

Bildet blir i nettleseren og lastes ikke opp noe sted.

Markøren starter midt i bildet. Fargen til pikselen under markøren settes som BGR-farge, akkurat som om du hadde dratt i glidebryterne. Derfor følger kuben, sylinderen, 2D-kartene og fargebåndet øverst med når du flytter markøren.

- **Flytt markøren:** klikk eller dra i bildet. Piltastene flytter én piksel om gangen, og med Shift ti.
- **Luppen** viser 15 × 15 piksler rundt markøren. Klikk i en rute for å flytte markøren dit.
- **Bruk pikselen:** endrer du fargen med glidebryterne etterpå, blir markøren stående. Knappen henter pikselfargen tilbake.
- **Kodeeksempelet** viser hvordan du leser samme piksel med `cv2.imread` og `img[y, x]`. Husk at numpy tar rad (y) først.
- **Gråtone:** kryss av for *Gråtone* ved knappene i bildekortet. Da vises bildet og luppen i gråtoner, og fargekartene får gråtonen Y til pikselen som BGR-fargen `[Y, Y, Y]`. I kuben havner markøren på den grå diagonalen fra svart til hvit, og i sylinderen på midtaksen (S = 0, V = Y). Ved luppen står både Y og den opprinnelige BGR- og HSV-fargen, og kodeeksempelet viser `cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)`.

- **Binær:** kryss av for *Binær*. Da dukker det opp to glidebrytere, *Terskel* (`thresh`, 0–255) og *Maksverdi* (`maxval`, 0–255). Bildet gjøres grått og deretter binært, slik `cv2.threshold(gray, thresh, maxval, cv2.THRESH_BINARY)` gjør det: piksler med gråtone over terskelen får maksverdien, resten blir 0. Fargekartene får binærverdien til pikselen under markøren som `[v, v, v]`, altså svart eller grått/hvitt. Ved luppen står binærverdien, gråtonen og sammenligningen med terskelen, for eksempel «Grå 151 > thresh 127, så pikselen får maxval = 255». Binær bruker alltid gråtone, så *Gråtone*-valget er slått av så lenge.

### Slik regner OpenCV ut gråtonen

Formelen er Y = 0,299 R + 0,587 G + 0,114 B, men OpenCV 4 regner med heltall: `(3735·B + 19235·G + 9798·R + 16384) >> 15`. Det gir ikke alltid samme svar som å runde av formelen med desimaltall. For rundt 21 000 av de 16,7 millioner fargene blir svaret 1 høyere eller lavere. Siden bruker heltallsversjonen, og `node test/sammenlign.js` kontrollerer at den stemmer med OpenCV.js for alle farger.

`cv2.imread('bilde.jpg', cv2.IMREAD_GRAYSCALE)` lar JPEG-dekoderen lage gråtonen selv, og kan derfor gi litt andre tall enn `cv2.cvtColor(..., COLOR_BGR2GRAY)`. Tallene her tilsvarer `cvtColor`.

Fargene leses fra en kopi av bildet i full oppløsning, ikke fra det forminskede bildet du ser. Bilder over 36 megapiksler skaleres ned, og da står det i panelet.

Tallene skal være de samme som `cv2.imread` gir, men det finnes noen unntak:

- **Fargeprofiler:** bildet dekodes uten å regne om innebygde fargeprofiler (for eksempel Display P3 fra iPhone), slik OpenCV også gjør. Et slikt bilde kan derfor se litt blekere ut her enn i et bildeprogram.
- **JPEG:** nettleseren og OpenCV bruker ikke alltid samme JPEG-dekoder. Noen piksler kan derfor avvike med 1–2 i en kanal. PNG gir nøyaktig like tall.
- **Gjennomsiktige piksler:** nettleseren lagrer farger ganget med alfa. I piksler som er helt eller delvis gjennomsiktige, kan fargeverdiene derfor bli endret. Panelet sier fra når det gjelder pikselen du står på.

## 3D-kuben

Velg «3D-kube» under *Fargekart* i BGR-panelet (det er standardvalget). Snu, klikk og piltaster virker likt i kuben og sylinderen.

- **Snu kuben:** dra med musen eller fingeren, eller klikk på kuben og bruk piltastene (Shift gir større steg).
- **Aksene** går fra 0 til 255 med merker for hver 51. De flytter seg til de kantene du ser best når du snur kuben.
- **De fargede rammene** viser flatene B = b, G = g og R = r. Der de tre flatene krysser hverandre, ligger fargen du har valgt, markert med en ring.
- **Skjær ut hjørnet mot deg** fjerner biten mellom fargen din og hjørnet nærmest deg, så snittflatene blir synlige. Slår du det av, ser du hele kuben, og ringen vises gjennom den.
- **Vis hjørnenavn** skriver navnet på de åtte hjørnefargene (svart, blå, grønn, cyan og så videre).

I 3D-scenen er x = B, y = G og z = R, med verdien 0 på -1 og 255 på 1. Fargene på kuben er vertex-farger som vises uten gamma-omregning. Hvert sted i kuben har derfor nøyaktig den RGB-verdien som posisjonen tilsvarer, og ringen i krysningspunktet er fylt med fargen fra glidebryterne.

three.js skriver en advarsel i nettleserkonsollen om at `three.min.js` er utgått. Den kan du se bort fra. r160 er siste versjon som kan lastes med en vanlig `<script>`-tagg, og det er det som gjør at siden virker når du dobbeltklikker `index.html`.

## 3D-sylinderen (HSV)

Velg «3D-sylinder» under *Fargekart* i HSV-panelet (det er standardvalget).

- **H** er vinkelen rundt sylinderen. Ringen med pil ved foten viser H fra 0 til 179, altså graden delt på 2 slik OpenCV lagrer den.
- **S** er avstanden fra midten. Aksen over toppen går fra 0 i sentrum til 255 ytterst, i retning av H-en du har valgt.
- **V** er høyden, fra 0 (svart) i bunnen til 255 på toppen. Aksen står ved siden av sylinderen.
- **De hvite rammene** viser flatene H = h (en loddrett skive fra midten og ut), S = s (sirkler på topp og bunn) og V = v (en ring rundt veggen). De møtes i fargen du har valgt.
- **Skjær ut en kakebit mot deg** fjerner en bit på 90° fra valgt H, utenfor valgt S og over valgt V. Står både S og V på 0, blir det en hel kakebit ned til det svarte midtpunktet, som på det klassiske bildet.
- **Vis fargenavn** skriver rød, gul, grønn, cyan, blå og magenta ved H-ringen, og hvit og svart i midten.

Fargene på sylinderen regnes ut i en shader for hver piksel, med vanlig HSV-til-RGB-formel. Ringen i krysningspunktet er fylt med fargen OpenCV ga, så den kan avvike med 1 i en kanal fra flaten rundt, fordi OpenCV runder av til heltall.

## Kontroller JavaScript-kopien selv

Har du [Node.js](https://nodejs.org) installert, kan du sammenligne `hsv-kopi.js` med OpenCV.js for alle farger:

```bash
cd fargelab
node test/sammenlign.js
```

Skriptet går gjennom alle 16,7 millioner BGR-farger og alle 11,8 millioner HSV-kombinasjoner. Det kontrollerer også gråtonen for alle BGR-farger, og terskelen (`cv2.threshold` med `THRESH_BINARY`) for alle kombinasjoner av gråtone, `thresh` og `maxval`. Det skriver ut om noen tall er forskjellige.

## Verdt å vite om OpenCV

| Kanal | Område i OpenCV (8 bit) | Vanlig område |
|-------|-------------------------|---------------|
| B, G, R | 0–255 | 0–255 |
| H | 0–179 | 0–360° |
| S | 0–255 | 0–100 % |
| V | 0–255 | 0–100 % |

- OpenCV lagrer farger i rekkefølgen **BGR**, ikke RGB.
- H er vinkelen delt på 2, fordi 360 ikke får plass i en `uint8`. Bruk `COLOR_BGR2HSV_FULL` hvis du vil ha H i 0–255.
- Rød ligger både nær H = 0 og nær H = 179. Med `cv2.inRange` trenger du derfor ofte to masker.

## Lisenser

- OpenCV.js: Apache License 2.0, se `lib/LICENSE-opencv-js.txt`.
- three.js: MIT, se `lib/LICENSE-three.txt`.
- Recursive: SIL Open Font License 1.1, se `fonts/OFL-recursive.txt`.
- Pyodide: Mozilla Public License 2.0, se `lib/LICENSE-pyodide.txt`. Hver pakke i `lib/pyodide/` har lisensen sin inne i .whl-filen.
- CodeMirror 5: MIT, se `lib/LICENSE-codemirror.txt`.

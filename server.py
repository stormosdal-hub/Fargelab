#!/usr/bin/env python3
"""
server.py – lokal webserver for Fargelab

Serverer nettsiden slik `python -m http.server` gjør, og lar web-appen lese
og skrive filer i to mapper i prosjektet:

    skript/   Python-skriptene (.py) og notatbøkene (.ipynb) du lager i Python-fanen
    bilder/   bilder og andre filer som skriptene kan bruke

Start fra prosjektmappen:

    python server.py            port 8000
    python server.py 8080       en annen port
    python server.py --åpne     åpner siden i nettleseren også

Åpne deretter http://localhost:8000. Stopp med Ctrl+C.

Sikkerhet:
  - Serveren lytter bare på denne maskinen (127.0.0.1 og ::1), ikke på nettverket.
  - API-et (/api/...) krever headeren X-Fargelab: 1 og en Host/Origin som er
    localhost. Det hindrer andre nettsider i å lese eller endre filene dine.
  - Filnavn kan ikke inneholde mapper (/ eller \\), og bare skript/ og bilder/
    kan endres.
  - Filer du sletter, flyttes til .papirkurv/ i samme mappe.

API (alle svar er JSON, unntatt filinnhold):
    GET    /api/info                         {"ok": true, "mapper": [...]}
    GET    /api/filer/<mappe>                [{"navn", "storrelse", "mtime"}, ...]
    GET    /api/filer/<mappe>/<navn>         filinnholdet, med X-Fargelab-Mtime
    PUT    /api/filer/<mappe>/<navn>         lagrer innholdet i forespørselen
           X-Fargelab-Mtime: <mtime>         bare hvis filen ikke er endret siden
           X-Fargelab-Mtime: ny              bare hvis filen ikke finnes fra før
    POST   /api/filer/<mappe>/<navn>         {"nyttNavn": "..."} gir filen nytt navn
    DELETE /api/filer/<mappe>/<navn>         flytter filen til <mappe>/.papirkurv/

mtime er st_mtime_ns som tekst (et heltall for stort for JSON-tall).
"""
import json
import os
import socket
import sys
import threading
import time
import urllib.parse
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FOLDERS = {"skript": ROOT / "skript", "bilder": ROOT / "bilder"}
ALLOWED_SUFFIXES = {"skript": {".py", ".ipynb"}, "bilder": None}   # None = alle filtyper
MAX_BYTES = 200 * 1024 * 1024
TRASH = ".papirkurv"
WINDOWS_RESERVED = {"CON", "PRN", "AUX", "NUL"} | {f"COM{i}" for i in range(1, 10)} | {f"LPT{i}" for i in range(1, 10)}


def valid_name(name):
    """Et filnavn uten mapper, som virker både på Windows, macOS og Linux."""
    if not name or len(name) > 150 or name != name.strip():
        return False
    if name.startswith(".") or name.endswith("."):
        return False
    if any(c in name for c in '<>:"/\\|?*') or any(ord(c) < 32 for c in name):
        return False
    return name.split(".")[0].upper() not in WINDOWS_RESERVED


# Lagringer skjer én om gangen. På Windows kan dessuten OneDrive, antivirus eller
# en editor holde filen et øyeblikk, så vi prøver noen ganger før vi gir opp.
WRITE_LOCK = threading.Lock()


def replace_with_retry(src, dst, tries=10):
    for i in range(tries):
        try:
            return os.replace(src, dst)
        except PermissionError:
            if i == tries - 1:
                raise
            time.sleep(0.05 * (i + 1))


def file_info(path):
    st = path.stat()
    return {"navn": path.name, "storrelse": st.st_size, "mtime": str(st.st_mtime_ns)}


class Handler(SimpleHTTPRequestHandler):
    # Riktige typer uansett hva Windows-registeret sier (moduler må være text/javascript)
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".wasm": "application/wasm",
        ".svg": "image/svg+xml",
        ".py": "text/plain; charset=utf-8",
        ".ipynb": "application/json; charset=utf-8",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        # Appens egne filer sjekkes hver gang, så endringer vises med en gang.
        # lib/ (Pyodide, OpenCV.js osv.) kan nettleseren huske.
        if not self.path.startswith(("/lib/", "/api/")):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    # ---------- Ruting ----------
    def do_GET(self):
        if self.path.startswith("/api/"):
            return self.api("GET")
        return super().do_GET()

    def do_HEAD(self):
        if self.path.startswith("/api/"):
            return self.send_json(405, {"feil": "HEAD støttes ikke for API-et"})
        return super().do_HEAD()

    def do_PUT(self):
        self.api("PUT")

    def do_POST(self):
        self.api("POST")

    def do_DELETE(self):
        self.api("DELETE")

    # ---------- Hjelpere ----------
    def send_json(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def local_request(self):
        """Host (og Origin, hvis den finnes) må peke på denne maskinen."""
        port = self.server.server_address[1]
        hosts = {f"localhost:{port}", f"127.0.0.1:{port}", f"[::1]:{port}"}
        if self.headers.get("Host", "") not in hosts:
            return False
        origin = self.headers.get("Origin")
        return origin is None or origin in {f"http://{h}" for h in hosts}

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BYTES:
            raise ValueError("for stor")
        return self.rfile.read(length) if length else b""

    # ---------- API ----------
    def api(self, method):
        if not self.local_request():
            return self.send_json(403, {"feil": "Bare sider fra denne maskinen kan bruke API-et."})
        if self.headers.get("X-Fargelab") != "1":
            return self.send_json(403, {"feil": "Mangler headeren X-Fargelab."})

        parts = [urllib.parse.unquote(p) for p in urllib.parse.urlsplit(self.path).path.split("/")[2:]]
        if parts == ["info"] and method == "GET":
            return self.send_json(200, {"ok": True, "mapper": list(FOLDERS), "versjon": 1})
        if len(parts) < 2 or parts[0] != "filer" or parts[1] not in FOLDERS:
            return self.send_json(404, {"feil": "Ukjent adresse."})

        key = parts[1]
        folder = FOLDERS[key]
        folder.mkdir(exist_ok=True)

        if len(parts) == 2:
            if method != "GET":
                return self.send_json(405, {"feil": "Bare GET virker på en mappe."})
            files = [file_info(p) for p in folder.iterdir() if p.is_file() and not p.name.startswith(".")]
            files.sort(key=lambda f: f["navn"].lower())
            return self.send_json(200, files)

        if len(parts) != 3:
            return self.send_json(404, {"feil": "Ukjent adresse."})
        name = parts[2]
        if not valid_name(name):
            return self.send_json(400, {"feil": f"Ugyldig filnavn: {name!r}"})
        allowed = ALLOWED_SUFFIXES[key]
        if allowed is not None and Path(name).suffix.lower() not in allowed:
            return self.send_json(400, {"feil": f"I {key}/ kan du bare lagre {', '.join(sorted(allowed))}-filer."})
        path = folder / name
        if path.resolve().parent != folder.resolve():
            return self.send_json(400, {"feil": "Ugyldig sti."})

        try:
            if method == "GET":
                return self.get_file(path)
            if method == "PUT":
                return self.put_file(folder, path)
            if method == "POST":
                return self.rename_file(key, folder, path)
            if method == "DELETE":
                return self.delete_file(folder, path)
        except ValueError:
            return self.send_json(413, {"feil": f"Filen er større enn {MAX_BYTES // (1024 * 1024)} MB."})
        except OSError as err:
            return self.send_json(500, {"feil": f"Kunne ikke bruke filen: {err.strerror or err}"})
        return self.send_json(405, {"feil": "Metoden støttes ikke."})

    def get_file(self, path):
        if not path.is_file():
            return self.send_json(404, {"feil": f"{path.name} finnes ikke."})
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", self.guess_type(str(path)))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Fargelab-Mtime", str(path.stat().st_mtime_ns))
        self.end_headers()
        self.wfile.write(data)

    def put_file(self, folder, path):
        expected = self.headers.get("X-Fargelab-Mtime")
        data = self.read_body()
        # Skriver til en midlertidig fil først, så filen aldri blir halvveis lagret
        tmp = folder / f".{path.name}.{os.getpid()}.{threading.get_ident()}.tmp"
        try:
            with WRITE_LOCK:
                # Sjekken og lagringen skjer under samme lås, så ingen annen lagring kommer imellom
                if expected == "ny" and path.exists():
                    return self.send_json(409, {"feil": "finnes", "melding": f"{path.name} finnes allerede."})
                if expected and expected != "ny" and path.exists() and str(path.stat().st_mtime_ns) != expected:
                    return self.send_json(409, {"feil": "endret", "melding": f"{path.name} er endret på disken.", **file_info(path)})
                tmp.write_bytes(data)
                replace_with_retry(tmp, path)
                info = file_info(path)
        finally:
            try:
                tmp.unlink(missing_ok=True)
            except OSError:
                pass
        return self.send_json(200, info)

    def rename_file(self, key, folder, path):
        try:
            new_name = json.loads(self.read_body() or b"{}").get("nyttNavn", "")
        except json.JSONDecodeError:
            return self.send_json(400, {"feil": "Ugyldig JSON."})
        if not valid_name(new_name):
            return self.send_json(400, {"feil": f"Ugyldig filnavn: {new_name!r}"})
        allowed = ALLOWED_SUFFIXES[key]
        if allowed is not None and Path(new_name).suffix.lower() not in allowed:
            return self.send_json(400, {"feil": f"I {key}/ kan du bare lagre {', '.join(sorted(allowed))}-filer."})
        if not path.is_file():
            return self.send_json(404, {"feil": f"{path.name} finnes ikke."})
        target = folder / new_name
        with WRITE_LOCK:
            if target.exists() and target.name.lower() != path.name.lower():
                return self.send_json(409, {"feil": "finnes", "melding": f"{new_name} finnes allerede."})
            replace_with_retry(path, target)
        return self.send_json(200, file_info(target))

    def delete_file(self, folder, path):
        if not path.is_file():
            return self.send_json(404, {"feil": f"{path.name} finnes ikke."})
        trash = folder / TRASH
        trash.mkdir(exist_ok=True)
        target = trash / path.name
        if target.exists():
            target = trash / f"{path.stem} {time.strftime('%Y-%m-%d %H.%M.%S')}{path.suffix}"
        with WRITE_LOCK:
            replace_with_retry(path, target)
        return self.send_json(200, {"slettet": path.name, "papirkurv": f"{folder.name}/{TRASH}/{target.name}"})


class LoopbackServer(ThreadingHTTPServer):
    daemon_threads = True


class LoopbackServer6(LoopbackServer):
    address_family = socket.AF_INET6


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    port = int(args[0]) if args else 8000
    for folder in FOLDERS.values():
        folder.mkdir(exist_ok=True)

    # Lytter på både 127.0.0.1 og ::1, så localhost virker raskt uansett,
    # men aldri på nettverket.
    servers = [LoopbackServer(("127.0.0.1", port), Handler)]
    try:
        servers.append(LoopbackServer6(("::1", port), Handler))
    except OSError:
        pass   # maskinen har ikke IPv6
    for srv in servers[1:]:
        threading.Thread(target=srv.serve_forever, daemon=True).start()

    url = f"http://localhost:{port}"
    print(f"Fargelab kjører på {url}  (Ctrl+C stopper serveren)")
    print(f"Skript lagres i {FOLDERS['skript']}")
    print(f"Bilder hentes fra {FOLDERS['bilder']}")
    sys.stdout.flush()
    if any(a in ("--åpne", "--apne", "--open") for a in sys.argv[1:]):
        webbrowser.open(url)
    try:
        servers[0].serve_forever()
    except KeyboardInterrupt:
        print("\nStoppet.")
    finally:
        for srv in servers:
            srv.server_close()


if __name__ == "__main__":
    main()

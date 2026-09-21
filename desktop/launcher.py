"""Offline launcher for Desafio BobRoll (events without internet).

Starts a tiny local web server that serves the game files bundled inside the
.exe, emulates leaderboard.php, and opens the game in an app-style Edge/Chrome
window. Closing that window exits.

Event mode (only in this offline build, the website never has it):
  * the game asks for name + phone before playing
  * every play is stored in participantes.json next to the .exe (so it
    travels with the pendrive) - the public ranking never exposes phones
  * Ctrl+Shift+E in the game downloads participantes.xlsx
    (Nome, Telefone, Pontuação, Data) and also saves a copy next to the .exe
"""
import io
import json
import os
import subprocess
import sys
import threading
import webbrowser
import zipfile
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from xml.sax.saxutils import escape

FROZEN = getattr(sys, "frozen", False)
BUNDLE_DIR = getattr(sys, "_MEIPASS", None) or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.dirname(sys.executable) if FROZEN else BUNDLE_DIR
PARTICIPANTS_FILE = os.path.join(DATA_DIR, "participantes.json")
EXCEL_COPY = os.path.join(DATA_DIR, "participantes.xlsx")
BROWSER_PROFILE = os.path.join(DATA_DIR, "browser-data")
PORTS = range(8765, 8785)
MAX_RETURNED = 10
lock = threading.Lock()


def read_entries():
    try:
        with open(PARTICIPANTS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def public_top(entries, limit):
    ranked = sorted(entries, key=lambda e: e.get("score", 0), reverse=True)[:limit]
    return [{"name": e["name"], "score": e["score"], "date": e.get("played_at", "")[:10]} for e in ranked]


def format_phone(digits):
    if len(digits) == 11:
        return f"({digits[:2]}) {digits[2:7]}-{digits[7:]}"
    if len(digits) == 10:
        return f"({digits[:2]}) {digits[2:6]}-{digits[6:]}"
    return digits


def build_xlsx(entries):
    """Minimal .xlsx writer (no third-party dependency)."""
    def text_cell(ref, value, style=0):
        return f'<c r="{ref}" t="inlineStr" s="{style}"><is><t>{escape(str(value))}</t></is></c>'

    rows = ['<row r="1">' + "".join(
        text_cell(f"{col}1", title, 1) for col, title in zip("ABCD", ["Nome", "Telefone", "Pontuação", "Data"])
    ) + "</row>"]
    for i, e in enumerate(entries, start=2):
        played = e.get("played_at", "")
        try:
            played = datetime.strptime(played, "%Y-%m-%d %H:%M:%S").strftime("%d/%m/%Y %H:%M")
        except ValueError:
            pass
        rows.append(
            f'<row r="{i}">'
            + text_cell(f"A{i}", e.get("name", ""))
            + text_cell(f"B{i}", format_phone(e.get("phone", "")))
            + f'<c r="C{i}"><v>{int(e.get("score", 0))}</v></c>'
            + text_cell(f"D{i}", played)
            + "</row>"
        )
    sheet = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<cols><col min="1" max="1" width="18" customWidth="1"/><col min="2" max="2" width="18" customWidth="1"/>'
        '<col min="3" max="3" width="12" customWidth="1"/><col min="4" max="4" width="20" customWidth="1"/></cols>'
        "<sheetData>" + "".join(rows) + "</sheetData></worksheet>"
    )
    styles = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>'
        '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        "</styleSheet>"
    )
    parts = {
        "[Content_Types].xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
            "</Types>"
        ),
        "_rels/.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            "</Relationships>"
        ),
        "xl/workbook.xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            '<sheets><sheet name="Participantes" sheetId="1" r:id="rId1"/></sheets></workbook>'
        ),
        "xl/_rels/workbook.xml.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
            "</Relationships>"
        ),
        "xl/worksheets/sheet1.xml": sheet,
        "xl/styles.xml": styles,
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, content in parts.items():
            z.writestr(name, content)
    return buf.getvalue()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BUNDLE_DIR, **kwargs)

    def log_message(self, *args):
        pass

    def _json(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        route = self.path.split("?")[0]
        if route == "/event-mode.json":
            self._json(200, {"event": True})
        elif route == "/leaderboard.php":
            with lock:
                self._json(200, public_top(read_entries(), MAX_RETURNED))
        elif route == "/export.xlsx":
            with lock:
                data = build_xlsx(read_entries())
            try:
                with open(EXCEL_COPY, "wb") as f:
                    f.write(data)
            except OSError:
                pass
            self.send_response(200)
            self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            self.send_header("Content-Disposition", 'attachment; filename="participantes.xlsx"')
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        else:
            super().do_GET()

    def do_POST(self):
        if self.path.split("?")[0] != "/leaderboard.php":
            return self._json(404, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
            name = str(body.get("name", "")).replace("<", "").replace(">", "").strip()[:10] or "Jogador"
            phone = "".join(ch for ch in str(body.get("phone", "")) if ch.isdigit())[:11]
            score = int(body.get("score", -1))
        except (ValueError, TypeError):
            return self._json(400, {"error": "invalid body"})
        if score < 0 or score > 5_000_000:
            return self._json(400, {"error": "invalid score"})
        with lock:
            entries = read_entries()
            entries.append({
                "name": name,
                "phone": phone,
                "score": score,
                "played_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            })
            try:
                with open(PARTICIPANTS_FILE, "w", encoding="utf-8") as f:
                    json.dump(entries, f, ensure_ascii=False)
            except OSError:
                return self._json(500, {"error": "storage unavailable"})
            self._json(200, public_top(entries, MAX_RETURNED))


def start_server():
    for port in PORTS:
        try:
            return ThreadingHTTPServer(("127.0.0.1", port), Handler), port
        except OSError:
            continue
    raise RuntimeError("no free port")


def find_browser():
    pf = [os.environ.get("ProgramFiles", r"C:\Program Files"), os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")]
    local = os.environ.get("LOCALAPPDATA", "")
    candidates = []
    for base in pf:
        candidates.append(os.path.join(base, "Microsoft", "Edge", "Application", "msedge.exe"))
        candidates.append(os.path.join(base, "Google", "Chrome", "Application", "chrome.exe"))
    candidates.append(os.path.join(local, "Google", "Chrome", "Application", "chrome.exe"))
    return next((c for c in candidates if os.path.isfile(c)), None)


def main():
    server, port = start_server()
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{port}/index.html"
    browser = find_browser()
    if browser:
        os.makedirs(BROWSER_PROFILE, exist_ok=True)
        proc = subprocess.Popen([
            browser, f"--app={url}", f"--user-data-dir={BROWSER_PROFILE}",
            "--start-maximized", "--no-first-run", "--disable-features=Translate",
            "--autoplay-policy=no-user-gesture-required",
        ])
        proc.wait()
    else:
        webbrowser.open(url)
        threading.Event().wait()
    server.shutdown()


if __name__ == "__main__":
    main()

"""Offline launcher for Desafio BobRoll (events without internet).

Starts a tiny local web server that serves the game files bundled inside the
.exe, emulates leaderboard.php (ranking saved in leaderboard.json next to the
.exe, so it survives between sessions and travels with the pendrive), and
opens the game in an app-style Edge/Chrome window. Closing that window exits.
"""
import json
import os
import subprocess
import sys
import threading
import webbrowser
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

FROZEN = getattr(sys, "frozen", False)
BUNDLE_DIR = getattr(sys, "_MEIPASS", None) or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.dirname(sys.executable) if FROZEN else BUNDLE_DIR
LEADERBOARD_FILE = os.path.join(DATA_DIR, "leaderboard.json")
BROWSER_PROFILE = os.path.join(DATA_DIR, "browser-data")
PORTS = range(8765, 8785)
MAX_STORED, MAX_RETURNED = 100, 10
lock = threading.Lock()


def read_entries():
    try:
        with open(LEADERBOARD_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def top(entries, limit):
    return sorted(entries, key=lambda e: e.get("score", 0), reverse=True)[:limit]


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
        if self.path.split("?")[0] == "/leaderboard.php":
            with lock:
                self._json(200, top(read_entries(), MAX_RETURNED))
        else:
            super().do_GET()

    def do_POST(self):
        if self.path.split("?")[0] != "/leaderboard.php":
            return self._json(404, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
            name = str(body.get("name", "")).replace("<", "").replace(">", "").strip()[:10] or "Jogador"
            score = int(body.get("score", -1))
        except (ValueError, TypeError):
            return self._json(400, {"error": "invalid body"})
        if score < 0 or score > 5_000_000:
            return self._json(400, {"error": "invalid score"})
        with lock:
            entries = read_entries()
            entries.append({"name": name, "score": score, "date": datetime.now(timezone.utc).strftime("%Y-%m-%d")})
            entries = top(entries, MAX_STORED)
            try:
                with open(LEADERBOARD_FILE, "w", encoding="utf-8") as f:
                    json.dump(entries, f, ensure_ascii=False)
            except OSError:
                return self._json(500, {"error": "storage unavailable"})
            self._json(200, top(entries, MAX_RETURNED))


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

#!/usr/bin/env python3
"""Optional local helper for the Diffraction Annotator.

Serves the app at http://127.0.0.1:8765 and forwards /mp/* requests to the Materials Project API
(browsers cannot call that API directly because it does not send CORS headers).

API key: MP_API_KEY environment variable, or a line MP_API_KEY=... in a .env file next to this script.
Standard library only.   Usage:  python3 serve.py [--port 8765] [--data FOLDER]
"""
import argparse, json, mimetypes, os, sys, urllib.parse, urllib.request, webbrowser
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, 'dist', 'diffraction_annotator.html')
MP = 'https://api.materialsproject.org/'


def api_key():
    k = os.environ.get('MP_API_KEY')
    envf = os.path.join(HERE, '.env')
    if not k and os.path.exists(envf):
        for line in open(envf):
            if line.strip().startswith('MP_API_KEY='):
                k = line.split('=', 1)[1].strip()
    return k


class H(BaseHTTPRequestHandler):
    data_dir = None
    save_dir = None

    def log_message(self, fmt, *a):
        sys.stderr.write('  ' + (fmt % a) + '\n')

    def send(self, code, body, ctype='application/json'):
        if isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        # test helper (only with --debug-save): store an uploaded PNG so rendering can be inspected
        path = urllib.parse.urlparse(self.path).path
        if self.save_dir and path.startswith('/debug/save/'):
            name = os.path.basename(urllib.parse.unquote(path[len('/debug/save/'):])) or 'out.png'
            n = int(self.headers.get('Content-Length', 0))
            open(os.path.join(self.save_dir, name), 'wb').write(self.rfile.read(n))
            return self.send(200, '{"ok":true}')
        return self.send(404, '{}')

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path in ('/', '/index.html'):
            return self.send(200, open(APP, 'rb').read(), 'text/html; charset=utf-8')
        if path == '/mp/ping':
            return self.send(200, json.dumps({'ok': bool(api_key() or self.headers.get('X-API-KEY')), 'hasKey': bool(api_key())}))
        if path.startswith('/mp/'):
            key = self.headers.get('X-API-KEY') or api_key()
            if not key:
                return self.send(401, json.dumps({'error': 'No Materials Project API key. Set MP_API_KEY or add it to .env'}))
            url = MP + self.path[len('/mp/'):]
            req = urllib.request.Request(url, headers={'X-API-KEY': key, 'accept': 'application/json', 'User-Agent': 'tem-diffraction-annotator/1.0'})
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    return self.send(r.status, r.read())
            except urllib.error.HTTPError as e:
                return self.send(e.code, e.read())
            except Exception as e:
                return self.send(502, json.dumps({'error': str(e)}))
        if self.data_dir and path.startswith('/files/'):
            # test/demo helper: list or serve files from --data (read-only, no path escapes)
            rel = urllib.parse.unquote(path[len('/files/'):])
            full = os.path.realpath(os.path.join(self.data_dir, rel))
            if not full.startswith(os.path.realpath(self.data_dir)):
                return self.send(403, '{}')
            if os.path.isdir(full):
                items = []
                for root, _, files in os.walk(full):
                    for f in files:
                        items.append(os.path.relpath(os.path.join(root, f), self.data_dir))
                return self.send(200, json.dumps(sorted(items)))
            if os.path.isfile(full):
                return self.send(200, open(full, 'rb').read(), mimetypes.guess_type(full)[0] or 'application/octet-stream')
        return self.send(404, json.dumps({'error': 'not found'}))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8765)
    ap.add_argument('--host', default='127.0.0.1', help='address to listen on (the container uses 0.0.0.0)')
    ap.add_argument('--data', help='optional folder to expose read-only under /files/ (for demos/tests)')
    ap.add_argument('--no-browser', action='store_true')
    ap.add_argument('--debug-save', help=argparse.SUPPRESS)
    a = ap.parse_args()
    if not os.path.exists(APP):
        sys.exit('Build the app first:  python3 build.py')
    H.data_dir = os.path.abspath(a.data) if a.data else None
    H.save_dir = os.path.abspath(a.debug_save) if a.debug_save else None
    srv = ThreadingHTTPServer((a.host, a.port), H)
    url = f'http://127.0.0.1:{a.port}/'
    print(f'Diffraction Annotator running at {url}  (Materials Project key: {"found" if api_key() else "not set"})')
    if not a.no_browser:
        webbrowser.open(url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()

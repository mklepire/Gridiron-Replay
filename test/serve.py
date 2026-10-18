# Local dev server that mimics Vercel's rewrites: unknown paths under /l/ and /demo serve index.html.
import http.server, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def do_GET(self):
        p = self.path.split('?')[0]
        if p.startswith('/l/') or p == '/demo': self.path = '/index.html'
        return super().do_GET()
http.server.ThreadingHTTPServer(('', int(sys.argv[1]) if len(sys.argv) > 1 else 8000), H).serve_forever()

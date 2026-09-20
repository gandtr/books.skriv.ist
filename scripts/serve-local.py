#!/usr/bin/env python3
"""Serve only the built app shell over loopback. Never serves books or other folders."""
import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
ROOT=Path(__file__).resolve().parents[1]/'dist'
class Handler(SimpleHTTPRequestHandler):
    def translate_path(self,path):
        decoded=unquote(urlsplit(path).path)
        parts=Path(decoded.lstrip('/')).parts
        if any(part.startswith('.') for part in parts):
            return str(ROOT/'__blocked__')
        target=(ROOT/decoded.lstrip('/')).resolve()
        if not target.is_relative_to(ROOT.resolve()):return str(ROOT/'__blocked__')
        return str(target)
    def end_headers(self):
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','no-referrer')
        self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self' https: http: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'none'")
        super().end_headers()
    def list_directory(self,path):
        self.send_error(403,'Directory listings are disabled')
    def log_message(self,*args):pass
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port',type=int,default=8580)
args=parser.parse_args()
if not (ROOT/'index.html').is_file():parser.error('Run npm ci and npm run build first.')
print(f'Skrivist Books: http://127.0.0.1:{args.port}',flush=True)
ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()

#!/usr/bin/env python3
"""Install an idempotent Custom-menu entry and desktop launcher; preserve user config."""
import argparse
import json
import os
from pathlib import Path
import shutil
import time
from urllib.parse import urlparse

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='https://books.skriv.ist')
args = parser.parse_args()
url = urlparse(args.url)
if url.scheme not in ('http', 'https') or not url.netloc or any(c in args.url for c in '\n\r"`$%\\'):
    parser.error('Expected a plain HTTP(S) URL')
config = Path(os.environ.get('XDG_CONFIG_HOME', str(Path.home() / '.config')))
data = Path(os.environ.get('XDG_DATA_HOME', str(Path.home() / '.local/share')))
menu = config / 'omarchy/extensions/omarchy-menu.jsonc'
menu.parent.mkdir(parents=True, exist_ok=True)
text = menu.read_text() if menu.exists() else '{}\n'
start, end = '// BEGIN skrivist.books', '// END skrivist.books'
if start in text:
    a, b = text.index(start), text.index(end) + len(end)
    text = text[:a] + text[b:]
else:
    # New block starts with its own comma, preserving all original comments.
    pass
entries = {
    'custom.skrivist-books': {'parent': 'custom', 'icon':'󰂺','label':'Skrivist Books','description':'Local EPUB/PDF files and OPDS catalogues','action':f'omarchy launch webapp "{args.url}"'},
}
# A shared Custom menu may already exist. Never overwrite it.
import re
if not re.search(r'"custom"\s*:', text):
    entries = {'custom': {'icon':'󰀻','label':'Custom'}, **entries}
tokens = re.finditer(r'"(?:\\.|[^"\\])*"|//[^\n]*|/\*[\s\S]*?\*/|}', text)
positions = [m.start() for m in tokens if m.group(0) == '}']
position = positions[-1] if positions else -1
if position < 0:
    raise SystemExit('Menu is not an object; no files changed')
body = json.dumps(entries, ensure_ascii=False, indent=2)[1:-1].strip()
prefix = text[:position].rstrip()
# A previous managed block includes its separating comma inside its markers.
# Ignore JSONC comments when deciding whether the previous member has a comma.
clean = re.sub(r'"(?:\\.|[^"\\])*"|//[^\n]*|/\*[\s\S]*?\*/', lambda m: m.group(0) if m.group(0).startswith('"') else '', prefix)
needs_comma = not clean.rstrip().endswith(('{', ','))
block = '\n  ' + start + '\n' + (',' if needs_comma else '') + '\n' + body + '\n  ' + end + '\n'
if menu.exists(): shutil.copy2(menu, menu.with_suffix(f'.jsonc.bak.{time.time_ns()}'))
menu.write_text(prefix + block + text[position:])
apps = data / 'applications'; apps.mkdir(parents=True, exist_ok=True)
(apps / 'skrivist-books-spa.desktop').write_text('[Desktop Entry]\nType=Application\nName=Skrivist Books\nComment=Local-first ebook reader\nExec=omarchy launch webapp "' + args.url + '"\nIcon=accessories-text-editor\nTerminal=false\nCategories=Office;Viewer;\n')
print('Installed Skrivist Books in Custom and the application launcher.')

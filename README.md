# Skrivist Books

A quiet, lightweight ebook reader. **[Open books.skriv.ist](https://books.skriv.ist)**

A static SPA that runs in your browser. No account, backend, cloud library, or uploads; page visits are counted with cookie-free Cloudflare Web Analytics. Separate from app.skriv.ist. Every installation starts empty; no personal books, folders, credentials, or server configuration are bundled.

## Read

- Add EPUB or PDF files, or explicitly select a folder. Files stay in IndexedDB on your device.
- Paginated EPUB reading, contents navigation, text size, light/dark themes, and keyboard navigation. Reader paper choices: Match theme, White, Cream, Sepia, Sage, and Night. The paper choice stays on this device and applies to EPUB text and PDF foreground/background rendering; Match theme keeps original PDF colors.
- PDF rendering code runs on demand. The initial UI is small; offline assets download in the background.
- Reading positions, progress, read/unread filters, and 24-book library pages.
- Install as a PWA. Wait for the “Ready to read offline” notice on the first visit. The app and PDF fonts/codecs (about 6 MB total) are then cached for offline reading.
- Keep original files: browser storage can be cleared or evicted. The About panel can request persistent storage. No cross-device syncing.

Use arrow keys or Page Up/Down to turn pages and Escape to return to the shelf. Mark a book read when finished; marking it unread resets its reading position. File imports are limited to 128 MB each; encrypted/DRM-protected books are not supported. EPUB presentation is adapted for readable, safe text rather than reproducing publisher layouts or scripts.

## Notes and Obsidian

Select text in an EPUB or text-based PDF, then choose **Add note**. Add your own thoughts, or save a quotation by itself. You can also add a note without a selection at the current chapter/spread or PDF page. **Notes** lists the book’s annotations, lets you edit them, and jumps back to their locations. Scanned PDFs without a text layer support page notes but not text selection; OCR is not included.

Notes are stored locally in IndexedDB. In **Obsidian destination**, enter your vault name and a folder within it (default `Reading`). **Save & open Obsidian** saves the note locally and passes Markdown to the installed Obsidian app using its built-in URI handler. No community plugin, API key, account, vault scanning, or book upload is needed. Spaces in Obsidian links use `%20`, preserving spaces in filenames and note text. Notes exported by v1.1.0 may already contain literal `+` characters: rename or edit those copies in Obsidian, or export the saved local note again. The app does not modify existing vault files. The browser may ask to open Obsidian. It cannot confirm that Obsidian completed the write.

Exports include title, author, quotation, your note, reading location, and a link back to that location. The same book file must be present in the browser at the linked reader origin. The EPUB location is a chapter and proportional spread position, so a different font size or screen width may change the visible text around it. Export is one-way; it never requests overwriting existing Obsidian files. To edit an exported copy, use Obsidian, or export another copy. Large notes that exceed app-link limits can be downloaded as Markdown; **Download all Markdown** exports a book’s notes together. Keep exported backups: removing a book deletes its local notes too.

## Anki

In **Notes**, choose **Anki ↓** for one saved note or **Export all to Anki** for the book. This downloads a UTF-8 CSV; nothing is sent to a server or AnkiWeb. In desktop Anki, choose **File → Import**, select the CSV and a standard two-field **Basic** note type, map Front/Back if needed, and choose your deck. Anki 2.1.54+ reads the included separator, HTML, field, and tag headers automatically.

The quotation becomes the front; your note, title, author, location, and return link become the back. A note without a quotation uses a question about that reading location as its front. Edit the cards in Anki to refine your questions. Text is escaped before HTML formatting, so imported book text and notes cannot load remote images or inject markup. Cards get the `skrivist-books` tag. Anki matches duplicates by the first field: review its duplicate settings when importing repeated quotations or re-exporting. This is a file export, not live synchronization.

## Calibre database integration

Open **Calibre → Choose library folder** and select the library root containing `metadata.db`. Close Calibre first so its database is fully saved. The reader opens a **read-only, in-memory SQLite snapshot** in a background worker. Nothing is uploaded or written back, and no library is connected automatically.

Browse 24 books per page. Search titles, authors, series, or tags and filter by EPUB/PDF. **Read EPUB / Read PDF** reads only that file and saves it in this browser for offline reading. Calibre's title and author are used when adding a new book. A previously imported identical file retains its notes and reading progress. Other formats are listed; convert them in Calibre before reading. Calibre's own annotations, custom columns, and reading positions are not synchronized.

On browsers supporting the File System Access API, folder access is read-only and files are resolved on demand without recursively scanning the library. **Use compatible folder picker** works in other browsers; it enumerates filenames but reads book contents only when you choose a book. Both methods require explicit folder selection. Metadata and folder references remain in this page's memory and are released when you reload or disconnect; already opened books remain in your browser library.

Use **Refresh library** after changing metadata in Calibre (close Calibre again first). The compatible picker asks you to select the folder again for a fresh snapshot. Database snapshots are limited to 64 MB; pending SQLite WAL/journal files are rejected to avoid displaying an incomplete snapshot. Path traversal outside the selected root is rejected. A missing or moved book reports an error rather than searching other folders. For larger or remotely hosted libraries, use Calibre's OPDS feed through **Catalogues** instead.

## OPDS

Add your own OPDS 1 (Atom) or OPDS 2 catalogue in **Catalogues**. Save connections and individual shelves. Browse 24 entries at a time; server pagination is followed only when needed. Book files download only when you press **Read book**, then remain available locally.

Requests go directly from your browser to your catalogue. The server must permit CORS for your reader's origin (including the Authorization header for Basic login). The public HTTPS app needs an HTTPS catalogue. To use a local HTTP catalogue, run the local app below and allow its origin on your server. There is no public proxy.

Passwords remain in memory for the current session, scoped to the catalogue origin and username. Saved feed URLs may contain access tokens, so treat this browser profile as private. Redirects are disabled to prevent credential forwarding; enter the final feed URL. A server without pagination still sends its metadata listing, but books are always fetched individually.

## Omarchy

Install the webapp launcher and **Custom → Skrivist Books** entry:

```sh
git clone https://github.com/gandtr/books.skriv.ist.git
cd books.skriv.ist
python3 scripts/install-omarchy.py
```

This preserves other menu entries and backs up the menu before editing. It creates `skrivist-books-spa.desktop`, so existing local ebook services are not replaced.

An optional bar widget is included in `manifest.json` and `omarchy/Books.qml`. Install with `omarchy plugin add https://github.com/gandtr/books.skriv.ist.git --yes`, then optionally run `omarchy plugin enable skrivist.books`. It launches the app and does not scan or import any files. The `url` setting can point at a local installation.

### Fully local installation

```sh
npm ci
npm run build
python3 scripts/serve-local.py --port 8580
python3 scripts/install-omarchy.py --url http://127.0.0.1:8580
```

The optional server binds loopback and serves only `dist/`. It does not read ebook folders or expose an API. Book files still come only from explicit browser file selection or your chosen OPDS catalogue. For automatic startup, run this command as a systemd user service.

## Development

Node 22.12 or newer:

```sh
npm ci
npm run dev
npm run check
npm test
npm run build
```

Tests use generated fixtures, never a personal library. `dist/` is the entire deployable app. Deploy it to any static host with SPA fallback and the supplied `_headers`. The service worker caches the shell and first-party runtime assets only, not OPDS requests or credentials.

## Release

Deployments are manual. `.github/workflows/deploy.yml` runs checks, tests, and the build before uploading to the Cloudflare Pages project `books-skriv-ist`. Configure `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets for CI. The custom domain belongs only to this static project; no personal server is exposed.

MIT licensed. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

# Skrivist Books

A quiet, lightweight ebook reader. **[Open books.skriv.ist](https://books.skriv.ist)**

A static SPA that runs in your browser. No account, backend, cloud library, analytics, or uploads. Separate from app.skriv.ist. Every installation starts empty; no personal books, folders, credentials, or server configuration are bundled.

## Read

- Add EPUB or PDF files, or explicitly select a folder. Files stay in IndexedDB on your device.
- Paginated EPUB reading, contents navigation, text size, light/dark themes, and keyboard navigation.
- PDF rendering code runs on demand. The initial UI is small; offline assets download in the background.
- Reading positions, progress, read/unread filters, and 24-book library pages.
- Install as a PWA. Wait for the “Ready to read offline” notice on the first visit. The app and PDF fonts/codecs (about 6 MB total) are then cached for offline reading.
- Keep original files: browser storage can be cleared or evicted. The About panel can request persistent storage. No cross-device syncing.

Use arrow keys or Page Up/Down to turn pages and Escape to return to the shelf. Mark a book read when finished; marking it unread resets its reading position. File imports are limited to 128 MB each; encrypted/DRM-protected books are not supported. EPUB presentation is adapted for readable, safe text rather than reproducing publisher layouts or scripts.

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

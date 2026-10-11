<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { safeUrl, type Feed, type Entry, type Link } from '../lib/feed';
  import {
    plainRequest,
    splitToken,
    rememberConnection,
    rememberPairing,
    pairedToken,
    forgetConnection,
    savedConnection,
    getFeed,
    getBookFile,
    type Connection,
  } from '../lib/opds';
  import { listBooks, getFile, type Book } from '../lib/store';
  import { saveShelf, shelves, forgetShelf, type Shelf } from '../lib/shelves';
  import { importBook } from '../lib/import';
  import { pairingTarget } from '../lib/pair';
  import CatalogueFeed from './CatalogueFeed.svelte';
  export let onread: (book: Book) => void;
  export let onadded: () => void;
  /** The latest pairing link (id counts scans): filled in, never fetched until Connect. */
  export let pairing: { url: string; id: number } = { url: '', id: 0 };
  /** Called once the pairing link is taken, so its owner can drop it for good. */
  export let onpaired: () => void = () => {};
  let saved: Shelf[] = [],
    url = '',
    username = '',
    password = '',
    feed: Feed | null = null,
    feedUrl = '',
    connection: Connection | null = null,
    // The connection a request in flight will use, shown or not yet.
    loading: Connection | undefined;
  let busy = false,
    error = '',
    notice = '',
    downloading = '',
    history: string[] = [];
  let controller: AbortController | undefined;
  let downloadController: AbortController | undefined;
  let pendingShelf: Shelf | undefined;
  let appliedPairing = 0;
  $: if (pairing.url && pairing.id !== appliedPairing) {
    appliedPairing = pairing.id;
    // A new library: drop the old one's request, feed and connection, so nothing
    // from it lands on screen or in the shelves. A running download keeps going.
    controller?.abort();
    controller = undefined;
    loading = undefined;
    busy = false;
    feed = null;
    feedUrl = '';
    connection = null;
    history = [];
    pendingShelf = undefined;
    url = heldPairing(pairing.url);
    username = '';
    password = '';
    error = '';
    if (!downloading) notice = '';
    onpaired();
  }
  onMount(() => {
    shelves()
      .then((value) => (saved = value))
      .catch((e) => (error = e.message));
  });
  onDestroy(() => {
    controller?.abort();
    downloadController?.abort();
  });
  async function load(target: string, from: Connection, remember = true) {
    controller?.abort();
    const current = new AbortController();
    controller = current;
    loading = from;
    busy = true;
    error = '';
    notice = '';
    try {
      // A /opds/t/<token>/ URL becomes a plain one plus a Bearer token: the
      // token stays out of every URL we fetch, keep in history or store.
      const plain = plainRequest(safeUrl(target), from);
      target = plain.target;
      const conn = plain.connection;
      const parsed = await getFeed(target, conn, current.signal);
      if (current !== controller) return;
      feed = parsed;
      feedUrl = target;
      connection = conn;
      rememberConnection(conn);
      // Paired: the form keeps the plain URL, the token lives with the connection.
      if (remember && url === from.url) url = conn.url;
      if (remember) {
        await saveShelf({
          url: target,
          title: parsed.title,
          username: conn.username,
          connectionUrl: conn.url,
          token: conn.token,
        });
        saved = await shelves();
      }
    } catch (e) {
      if (!current.signal.aborted) error = (e as Error).message;
    } finally {
      if (current === controller) {
        busy = false;
        loading = undefined;
      }
    }
  }
  /** A pairing link's catalogue URL for the form. Its token is held for this session
   * (Connect finds it there), never shown. */
  function heldPairing(value: string): string {
    const paired = splitToken(pairingTarget(value));
    if (paired.token)
      rememberPairing({
        url: paired.url,
        username: '',
        password: '',
        token: paired.token,
      });
    return paired.url;
  }
  function connect() {
    history = [];
    // A whole pairing link pasted into the form connects to the catalogue inside it;
    // a token in the typed URL is that connection's, whatever the login fields hold.
    const typed = splitToken(pairingTarget(url)).token;
    url = heldPairing(url);
    const shelf =
      pendingShelf &&
      pendingShelf.connectionUrl === url &&
      pendingShelf.username === username
        ? pendingShelf
        : undefined;
    // A paired form shows the plain URL: the token comes from a pairing applied
    // here, this session or the shelf. A typed password is a login and wins; a
    // username alone does not log in to Armarium, so it keeps the held pairing.
    let token: string | undefined = typed;
    if (!token && !password) {
      try {
        token =
          pairedToken(url, '') ||
          savedConnection(url, username)?.token ||
          savedConnection(url, '')?.token;
      } catch {
        // Not a URL: load() reports it.
      }
      token ||= shelf?.token;
    }
    // A pairing is a token connection: a username left in the form does not ride
    // along, so its shelves stay one connection (one token, forgotten together).
    const conn: Connection = token
      ? { url, username: '', password: '', token }
      : { url, username, password };
    pendingShelf = undefined;
    load(shelf ? shelf.url : url, conn);
  }
  function savedOpen(shelf: Shelf) {
    pendingShelf = shelf;
    const session = savedConnection(shelf.connectionUrl, shelf.username);
    // A paired shelf keeps its token on this device, so it opens after a reload.
    // Newest first: a pairing link applied in this page, then a password typed this
    // session, then the shelf's own token (saving a pairing gives it to every shelf
    // of the connection), which wins over a token this page merely remembers.
    const token =
      pairedToken(shelf.connectionUrl, shelf.username) ??
      (session?.password ? undefined : shelf.token);
    const conn: Connection | undefined = token
      ? {
          url: shelf.connectionUrl,
          username: shelf.username,
          password: session?.password ?? '',
          token,
        }
      : session;
    url = shelf.connectionUrl;
    username = shelf.username;
    password = '';
    history = [];
    if (!conn) {
      notice = 'Enter the catalogue password for this session, then connect.';
      return;
    }
    load(shelf.url, conn, false);
  }

  async function forget(shelf: Shelf) {
    // One identity everywhere: the catalogue's connection URL and the login.
    const same = (c: { url: string; username: string }) => {
      try {
        return (
          splitToken(c.url).url === shelf.connectionUrl &&
          c.username === shelf.username
        );
      } catch {
        return false;
      }
    };
    // Forgetting the catalogue itself forgets every shelf saved from it.
    const root = shelf.url === shelf.connectionUrl;
    const others = saved.some(
      (s) =>
        s.url !== shelf.url &&
        s.connectionUrl === shelf.connectionUrl &&
        s.username === shelf.username,
    );
    // Stop whatever uses these credentials before touching storage, shown or
    // not: a load still in flight would otherwise put the connection back.
    if (loading && same(loading)) {
      controller?.abort();
      controller = undefined;
      loading = undefined;
      busy = false;
    }
    if (connection && same(connection)) {
      connection = null;
      feed = null;
      controller?.abort();
      downloadController?.abort();
    }
    forgetConnection(shelf.connectionUrl, shelf.username);
    password = '';
    // A shelf being opened goes with it, or with its catalogue: Connect must not bring it back.
    if (
      pendingShelf &&
      (pendingShelf.url === shelf.url ||
        (root &&
          same({
            url: pendingShelf.connectionUrl,
            username: pendingShelf.username,
          })))
    )
      pendingShelf = undefined;
    // A token still in the form would let Connect bring the shelf back.
    const typed = splitToken(url);
    if (typed.token && same({ url, username: shelf.username })) url = typed.url;
    await forgetShelf(shelf.url, root ? shelf : undefined);
    saved = await shelves();
    notice =
      root && others
        ? `Forgot ${shelf.title} and its saved shelves.`
        : `Forgot ${shelf.title}.`;
  }
  function back() {
    if (!connection || !history.length) return;
    const target = history.at(-1)!;
    history = history.slice(0, -1);
    load(target, connection, false);
  }
  /** Opens a link of the feed: forward into it (Back returns), or to its previous page. */
  function follow(link: Link, forward: boolean) {
    if (!connection) return;
    if (forward) history = [...history, feedUrl];
    load(link.href, connection, false);
  }
  async function read(entry: Entry, link: Link) {
    if (!connection || downloading) return;
    const conn = { ...connection };
    const originFeed = feedUrl;
    const current = new AbortController();
    downloadController = current;
    downloading = link.href;
    error = '';
    notice = `Fetching ${entry.title}…`;
    try {
      const existing = (await listBooks()).find(
        (book) =>
          book.remote?.href === link.href &&
          book.remote?.username === conn.username &&
          new URL(book.remote.connectionUrl).origin ===
            new URL(conn.url).origin,
      );
      if (existing && (await getFile(existing.id))) {
        onread(existing);
        notice = '';
        return;
      }
      const file = await getBookFile(entry, link, conn, current.signal);
      const book = await importBook(
        file,
        {
          href: link.href,
          feedUrl: originFeed,
          connectionUrl: conn.url,
          username: conn.username,
        },
        current.signal,
      );
      onadded();
      notice = 'Saved on this device.';
      onread(book);
    } catch (e) {
      notice = current.signal.aborted ? 'Download cancelled.' : '';
      if (!current.signal.aborted) error = (e as Error).message;
    } finally {
      downloading = '';
    }
  }
  async function saveCurrent() {
    if (!connection || !feed) return;
    try {
      await saveShelf({
        url: feedUrl,
        title: feed.title,
        connectionUrl: connection.url,
        username: connection.username,
        token: connection.token,
      });
      saved = await shelves();
      notice = 'Shelf saved. Books download only when you open them.';
    } catch (e) {
      error = (e as Error).message;
    }
  }
</script>

<section class="catalogue">
  <div class="section-heading">
    <div>
      <span class="eyebrow">Your shelves, wherever they live</span>
      <h1>Catalogues</h1>
      <p>
        Connect once. Browse a shelf. Bring home only the book you want to read.
      </p>
    </div>
  </div>
  <form
    class="connection-panel"
    onsubmit={(e) => {
      e.preventDefault();
      connect();
    }}
  >
    <label class="url-field"
      >OPDS catalogue URL<input
        type="url"
        required
        autocomplete="off"
        bind:value={url}
        placeholder="https://your-server.example/opds"
      /></label
    >
    <label
      >Username <span class="optional">optional</span><input
        autocomplete="username"
        bind:value={username}
      /></label
    >
    <label
      >Password <span class="optional">this session only</span><input
        type="password"
        autocomplete="off"
        bind:value={password}
      /></label
    >
    <button class="primary" disabled={busy}
      >{busy ? 'Connecting…' : 'Connect catalogue'}</button
    >
  </form>
  <p class="small-note">
    Connects directly to your server. It must allow browser access (CORS). The
    public app needs an HTTPS catalogue; a local installation can use HTTP.
    Pairing tokens are kept on this device; passwords are never saved.
  </p>
  {#if error}<p class="message error" role="alert">{error}</p>{/if}
  {#if notice}<p class="message" role="status">
      {notice}
      {#if downloading}<button
          class="quiet"
          onclick={() => {
            downloadController?.abort();
            notice = 'Download cancelled.';
          }}>Cancel download</button
        >{/if}
    </p>{/if}
  {#if saved.length}<div class="saved-shelves">
      <span class="eyebrow">Saved shelves</span
      >{#each saved as shelf (shelf.url)}<div class="saved-shelf">
          <button onclick={() => savedOpen(shelf)}
            >{shelf.title}<span>{new URL(shelf.url).hostname}</span></button
          ><button
            class="quiet"
            aria-label={`Forget ${shelf.title}`}
            onclick={() => forget(shelf).catch((e) => (error = e.message))}
            >×</button
          >
        </div>{/each}
    </div>{/if}
  {#if feed}<CatalogueFeed
      {feed}
      {feedUrl}
      {busy}
      {downloading}
      canGoBack={history.length > 0}
      onback={back}
      onsave={saveCurrent}
      onread={read}
      onfollow={follow}
    />
  {/if}
</section>

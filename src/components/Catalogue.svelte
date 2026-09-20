<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    acquisition,
    navigation,
    safeUrl,
    rememberConnection,
    forgetConnection,
    savedConnection,
    getFeed,
    getBookFile,
    type Connection,
    type Feed,
    type Entry,
    type Link,
  } from '../lib/opds';
  import {
    saveShelf,
    shelves,
    forgetShelf,
    listBooks,
    getFile,
    type Shelf,
    type Book,
  } from '../lib/store';
  import { importBook } from '../lib/import';
  export let onread: (book: Book) => void;
  export let onadded: () => void;
  let saved: Shelf[] = [],
    url = '',
    username = '',
    password = '',
    feed: Feed | null = null,
    feedUrl = '',
    connection: Connection | null = null;
  let page = 0,
    busy = false,
    error = '',
    notice = '',
    downloading = '',
    history: string[] = [];
  let controller: AbortController | undefined;
  let downloadController: AbortController | undefined;
  const size = 24;
  $: entries = feed?.entries.slice(page * size, (page + 1) * size) || [];
  $: next = feed?.links.find((link) => link.rel.split(/\s+/).includes('next'));
  $: previous = feed?.links.find(
    (link) =>
      link.rel.split(/\s+/).includes('previous') ||
      link.rel.split(/\s+/).includes('prev'),
  );
  onMount(() => {
    shelves()
      .then((value) => (saved = value))
      .catch((e) => (error = e.message));
  });
  onDestroy(() => {
    controller?.abort();
    downloadController?.abort();
  });
  async function load(target: string, conn: Connection, remember = true) {
    controller?.abort();
    const current = new AbortController();
    controller = current;
    busy = true;
    error = '';
    notice = '';
    try {
      const parsed = await getFeed(safeUrl(target), conn, current.signal);
      if (current !== controller) return;
      feed = parsed;
      feedUrl = target;
      connection = conn;
      rememberConnection(conn);
      page = 0;
      if (remember) {
        await saveShelf({
          url: target,
          title: parsed.title,
          username: conn.username,
          connectionUrl: conn.url,
        });
        saved = await shelves();
      }
    } catch (e) {
      if (!current.signal.aborted) error = (e as Error).message;
    } finally {
      if (current === controller) busy = false;
    }
  }
  function connect() {
    history = [];
    const conn = { url, username, password };
    load(url, conn);
  }
  function savedOpen(shelf: Shelf) {
    const conn = savedConnection(shelf.connectionUrl, shelf.username);
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
    await forgetShelf(shelf.url);
    forgetConnection(shelf.connectionUrl, shelf.username);
    password = '';
    if (
      connection &&
      new URL(connection.url).origin === new URL(shelf.connectionUrl).origin &&
      connection.username === shelf.username
    ) {
      connection = null;
      feed = null;
      controller?.abort();
      downloadController?.abort();
    }
    saved = await shelves();
  }
  function browse(link: Link) {
    if (!connection) return;
    history = [...history, feedUrl];
    load(link.href, connection, false);
  }
  function back() {
    if (!connection || !history.length) return;
    const target = history.at(-1)!;
    history = history.slice(0, -1);
    load(target, connection, false);
  }
  function nextPage() {
    if (!feed || !connection) return;
    if ((page + 1) * size < feed.entries.length) page++;
    else if (next) {
      history = [...history, feedUrl];
      load(next.href, connection, false);
    }
  }
  function previousPage() {
    if (page > 0) page--;
    else if (previous && connection) load(previous.href, connection, false);
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
    Passwords are never saved.
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
  {#if feed}<div class="catalogue-heading">
      <div>
        {#if history.length}<button class="quiet" disabled={busy} onclick={back}
            >← Back</button
          >{/if}
        <h2>{feed.title}</h2>
        <span class="muted"
          >{page * size + 1}–{Math.min((page + 1) * size, feed.entries.length)} of
          {feed.entries.length} entries on this feed</span
        >
      </div>
      <button class="secondary" onclick={saveCurrent}>Save this shelf</button>
    </div>
    <div class="catalogue-grid" aria-busy={busy}>
      {#each entries as entry, i (feedUrl + ':' + page + ':' + i)}{@const file =
          entry.links.find(acquisition)}{@const folder =
          entry.links.find(navigation)}
        <article class="catalogue-entry">
          <span class="entry-symbol" aria-hidden="true">{file ? '▤' : '↳'}</span
          >
          <div>
            <h3>{entry.title}</h3>
            <p>
              {entry.author || (file ? 'Ready to fetch' : 'Browse this shelf')}
            </p>
          </div>
          {#if file}<button
              class="secondary"
              disabled={!!downloading || busy}
              onclick={() => read(entry, file)}
              >{downloading === file.href ? 'Fetching…' : 'Read book'}</button
            >{:else if folder}<button
              class="secondary"
              disabled={busy}
              onclick={() => browse(folder)}>Browse →</button
            >{:else}<span class="muted">No EPUB or PDF</span>{/if}
        </article>{/each}
    </div>
    {#if !entries.length}<p class="empty-note">This shelf is empty.</p>{/if}
    <nav class="pagination" aria-label="Catalogue pages">
      <button disabled={busy || (!page && !previous)} onclick={previousPage}
        >← Previous</button
      ><span>Page {page + 1}</span><button
        disabled={busy || (!(feed.entries.length > (page + 1) * size) && !next)}
        onclick={nextPage}>Next →</button
      >
    </nav>
  {/if}
</section>

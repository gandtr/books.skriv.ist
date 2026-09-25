<script lang="ts">
  import { onMount } from 'svelte';
  import { registerSW } from 'virtual:pwa-register';
  import BookCard from './components/BookCard.svelte';
  import Catalogue from './components/Catalogue.svelte';
  import Calibre from './components/Calibre.svelte';
  import Reader from './components/Reader.svelte';
  import { parseReadingRoute } from './lib/notes';
  let initialPosition: import('./lib/store').Position | undefined;
  let reader: Reader;
  import {
    listBooks,
    updateBook,
    deleteBook,
    getBook,
    storageInfo,
    type Book,
  } from './lib/store';
  import { importBook } from './lib/import';
  let books: Book[] = [],
    active: Book | undefined,
    view = 'library',
    status = '',
    query = '',
    sort = 'recent',
    page = 0,
    error = '',
    notice = '',
    busy = false,
    loading = true;
  let fileInput: HTMLInputElement,
    directoryInput: HTMLInputElement,
    theme = 'light',
    themeMode = 'system',
    showInfo = false,
    storage = '';
  let importing: AbortController | undefined,
    installPrompt: any,
    updateReady = false,
    updateApp: ((reload?: boolean) => Promise<void>) | undefined;
  const size = 24;
  $: filtered = books
    .filter(
      (book) =>
        (!status || book.status === status) &&
        `${book.title} ${book.author}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === 'title' ? a.title.localeCompare(b.title) : b.added - a.added,
    );
  $: pages = Math.max(1, Math.ceil(filtered.length / size));
  $: if (page >= pages) page = pages - 1;
  $: visible = filtered.slice(page * size, (page + 1) * size);
  $: reading = books.filter((b) => b.status === 'reading').length;
  async function refresh() {
    try {
      books = await listBooks();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }
  function applyTheme() {
    theme =
      themeMode === 'system'
        ? matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : themeMode;
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#1c201e' : '#f6f3ec');
  }
  function changeTheme() {
    themeMode = theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('books-theme', themeMode);
    applyTheme();
  }
  async function read(book: Book) {
    initialPosition = undefined;
    active = book;
    location.hash = `read=${book.id}`;
  }
  function close() {
    active = undefined;
    history.replaceState(null, '', location.pathname + location.search);
  }
  async function route() {
    const match = parseReadingRoute(location.hash);
    if (match) {
      if (active?.id === match.id && reader) {
        if (match.position) reader.goToPosition(match.position);
        return;
      }
      initialPosition = match.position;
      active = await getBook(match.id);
      if (!active) {
        error = 'That book is not stored on this device.';
        history.replaceState(null, '', location.pathname);
      }
    } else active = undefined;
  }
  onMount(() => {
    themeMode = localStorage.getItem('books-theme') || 'system';
    applyTheme();
    const media = matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', applyTheme);
    refresh().then(route);
    window.addEventListener('hashchange', route);
    const install = (event: Event) => {
      event.preventDefault();
      installPrompt = event;
    };
    window.addEventListener('beforeinstallprompt', install);
    updateApp = registerSW({
      onNeedRefresh() {
        updateReady = true;
      },
      onOfflineReady() {
        notice = 'Ready to read offline. Books you add stay on this device.';
      },
    });
    return () => {
      window.removeEventListener('hashchange', route);
      window.removeEventListener('beforeinstallprompt', install);
      media.removeEventListener('change', applyTheme);
      importing?.abort();
    };
  });
  async function add(files: FileList | File[] | null) {
    if (!files || busy) return;
    const chosen = Array.from(files).filter((file) =>
      /\.(epub|pdf)$/i.test(file.name),
    );
    if (!chosen.length) {
      error = 'Choose EPUB or PDF files, or a folder containing them.';
      return;
    }
    busy = true;
    error = '';
    importing = new AbortController();
    let count = 0;
    const failed: string[] = [];
    for (const file of chosen) {
      if (importing.signal.aborted) break;
      notice = `Adding ${count + 1} of ${chosen.length}: ${file.name}`;
      try {
        await importBook(file, undefined, importing.signal);
        count++;
      } catch (e) {
        if (!importing.signal.aborted)
          failed.push(`${file.name}: ${(e as Error).message}`);
      }
    }
    notice = importing.signal.aborted
      ? 'Import stopped. Completed books are saved.'
      : `${count} book${count === 1 ? '' : 's'} added to this device.`;
    busy = false;
    page = 0;
    await refresh();
    if (failed.length)
      error =
        failed.slice(0, 3).join(' · ') +
        (failed.length > 3
          ? ` · ${failed.length - 3} more files could not be added.`
          : '');
    if (fileInput) fileInput.value = '';
    if (directoryInput) directoryInput.value = '';
  }
  async function mark(book: Book) {
    await updateBook(
      book.id,
      book.status === 'read'
        ? {
            status: 'unread',
            progress: 0,
            position: { chapter: 0, fraction: 0, page: 1 },
          }
        : { status: 'read', progress: 1 },
    );
    await refresh();
  }
  async function remove(book: Book) {
    if (
      !confirm(
        `Remove “${book.title}” and its local notes and reading position from this device? Your original file is unchanged.`,
      )
    )
      return;
    await deleteBook(book.id);
    await refresh();
  }
  async function info() {
    showInfo = !showInfo;
    if (showInfo) {
      const estimate = await storageInfo();
      storage = estimate.usage
        ? `${(estimate.usage / 1024 / 1024).toFixed(1)} MB stored on this device`
        : 'Your library stays in this browser';
    }
  }
  async function install() {
    if (installPrompt) {
      await installPrompt.prompt();
      installPrompt = undefined;
    } else {
      showInfo = true;
      notice =
        'To install, choose “Install app” or “Add to Home Screen” from your browser menu. Omarchy installation instructions are below.';
    }
  }
</script>

<svelte:head
  ><title>{active ? active.title + ' — ' : ''}Skrivist Books</title
  ></svelte:head
>
{#if active}{#key active.id}<Reader
      bind:this={reader}
      {initialPosition}
      book={active}
      onclose={close}
      onchanged={refresh}
    />{/key}{:else}
  <div class="app-shell">
    <header class="app-header">
      <a
        class="brand"
        href="/"
        onclick={(e) => {
          e.preventDefault();
          view = 'library';
          status = '';
          page = 0;
        }}
        ><svg viewBox="0 0 32 32" aria-hidden="true"
          ><path
            d="M4 6h10c3 0 5 2 5 5v16c-1-3-3-4-6-4H4zM19 11c0-3 2-5 5-5h4v17h-4c-2 0-4 1-5 4"
          /></svg
        ><span>skrivist <strong>books</strong></span></a
      >
      <nav aria-label="Main">
        <button
          class:active={view === 'library'}
          onclick={() => (view = 'library')}>Library</button
        ><button
          class:active={view === 'catalogues'}
          onclick={() => (view = 'catalogues')}>Catalogues</button
        ><button
          class:active={view === 'calibre'}
          onclick={() => (view = 'calibre')}>Calibre</button
        >
      </nav>
      <div class="header-actions">
        <button
          class="quiet theme-button"
          onclick={changeTheme}
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          >{theme === 'light' ? '☾' : '☀'}</button
        ><button class="quiet" onclick={info} aria-label="About and storage"
          >ⓘ</button
        ><button class="secondary install-button" onclick={install}
          >Install app ↗</button
        >
      </div>
    </header>
    <main class="app-main">
      {#if updateReady}<div class="message">
          An update is ready. <button onclick={() => updateApp?.(true)}
            >Update app</button
          >
        </div>{/if}
      {#if error}<div class="message error" role="alert">
          {error}<button
            class="quiet"
            aria-label="Dismiss error"
            onclick={() => (error = '')}>×</button
          >
        </div>{/if}
      {#if notice}<div class="message" role="status">
          {notice}{#if busy}<button
              class="quiet"
              onclick={() => importing?.abort()}>Stop import</button
            >{:else}<button
              class="quiet"
              aria-label="Dismiss notice"
              onclick={() => (notice = '')}>×</button
            >{/if}
        </div>{/if}
      {#if showInfo}<section class="info-panel">
          <button
            class="close-info quiet"
            aria-label="Close about"
            onclick={() => (showInfo = false)}>×</button
          ><span class="eyebrow">A small app. A private library.</span>
          <h2>Just you and your books.</h2>
          <p>
            Skrivist Books reads EPUB and PDF files on your device. No account,
            cloud library, or uploads. It is separate from app.skriv.ist. Page
            visits are counted with cookie-free Cloudflare Web Analytics.
          </p>
          <p>
            {storage}. Browser storage can be cleared or evicted, so keep your
            original files. Reading positions belong to this browser and do not
            sync to other devices.
          </p>
          <div class="info-links">
            <button
              class="secondary"
              onclick={async () => {
                const granted = await navigator.storage?.persist?.();
                notice = granted
                  ? 'Persistent storage enabled.'
                  : 'Your browser manages storage automatically. Keep your original files.';
              }}>Keep offline storage</button
            ><a
              href="https://github.com/gandtr/books.skriv.ist#omarchy"
              target="_blank"
              rel="noreferrer">Install for Omarchy ↗</a
            ><a
              href="https://github.com/gandtr/books.skriv.ist"
              target="_blank"
              rel="noreferrer">Source & help ↗</a
            >
          </div>
        </section>{/if}
      {#if view === 'calibre'}<Calibre
          onread={read}
          onadded={refresh}
        />{:else if view === 'catalogues'}<Catalogue
          onread={read}
          onadded={refresh}
        />{:else}
        <div class="section-heading">
          <div>
            <span class="eyebrow">Your own little reading room</span>
            <h1>Your library<span class="heading-dot">.</span></h1>
            <p>
              {books.length
                ? `${books.length} books, a little time, and somewhere quiet.`
                : 'A place for the books you choose. Nothing else.'}
            </p>
          </div>
          <div class="import-actions">
            <button
              class="secondary"
              disabled={busy}
              onclick={() => directoryInput.click()}>Add folder</button
            ><button
              class="primary"
              disabled={busy}
              onclick={() => fileInput.click()}>＋ Add books</button
            >
          </div>
        </div>
        <input
          class="file-input"
          aria-label="Choose books"
          type="file"
          accept=".epub,.pdf"
          multiple
          bind:this={fileInput}
          onchange={(e) => add(e.currentTarget.files)}
        />
        <input
          class="file-input"
          aria-label="Choose book folder"
          type="file"
          webkitdirectory
          multiple
          bind:this={directoryInput}
          onchange={(e) => add(e.currentTarget.files)}
        />
        {#if loading}<p class="empty-note" role="status">
            Opening your library…
          </p>{:else if !books.length}<section class="empty-library">
            <div class="empty-art" aria-hidden="true">
              <div class="drawn-book book-one">
                <span>THE<br />QUIET<br />HOURS</span>
              </div>
              <div class="drawn-book book-two">
                <span>A WORLD<br />BETWEEN<br />PAGES</span>
              </div>
              <div class="drawn-book book-three">
                <span>ONE<br />MORE<br />CHAPTER</span>
              </div>
              <span class="shelf-line"></span>
            </div>
            <div class="empty-copy">
              <span class="eyebrow">A shelf waiting for your story</span>
              <h2>Make room<br />for a good book.</h2>
              <p>
                Add an EPUB or PDF, choose a folder, or connect an OPDS
                catalogue. Everything you read stays on this device.
              </p>
              <div>
                <button class="primary" onclick={() => fileInput.click()}
                  >Choose your first book</button
                ><button
                  class="text-button"
                  onclick={() => (view = 'catalogues')}
                  >Browse a catalogue →</button
                >
              </div>
              <span class="privacy-note"
                ><span class="tiny-dot"></span> No sign-up. No cloud storage. Yours
                to keep.</span
              >
            </div>
          </section>
        {:else}<div class="library-tools">
            <div class="status-tabs" role="group" aria-label="Reading status">
              {#each [['', 'All books'], ['reading', `Reading${reading ? ' · ' + reading : ''}`], ['unread', 'Unread'], ['read', 'Read']] as [value, label]}<button
                  class:active={status === value}
                  onclick={() => {
                    status = value;
                    page = 0;
                  }}>{label}</button
                >{/each}
            </div>
            <div class="search-sort">
              <input
                aria-label="Search your library"
                type="search"
                placeholder="Find a book or author…"
                bind:value={query}
                oninput={() => (page = 0)}
              /><select aria-label="Sort books" bind:value={sort}
                ><option value="recent">Recently added</option><option
                  value="title">Title A–Z</option
                ></select
              >
            </div>
          </div>
          <div class="shelf-meta">
            <span
              >{filtered.length
                ? `${page * size + 1}–${Math.min((page + 1) * size, filtered.length)} of ${filtered.length} books`
                : 'No matching books'}</span
            ><span>On this device</span>
          </div>
          <div class="book-grid">
            {#each visible as book (book.id)}<BookCard
                {book}
                onread={read}
                onstatus={(b) => mark(b).catch((e) => (error = e.message))}
                onremove={(b) => remove(b).catch((e) => (error = e.message))}
              />{/each}
          </div>
          {#if !filtered.length}<p class="empty-note">
              No books here yet. Try another filter or add something new.
            </p>{/if}
          {#if pages > 1}<nav class="pagination" aria-label="Library pages">
              <button disabled={page === 0} onclick={() => page--}
                >← Previous</button
              ><span>Page {page + 1} of {pages}</span><button
                disabled={page >= pages - 1}
                onclick={() => page++}>Next →</button
              >
            </nav>{/if}{/if}
      {/if}
    </main>
    <footer class="app-footer">
      <span>SKRIVIST BOOKS</span><span>Read slowly. Keep it local.</span><a
        href="https://comics.skriv.ist"
        target="_blank"
        rel="noreferrer">More of a comics person? ↗</a
      ><a href="https://skriv.ist/" target="_blank" rel="noreferrer"
        >skriv.ist · Skrivist Cloud coming soon ↗</a
      >
    </footer>
  </div>
{/if}

<script lang="ts">
  import { onDestroy } from 'svelte';
  import {
    calibreSession,
    connectCalibre,
    calibrePage,
    disconnectCalibre,
  } from '../lib/calibre';
  import {
    sourceFromFiles,
    sourceFromDirectory,
    calibreBookPath,
    type CalibreSource,
    type ReadDirectory,
  } from '../lib/calibre-source';
  import { CALIBRE_PAGE_SIZE, type CalibreEntry } from '../lib/calibre-db';
  import { importBook } from '../lib/import';
  import type { Book } from '../lib/store';
  export let onread: (book: Book) => void;
  export let onadded: () => void;
  let result = calibreSession.result;
  let source = calibreSession.source;
  let query = calibreSession.query,
    format = calibreSession.format;
  let busy = false,
    opening = '',
    error = '',
    mounted = true;
  let folderInput: HTMLInputElement;
  const picker = (
    window as Window & {
      showDirectoryPicker?: (options: {
        mode: 'read';
      }) => Promise<ReadDirectory>;
    }
  ).showDirectoryPicker;
  onDestroy(() => {
    mounted = false;
  });
  async function connect(next: CalibreSource) {
    busy = true;
    error = '';
    try {
      const loaded = await connectCalibre(next);
      if (!mounted) return;
      source = next;
      result = loaded;
      query = '';
      format = '';
    } catch (e) {
      if (mounted) error = (e as Error).message;
    } finally {
      if (mounted) busy = false;
    }
  }
  async function choose() {
    if (!picker) {
      folderInput.click();
      return;
    }
    try {
      await connect(
        sourceFromDirectory(await picker.call(window, { mode: 'read' })),
      );
    } catch (e) {
      if ((e as Error).name !== 'AbortError') error = (e as Error).message;
    }
  }
  async function selected() {
    try {
      await connect(sourceFromFiles(Array.from(folderInput.files || [])));
    } catch (e) {
      error = (e as Error).message;
    } finally {
      folderInput.value = '';
    }
  }
  async function browse(page = 0) {
    if (busy) return;
    busy = true;
    error = '';
    try {
      const next = await calibrePage(query, format, page);
      if (mounted) result = next;
    } catch (e) {
      if (mounted) error = (e as Error).message;
    } finally {
      if (mounted) busy = false;
    }
  }
  async function read(
    entry: CalibreEntry,
    file: { format: string; name: string },
  ) {
    if (!source || opening || busy) return;
    opening = `${entry.id}:${file.format}`;
    error = '';
    try {
      const original = await source.file(
        calibreBookPath(entry.path, file.name, file.format),
      );
      if (!mounted) return;
      const book = await importBook(original, undefined, undefined, {
        title: entry.title,
        author: entry.author,
      });
      if (mounted) {
        onadded();
        onread(book);
      }
    } catch (e) {
      if (mounted) error = (e as Error).message;
    } finally {
      if (mounted) opening = '';
    }
  }
</script>

<section aria-labelledby="calibre-heading">
  <div class="section-heading">
    <div>
      <span class="eyebrow">Your library, already organised</span>
      <h1 id="calibre-heading">Calibre<span class="heading-dot">.</span></h1>
      <p>Browse your Calibre library. Open a book when you’re ready.</p>
    </div>
    <button class="primary" disabled={busy || !!opening} onclick={choose}
      >{source ? 'Change library folder' : 'Choose library folder'}</button
    >
  </div>
  <input
    class="file-input"
    type="file"
    multiple
    webkitdirectory
    aria-label="Choose Calibre library folder"
    bind:this={folderInput}
    onchange={selected}
  />
  <div class="calibre-intro">
    <p>
      Choose the folder containing <strong>metadata.db</strong>. Close Calibre
      first so its database is fully saved. Books reads a local snapshot and
      never changes the database. Nothing is uploaded.
    </p>
    <p>
      Only a book you choose to read is copied into this browser for offline
      reading, notes, and progress. Folder access lasts for this session; choose
      it again after reloading.
    </p>
    {#if picker}<button
        class="quiet"
        disabled={busy || !!opening}
        onclick={() => folderInput.click()}>Use compatible folder picker</button
      >{/if}
  </div>
  {#if error}<p class="message error" role="alert">{error}</p>{/if}
  {#if busy}<p class="message" role="status">Reading Calibre metadata…</p>{/if}
  {#if source && result}
    <div class="catalogue-heading calibre-heading">
      <div>
        <h2>{source.name}</h2>
        <p class="muted">{result.total} matching books · Metadata snapshot</p>
      </div>
      <div class="note-actions">
        <button
          class="secondary"
          disabled={busy || !!opening}
          onclick={() =>
            source?.snapshot ? folderInput.click() : source && connect(source)}
          >Refresh library</button
        ><button
          class="quiet"
          disabled={busy || !!opening}
          onclick={() => {
            disconnectCalibre();
            source = undefined;
            result = undefined;
            query = '';
            format = '';
            error = '';
          }}>Disconnect</button
        >
      </div>
    </div>
    <form
      class="calibre-search"
      onsubmit={(e) => {
        e.preventDefault();
        browse();
      }}
    >
      <label
        >Search Calibre<input
          bind:value={query}
          maxlength="300"
          placeholder="Title, author, series, or tag"
          disabled={busy || !!opening}
        /></label
      >
      <label
        >Format<select bind:value={format} disabled={busy || !!opening}
          ><option value="">All formats</option><option value="epub"
            >EPUB</option
          ><option value="pdf">PDF</option></select
        ></label
      >
      <button class="secondary" disabled={busy || !!opening}>Search</button>
    </form>
    <div class="catalogue-grid calibre-grid" aria-busy={busy}>
      {#each result.entries as entry (entry.id)}
        <article class="catalogue-entry">
          <div>
            <h3>{entry.title}</h3>
            <p>{entry.author || 'Unknown author'}</p>
            {#if entry.series}<p>{entry.series}</p>{/if}{#if entry.tags}<p
                class="calibre-tags"
              >
                {entry.tags}
              </p>{/if}
            <p>
              {entry.formats.map((f) => f.format.toUpperCase()).join(' · ') ||
                'No book files'}
            </p>
          </div>
          <div class="calibre-formats">
            {#each entry.formats.filter((f) => f.format === 'epub' || f.format === 'pdf') as file}
              <button
                class="secondary"
                disabled={busy || !!opening}
                aria-label={`Read ${entry.title} as ${file.format.toUpperCase()}`}
                onclick={() => read(entry, file)}
                >{opening === `${entry.id}:${file.format}`
                  ? 'Opening…'
                  : `Read ${file.format.toUpperCase()}`}</button
              >
            {:else}<span class="small-note"
                >Convert to EPUB or PDF in Calibre to read here.</span
              >{/each}
          </div>
        </article>
      {/each}
    </div>
    {#if !result.entries.length}<p class="empty-note">
        No books match this search.
      </p>{/if}
    <nav class="pagination" aria-label="Calibre pages">
      <button
        disabled={busy || !!opening || result.page === 0}
        onclick={() => browse(result!.page - 1)}>← Previous</button
      ><span
        >Page {result.page + 1} of {Math.max(
          1,
          Math.ceil(result.total / CALIBRE_PAGE_SIZE),
        )}</span
      ><button
        disabled={busy ||
          !!opening ||
          (result.page + 1) * CALIBRE_PAGE_SIZE >= result.total}
        onclick={() => browse(result!.page + 1)}>Next →</button
      >
    </nav>
  {:else if !busy}<p class="empty-note">
      Your Calibre library will appear here after you choose a folder. No
      library is connected automatically.
    </p>{/if}
</section>

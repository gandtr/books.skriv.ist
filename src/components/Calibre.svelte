<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import {
    calibreSession,
    connectCalibre,
    calibrePage,
    disconnectCalibre,
  } from '../lib/calibre';
  import {
    sourceFromFiles,
    sourceFromDirectory,
    sourceFromHost,
    calibreBookPath,
    type CalibreSource,
    type ReadDirectory,
  } from '../lib/calibre-source';
  import { CALIBRE_PAGE_SIZE, type CalibreEntry } from '../lib/calibre-db';
  import {
    addCalibreFolder,
    calibreFolders,
    calibreStat,
    forgetCalibreFolder,
    isDesktop,
    libraryLocation,
    type CalibreFolder,
  } from '../lib/desktop';
  import { MAX_BOOK } from '../lib/epub';
  import { importBook } from '../lib/import';
  import {
    calibreBookId,
    getBook,
    linkBook,
    type Book,
    type CalibreLink,
  } from '../lib/store';
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
  // Desktop, where the host remembers Calibre folders and books open in place.
  let hosted = false;
  let folders: CalibreFolder[] = [];
  const LAST_FOLDER = 'books-calibre-folder';
  onMount(() => {
    if (!isDesktop()) return;
    (async () => {
      if (!(await libraryLocation()).calibre) return;
      const known = await calibreFolders();
      if (!mounted) return;
      hosted = true;
      folders = known;
      // Reconnect the library used last, so a remembered folder needs no clicks.
      if (source || busy) return;
      let last = '';
      try {
        last = localStorage.getItem(LAST_FOLDER) || '';
      } catch {}
      const again =
        known.find((f) => f.id === last && f.available) ||
        (known.length === 1 && known[0].available ? known[0] : undefined);
      if (again) await open(again);
    })().catch(() => {});
  });
  async function open(folder: CalibreFolder) {
    await connect(sourceFromHost(folder));
    if (source?.folder === folder.id)
      try {
        localStorage.setItem(LAST_FOLDER, folder.id);
      } catch {}
  }
  async function add() {
    error = '';
    try {
      const folder = await addCalibreFolder();
      if (!folder || !mounted) return;
      folders = await calibreFolders();
      await open(folder);
    } catch (e) {
      if (mounted) error = typeof e === 'string' ? e : (e as Error).message;
    }
  }
  async function forget(folder: CalibreFolder) {
    error = '';
    try {
      await forgetCalibreFolder(folder.id);
      if (source?.folder === folder.id) disconnect();
      folders = await calibreFolders();
    } catch (e) {
      if (mounted) error = typeof e === 'string' ? e : (e as Error).message;
    }
  }
  function disconnect() {
    disconnectCalibre();
    source = undefined;
    result = undefined;
    query = '';
    format = '';
    error = '';
  }
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
      const path = calibreBookPath(entry.path, file.name, file.format);
      const book = source.folder
        ? await readInPlace(entry, file.format as 'epub' | 'pdf', path)
        : await importBook(await source.file(path), undefined, undefined, {
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
  /**
   * Desktop: the book stays in Calibre. The library gets a record that points
   * at it, keyed to Calibre's book ID, where the position and notes are kept.
   */
  async function readInPlace(
    entry: CalibreEntry,
    format: 'epub' | 'pdf',
    path: string,
  ): Promise<Book> {
    const from = source!;
    const link: CalibreLink = {
      library: result?.library || `folder-${from.folder}`,
      book: entry.id,
      format,
      path,
      folder: from.folder!,
    };
    const id = await calibreBookId(link);
    // Checked before anything is added. The file itself is read by the reader.
    const original = await calibreStat(link.folder, path);
    if (!original)
      throw new Error(
        `File missing from the Calibre library: ${path}. Refresh the library if Calibre moved or changed it.`,
      );
    if (original.size > MAX_BOOK)
      throw new Error('Choose a book smaller than 128 MB.');
    let cover: Blob | undefined;
    if (!(await getBook(id)))
      try {
        const image = await from.file(`${entry.path}/cover.jpg`);
        if (image.size <= 8 * 1024 * 1024)
          cover = new Blob([image], { type: 'image/jpeg' });
      } catch {}
    return linkBook(
      {
        id,
        title: entry.title,
        author: entry.author,
        format,
        added: Date.now(),
        size: original.size,
        status: 'unread',
        progress: 0,
        position: { chapter: 0, fraction: 0, page: 1 },
        calibre: link,
      },
      cover,
    );
  }
</script>

<section aria-labelledby="calibre-heading">
  <div class="section-heading">
    <div>
      <span class="eyebrow">Your library, already organised</span>
      <h1 id="calibre-heading">Calibre<span class="heading-dot">.</span></h1>
      <p>Browse your Calibre library. Open a book when you’re ready.</p>
    </div>
    {#if hosted}<button
        class="primary"
        disabled={busy || !!opening}
        onclick={add}>Connect a Calibre library…</button
      >{:else}<button
        class="primary"
        disabled={busy || !!opening}
        onclick={choose}
        >{source ? 'Change library folder' : 'Choose library folder'}</button
      >{/if}
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
  {#if hosted}<div class="calibre-intro">
      <p>
        Connect the folder containing <strong>metadata.db</strong>. Books opens
        your books straight from it: nothing is copied, and Calibre's files and
        database are never changed. Close Calibre while you connect or refresh,
        so its database is fully saved.
      </p>
      <p>
        Reading positions and notes are kept in your Skrivist library, so a
        book you open here also appears in <strong>Library</strong>. It can be
        read only while its Calibre folder is reachable.
      </p>
      {#if folders.length}<ul class="calibre-folders">
          {#each folders as folder (folder.id)}
            <li>
              <span
                ><strong>{folder.name}</strong>
                <span class="muted">{folder.path}</span
                >{#if !folder.available}<span class="muted">
                    · not reachable right now</span
                  >{/if}</span
              >
              <span class="note-actions"
                ><button
                  class="secondary"
                  disabled={busy ||
                    !!opening ||
                    !folder.available ||
                    source?.folder === folder.id}
                  aria-label={`Open the Calibre library ${folder.name}`}
                  onclick={() => open(folder)}
                  >{source?.folder === folder.id ? 'Open' : 'Open library'}</button
                ><button
                  class="quiet"
                  disabled={busy || !!opening}
                  aria-label={`Forget the Calibre library ${folder.name}`}
                  onclick={() => forget(folder)}>Forget</button
                ></span
              >
            </li>
          {/each}
        </ul>{/if}
    </div>{:else}<div class="calibre-intro">
      <p>
        Choose the folder containing <strong>metadata.db</strong>. Close Calibre
        first so its database is fully saved. Books reads a local snapshot and
        never changes the database. Nothing is uploaded.
      </p>
      <p>
        Only a book you choose to read is copied into this browser for offline
        reading, notes, and progress. Folder access lasts for this session;
        choose it again after reloading.
      </p>
      {#if picker}<button
          class="quiet"
          disabled={busy || !!opening}
          onclick={() => folderInput.click()}
          >Use compatible folder picker</button
        >{/if}
    </div>{/if}
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
          onclick={disconnect}>{hosted ? 'Close' : 'Disconnect'}</button
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
      {hosted
        ? folders.length
          ? 'Open one of your connected Calibre libraries above.'
          : 'Your Calibre library will appear here after you connect its folder.'
        : 'Your Calibre library will appear here after you choose a folder. No library is connected automatically.'}
    </p>{/if}
</section>

<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import type {
    PDFDocumentProxy,
    PDFDocumentLoadingTask,
    RenderTask,
  } from 'pdfjs-dist';
  import Notes from './Notes.svelte';
  import {
    papers,
    isPaper,
    paperStyle,
    pdfPaper,
    type Paper,
  } from '../lib/paper';
  let paper: Paper = 'auto';
  function changePaper() {
    try {
      localStorage.setItem('books-paper', paper);
    } catch {}
    if (pdf) showPdf(page);
  }
  import type { ReadingNote } from '../lib/notes';
  import type { Position } from '../lib/store';
  import { Epub } from '../lib/epub';
  import { getFile, updateBook, type Book } from '../lib/store';
  export let book: Book;
  export let initialPosition: Position | undefined = undefined;
  let notesPanel: Notes;
  let selectedQuote = '';
  let pdfText: HTMLDivElement, pdfFrame: HTMLDivElement;
  let textLayer: import('pdfjs-dist').TextLayer | undefined;
  let PdfTextLayer: typeof import('pdfjs-dist').TextLayer;
  export let onclose: () => void;
  export let onchanged: () => void;
  let host: HTMLDivElement, canvas: HTMLCanvasElement;
  let epub: Epub | undefined, root: ShadowRoot, content: HTMLDivElement;
  let pdf: PDFDocumentProxy | undefined,
    pdfTask: PDFDocumentLoadingTask | undefined,
    renderTask: RenderTask | undefined;
  let readable = false;
  let loading = true,
    error = '',
    chapter = (initialPosition || book.position).chapter || 0,
    fraction = (initialPosition || book.position).fraction || 0,
    page = (initialPosition || book.position).page || 1,
    total = 0;
  let spread = 0,
    spreads = 1,
    step = 0,
    toc = false,
    font = 18,
    sectionTitle = '',
    mounted = true,
    sequence = 0;
  let completed = book.status === 'read',
    writeChain = Promise.resolve();
  let sections: { title: string; path: string }[] = [];
  const readerCss = `:host{display:block;height:100%;min-height:0;overflow:hidden}#flow{height:100%;column-fill:auto;column-gap:48px;line-height:1.7;font-family:Georgia,'Times New Roman',serif;color:var(--ink);overflow:visible;overflow-wrap:anywhere;box-sizing:border-box}#flow>*:first-child{margin-top:0}p{margin:0 0 1em}h1,h2,h3,h4{line-height:1.2;break-after:avoid;font-weight:500}h1{font-size:1.9em}h2{font-size:1.45em}img{display:block;max-width:100%;max-height:85%;object-fit:contain;break-inside:avoid;margin:auto}pre{white-space:pre-wrap;font:0.8em/1.5 monospace}table{max-width:100%;font-size:.85em;border-collapse:collapse}td,th{padding:.4em;border:1px solid var(--line)}a{color:var(--accent)}blockquote{margin:1em;padding-left:1em;border-left:2px solid var(--accent)}hr{border:0;border-top:1px solid var(--line)}`;
  function persist() {
    if (loading || !readable || !mounted) return;
    const progress = completed
      ? 1
      : book.format === 'epub'
        ? (chapter + (spreads === 1 ? 0 : fraction)) / Math.max(1, total)
        : (page - 1) / Math.max(1, total);
    const position = { chapter, fraction, page };
    writeChain = writeChain
      .then(() =>
        updateBook(book.id, {
          position,
          progress: completed ? 1 : Math.min(0.99, progress),
          status: completed ? 'read' : 'reading',
        }),
      )
      .catch(() => {
        error =
          'Your reading position could not be saved. Browser storage may be full.';
      });
  }
  function layout() {
    if (!content || !host?.clientWidth) return;
    const width = host.clientWidth,
      columns = width > 820 ? 2 : 1;
    step = width + 48;
    content.style.width = `${width}px`;
    content.style.columnWidth = `${(width - (columns - 1) * 48) / columns}px`;
    content.style.fontSize = `${font}px`;
    content.style.transform = 'none';
    spreads = Math.max(1, Math.ceil((content.scrollWidth + 48) / step));
    spread = Math.min(spreads - 1, Math.round(fraction * (spreads - 1)));
    content.style.transform = `translateX(${-spread * step}px)`;
  }
  async function showChapter(index: number, position = 0, last = false) {
    if (!epub) return;
    selectedQuote = '';
    const request = ++sequence;
    loading = true;
    readable = false;
    error = '';
    try {
      const fragment = await epub.chapter(index);
      if (!mounted || request !== sequence) return;
      chapter = index;
      fraction = position;
      sectionTitle = sections[index]?.title || '';
      content.replaceChildren(fragment);
      await tick();
      await Promise.all(
        Array.from(content.querySelectorAll('img')).map((img) =>
          img.decode().catch(() => {}),
        ),
      );
      if (!mounted || request !== sequence) return;
      layout();
      if (last) {
        spread = spreads - 1;
        fraction = 1;
        content.style.transform = `translateX(${-spread * step}px)`;
      }
      loading = false;
      readable = true;
      persist();
    } catch (e) {
      if (mounted && request === sequence) {
        error = (e as Error).message;
        loading = false;
      }
    }
  }
  async function showPdf(target: number) {
    if (!pdf) return;
    selectedQuote = '';
    const request = ++sequence;
    loading = true;
    readable = false;
    error = '';
    renderTask?.cancel();
    textLayer?.cancel();
    pdfText.replaceChildren();
    try {
      const sheet = await pdf.getPage(target);
      if (!mounted || request !== sequence) return;
      const natural = sheet.getViewport({ scale: 1 });
      const scale = Math.min(
        (host.clientWidth - 24) / natural.width,
        (host.clientHeight - 16) / natural.height,
      );
      const viewport = sheet.getViewport({
        scale: Math.max(0.2, scale) * Math.min(devicePixelRatio, 2),
      });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width / Math.min(devicePixelRatio, 2)}px`;
      canvas.style.height = `${viewport.height / Math.min(devicePixelRatio, 2)}px`;
      renderTask = sheet.render({
        canvas,
        viewport,
        pageColors: pdfPaper(paper),
      });
      await renderTask.promise;
      if (!mounted || request !== sequence) return;
      const textViewport = sheet.getViewport({ scale: Math.max(0.2, scale) });
      pdfFrame.style.width = `${textViewport.width}px`;
      pdfFrame.style.height = `${textViewport.height}px`;
      pdfText.style.setProperty(
        '--total-scale-factor',
        String(textViewport.scale),
      );
      textLayer = new PdfTextLayer({
        textContentSource: sheet.streamTextContent(),
        container: pdfText,
        viewport: textViewport,
      });
      try {
        await textLayer.render();
      } catch {
        if (mounted && request === sequence) pdfText.replaceChildren();
      }
      if (!mounted || request !== sequence) return;
      page = target;
      loading = false;
      readable = true;
      persist();
    } catch (e) {
      if (
        (e as Error).name !== 'RenderingCancelledException' &&
        mounted &&
        request === sequence
      ) {
        error = (e as Error).message;
        loading = false;
      }
    }
  }
  function turn(delta: number) {
    selectedQuote = '';
    if (loading) return;
    if (book.format === 'pdf') {
      const target = page + delta;
      if (target >= 1 && target <= total) showPdf(target);
      return;
    }
    const target = spread + delta;
    if (target >= 0 && target < spreads) {
      spread = target;
      fraction = spreads > 1 ? spread / (spreads - 1) : 0;
      content.style.transform = `translateX(${-spread * step}px)`;
      persist();
    } else if (chapter + delta >= 0 && chapter + delta < total)
      showChapter(chapter + delta, delta > 0 ? 0 : 1, delta < 0);
  }
  async function finish() {
    completed = !completed;
    await updateBook(book.id, {
      status: completed ? 'read' : 'reading',
      progress: completed
        ? 1
        : book.format === 'epub'
          ? (chapter + fraction) / Math.max(1, total)
          : (page - 1) / Math.max(1, total),
    });
    onchanged();
  }
  async function close() {
    persist();
    await writeChain;
    onchanged();
    onclose();
  }
  function key(event: KeyboardEvent) {
    if (document.querySelector('dialog[open]')) return;
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLSelectElement
    )
      return;
    if (
      event.key === ' ' &&
      (event.target instanceof HTMLButtonElement ||
        event.target instanceof HTMLAnchorElement)
    )
      return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (toc) toc = false;
      else close();
    }
    if (['ArrowRight', 'PageDown', ' '].includes(event.key)) {
      event.preventDefault();
      turn(1);
    }
    if (['ArrowLeft', 'PageUp'].includes(event.key)) {
      event.preventDefault();
      turn(-1);
    }
  }
  let resizeTimer: ReturnType<typeof setTimeout>;
  onMount(() => {
    try {
      const saved = localStorage.getItem('books-paper');
      if (isPaper(saved)) paper = saved;
    } catch {}
    font = Math.min(
      30,
      Math.max(14, Number(localStorage.getItem('books-font')) || 18),
    );
    let observer: ResizeObserver;
    (async () => {
      try {
        const file = await getFile(book.id);
        if (!file)
          throw new Error(
            'This book is no longer stored on this device. Import it again.',
          );
        if (!mounted) return;
        if (book.format === 'epub') {
          epub = await Epub.open(file);
          if (!mounted) {
            epub.close();
            return;
          }
          sections = epub.info.sections;
          total = sections.length;
          root = host.attachShadow({ mode: 'open' });
          const style = document.createElement('style');
          style.textContent = readerCss;
          content = document.createElement('div');
          content.id = 'flow';
          root.append(style, content);
          root.addEventListener('click', (e) => {
            const link = (e.target as Element).closest('a[data-chapter]');
            if (link) {
              e.preventDefault();
              showChapter(Number(link.getAttribute('data-chapter')));
            }
          });
          await showChapter(Math.min(chapter, total - 1), fraction);
        } else {
          const pdfjs = await import('pdfjs-dist');
          PdfTextLayer = pdfjs.TextLayer;
          const worker =
            await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
          pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
          if (!mounted) return;
          pdfTask = pdfjs.getDocument({
            data: new Uint8Array(await file.arrayBuffer()),
            cMapUrl: '/pdf-assets/cmaps/',
            cMapPacked: true,
            standardFontDataUrl: '/pdf-assets/standard_fonts/',
            wasmUrl: '/pdf-assets/wasm/',
          });
          pdf = await pdfTask.promise;
          if (!mounted) {
            await pdfTask.destroy();
            return;
          }
          total = pdf.numPages;
          await showPdf(Math.min(Math.max(page, 1), total));
        }
        observer = new ResizeObserver(() => {
          clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => {
            if (!loading) {
              if (epub) layout();
              else showPdf(page);
            }
          }, 100);
        });
        observer.observe(host);
      } catch (e) {
        error = (e as Error).message;
        loading = false;
      }
    })();
    document.addEventListener('selectionchange', captureSelection);
    window.addEventListener('keydown', key);
    return () => {
      observer?.disconnect();
      window.removeEventListener('keydown', key);
      document.removeEventListener('selectionchange', captureSelection);
    };
  });
  onDestroy(() => {
    mounted = false;
    sequence++;
    clearTimeout(resizeTimer);
    epub?.close();
    renderTask?.cancel();
    textLayer?.cancel();
    void pdfTask?.destroy().catch(() => {});
  });
  function captureSelection() {
    const selection =
      (
        root as ShadowRoot & { getSelection?: () => Selection | null }
      )?.getSelection?.() || window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    const area = book.format === 'epub' ? content : pdfText;
    if (
      area?.contains(range.startContainer) &&
      area.contains(range.endContainer)
    )
      selectedQuote = selection.toString().trim();
  }
  function captureNote() {
    captureSelection();
    return {
      quote: selectedQuote,
      position: { chapter, fraction, page },
      section: sectionTitle,
    };
  }
  function jumpNote(note: ReadingNote) {
    goToPosition(note.position);
  }
  export function goToPosition(position: Position) {
    if (loading) return;
    if (epub)
      showChapter(
        Math.min(Math.max(0, position.chapter), total - 1),
        position.fraction,
      );
    else if (pdf) showPdf(Math.min(Math.max(1, position.page), total));
  }
  function fontChange(delta: number) {
    font = Math.min(30, Math.max(14, font + delta));
    localStorage.setItem('books-font', String(font));
    layout();
  }
  $: atStart =
    book.format === 'epub' ? chapter === 0 && spread === 0 : page === 1;
  $: atEnd =
    book.format === 'epub'
      ? chapter === total - 1 && spread === spreads - 1
      : page === total;
</script>

<div
  class="reader-shell"
  style={paperStyle(paper)}
  role="region"
  aria-label={`Reading ${book.title}`}
>
  <header class="reader-toolbar">
    <button class="quiet" onclick={close}>← Library</button>
    <div class="reader-book">
      <strong>{book.title}</strong><span>{book.author}</span>
    </div>
    <label class="paper-control"
      >Paper<select
        aria-label="Paper color"
        bind:value={paper}
        onchange={changePaper}
        disabled={loading}
        >{#each Object.entries(papers) as [value, option]}<option {value}
            >{option.label}</option
          >{/each}</select
      ></label
    >
    {#if book.format === 'epub'}<button
        class="secondary"
        onclick={() => (toc = !toc)}>Contents</button
      ><button
        class="quiet"
        aria-label="Smaller text"
        onclick={() => fontChange(-1)}>A−</button
      ><button
        class="quiet"
        aria-label="Larger text"
        onclick={() => fontChange(1)}>A+</button
      >{/if}<button
      class="secondary"
      onclick={() => finish().catch((e) => (error = e.message))}
      >{completed ? '✓ Read' : 'Mark read'}</button
    >
    <button
      class="secondary"
      disabled={loading || !readable}
      onpointerdown={captureSelection}
      onclick={() => notesPanel.open(true)}>Add note</button
    >
    <button class="quiet" onclick={() => notesPanel.open()}>Notes</button>
  </header>
  {#if error}<div class="message error reader-message" role="alert">
      {error}<button
        onclick={() =>
          epub ? showChapter(chapter, fraction) : pdf ? showPdf(page) : close()}
        >Try again</button
      >
    </div>{/if}
  {#if toc}<aside class="contents-panel">
      <div>
        <h2>Contents</h2>
        <button
          class="quiet"
          onclick={() => (toc = false)}
          aria-label="Close contents">×</button
        >
      </div>
      {#each sections as section, i}<button
          class:current={chapter === i}
          onclick={() => {
            toc = false;
            showChapter(i);
          }}>{section.title}</button
        >{/each}
    </aside>{/if}
  <main class="reading-stage">
    <button
      class="page-turn previous"
      aria-label="Previous page"
      disabled={loading || atStart}
      onclick={() => turn(-1)}>‹</button
    >
    <div
      class="reading-page"
      class:pdf={book.format === 'pdf'}
      bind:this={host}
    >
      {#if book.format === 'pdf'}<div class="pdf-frame" bind:this={pdfFrame}>
          <canvas bind:this={canvas} aria-label={`Page ${page} of ${total}`}
          ></canvas>
          <div class="pdf-text-layer" bind:this={pdfText}></div>
        </div>{/if}
    </div>
    <button
      class="page-turn next"
      aria-label="Next page"
      disabled={loading || atEnd}
      onclick={() => turn(1)}>›</button
    >{#if loading}<div class="reader-loading" role="status">
        Opening your book…
      </div>{/if}
  </main>
  <footer class="reader-footer">
    <span>{sectionTitle || book.format.toUpperCase()}</span><span
      >{book.format === 'epub'
        ? `Chapter ${chapter + 1} of ${total} · ${spread + 1} / ${spreads}`
        : `Page ${page} of ${total}`}</span
    >{#if atEnd && !completed}<button
        class="quiet"
        onclick={() => finish().catch((e) => (error = e.message))}
        >Finished? Mark read ✓</button
      >{/if}
  </footer>
</div>

<Notes bind:this={notesPanel} {book} capture={captureNote} jump={jumpNote} />

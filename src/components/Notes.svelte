<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { ankiCsv } from '../lib/anki';
  import type { Book } from '../lib/store';
  import {
    listNotes,
    saveNote,
    removeNote,
    locationLabel,
    noteMarkdown,
    noteFile,
    obsidianLink,
    type ReadingNote,
    type NoteLocation,
  } from '../lib/notes';
  export let book: Book;
  export let capture: () => NoteLocation & { quote: string };
  export let jump: (note: ReadingNote) => void;
  let notes: ReadingNote[] = [],
    dialog: HTMLDialogElement,
    editing: ReadingNote | undefined,
    quote = '',
    text = '',
    error = '',
    notice = '',
    busy = false,
    vault = '',
    folder = 'Reading',
    settingsOpen = false;
  onMount(() => {
    refresh();
    try {
      vault = localStorage.getItem('books-obsidian-vault') || '';
      folder = localStorage.getItem('books-obsidian-folder') || 'Reading';
    } catch {}
  });
  async function refresh() {
    try {
      notes = await listNotes(book.id);
    } catch (e) {
      error = (e as Error).message;
    }
  }
  export async function open(add = false) {
    error = '';
    notice = '';
    editing = undefined;
    await refresh();
    if (add) {
      const selection = capture();
      editing = {
        id: crypto.randomUUID(),
        bookId: book.id,
        ...selection,
        created: Date.now(),
        updated: Date.now(),
        text: '',
      };
      quote = editing.quote;
      text = '';
    }
    await tick();
    dialog.showModal();
  }
  function edit(note: ReadingNote) {
    editing = { ...note, position: { ...note.position } };
    quote = note.quote;
    text = note.text;
    error = '';
    notice = '';
  }
  function settings() {
    localStorage.setItem('books-obsidian-vault', vault.trim());
    localStorage.setItem('books-obsidian-folder', folder.trim());
  }
  async function save(send = false) {
    if (!editing || busy) return;
    busy = true;
    error = '';
    try {
      const note = { ...editing, quote, text, updated: Date.now() };
      await saveNote(note);
      editing = note;
      await refresh();
      notice = 'Saved on this device.';
      if (send) exportObsidian(note);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
  function exportObsidian(note: ReadingNote) {
    try {
      const uri = obsidianLink(book, note, vault, folder);
      settings();
      location.href = uri;
      notice =
        'Note saved here. Obsidian will ask to open it; the browser cannot confirm the vault write.';
    } catch (e) {
      error = (e as Error).message;
      if (!vault.trim()) settingsOpen = true;
    }
  }
  function download(note?: ReadingNote, anki = false) {
    const body = anki
      ? ankiCsv(book, note ? [note] : notes)
      : note
        ? noteMarkdown(book, note)
        : notes.map((n) => noteMarkdown(book, n)).join('\n---\n\n');
    const blob = new Blob([body], {
      type: anki ? 'text/csv;charset=utf-8' : 'text/markdown;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = note
      ? noteFile(book, note, '')
      : book.title.replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 70) +
        ' - notes.md';
    if (anki) a.download = a.download.replace(/\.md$/, ' - Anki.csv');
    a.click();
    if (anki)
      notice =
        'Anki file downloaded. In Anki, choose File → Import, select this CSV, and use a two-field Basic note type (Front / Back).';
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function remove(note: ReadingNote) {
    if (!confirm('Delete this local note? Any copy in Obsidian will remain.'))
      return;
    try {
      await removeNote(note.id);
      if (editing?.id === note.id) editing = undefined;
      await refresh();
    } catch (e) {
      error = (e as Error).message;
    }
  }
</script>

<dialog
  class="notes-dialog"
  bind:this={dialog}
  aria-labelledby="notes-title"
  onclose={() => {
    editing = undefined;
  }}
>
  <div class="notes-header">
    <div>
      <span class="eyebrow">Your reading notebook</span>
      <h2 id="notes-title">Notes & highlights</h2>
    </div>
    <button
      class="quiet"
      onclick={() => dialog.close()}
      aria-label="Close notes">×</button
    >
  </div>
  <p class="muted">{book.title}</p>
  {#if error}<p role="alert" class="message error">
      {error}
    </p>{/if}{#if notice}<p role="status" class="message">{notice}</p>{/if}
  {#if editing}
    <form
      onsubmit={(e) => {
        e.preventDefault();
        save();
      }}
      class="note-editor"
    >
      <p class="note-location">
        {locationLabel(book, editing)} · Saved at this reading position
      </p>
      {#if quote}<label
          >Selected passage<textarea
            bind:value={quote}
            rows="4"
            maxlength="8000"></textarea></label
        >{/if}
      <label
        >Your note<textarea
          bind:value={text}
          rows="5"
          maxlength="16000"
          placeholder="What would you like to remember?"></textarea></label
      >
      <div class="note-actions">
        <button
          class="primary"
          disabled={busy || (!quote.trim() && !text.trim())}>Save note</button
        ><button
          type="button"
          class="secondary"
          disabled={busy || (!quote.trim() && !text.trim())}
          onclick={() => save(true)}>Save & open Obsidian</button
        ><button
          type="button"
          class="quiet"
          onclick={() => (editing = undefined)}>Back to notes</button
        >
      </div>
    </form>
  {/if}
  <details class="obsidian-settings" bind:open={settingsOpen}>
    <summary>Obsidian destination</summary>
    <p class="small-note">
      Enter your vault name exactly as it appears in Obsidian. Only the note you
      send is passed to the installed app. Your vault is never scanned. Export
      is one-way and does not request overwriting existing files.
    </p>
    <label
      >Vault name<input
        bind:value={vault}
        placeholder="My vault"
        autocomplete="off"
      /></label
    ><label
      >Folder inside vault<input
        bind:value={folder}
        placeholder="Reading"
        autocomplete="off"
      /></label
    ><button
      class="secondary"
      onclick={() => {
        try {
          settings();
          notice = 'Destination saved on this device.';
        } catch (e) {
          error = (e as Error).message;
        }
      }}>Save destination</button
    >
  </details>
  {#if !editing}
    <div class="note-actions">
      <button
        class="primary"
        onclick={() => {
          const location = capture();
          edit({
            id: crypto.randomUUID(),
            bookId: book.id,
            ...location,
            quote: '',
            text: '',
            created: Date.now(),
            updated: Date.now(),
          });
        }}>Write a note here</button
      >{#if notes.length}<button class="secondary" onclick={() => download()}
          >Download all Markdown</button
        ><button class="secondary" onclick={() => download(undefined, true)}
          >Export all to Anki</button
        >{/if}
    </div>
    {#if !notes.length}<p class="empty-note">
        Select a passage and choose “Add note”, or write a note at your current
        position.
      </p>{/if}
    <div class="notes-list">
      {#each notes as note (note.id)}<article>
          <button
            class="note-location quiet"
            onclick={() => {
              dialog.close();
              jump(note);
            }}>{locationLabel(book, note)} ↗</button
          >{#if note.quote}<blockquote>
              {note.quote}
            </blockquote>{/if}{#if note.text}<p class="note-body">
              {note.text}
            </p>{/if}
          <div class="note-actions">
            <button class="secondary" onclick={() => edit(note)}>Edit</button
            ><button class="secondary" onclick={() => exportObsidian(note)}
              >Open in Obsidian</button
            ><button class="quiet" onclick={() => download(note)}
              >Markdown ↓</button
            ><button class="quiet" onclick={() => download(note, true)}
              >Anki ↓</button
            ><button class="quiet" onclick={() => remove(note)}>Delete</button>
          </div>
        </article>{/each}
    </div>
  {/if}
  <p class="small-note">
    Anki exports put the passage on the front and your note with its source on
    the back. Without a passage, the front asks what you noted at that location.
    Import the CSV in Anki, then edit cards there to suit your study. Notes stay
    in this browser until you export them. Obsidian needs to be installed.
    Scanned PDFs without text support location notes, but cannot provide
    selectable quotations.
  </p>
</dialog>

import { db, type Book, type Position } from './store';
export interface ReadingNote {
  id: string;
  bookId: string;
  quote: string;
  text: string;
  position: Position;
  section: string;
  created: number;
  updated: number;
}
export type NoteLocation = { position: Position; section: string };
export async function listNotes(bookId: string): Promise<ReadingNote[]> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = d
      .transaction('notes')
      .objectStore('notes')
      .index('bookId')
      .getAll(bookId);
    r.onsuccess = () =>
      resolve(
        r.result.sort(
          (a: ReadingNote, b: ReadingNote) => a.created - b.created,
        ),
      );
    r.onerror = () => reject(r.error);
  });
}
export async function saveNote(note: ReadingNote): Promise<void> {
  if (!note.quote.trim() && !note.text.trim())
    throw new Error('Select a passage or write a note first.');
  if (note.quote.length > 8000 || note.text.length > 16000)
    throw new Error(
      'Keep quotations under 8,000 characters and notes under 16,000 characters.',
    );
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(['books', 'notes'], 'readwrite');
    const req = tx.objectStore('books').get(note.bookId);
    req.onsuccess = () => {
      if (!req.result) {
        tx.abort();
        return;
      }
      tx.objectStore('notes').put(note);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () =>
      reject(tx.error || new Error('The book is no longer in your library.'));
  });
}
export async function removeNote(id: string) {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction('notes', 'readwrite');
    tx.objectStore('notes').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}
export function locationLabel(book: Book, note: NoteLocation) {
  return book.format === 'pdf'
    ? `Page ${note.position.page}`
    : `Chapter ${note.position.chapter + 1}${note.section ? ' · ' + note.section : ''}`;
}
export function readingLink(
  book: Book,
  note: NoteLocation,
  origin = location.origin,
) {
  const params = new URLSearchParams({
    read: book.id,
    chapter: String(note.position.chapter),
    fraction: String(note.position.fraction),
    page: String(note.position.page),
  });
  return `${origin}/#${params}`;
}
function plainMarkdown(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\`*_{}[\]()#+.!|~-]/g, '\\$&');
}
export function noteMarkdown(
  book: Book,
  note: ReadingNote,
  origin = location.origin,
) {
  const quote = note.quote.trim()
    ? note.quote
        .split('\n')
        .map((line) => '> ' + plainMarkdown(line))
        .join('\n') + '\n\n'
    : '';
  return `# ${plainMarkdown(book.title)}\n\n${book.author ? plainMarkdown(book.author) + '\n\n' : ''}${plainMarkdown(locationLabel(book, note))} · ${new Date(note.created).toISOString().slice(0, 10)}\n\n${quote}${note.text.trim() ? note.text.trim() + '\n\n' : ''}[Return to this location](${readingLink(book, note, origin)})\n\nBook ID: \`${book.id}\`\nNote ID: \`${note.id}\`\n\n_Skrivist Books · The same book must be stored in this browser to follow the link._\n`;
}
export function noteFile(book: Book, note: ReadingNote, folder = 'Reading') {
  const parts = folder.split('/').filter(Boolean);
  if (
    parts.some((p) => p === '.' || p === '..' || /[\\:#^\[\]\x00-\x1f]/.test(p))
  )
    throw new Error('Use a folder inside the vault, such as Reading/Books.');
  const title =
    book.title
      .replace(/[\\/:*?"<>|#^\[\]\x00-\x1f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 70) || 'Book';
  return [...parts, `${title} - ${note.id}.md`].join('/');
}
export function obsidianLink(
  book: Book,
  note: ReadingNote,
  vault: string,
  folder: string,
  origin = location.origin,
) {
  if (!vault.trim()) throw new Error('Enter the Obsidian vault name first.');
  const params = new URLSearchParams({
    vault: vault.trim(),
    file: noteFile(book, note, folder),
    content: noteMarkdown(book, note, origin),
  });
  const url = 'obsidian://new?' + params;
  if (url.length > 20000)
    throw new Error(
      'This note is too long for an app link. Download Markdown and add it to Obsidian instead.',
    );
  return url;
}
export function parseReadingRoute(
  hash: string,
): { id: string; position?: Position } | undefined {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const id = p.get('read');
  if (!id || !/^[a-f0-9]{64}$/.test(id)) return;
  if (!['chapter', 'fraction', 'page'].every((k) => p.has(k))) return { id };
  const chapter = Number(p.get('chapter')),
    fraction = Number(p.get('fraction')),
    page = Number(p.get('page'));
  if (
    !Number.isInteger(chapter) ||
    chapter < 0 ||
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isFinite(fraction) ||
    fraction < 0 ||
    fraction > 1
  )
    return { id };
  return { id, position: { chapter, fraction, page } };
}

import { beforeEach, it, expect } from 'vitest';
import { db, deleteBook, getBook, updateBook } from '../src/lib/store';
import { importBook } from '../src/lib/import';
import { epubFile } from './fixtures';
import {
  listNotes,
  saveNote,
  removeNote,
  noteMarkdown,
  obsidianLink,
  noteFile,
  parseReadingRoute,
  readingLink,
  type ReadingNote,
} from '../src/lib/notes';
beforeEach(async () => {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction([...d.objectStoreNames], 'readwrite');
    for (const name of tx.objectStoreNames) tx.objectStore(name).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
});
function note(bookId: string): ReadingNote {
  return {
    id: '954129c4-3369-4833-9672-748427734d20',
    bookId,
    quote: 'A quiet morning.',
    text: 'Remember this.',
    position: { chapter: 1, fraction: 0.4, page: 2 },
    section: 'Evening',
    created: Date.UTC(2026, 8, 21),
    updated: Date.UTC(2026, 8, 21),
  };
}
it('stores and edits location notes independently of reading progress', async () => {
  const book = await importBook(epubFile());
  await updateBook(book.id, { progress: 0.7, status: 'reading' });
  const n = note(book.id);
  await saveNote(n);
  await saveNote({ ...n, text: 'Revised' });
  expect(await listNotes(book.id)).toEqual([{ ...n, text: 'Revised' }]);
  expect((await getBook(book.id))?.progress).toBe(0.7);
  await removeNote(n.id);
  expect(await listNotes(book.id)).toEqual([]);
});
it('deleting a book also deletes only its own notes', async () => {
  const book = await importBook(epubFile());
  const other = await importBook(epubFile({}, 'Other text'));
  await saveNote(note(book.id));
  await saveNote({ ...note(other.id), id: 'other-note' });
  await deleteBook(book.id);
  expect(await listNotes(book.id)).toEqual([]);
  expect(await listNotes(other.id)).toHaveLength(1);
});
it('rejects empty, oversize and orphaned notes', async () => {
  const book = await importBook(epubFile());
  await expect(
    saveNote({ ...note(book.id), quote: '', text: '' }),
  ).rejects.toThrow();
  await expect(
    saveNote({ ...note(book.id), quote: 'x'.repeat(8001) }),
  ).rejects.toThrow();
  await deleteBook(book.id);
  await expect(saveNote(note(book.id))).rejects.toThrow();
});
it('exports to an explicit vault without overwrite or path parameters', async () => {
  const book = await importBook(epubFile());
  const n = note(book.id);
  const u = new URL(
    obsidianLink(
      book,
      n,
      '日本語 & notes',
      'Reading/Books',
      'https://books.skriv.ist',
    ),
  );
  expect(u.protocol).toBe('obsidian:');
  expect(u.searchParams.get('vault')).toBe('日本語 & notes');
  expect(u.searchParams.get('file')).toBe(
    'Reading/Books/A Small Book - ' + n.id + '.md',
  );
  expect(u.searchParams.has('overwrite')).toBe(false);
  expect(u.searchParams.has('path')).toBe(false);
  expect(u.searchParams.get('content')).toContain('Remember this.');
  expect(() => obsidianLink(book, n, '', 'Reading')).toThrow('vault');
  expect(() => noteFile(book, n, '../private')).toThrow();
});
it('quotes imported text literally rather than loading embedded Markdown or HTML', async () => {
  const book = await importBook(epubFile());
  const markdown = noteMarkdown(
    book,
    {
      ...note(book.id),
      quote:
        '![beacon](https://tracker.test/pixel)\n<img src="https://tracker.test">',
    },
    'https://books.skriv.ist',
  );
  expect(markdown).toContain('\\!\\[beacon\\]');
  expect(markdown).not.toContain('<img');
});
it('location links round-trip and reject malformed coordinates', async () => {
  const book = await importBook(epubFile());
  const n = note(book.id);
  const link = new URL(readingLink(book, n, 'https://books.skriv.ist'));
  expect(parseReadingRoute(link.hash)).toEqual({
    id: book.id,
    position: n.position,
  });
  expect(
    parseReadingRoute('#read=' + book.id + '&chapter=-1&fraction=NaN&page=1'),
  ).toEqual({ id: book.id });
  expect(parseReadingRoute('#read=../../private')).toBeUndefined();
});

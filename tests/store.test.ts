import { beforeEach, it, expect } from 'vitest';
import {
  db,
  listBooks,
  getFile,
  getBook,
  getCover,
  addBook,
  updateBook,
  deleteBook,
  saveShelf,
  shelves,
} from '../src/lib/store';
import { importBook } from '../src/lib/import';
import { epubFile } from './fixtures';
beforeEach(async () => {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(
      ['books', 'files', 'covers', 'shelves'],
      'readwrite',
    );
    for (const name of tx.objectStoreNames) tx.objectStore(name).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
});
it('starts empty; importing stores only explicitly selected files', async () => {
  expect(await listBooks()).toEqual([]);
  const book = await importBook(epubFile());
  expect(book.title).toBe('A Small Book');
  expect(book.status).toBe('unread');
  expect((await getFile(book.id))?.size).toBeGreaterThan(0);
});
it('deduplicates without losing reading positions or completion', async () => {
  const book = await importBook(epubFile());
  await updateBook(book.id, {
    status: 'read',
    position: { chapter: 1, fraction: 0.5, page: 1 },
    progress: 1,
  });
  await Promise.all([importBook(epubFile()), importBook(epubFile())]);
  expect(await listBooks()).toHaveLength(1);
  expect((await getBook(book.id))?.position.fraction).toBe(0.5);
  expect((await getBook(book.id))?.status).toBe('read');
});
it('removes the file, cover and metadata together', async () => {
  const book = await importBook(epubFile());
  await deleteBook(book.id);
  expect(await getBook(book.id)).toBeUndefined();
  expect(await getFile(book.id)).toBeUndefined();
  expect(await getCover(book.id)).toBeUndefined();
});
it('cancellation cannot leave a partial import', async () => {
  const abort = new AbortController();
  abort.abort();
  await expect(
    importBook(epubFile(), undefined, abort.signal),
  ).rejects.toThrow();
  expect(await listBooks()).toEqual([]);
});
it('does not persist session passwords with shelves', async () => {
  await saveShelf({
    url: 'https://example.test/feed',
    connectionUrl: 'https://example.test/',
    username: 'reader',
    title: 'Test',
    password: 'private',
  } as any);
  expect(JSON.stringify(await shelves())).not.toContain('private');
});
it('validates PDF magic before storing', async () => {
  await expect(importBook(new File(['html'], 'wrong.pdf'))).rejects.toThrow(
    'valid PDF',
  );
  expect(await listBooks()).toEqual([]);
});
it('repairs a missing file and attaches catalogue identity without resetting progress', async () => {
  const file = epubFile();
  const book = await importBook(file);
  await updateBook(book.id, { status: 'read', progress: 1 });
  const d = await db();
  await new Promise<void>((resolve) => {
    const tx = d.transaction('files', 'readwrite');
    tx.objectStore('files').delete(book.id);
    tx.oncomplete = () => resolve();
  });
  const remote = {
    href: 'https://test.example/book',
    feedUrl: 'https://test.example/feed',
    connectionUrl: 'https://test.example/feed',
    username: 'reader',
  };
  const repaired = await importBook(file, remote);
  expect(repaired.status).toBe('read');
  expect(repaired.remote).toEqual(remote);
  expect(await getFile(book.id)).toBeTruthy();
});
it('restores missing covers on re-import', async () => {
  const file = epubFile({
    $manifest:
      '<item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/>',
    'OPS/cover.png': 'synthetic image bytes',
  });
  const book = await importBook(file);
  expect(await getCover(book.id)).toBeTruthy();
  const d = await db();
  await new Promise<void>((resolve) => {
    const tx = d.transaction('covers', 'readwrite');
    tx.objectStore('covers').delete(book.id);
    tx.oncomplete = () => resolve();
  });
  await importBook(file);
  expect(await getCover(book.id)).toBeTruthy();
});

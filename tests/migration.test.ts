import { it, expect } from 'vitest';
import { db, getBook, getFile } from '../src/lib/store';
it('upgrades a v1 library without changing stored files or reading state', async () => {
  const old = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('skrivist-books', 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('books', { keyPath: 'id' });
      r.result.createObjectStore('files');
      r.result.createObjectStore('covers');
      r.result.createObjectStore('shelves', { keyPath: 'url' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const book = {
    id: 'a'.repeat(64),
    title: 'Synthetic existing book',
    format: 'epub',
    progress: 0.42,
    status: 'reading',
    position: { chapter: 3, fraction: 0.5, page: 1 },
  };
  await new Promise<void>((resolve) => {
    const tx = old.transaction(['books', 'files'], 'readwrite');
    tx.objectStore('books').put(book);
    tx.objectStore('files').put(new Blob(['synthetic stored file']), book.id);
    tx.oncomplete = () => resolve();
  });
  old.close();
  const upgraded = await db();
  expect(upgraded.version).toBe(2);
  expect(upgraded.objectStoreNames.contains('notes')).toBe(true);
  expect(await getBook(book.id)).toEqual(book);
  expect((await getFile(book.id))?.size).toBe(21);
});

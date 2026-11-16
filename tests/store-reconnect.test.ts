import { expect, it } from 'vitest';
import { db, getBook, listBooks, updateBook } from '../src/lib/store';
import { listNotes } from '../src/lib/notes';
import { shelves } from '../src/lib/shelves';
import { importBook } from '../src/lib/import';
import { epubFile } from './fixtures';

// Runs first in this file: the database does not exist yet, so db() has to
// upgrade it, and an old connection that never closes blocks that.
it('says so when another tab blocks the database upgrade', async () => {
  const old = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('skrivist-books', 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await expect(db()).rejects.toThrow('Close other Skrivist Books tabs');
  old.close();
  // The next call opens again instead of keeping the failed promise.
  await expect(db()).resolves.toBeTruthy();
});

it('reopens the database when the browser drops the connection', async () => {
  const book = await importBook(epubFile());
  const lost = await db();
  // WebKit can lose the connection without a close event reaching the page.
  lost.close();
  await updateBook(book.id, { progress: 0.5 });
  expect((await getBook(book.id))?.progress).toBe(0.5);
  expect(await listBooks()).toHaveLength(1);
  expect(await listNotes(book.id)).toEqual([]);
  expect(await shelves()).toEqual([]);
  const fresh = await db();
  expect(fresh).not.toBe(lost);

  // A close event drops the cached connection too.
  fresh.close();
  fresh.onclose?.call(fresh, new Event('close'));
  expect(await db()).not.toBe(fresh);
});

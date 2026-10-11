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
} from '../src/lib/store';
import { saveShelf, shelves, forgetShelf } from '../src/lib/shelves';
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

const rawAll = async <T>(name: string): Promise<T[]> => {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = d.transaction(name).objectStore(name).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};
const rawPut = async (name: string, value: unknown) => {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(name, 'readwrite');
    tx.objectStore(name).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};
const LEGACY = 'https://a.example/opds/t/tok_en/v1.2/catalog';
const PLAIN = 'https://a.example/opds/v1.2/catalog';

it('keeps a pairing token in its own field of the shelf', async () => {
  await saveShelf({
    url: PLAIN,
    connectionUrl: PLAIN,
    username: '',
    title: 'Paired',
    token: 'tok_en',
  });
  expect(await shelves()).toEqual([
    {
      url: PLAIN,
      connectionUrl: PLAIN,
      username: '',
      title: 'Paired',
      token: 'tok_en',
    },
  ]);
  const [stored] = await rawAll<{ url: string; connectionUrl: string }>(
    'shelves',
  );
  expect(stored.url + stored.connectionUrl).not.toContain('tok_en');
});
it('deletes the token with the shelf', async () => {
  await saveShelf({
    url: PLAIN,
    connectionUrl: PLAIN,
    username: '',
    title: 'Paired',
    token: 'tok_en',
  });
  await forgetShelf(PLAIN);
  expect(await shelves()).toEqual([]);
  expect(await rawAll('shelves')).toEqual([]);
});
it('keeps a Basic shelf over a legacy pairing of the same catalogue, without taking its token', async () => {
  await rawPut('shelves', {
    url: LEGACY,
    connectionUrl: LEGACY,
    username: '',
    title: 'Old pairing',
  });
  await rawPut('shelves', {
    url: PLAIN,
    connectionUrl: PLAIN,
    username: 'reader',
    title: 'Mine',
  });
  expect(await shelves()).toEqual([
    { url: PLAIN, connectionUrl: PLAIN, username: 'reader', title: 'Mine' },
  ]);
});
it('moves a legacy token out of a shelf URL and rewrites the stored record', async () => {
  await rawPut('shelves', {
    url: LEGACY,
    connectionUrl: LEGACY,
    username: '',
    title: 'Old',
  });
  const expected = {
    url: PLAIN,
    connectionUrl: PLAIN,
    username: '',
    title: 'Old',
    token: 'tok_en',
  };
  expect(await shelves()).toEqual([expected]);
  expect(await rawAll('shelves')).toEqual([expected]);
  expect(await shelves()).toEqual([expected]);
});
it('merges a legacy shelf with the plain shelf it becomes', async () => {
  await rawPut('shelves', {
    url: LEGACY,
    connectionUrl: LEGACY,
    username: '',
    title: 'Old',
  });
  await rawPut('shelves', {
    url: PLAIN,
    connectionUrl: PLAIN,
    username: '',
    title: 'New',
  });
  const result = await shelves();
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ url: PLAIN, token: 'tok_en' });
  expect(await rawAll('shelves')).toHaveLength(1);
});
it('scrubs a legacy token from the catalogue URLs stored with a book', async () => {
  const book = await importBook(epubFile());
  await rawPut('books', {
    ...book,
    status: 'reading',
    progress: 0.4,
    remote: {
      href: 'https://a.example/opds/t/tok_en/v1.2/items/1/file',
      feedUrl: LEGACY,
      connectionUrl: LEGACY,
      username: '',
    },
  });
  const plain = {
    href: 'https://a.example/opds/v1.2/items/1/file',
    feedUrl: PLAIN,
    connectionUrl: PLAIN,
    username: '',
  };
  const [listed] = await listBooks();
  expect(listed.remote).toEqual(plain);
  expect(listed).toMatchObject({ status: 'reading', progress: 0.4 });
  const [stored] = await rawAll<typeof book>('books');
  expect(stored.remote).toEqual(plain);
  expect(stored).toMatchObject({ status: 'reading', progress: 0.4 });
});

const P = 'https://p.example/opds/v1.2/catalog';
const SAGA = 'https://p.example/opds/v1.2/series/3';
const MINE = 'https://p.example/opds/v1.2/recent';
const Q = 'https://q.example/opds';
const connectionShelves = async () => {
  await saveShelf({
    url: P,
    title: 'Library',
    username: '',
    connectionUrl: P,
    token: 'A',
  });
  await saveShelf({
    url: SAGA,
    title: 'Saga',
    username: '',
    connectionUrl: P,
    token: 'A',
  });
  await saveShelf({
    url: MINE,
    title: 'Mine',
    username: 'me',
    connectionUrl: P,
  });
  await saveShelf({
    url: Q,
    title: 'Other',
    username: '',
    connectionUrl: Q,
    token: 'X',
  });
};
it('keeps one token per connection: re-pairing updates every shelf saved from the catalogue', async () => {
  await connectionShelves();
  await saveShelf({
    url: P,
    title: 'Library',
    username: '',
    connectionUrl: P,
    token: 'B',
  });
  const tokens = Object.fromEntries(
    (await shelves()).map((s) => [s.url, s.token]),
  );
  expect(tokens).toEqual({
    [P]: 'B',
    [SAGA]: 'B',
    [MINE]: undefined,
    [Q]: 'X',
  });
});
it('forgetting a catalogue forgets the shelves saved from it; a sub-shelf alone goes alone', async () => {
  await connectionShelves();
  await forgetShelf(SAGA);
  expect((await shelves()).map((s) => s.url).sort()).toEqual(
    [MINE, P, Q].sort(),
  );
  await saveShelf({
    url: SAGA,
    title: 'Saga',
    username: '',
    connectionUrl: P,
    token: 'A',
  });
  await forgetShelf(P, { connectionUrl: P, username: '' });
  // Mine is the same catalogue under another login: another connection.
  expect((await shelves()).map((s) => s.url).sort()).toEqual([MINE, Q].sort());
});
it('a pairing shelf saved with a username by an older version joins its connection', async () => {
  await rawPut('shelves', {
    url: P,
    connectionUrl: P,
    username: '',
    title: 'Library',
    token: 'A',
  });
  await rawPut('shelves', {
    url: SAGA,
    connectionUrl: P,
    username: 'reader',
    title: 'Saga',
    token: 'A',
  });
  await rawPut('shelves', {
    url: MINE,
    connectionUrl: P,
    username: 'reader',
    title: 'Mine',
  });
  const users = Object.fromEntries(
    (await shelves()).map((s) => [s.url, s.username]),
  );
  expect(users).toEqual({ [P]: '', [SAGA]: '', [MINE]: 'reader' });
  expect(
    (await rawAll<{ url: string; username: string }>('shelves')).find(
      (s) => s.url === SAGA,
    )?.username,
  ).toBe('');
  await saveShelf({
    url: P,
    title: 'Library',
    username: '',
    connectionUrl: P,
    token: 'B',
  });
  expect((await shelves()).find((s) => s.url === SAGA)?.token).toBe('B');
  await forgetShelf(P, { connectionUrl: P, username: '' });
  expect((await shelves()).map((s) => s.url)).toEqual([MINE]);
});

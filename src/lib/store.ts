import { isDesktop, native, nativeGet } from './desktop';
import { plainRequest } from './opds';
export type Status = 'unread' | 'reading' | 'read';
export interface Position {
  chapter: number;
  fraction: number;
  page: number;
}
export interface Remote {
  href: string;
  feedUrl: string;
  connectionUrl: string;
  username: string;
}
export interface Book {
  id: string;
  title: string;
  author: string;
  format: 'epub' | 'pdf';
  added: number;
  size: number;
  status: Status;
  progress: number;
  position: Position;
  remote?: Remote;
}
export interface Shelf {
  url: string;
  title: string;
  username: string;
  connectionUrl: string;
  /** An Armarium pairing token. Kept on this device in its own field, never in a URL. */
  token?: string;
}
let opening: Promise<IDBDatabase> | undefined;
export function db(): Promise<IDBDatabase> {
  if (isDesktop())
    return Promise.reject(new Error('Desktop libraries use native storage.'));
  return (opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('skrivist-books', 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('books')) {
        db.createObjectStore('books', { keyPath: 'id' });
        db.createObjectStore('files');
        db.createObjectStore('covers');
        db.createObjectStore('shelves', { keyPath: 'url' });
      }
      if (!db.objectStoreNames.contains('notes'))
        db.createObjectStore('notes', { keyPath: 'id' }).createIndex(
          'bookId',
          'bookId',
        );
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => {
        req.result.close();
        opening = undefined;
      };
      resolve(req.result);
    };
    req.onerror = () => {
      opening = undefined;
      reject(req.error);
    };
  }));
}
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () =>
      reject(tx.error || new Error('Browser storage is full or unavailable.'));
  });
}
// Before tokens had a field of their own they were stored inside catalogue URLs
// (/opds/t/<token>/…). The URLs a book remembers only identify it, so the token
// is simply dropped from them; each record is re-read before it is rewritten.
function plainRemote(remote: Remote): Remote {
  try {
    const connection = {
      url: remote.connectionUrl,
      username: '',
      password: '',
    };
    const href = plainRequest(remote.href, connection);
    return {
      ...remote,
      href: href.target,
      feedUrl: plainRequest(remote.feedUrl, connection).target,
      connectionUrl: href.connection.url,
    };
  } catch {
    return remote;
  }
}
const sameRemote = (a: Remote, b: Remote) =>
  a.href === b.href &&
  a.feedUrl === b.feedUrl &&
  a.connectionUrl === b.connectionUrl;
async function scrubRemotes(ids: string[]) {
  if (isDesktop()) {
    for (const id of ids) {
      const book = await getBook(id);
      if (book?.remote)
        await native('books_update', {
          id,
          changes: { remote: plainRemote(book.remote) },
        });
    }
    return;
  }
  const d = await db(),
    tx = d.transaction('books', 'readwrite'),
    finished = done(tx),
    store = tx.objectStore('books');
  for (const id of ids) {
    const req = store.get(id);
    req.onsuccess = () => {
      const book: Book | undefined = req.result;
      if (book?.remote)
        store.put({ ...book, remote: plainRemote(book.remote) });
    };
  }
  await finished;
}
export async function listBooks(): Promise<Book[]> {
  const books: Book[] = isDesktop()
    ? await native('list', { store: 'books' })
    : await request(
        (await db()).transaction('books').objectStore('books').getAll(),
      );
  const legacy: Book[] = [];
  const result = books.map((book) => {
    if (!book.remote) return book;
    const remote = plainRemote(book.remote);
    if (sameRemote(remote, book.remote)) return book;
    legacy.push(book);
    return { ...book, remote };
  });
  if (legacy.length) await scrubRemotes(legacy.map((book) => book.id));
  return result;
}
export async function getBook(id: string): Promise<Book | undefined> {
  const book: Book | undefined = isDesktop()
    ? await nativeGet('books', id)
    : await request(
        (await db()).transaction('books').objectStore('books').get(id),
      );
  // listBooks() rewrites stored remotes; a book opened by link may be read first.
  return book?.remote ? { ...book, remote: plainRemote(book.remote) } : book;
}
export async function getFile(id: string): Promise<Blob | undefined> {
  if (isDesktop()) return nativeGet('files', id);
  const d = await db();
  return request(d.transaction('files').objectStore('files').get(id));
}
export async function getCover(id: string): Promise<Blob | undefined> {
  if (isDesktop()) return nativeGet('covers', id);
  const d = await db();
  return request(d.transaction('covers').objectStore('covers').get(id));
}
export async function addBook(
  book: Book,
  file: Blob,
  cover?: Blob,
): Promise<Book> {
  if (isDesktop()) return native('books_add', { book, file, cover });
  const d = await db(),
    tx = d.transaction(['books', 'files', 'covers'], 'readwrite'),
    finished = done(tx);
  let result = book;
  const req = tx.objectStore('books').get(book.id);
  req.onsuccess = () => {
    if (req.result) {
      result = { ...req.result, remote: book.remote || req.result.remote };
      tx.objectStore('books').put(result);
      if (cover) tx.objectStore('covers').put(cover, book.id);
      const stored = tx.objectStore('files').get(book.id);
      stored.onsuccess = () => {
        if (!stored.result) tx.objectStore('files').put(file, book.id);
      };
      return;
    }
    tx.objectStore('books').put(book);
    tx.objectStore('files').put(file, book.id);
    if (cover) tx.objectStore('covers').put(cover, book.id);
  };
  await finished;
  return result;
}
export async function updateBook(
  id: string,
  changes: Partial<Pick<Book, 'status' | 'position' | 'progress'>>,
): Promise<void> {
  if (isDesktop()) return native('books_update', { id, changes });
  const d = await db(),
    tx = d.transaction('books', 'readwrite'),
    finished = done(tx),
    store = tx.objectStore('books'),
    req = store.get(id);
  req.onsuccess = () => {
    if (req.result) store.put({ ...req.result, ...changes, id });
  };
  await finished;
}
export async function deleteBook(id: string) {
  if (isDesktop()) return native('books_delete', { id });
  const d = await db(),
    tx = d.transaction(['books', 'files', 'covers', 'notes'], 'readwrite'),
    finished = done(tx);
  const notes = tx
    .objectStore('notes')
    .index('bookId')
    .openKeyCursor(IDBKeyRange.only(id));
  notes.onsuccess = () => {
    const cursor = notes.result;
    if (cursor) {
      tx.objectStore('notes').delete(cursor.primaryKey);
      cursor.continue();
    }
  };
  for (const name of ['books', 'files', 'covers'])
    tx.objectStore(name).delete(id);
  await finished;
}
const shelfRecord = (shelf: Shelf): Shelf => ({
  url: shelf.url,
  title: shelf.title,
  username: shelf.username,
  connectionUrl: shelf.connectionUrl,
  ...(shelf.token ? { token: shelf.token } : {}),
});
export async function saveShelf(shelf: Shelf) {
  if (isDesktop())
    return native('put', { store: 'shelves', value: shelfRecord(shelf) });
  const d = await db(),
    tx = d.transaction('shelves', 'readwrite'),
    finished = done(tx);
  tx.objectStore('shelves').put(shelfRecord(shelf));
  await finished;
}
// A shelf saved before tokens had a field of their own carries its token inside
// its URLs (/opds/t/<token>/…): move it into the field and make the URLs plain.
function plainShelf(shelf: Shelf): Shelf {
  try {
    const plain = plainRequest(shelf.url, {
      url: shelf.connectionUrl,
      username: shelf.username,
      password: '',
      ...(shelf.token ? { token: shelf.token } : {}),
    });
    const { token: _, ...rest } = shelf;
    return {
      ...rest,
      url: plain.target,
      connectionUrl: plain.connection.url,
      ...(plain.connection.token ? { token: plain.connection.token } : {}),
    };
  } catch {
    return shelf;
  }
}
// Legacy shelves rewritten to plain URLs; shelves that become the same one merge,
// keeping a token. Pure: the stored records are not modified.
function planShelves(stored: Shelf[]): { result: Shelf[]; changed: boolean } {
  const plain = new Map<string, Shelf>();
  let changed = false;
  for (const shelf of stored) {
    const next = plainShelf(shelf);
    if (next.url !== shelf.url || next.connectionUrl !== shelf.connectionUrl)
      changed = true;
    const same = plain.get(next.url);
    if (!same) plain.set(next.url, next);
    else if (!same.token && next.token)
      plain.set(next.url, { ...same, token: next.token });
  }
  return { result: [...plain.values()], changed };
}
export async function shelves(): Promise<Shelf[]> {
  if (isDesktop()) {
    const stored: Shelf[] = await native('list', { store: 'shelves' });
    const { result, changed } = planShelves(stored);
    if (!changed) return result;
    // Native storage has no multi-record transaction: write the plain shelves
    // first and drop the legacy rows last, so an interrupted rewrite loses nothing.
    for (const shelf of result)
      await native('put', { store: 'shelves', value: shelfRecord(shelf) });
    // A native library that predates the token field drops it: keep the legacy
    // rows, which still carry their tokens, unless every token was stored.
    for (const shelf of result)
      if (
        shelf.token &&
        (await nativeGet<Shelf>('shelves', shelf.url))?.token !== shelf.token
      )
        return result;
    for (const shelf of stored)
      if (!result.some((kept) => kept.url === shelf.url))
        await native('delete', { store: 'shelves', key: shelf.url });
    return result;
  }
  // One read-write transaction: rewriting old records must not race a save.
  const d = await db(),
    tx = d.transaction('shelves', 'readwrite'),
    finished = done(tx),
    store = tx.objectStore('shelves'),
    req = store.getAll();
  let result: Shelf[] = [];
  req.onsuccess = () => {
    const stored: Shelf[] = req.result;
    const plan = planShelves(stored);
    result = plan.result;
    if (!plan.changed) return;
    for (const shelf of stored) store.delete(shelf.url);
    for (const shelf of result) store.put(shelf);
  };
  await finished;
  return result;
}
export async function forgetShelf(url: string) {
  if (isDesktop()) return native('delete', { store: 'shelves', key: url });
  const d = await db(),
    tx = d.transaction('shelves', 'readwrite'),
    finished = done(tx);
  tx.objectStore('shelves').delete(url);
  await finished;
}
export async function storageInfo() {
  if (isDesktop()) return native<{ usage: number; quota?: number }>('usage');
  return navigator.storage?.estimate?.() || {};
}

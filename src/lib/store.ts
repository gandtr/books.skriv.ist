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
  const d = await db();
  const books: Book[] = await request(
    d.transaction('books').objectStore('books').getAll(),
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
  const d = await db();
  return request(d.transaction('books').objectStore('books').get(id));
}
export async function getFile(id: string): Promise<Blob | undefined> {
  const d = await db();
  return request(d.transaction('files').objectStore('files').get(id));
}
export async function getCover(id: string): Promise<Blob | undefined> {
  const d = await db();
  return request(d.transaction('covers').objectStore('covers').get(id));
}
export async function addBook(
  book: Book,
  file: Blob,
  cover?: Blob,
): Promise<Book> {
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
export async function saveShelf(shelf: Shelf) {
  const d = await db(),
    tx = d.transaction('shelves', 'readwrite'),
    finished = done(tx);
  tx.objectStore('shelves').put({
    url: shelf.url,
    title: shelf.title,
    username: shelf.username,
    connectionUrl: shelf.connectionUrl,
    ...(shelf.token ? { token: shelf.token } : {}),
  });
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
export async function shelves(): Promise<Shelf[]> {
  // One read-write transaction: rewriting old records must not race a save.
  const d = await db(),
    tx = d.transaction('shelves', 'readwrite'),
    finished = done(tx),
    store = tx.objectStore('shelves'),
    req = store.getAll();
  let result: Shelf[] = [];
  req.onsuccess = () => {
    const stored: Shelf[] = req.result;
    const plain = new Map<string, Shelf>();
    let changed = false;
    for (const shelf of stored) {
      const next = plainShelf(shelf);
      if (next.url !== shelf.url || next.connectionUrl !== shelf.connectionUrl)
        changed = true;
      const same = plain.get(next.url);
      if (!same) plain.set(next.url, next);
      else if (!same.token && next.token) same.token = next.token;
    }
    result = [...plain.values()];
    if (!changed) return;
    for (const shelf of stored) store.delete(shelf.url);
    for (const shelf of result) store.put(shelf);
  };
  await finished;
  return result;
}
export async function forgetShelf(url: string) {
  const d = await db(),
    tx = d.transaction('shelves', 'readwrite'),
    finished = done(tx);
  tx.objectStore('shelves').delete(url);
  await finished;
}
export async function storageInfo() {
  return navigator.storage?.estimate?.() || {};
}

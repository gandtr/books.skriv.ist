import {
  calibreFile,
  calibreFolders,
  isDesktop,
  native,
  nativeGet,
} from './desktop';
import { MAX_BOOK } from './epub';
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
/**
 * A book read in place from a Calibre library (desktop only). The file stays
 * in Calibre; the reading position and notes are kept here, keyed to Calibre's
 * book ID so they survive the file being renamed or converted again.
 */
export interface CalibreLink {
  /** Calibre's library ID, or `folder-<id>` for a database without one. */
  library: string;
  /** Calibre's book ID. */
  book: number;
  format: 'epub' | 'pdf';
  /** The file, relative to the library root, when the book was last opened. */
  path: string;
  /** The connected folder it was last opened from. */
  folder: string;
}
/**
 * The library ID of a linked book: derived from Calibre's library and book
 * IDs rather than from the file, and shaped like every other book ID (64 hex
 * digits), which reading links and exported notes rely on.
 */
export async function calibreBookId(
  link: Pick<CalibreLink, 'library' | 'book' | 'format'>,
): Promise<string> {
  const key = new TextEncoder().encode(
    `calibre:${link.library}:${link.book}:${link.format}`,
  );
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', key)),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
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
  calibre?: CalibreLink;
}
let opening: Promise<IDBDatabase> | undefined;
let connection: IDBDatabase | undefined;
// The browser can close the connection (site data cleared, storage pressure,
// WebKit losing its IndexedDB server); the next call opens a new one.
function forget(d: IDBDatabase) {
  if (connection !== d) return;
  connection = undefined;
  opening = undefined;
}
export function db(): Promise<IDBDatabase> {
  if (isDesktop())
    return Promise.reject(new Error('Desktop libraries use native storage.'));
  return (opening ??= new Promise((resolve, reject) => {
    let blocked = false;
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
      const d = req.result;
      // Opened after the caller was told to close other tabs: not used.
      if (blocked) return d.close();
      connection = d;
      d.onversionchange = () => {
        d.close();
        forget(d);
      };
      d.onclose = () => forget(d);
      resolve(d);
    };
    req.onblocked = () => {
      blocked = true;
      opening = undefined;
      reject(new Error('Close other Skrivist Books tabs, then try again.'));
    };
    req.onerror = () => {
      opening = undefined;
      reject(req.error);
    };
  }));
}
/** A transaction on the library database, reopening a connection the browser closed. */
export async function transaction(
  stores: string | string[],
  mode: IDBTransactionMode = 'readonly',
): Promise<IDBTransaction> {
  const d = await db();
  try {
    return d.transaction(stores, mode);
  } catch (e) {
    if ((e as DOMException).name !== 'InvalidStateError') throw e;
    forget(d);
    return (await db()).transaction(stores, mode);
  }
}
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export function done(tx: IDBTransaction): Promise<void> {
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
  const tx = await transaction('books', 'readwrite'),
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
    : await request((await transaction('books')).objectStore('books').getAll());
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
    : await request((await transaction('books')).objectStore('books').get(id));
  // listBooks() rewrites stored remotes; a book opened by link may be read first.
  return book?.remote ? { ...book, remote: plainRemote(book.remote) } : book;
}
const TOO_LARGE = 'Choose a book smaller than 128 MB.';
/**
 * The file of a book that lives in a Calibre library. Tries the folder it was
 * last opened from, then every other connected folder: the path contains
 * Calibre's book ID, so the same path in a moved or re-connected library is
 * the same book.
 */
async function calibreBookFile(link: CalibreLink): Promise<Blob> {
  let failure: unknown;
  try {
    return await calibreFile(link.folder, link.path, MAX_BOOK, TOO_LARGE);
  } catch (e) {
    if ((e as Error).message === TOO_LARGE) throw e;
    failure = e;
  }
  for (const folder of await calibreFolders().catch(() => [])) {
    if (folder.id === link.folder || !folder.available) continue;
    try {
      return await calibreFile(folder.id, link.path, MAX_BOOK, TOO_LARGE);
    } catch {}
  }
  throw new Error(
    failure instanceof DOMException && failure.name === 'NotFoundError'
      ? 'This book is no longer where Calibre kept it. Open it again from the Calibre tab; your notes and reading position are kept.'
      : 'This book is in a Calibre library that is not connected or not reachable right now. Connect it again in the Calibre tab; your notes and reading position are kept.',
  );
}
export async function getFile(id: string): Promise<Blob | undefined> {
  if (isDesktop()) {
    const stored = await nativeGet<Blob>('files', id);
    if (stored) return stored;
    const book = await nativeGet<Book>('books', id);
    return book?.calibre ? calibreBookFile(book.calibre) : undefined;
  }
  return request((await transaction('files')).objectStore('files').get(id));
}
export async function getCover(id: string): Promise<Blob | undefined> {
  if (isDesktop()) return nativeGet('covers', id);
  return request((await transaction('covers')).objectStore('covers').get(id));
}
export async function addBook(
  book: Book,
  file: Blob,
  cover?: Blob,
): Promise<Book> {
  if (isDesktop()) return native('books_add', { book, file, cover });
  const tx = await transaction(['books', 'files', 'covers'], 'readwrite'),
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
/**
 * Adds a Calibre book to the library without copying its file, or refreshes
 * the link, title and author of one already there. Desktop only.
 */
export async function linkBook(book: Book, cover?: Blob): Promise<Book> {
  if (!isDesktop() || !book.calibre)
    throw new Error('Reading in place needs the desktop app.');
  return native('books_link', { book, cover });
}
export async function updateBook(
  id: string,
  changes: Partial<Pick<Book, 'status' | 'position' | 'progress'>>,
): Promise<void> {
  if (isDesktop()) return native('books_update', { id, changes });
  const tx = await transaction('books', 'readwrite'),
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
  const tx = await transaction(
      ['books', 'files', 'covers', 'notes'],
      'readwrite',
    ),
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
export async function storageInfo() {
  if (isDesktop()) return native<{ usage: number; quota?: number }>('usage');
  return navigator.storage?.estimate?.() || {};
}

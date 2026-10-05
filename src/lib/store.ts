import { isDesktop, native, nativeGet } from './desktop';
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
}
let opening: Promise<IDBDatabase> | undefined;
export function db(): Promise<IDBDatabase> {
  if (isDesktop()) return Promise.reject(new Error('Desktop libraries use native storage.'));
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
export async function listBooks(): Promise<Book[]> {
  if (isDesktop()) return native('list', { store: 'books' });
  const d = await db();
  return request(d.transaction('books').objectStore('books').getAll());
}
export async function getBook(id: string): Promise<Book | undefined> {
  if (isDesktop()) return nativeGet('books', id);
  const d = await db();
  return request(d.transaction('books').objectStore('books').get(id));
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
export async function saveShelf(shelf: Shelf) {
  if (isDesktop()) return native('put', { store: 'shelves', value: { url: shelf.url, title: shelf.title, username: shelf.username, connectionUrl: shelf.connectionUrl } });
  const d = await db(),
    tx = d.transaction('shelves', 'readwrite'),
    finished = done(tx);
  tx.objectStore('shelves').put({
    url: shelf.url,
    title: shelf.title,
    username: shelf.username,
    connectionUrl: shelf.connectionUrl,
  });
  await finished;
}
export async function shelves(): Promise<Shelf[]> {
  if (isDesktop()) return native('list', { store: 'shelves' });
  const d = await db();
  return request(d.transaction('shelves').objectStore('shelves').getAll());
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

import { Epub, MAX_BOOK } from './epub';
import {
  addBook,
  getBook,
  getCover,
  getFile,
  listBooks,
  type Book,
  type Remote,
} from './store';
export async function importBook(
  file: File,
  remote?: Remote,
  signal?: AbortSignal,
  metadata?: { title: string; author: string },
): Promise<Book> {
  signal?.throwIfAborted();
  const format = file.name.toLowerCase().endsWith('.epub')
    ? 'epub'
    : file.name.toLowerCase().endsWith('.pdf')
      ? 'pdf'
      : null;
  if (!format) throw new Error('Choose an EPUB or PDF file.');
  if (file.size > MAX_BOOK)
    throw new Error('Choose a book smaller than 128 MB.');
  if (remote) {
    const known = (await listBooks()).find(
      (book) =>
        book.remote?.href === remote.href &&
        book.remote?.username === remote.username &&
        new URL(book.remote.connectionUrl).origin ===
          new URL(remote.connectionUrl).origin,
    );
    if (known && (await getFile(known.id))) return known;
  }
  const bytes = await file.arrayBuffer();
  signal?.throwIfAborted();
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const id = Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  const existing = await getBook(id);
  if (existing) {
    let restoredCover: Blob | undefined;
    if (format === 'epub' && !(await getCover(id))) {
      const epub = await Epub.open(new Uint8Array(bytes));
      restoredCover = epub.info.cover;
      epub.close();
    }
    signal?.throwIfAborted();
    return addBook(
      { ...existing, remote: remote || existing.remote },
      file,
      restoredCover,
    );
  }
  let title = file.name.replace(/\.(epub|pdf)$/i, ''),
    author = '',
    cover: Blob | undefined;
  if (format === 'epub') {
    const epub = await Epub.open(new Uint8Array(bytes));
    ({ title, author, cover } = epub.info);
    epub.close();
  } else if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-')
    throw new Error('This file is not a valid PDF.');
  if (metadata) {
    title = metadata.title;
    author = metadata.author;
  }
  signal?.throwIfAborted();
  return addBook(
    {
      id,
      title,
      author,
      format,
      added: Date.now(),
      size: file.size,
      status: 'unread',
      progress: 0,
      position: { chapter: 0, fraction: 0, page: 1 },
      remote,
    },
    file,
    cover,
  );
}

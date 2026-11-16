// @vitest-environment node
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { invoke } from '@tauri-apps/api/core';
import { CalibreDatabase } from '../src/lib/calibre-db';
import {
  readCalibreSnapshot,
  sourceFromHost,
} from '../src/lib/calibre-source';
import { calibreFile } from '../src/lib/desktop';
import {
  calibreBookId,
  getFile,
  linkBook,
  type Book,
} from '../src/lib/store';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const ipc = vi.mocked(invoke);
const FOLDER = { id: 'f1', path: 'D:\\Calibre', name: 'Calibre', available: true };
const BOOK = 'Writer/Title (7)/Title - Writer.epub';
const MB = 1024 * 1024;

/** A host holding Calibre folders in memory: id -> path -> bytes. */
function host(folders: Record<string, Record<string, Uint8Array>>) {
  const reads: string[] = [];
  const records = new Map<string, any>();
  ipc.mockImplementation(async (command, args: any) => {
    if (command === 'calibre_folders')
      return Object.keys(folders).map((id) => ({ ...FOLDER, id }));
    if (command === 'calibre_stat' || command === 'calibre_read') {
      const folder = folders[args.id];
      if (!folder) throw 'This Calibre library is no longer connected.';
      const bytes = folder[args.path];
      if (command === 'calibre_stat')
        return bytes ? { size: bytes.length, modified: 1000 } : null;
      reads.push(`${args.id}:${args.path}:${args.offset}+${args.length}`);
      return bytes.slice(args.offset, args.offset + args.length).buffer;
    }
    if (command === 'library_execute') {
      const { action, args: a } = args;
      if (action === 'get') return records.get(`${a.store}:${a.key}`) ?? null;
      if (action === 'books_link') {
        records.set(`books:${a.book.id}`, a.book);
        return a.book;
      }
    }
    throw new Error(`unexpected ${command}`);
  });
  return { reads, records };
}
let SQL: SqlJsStatic;
beforeAll(async () => {
  SQL = await initSqlJs({
    wasmBinary: new Uint8Array(
      readFileSync(resolve('node_modules/sql.js/dist/sql-wasm.wasm')),
    ).buffer,
  });
});
beforeEach(() => {
  vi.stubGlobal('__SKRIVIST_DESKTOP__', true);
  ipc.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

it('reads a Calibre file through the host in bounded chunks', async () => {
  const bytes = new Uint8Array(2 * MB + 5).map((_, i) => i % 251);
  const { reads } = host({ f1: { [BOOK]: bytes } });
  const file = await calibreFile('f1', BOOK, 128 * MB, 'too large');
  expect(file.name).toBe('Title - Writer.epub');
  expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
  expect(reads).toEqual([
    `f1:${BOOK}:0+${MB}`,
    `f1:${BOOK}:${MB}+${MB}`,
    `f1:${BOOK}:${2 * MB}+5`,
  ]);
});

it('reports a missing file like a browser folder does, and refuses an oversize one unread', async () => {
  const { reads } = host({ f1: { [BOOK]: new Uint8Array(10) } });
  await expect(
    calibreFile('f1', 'Writer/Gone (8)/Gone.epub', MB, 'too large'),
  ).rejects.toMatchObject({ name: 'NotFoundError' });
  await expect(calibreFile('f1', BOOK, 9, 'too large')).rejects.toThrow(
    'too large',
  );
  expect(reads).toEqual([]);
});

it('refuses a file that changed while it was read', async () => {
  let stats = 0;
  ipc.mockImplementation(async (command) =>
    command === 'calibre_stat'
      ? { size: 4, modified: ++stats }
      : new Uint8Array(4).buffer,
  );
  await expect(calibreFile('f1', BOOK, MB, 'too large')).rejects.toThrow(
    'changed while it was being read',
  );
});

it('snapshots metadata.db from a host folder and refuses a pending journal', async () => {
  const database = new TextEncoder().encode('SQLite format 3\0…');
  host({ f1: { 'metadata.db': database } });
  const source = sourceFromHost(FOLDER);
  expect(source.folder).toBe('f1');
  expect(new Uint8Array(await readCalibreSnapshot(source))).toEqual(database);

  host({
    f1: { 'metadata.db': database, 'metadata.db-journal': new Uint8Array(8) },
  });
  await expect(readCalibreSnapshot(sourceFromHost(FOLDER))).rejects.toThrow(
    'Close Calibre',
  );
});

it("exposes Calibre's library ID so linked books survive a moved folder", () => {
  const db = new SQL.Database();
  db.run(`CREATE TABLE books (id INTEGER PRIMARY KEY,title TEXT,path TEXT,series_index REAL);
    CREATE TABLE authors (id INTEGER PRIMARY KEY,name TEXT);
    CREATE TABLE books_authors_link (id INTEGER PRIMARY KEY,book INTEGER,author INTEGER);
    CREATE TABLE data (book INTEGER,format TEXT,name TEXT);
    CREATE TABLE series (id INTEGER PRIMARY KEY,name TEXT);
    CREATE TABLE books_series_link (book INTEGER,series INTEGER);
    CREATE TABLE tags (id INTEGER PRIMARY KEY,name TEXT);
    CREATE TABLE books_tags_link (book INTEGER,tag INTEGER);`);
  const plain = db.export();
  db.run(`CREATE TABLE library_id (id INTEGER PRIMARY KEY, uuid TEXT NOT NULL);
    INSERT INTO library_id VALUES (1,'8a1e4c2e-6f0b-4d53-9a40-2f6d1c0a7b11');`);
  expect(new CalibreDatabase(SQL, db.export()).page().library).toBe(
    '8a1e4c2e-6f0b-4d53-9a40-2f6d1c0a7b11',
  );
  // An old database has none; the caller then keys the book to the folder.
  expect(new CalibreDatabase(SQL, plain).page().library).toBeUndefined();
  db.close();
});

const link = {
  library: 'lib-uuid',
  book: 7,
  format: 'epub' as const,
  path: BOOK,
  folder: 'f1',
};
const linked: Book = {
  id: calibreBookId(link),
  title: 'Title',
  author: 'Writer',
  format: 'epub',
  added: 1,
  size: 6,
  status: 'unread',
  progress: 0,
  position: { chapter: 0, fraction: 0, page: 1 },
  calibre: link,
};

it('keys a linked book to the Calibre book, not to its file', () => {
  expect(linked.id).toBe('calibre:lib-uuid:7:epub');
});

it('opens a linked book from its Calibre folder without a stored file', async () => {
  const bytes = new TextEncoder().encode('in place');
  const { records } = host({ f1: { [BOOK]: bytes } });
  await linkBook(linked);
  expect(records.has(`files:${linked.id}`)).toBe(false);
  const file = await getFile(linked.id);
  expect(new Uint8Array(await file!.arrayBuffer())).toEqual(bytes);
});

it('finds a linked book in another connected folder after the library moved', async () => {
  const bytes = new TextEncoder().encode('moved');
  host({ f2: { [BOOK]: bytes } });
  await linkBook(linked);
  const file = await getFile(linked.id);
  expect(new Uint8Array(await file!.arrayBuffer())).toEqual(bytes);
});

it('says what to do when the Calibre library is unreachable or the book was removed', async () => {
  host({});
  await linkBook(linked);
  await expect(getFile(linked.id)).rejects.toThrow('not connected or not reachable');
  host({ f1: {} });
  await linkBook(linked);
  await expect(getFile(linked.id)).rejects.toThrow('no longer where Calibre kept it');
});

it('still reports a book with neither a stored file nor a link as absent', async () => {
  host({});
  expect(await getFile('some-hash')).toBeUndefined();
});

it('refuses to link outside the desktop app', async () => {
  vi.stubGlobal('__SKRIVIST_DESKTOP__', false);
  await expect(linkBook(linked)).rejects.toThrow('desktop app');
});

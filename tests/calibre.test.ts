import { beforeAll, it, expect, vi } from 'vitest';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CalibreDatabase, MAX_CALIBRE_DB } from '../src/lib/calibre-db';
import {
  readCalibreSnapshot,
  calibreBookPath,
  calibrePath,
  sourceFromDirectory,
  sourceFromFiles,
} from '../src/lib/calibre-source';
import { importBook } from '../src/lib/import';
import { epubFile } from './fixtures';
import { updateBook, getBook } from '../src/lib/store';
let SQL: SqlJsStatic;
beforeAll(async () => {
  SQL = await initSqlJs({
    wasmBinary: new Uint8Array(
      readFileSync(resolve('node_modules/sql.js/dist/sql-wasm.wasm')),
    ).buffer,
  });
});
function fixture() {
  const db = new SQL.Database();
  db.run(`CREATE TABLE books (id INTEGER PRIMARY KEY,title TEXT,path TEXT,series_index REAL);
    CREATE TABLE authors (id INTEGER PRIMARY KEY,name TEXT);
    CREATE TABLE books_authors_link (id INTEGER PRIMARY KEY,book INTEGER,author INTEGER);
    CREATE TABLE data (book INTEGER,format TEXT,name TEXT);
    CREATE TABLE series (id INTEGER PRIMARY KEY,name TEXT);
    CREATE TABLE books_series_link (book INTEGER,series INTEGER);
    CREATE TABLE tags (id INTEGER PRIMARY KEY,name TEXT);
    CREATE TABLE books_tags_link (book INTEGER,tag INTEGER);
    INSERT INTO authors VALUES (1,'Writer| Example');
    INSERT INTO series VALUES (1,'Small adventures');
    INSERT INTO tags VALUES (1,'日本語');`);
  for (let id = 1; id <= 51; id++) {
    db.run('INSERT INTO books VALUES (?,?,?,?)', [
      id,
      `Book ${String(id).padStart(2, '0')}`,
      `Writer/Book (${id})`,
      id,
    ]);
    db.run('INSERT INTO books_authors_link VALUES (?,?,?)', [id, id, 1]);
    db.run('INSERT INTO data VALUES (?,?,?)', [
      id,
      id % 2 ? 'EPUB' : 'PDF',
      `Book ${id}`,
    ]);
    db.run('INSERT INTO books_series_link VALUES (?,1)', [id]);
  }
  db.run(
    "INSERT INTO books VALUES (52,'100%_literal','Writer/Literal (52)',1); INSERT INTO data VALUES (52,'MOBI','Literal'); INSERT INTO books_tags_link VALUES (52,1)",
  );
  const bytes = db.export();
  db.close();
  return bytes;
}
it('queries 24-book pages, clamps page numbers and preserves the database bytes', () => {
  const bytes = fixture(),
    original = bytes.slice(),
    db = new CalibreDatabase(SQL, bytes);
  const first = db.page(),
    second = db.page('', '', 1),
    last = db.page('', '', 99);
  expect(first.entries).toHaveLength(24);
  expect(first.total).toBe(52);
  expect(second.entries).toHaveLength(24);
  expect(last.page).toBe(2);
  expect(last.entries).toHaveLength(4);
  expect(
    new Set(
      [...first.entries, ...second.entries, ...last.entries].map((b) => b.id),
    ).size,
  ).toBe(52);
  expect(db.page('', '', -3).page).toBe(0);
  expect(bytes).toEqual(original);
  db.close();
});
it('searches authors, series, tags, literal wildcard characters and filters formats', () => {
  const db = new CalibreDatabase(SQL, fixture());
  expect(db.page('Writer').total).toBe(51);
  expect(db.page('adventures').total).toBe(51);
  expect(db.page('日本語').entries[0].title).toBe('100%_literal');
  expect(db.page('%_').total).toBe(1);
  expect(db.page("' OR 1=1 --").total).toBe(0);
  expect(db.page('', 'epub').total).toBe(26);
  expect(db.page('', 'pdf').total).toBe(25);
  const entry = db.page('Book 01').entries[0];
  expect(entry.author).toBe('Writer, Example');
  expect(entry.series).toBe('Small adventures · 1');
  expect(entry.formats).toEqual([{ format: 'epub', name: 'Book 1' }]);
  db.close();
});
it('rejects invalid, oversize, unrelated and view-substituted databases', () => {
  expect(() => new CalibreDatabase(SQL, new Uint8Array(16))).toThrow('SQLite');
  expect(
    () => new CalibreDatabase(SQL, new Uint8Array(MAX_CALIBRE_DB + 1)),
  ).toThrow('64 MB');
  const unrelated = new SQL.Database();
  unrelated.run('CREATE TABLE unrelated (id INTEGER)');
  expect(() => new CalibreDatabase(SQL, unrelated.export())).toThrow('schema');
  unrelated.close();
  const malicious = new SQL.Database(fixture());
  malicious.run(
    'ALTER TABLE books RENAME TO original_books; CREATE VIEW books AS SELECT * FROM original_books',
  );
  expect(() => new CalibreDatabase(SQL, malicious.export())).toThrow('schema');
  malicious.close();
});
it('rejects traversal, absolute paths, alternate separators and unsupported formats', () => {
  for (const path of [
    '../private',
    '/absolute',
    'Writer/../Book',
    'Writer\\Book',
    'C:/books',
    'Writer//Book',
    'Writer/\0Book',
  ])
    expect(() => calibrePath(path)).toThrow('unsafe');
  expect(() => calibreBookPath('Writer/Book', '../other', 'epub')).toThrow();
  expect(() => calibreBookPath('Writer/Book', 'Book', 'mobi')).toThrow('EPUB');
  expect(
    calibreBookPath('Writer/日本語 (1)', "Reader's Book + notes", 'pdf'),
  ).toBe("Writer/日本語 (1)/Reader's Book + notes.pdf");
});
it('reads only explicitly requested handles and never enumerates a directory', async () => {
  const file = new File(['synthetic'], 'Book.epub');
  const getFile = vi.fn(async () => file),
    getFileHandle = vi.fn(async () => ({ getFile }));
  const child = { name: 'Writer', getDirectoryHandle: vi.fn(), getFileHandle };
  const root = {
    name: 'Synthetic Library',
    getDirectoryHandle: vi.fn(async () => child),
    getFileHandle: vi.fn(),
  };
  const source = sourceFromDirectory(root);
  expect(root.getDirectoryHandle).not.toHaveBeenCalled();
  expect(await source.file('Writer/Book.epub')).toBe(file);
  expect(root.getDirectoryHandle).toHaveBeenCalledWith('Writer');
  expect(getFileHandle).toHaveBeenCalledWith('Book.epub');
  await expect(source.file('../outside')).rejects.toThrow('unsafe');
  expect(getFile).toHaveBeenCalledTimes(1);
});
it('requires metadata.db at the selected folder root and reports missing book files', async () => {
  const db = new File(['synthetic'], 'metadata.db'),
    book = new File(['book'], 'Book.epub');
  Object.defineProperty(db, 'webkitRelativePath', {
    value: 'Library/metadata.db',
  });
  Object.defineProperty(book, 'webkitRelativePath', {
    value: 'Library/Writer/Book.epub',
  });
  const source = sourceFromFiles([db, book]);
  expect(source.name).toBe('Library');
  expect(await source.file('Writer/Book.epub')).toBe(book);
  await expect(source.file('Writer/Missing.epub')).rejects.toMatchObject({
    name: 'NotFoundError',
  });
  expect(() => sourceFromFiles([book])).toThrow('root folder');
});
it('uses Calibre metadata when opening a book without resetting existing progress', async () => {
  const file = epubFile({}, 'Calibre import test original text');
  const imported = await importBook(file, undefined, undefined, {
    title: 'Calibre edited title',
    author: 'Calibre author',
  });
  expect(imported.title).toBe('Calibre edited title');
  expect(imported.author).toBe('Calibre author');
  await updateBook(imported.id, { progress: 0.5, status: 'reading' });
  await importBook(file, undefined, undefined, {
    title: 'Other title',
    author: 'Other author',
  });
  expect((await getBook(imported.id))?.progress).toBe(0.5);
});

it('refuses pending WAL/journal snapshots before reading database bytes', async () => {
  for (const suffix of ['-wal', '-journal']) {
    const db = new File(['database'], 'metadata.db');
    const read = vi.spyOn(db, 'arrayBuffer');
    const source = {
      name: 'Synthetic',
      snapshot: true,
      file: async (path: string) => {
        if (path === 'metadata.db') return db;
        if (path === 'metadata.db' + suffix) return new File(['pending'], path);
        throw new DOMException('Missing', 'NotFoundError');
      },
    };
    await expect(readCalibreSnapshot(source)).rejects.toThrow('Close Calibre');
    expect(read).not.toHaveBeenCalled();
  }
});
it('reads a clean snapshot and surfaces permission failures', async () => {
  const db = new File(['database'], 'metadata.db');
  const source = {
    name: 'Synthetic',
    snapshot: false,
    file: async (path: string) => {
      if (path === 'metadata.db') return db;
      throw new DOMException('Missing', 'NotFoundError');
    },
  };
  expect(new TextDecoder().decode(await readCalibreSnapshot(source))).toBe(
    'database',
  );
  await expect(
    readCalibreSnapshot({
      ...source,
      file: async () => {
        throw new DOMException('Permission denied', 'NotAllowedError');
      },
    }),
  ).rejects.toThrow('Permission denied');
});

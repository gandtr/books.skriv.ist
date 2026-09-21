import type { Database, SqlJsStatic, SqlValue } from 'sql.js';
export const CALIBRE_PAGE_SIZE = 24;
export const MAX_CALIBRE_DB = 64 * 1024 * 1024;
export interface CalibreEntry {
  id: number;
  title: string;
  author: string;
  path: string;
  series: string;
  tags: string;
  formats: { format: string; name: string }[];
}
export interface CalibrePage {
  entries: CalibreEntry[];
  total: number;
  page: number;
}
export class CalibreDatabase {
  private db: Database;
  constructor(SQL: SqlJsStatic, bytes: Uint8Array) {
    if (bytes.length > MAX_CALIBRE_DB)
      throw new Error('Choose a metadata.db smaller than 64 MB.');
    if (new TextDecoder().decode(bytes.slice(0, 16)) !== 'SQLite format 3\0')
      throw new Error(
        'This is not a SQLite database. Choose the Calibre library folder containing metadata.db.',
      );
    this.db = new SQL.Database(bytes);
    try {
      this.db.run('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON');
      const required: Record<string, string[]> = {
        books: ['id', 'title', 'path', 'series_index'],
        authors: ['id', 'name'],
        books_authors_link: ['id', 'book', 'author'],
        data: ['book', 'format', 'name'],
        series: ['id', 'name'],
        books_series_link: ['book', 'series'],
        tags: ['id', 'name'],
        books_tags_link: ['book', 'tag'],
      };
      for (const [table, columns] of Object.entries(required)) {
        if (
          !this.rows(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            [table],
          ).length
        )
          throw new Error(
            'This database does not have a supported Calibre library schema.',
          );
        const found = this.rows(`PRAGMA table_info(${table})`).map(
          (r) => r.name,
        );
        if (columns.some((c) => !found.includes(c)))
          throw new Error('This Calibre database has an unsupported schema.');
      }
    } catch (e) {
      this.db.close();
      throw e;
    }
  }
  private rows(sql: string, params: SqlValue[] = []) {
    const statement = this.db.prepare(sql);
    try {
      statement.bind(params);
      const rows: Record<string, SqlValue>[] = [];
      while (statement.step()) rows.push(statement.getAsObject());
      return rows;
    } finally {
      statement.free();
    }
  }
  page(query = '', format = '', requestedPage = 0): CalibrePage {
    const pattern =
      '%' +
      query
        .trim()
        .slice(0, 300)
        .replace(/[\\%_]/g, '\\$&') +
      '%';
    const where = `WHERE (b.title LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM books_authors_link l JOIN authors a ON a.id=l.author WHERE l.book=b.id AND a.name LIKE ? ESCAPE '\\')
      OR EXISTS (SELECT 1 FROM books_series_link l JOIN series s ON s.id=l.series WHERE l.book=b.id AND s.name LIKE ? ESCAPE '\\')
      OR EXISTS (SELECT 1 FROM books_tags_link l JOIN tags t ON t.id=l.tag WHERE l.book=b.id AND t.name LIKE ? ESCAPE '\\'))
      ${format === 'epub' || format === 'pdf' ? 'AND EXISTS (SELECT 1 FROM data d WHERE d.book=b.id AND upper(d.format)=?)' : ''}`;
    const params: SqlValue[] = [pattern, pattern, pattern, pattern];
    if (format === 'epub' || format === 'pdf')
      params.push(format.toUpperCase());
    const total = Number(
      this.rows('SELECT count(*) AS n FROM books b ' + where, params)[0].n,
    );
    const page = Math.max(
      0,
      Math.min(
        Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 0,
        Math.ceil(total / CALIBRE_PAGE_SIZE) - 1,
      ),
    );
    const books = this.rows(
      `SELECT b.id,b.title,b.path,b.series_index FROM books b ${where} ORDER BY b.title COLLATE NOCASE,b.id LIMIT ? OFFSET ?`,
      [...params, CALIBRE_PAGE_SIZE, page * CALIBRE_PAGE_SIZE],
    );
    const entries = books.map((b) => {
      const id = Number(b.id);
      const authors = this.rows(
        'SELECT a.name FROM books_authors_link l JOIN authors a ON a.id=l.author WHERE l.book=? ORDER BY l.id',
        [id],
      );
      const series = this.rows(
        'SELECT s.name FROM books_series_link l JOIN series s ON s.id=l.series WHERE l.book=?',
        [id],
      );
      const tags = this.rows(
        'SELECT t.name FROM books_tags_link l JOIN tags t ON t.id=l.tag WHERE l.book=? ORDER BY t.name',
        [id],
      );
      const formats = this.rows(
        'SELECT format,name FROM data WHERE book=? ORDER BY format',
        [id],
      );
      return {
        id,
        title: String(b.title),
        path: String(b.path),
        author: authors
          .map((a) => String(a.name).replace(/\|/g, ','))
          .join(', '),
        series: series.map((s) => `${s.name} · ${b.series_index}`).join(', '),
        tags: tags.map((t) => t.name).join(', '),
        formats: formats.map((f) => ({
          format: String(f.format).toLowerCase(),
          name: String(f.name),
        })),
      };
    });
    return { entries, total, page };
  }
  close() {
    this.db.close();
  }
}

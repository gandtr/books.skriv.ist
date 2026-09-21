import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { CalibreDatabase } from './calibre-db';
let database: CalibreDatabase | undefined;
let chain = Promise.resolve();
self.onmessage = (event: MessageEvent) => {
  const { id, type, bytes, query, format, page } = event.data;
  chain = chain.then(async () => {
    try {
      if (type === 'open') {
        database?.close();
        database = undefined;
        const SQL = await initSqlJs({ locateFile: () => wasmUrl });
        database = new CalibreDatabase(SQL, new Uint8Array(bytes));
      }
      if (!database) throw new Error('Choose a Calibre library first.');
      self.postMessage({ id, result: database.page(query, format, page) });
    } catch (e) {
      self.postMessage({ id, error: (e as Error).message });
    }
  });
};

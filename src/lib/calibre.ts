import { readCalibreSnapshot, type CalibreSource } from './calibre-source';
import { type CalibrePage } from './calibre-db';
class CalibreClient {
  private worker = new Worker(new URL('./calibre.worker.ts', import.meta.url), {
    type: 'module',
  });
  private nextId = 0;
  private closed = '';
  private pending = new Map<
    number,
    {
      resolve: (value: CalibrePage) => void;
      reject: (reason: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor() {
    this.worker.onmessage = ({ data }) => {
      const job = this.pending.get(data.id);
      if (!job) return;
      clearTimeout(job.timer);
      this.pending.delete(data.id);
      data.error ? job.reject(new Error(data.error)) : job.resolve(data.result);
    };
    this.worker.onerror = () =>
      this.close(
        'The Calibre reader could not start. Reload the app and try again.',
      );
  }
  request(
    message: Record<string, unknown>,
    transfer: Transferable[] = [],
  ): Promise<CalibrePage> {
    if (this.closed) return Promise.reject(new Error(this.closed));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          this.close(
            'This library took too long to read. Reconnect or use a smaller library.',
          ),
        30000,
      );
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ ...message, id }, transfer);
    });
  }
  close(reason = 'Calibre library disconnected.') {
    this.closed = reason;
    this.worker.terminate();
    for (const job of this.pending.values()) {
      clearTimeout(job.timer);
      job.reject(new Error(reason));
    }
    this.pending.clear();
  }
}
// Session-only access survives opening a book; a page reload releases it.
export const calibreSession: {
  source?: CalibreSource;
  client?: CalibreClient;
  result?: CalibrePage;
  query: string;
  format: string;
} = { query: '', format: '' };
let generation = 0;
export async function connectCalibre(source: CalibreSource) {
  const current = ++generation;
  const bytes = await readCalibreSnapshot(source);
  if (current !== generation) throw new Error('Library selection changed.');
  const client = new CalibreClient();
  try {
    const result = await client.request({ type: 'open', bytes }, [bytes]);
    if (current !== generation) throw new Error('Library selection changed.');
    calibreSession.client?.close();
    Object.assign(calibreSession, {
      source,
      client,
      result,
      query: '',
      format: '',
    });
    return result;
  } catch (e) {
    client.close();
    throw e;
  }
}
export async function calibrePage(query: string, format: string, page: number) {
  if (!calibreSession.client)
    throw new Error('Choose a Calibre library first.');
  const client = calibreSession.client;
  const result = await client.request({
    type: 'page',
    query,
    format,
    page,
  });
  if (client !== calibreSession.client)
    throw new Error('Library selection changed.');
  Object.assign(calibreSession, { query, format, result });
  return result;
}
export function disconnectCalibre() {
  generation++;
  calibreSession.client?.close();
  Object.assign(calibreSession, {
    source: undefined,
    client: undefined,
    result: undefined,
    query: '',
    format: '',
  });
}

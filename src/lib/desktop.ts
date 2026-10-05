import { invoke } from '@tauri-apps/api/core';
declare const __SKRIVIST_DESKTOP__: boolean;
const CHUNK = 1024 * 1024;
export function isDesktop(): boolean {
  return typeof __SKRIVIST_DESKTOP__ !== 'undefined' && __SKRIVIST_DESKTOP__;
}
interface StoredBlob { __skrivistBlob: string; size: number; mime: string }
async function encode(value: unknown): Promise<unknown> {
  if (value instanceof Blob) {
    const id = await invoke<string>('blob_begin', { size: value.size, mime: value.type });
    try {
      for (let offset = 0; offset < value.size; offset += CHUNK) {
        const bytes = new Uint8Array(await value.slice(offset, offset + CHUNK).arrayBuffer());
        await invoke('blob_append', bytes, { headers: { 'x-blob-id': id, 'x-blob-offset': String(offset) } });
      }
      return await invoke<StoredBlob>('blob_finish', { id });
    } catch (error) {
      await invoke('blob_abort', { id }).catch(() => {});
      throw error;
    }
  }
  if (Array.isArray(value)) return Promise.all(value.map(encode));
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (child !== undefined) result[key] = await encode(child);
    }
    return result;
  }
  return value;
}
async function decode(value: unknown): Promise<unknown> {
  if (Array.isArray(value)) return Promise.all(value.map(decode));
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.__skrivistBlob === 'string') {
      const ref = record as unknown as StoredBlob;
      if (!Number.isSafeInteger(ref.size) || ref.size < 0 || ref.size > 512 * 1024 * 1024 || typeof ref.mime !== 'string') throw new Error('Invalid library file metadata.');
      const parts: Uint8Array<ArrayBuffer>[] = [];
      for (let offset = 0; offset < ref.size; offset += CHUNK) {
        const length = Math.min(CHUNK, ref.size - offset);
        const raw = await invoke<ArrayBuffer | number[]>('blob_read', { id: ref.__skrivistBlob, offset, length });
        const bytes = new Uint8Array(raw);
        if (bytes.byteLength !== length) throw new Error('The saved library file is incomplete.');
        parts.push(bytes);
      }
      return new Blob(parts, { type: ref.mime });
    }
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(record)) result[key] = await decode(child);
    return result;
  }
  return value;
}
export async function native<T>(action: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!isDesktop()) throw new Error('Native library access is available only in the desktop app.');
  return await decode(await invoke('library_execute', { action, args: await encode(args) })) as T;
}
export async function nativeGet<T>(store: string, key: unknown): Promise<T | undefined> {
  return (await native<T | null>('get', { store, key })) ?? undefined;
}
export async function openExternal(url: string): Promise<void> {
  await invoke('open_external', { url });
}

interface OpenedFile { id: string; name: string; size: number; mime: string }
/** OS activation uses the reader's existing import queue, after bounded native reads. */
export async function watchNativeFiles(
  onFiles: (files: File[]) => void | Promise<void>,
  onRoute: (fragment: string) => void,
  onError: (message: string) => void,
): Promise<() => void> {
  if (!isDesktop()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  let stopped = false;
  let tail = Promise.resolve();
  const drain = () => {
    tail = tail.then(async () => {
      if (stopped) return;
      const pending = await invoke<{ files: OpenedFile[]; routes: string[]; errors: string[] }>('intake_pending');
      for (const error of pending.errors) onError(error);
      for (const route of pending.routes) {
        const uri = new URL(route);
        onRoute(uri.hash || (uri.search ? '#' + uri.search.slice(1) : ''));
      }
      for (const file of pending.files) {
        try {
          const parts: Uint8Array<ArrayBuffer>[] = [];
          if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > 512 * 1024 * 1024) throw new Error('The selected file is too large.');
          for (let offset = 0; offset < file.size; offset += CHUNK) {
            const length = Math.min(CHUNK, file.size - offset);
            const bytes = new Uint8Array(await invoke<ArrayBuffer | number[]>('intake_read', { id: file.id, offset, length }));
            if (bytes.byteLength !== length) throw new Error('The selected file changed during import.');
            parts.push(bytes);
          }
          if (!stopped) await onFiles([new File(parts, file.name, { type: file.mime })]);
        } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
        finally { await invoke('intake_done', { id: file.id }).catch(() => {}); }
      }
    }).catch(error => onError(error instanceof Error ? error.message : String(error)));
  };
  const stop = await listen('native-open', drain);
  drain();
  return () => { stopped = true; stop(); };
}

// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { native, nativeGet } from '../src/lib/desktop';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const ipc = vi.mocked(invoke);
const chunk = 1024 * 1024;
beforeEach(() => { vi.stubGlobal('__SKRIVIST_DESKTOP__', true); ipc.mockReset(); });
afterEach(() => vi.unstubAllGlobals());
it('streams binary files with bounded ordered chunks before committing metadata', async () => {
 const data = new Blob([new Uint8Array(chunk + 7)], { type: 'application/pdf' });
 ipc.mockImplementation(async (command: string, args: any, options: any) => {
  if (command === 'blob_begin') { expect(args.size).toBe(chunk + 7); return 'file-id'; }
  if (command === 'blob_append') { expect(args).toBeInstanceOf(Uint8Array); expect(args.length).toBeLessThanOrEqual(chunk); expect(options.headers['x-blob-id']).toBe('file-id'); return null; }
  if (command === 'blob_finish') return { __skrivistBlob: 'file-id', size: data.size, mime: data.type };
  expect(args.args.file.__skrivistBlob).toBe('file-id'); return 'book';
 });
 expect(await native('books_add', { file: data })).toBe('book');
 const writes = ipc.mock.calls.filter(call => call[0] === 'blob_append');
 expect(writes.map(call => (call[2] as any).headers['x-blob-offset'])).toEqual(['0', String(chunk)]);
 expect(ipc.mock.calls.at(-1)?.[0]).toBe('library_execute');
});
it('aborts an interrupted file without committing its metadata', async () => {
 ipc.mockImplementation(async (command: string) => { if (command === 'blob_begin') return 'file-id'; if (command === 'blob_abort') return null; throw new Error('Disk full'); });
 await expect(native('books_add', { file: new Blob(['abc']) })).rejects.toThrow('Disk full');
 expect(ipc).toHaveBeenCalledWith('blob_abort', { id: 'file-id' });
 expect(ipc.mock.calls.some(call => call[0] === 'library_execute')).toBe(false);
});
it('reconstructs saved binary files and maps missing records to undefined', async () => {
 ipc.mockResolvedValueOnce({ __skrivistBlob: 'file-id', size: 3, mime: 'text/plain' }).mockResolvedValueOnce(new Uint8Array([97,98,99]).buffer);
 const blob = await nativeGet<Blob>('files', 'book');
 expect(await blob?.text()).toBe('abc');
 ipc.mockResolvedValueOnce(null); expect(await nativeGet('books', 'missing')).toBeUndefined();
});
it('rejects short reads and invalid blob sizes', async () => {
 ipc.mockResolvedValueOnce({ __skrivistBlob: 'file-id', size: 3, mime: '' }).mockResolvedValueOnce([1]);
 await expect(nativeGet('files', 'book')).rejects.toThrow('incomplete');
 ipc.mockResolvedValueOnce({ __skrivistBlob: 'file-id', size: -1, mime: '' });
 await expect(nativeGet('files', 'book')).rejects.toThrow('metadata');
});
it('propagates native storage failure and forbids web calls into native storage', async () => {
 ipc.mockRejectedValueOnce(new Error('Library unavailable'));
 await expect(native('list', { store: 'books' })).rejects.toThrow('Library unavailable');
 vi.stubGlobal('__SKRIVIST_DESKTOP__', false); ipc.mockClear();
 await expect(native('list', { store: 'books' })).rejects.toThrow('desktop app');
 expect(ipc).not.toHaveBeenCalled();
});

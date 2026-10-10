// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  listBooks,
  saveShelf,
  shelves,
  type Book,
  type Shelf,
} from '../src/lib/store';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const ipc = vi.mocked(invoke);
interface Call {
  action: string;
  args: Record<string, any>;
}
const calls = () => ipc.mock.calls.map((call) => call[1] as unknown as Call);
const LEGACY = 'https://a.example/opds/t/tok_en/v1.2/catalog';
const PLAIN = 'https://a.example/opds/v1.2/catalog';
beforeEach(() => {
  vi.stubGlobal('__SKRIVIST_DESKTOP__', true);
  ipc.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

it('saves a paired shelf token in its own field', async () => {
  ipc.mockResolvedValue(null);
  await saveShelf({
    url: PLAIN,
    title: 'Paired',
    username: '',
    connectionUrl: PLAIN,
    token: 'tok_en',
  });
  expect(calls()).toEqual([
    {
      action: 'put',
      args: {
        store: 'shelves',
        value: {
          url: PLAIN,
          title: 'Paired',
          username: '',
          connectionUrl: PLAIN,
          token: 'tok_en',
        },
      },
    },
  ]);
});
it('moves a legacy token out of shelf URLs: the plain shelf is written before the old one is deleted', async () => {
  const legacy: Shelf = {
    url: LEGACY,
    title: 'Old',
    username: '',
    connectionUrl: LEGACY,
  };
  ipc.mockImplementation(async (_command, args: any) =>
    args.action === 'list' ? [legacy] : null,
  );
  const expected = {
    url: PLAIN,
    title: 'Old',
    username: '',
    connectionUrl: PLAIN,
    token: 'tok_en',
  };
  expect(await shelves()).toEqual([expected]);
  const writes = calls().filter((call) => call.action !== 'list');
  expect(writes).toEqual([
    { action: 'put', args: { store: 'shelves', value: expected } },
    { action: 'delete', args: { store: 'shelves', key: LEGACY } },
  ]);
  expect(legacy).toEqual({
    url: LEGACY,
    title: 'Old',
    username: '',
    connectionUrl: LEGACY,
  });
});
it('merges a legacy shelf into the plain shelf it becomes, keeping the token', async () => {
  const stored: Shelf[] = [
    { url: LEGACY, title: 'Old', username: '', connectionUrl: LEGACY },
    { url: PLAIN, title: 'New', username: '', connectionUrl: PLAIN },
  ];
  ipc.mockImplementation(async (_command, args: any) =>
    args.action === 'list' ? stored : null,
  );
  const result = await shelves();
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ url: PLAIN, token: 'tok_en' });
  expect(calls().filter((call) => call.action === 'delete')).toEqual([
    { action: 'delete', args: { store: 'shelves', key: LEGACY } },
  ]);
});
it('leaves plain shelves alone', async () => {
  const plain: Shelf = {
    url: PLAIN,
    title: 'Lib',
    username: '',
    connectionUrl: PLAIN,
    token: 'tok_en',
  };
  ipc.mockImplementation(async (_command, args: any) =>
    args.action === 'list' ? [plain] : null,
  );
  expect(await shelves()).toEqual([plain]);
  expect(calls().map((call) => call.action)).toEqual(['list']);
});
it('rewrites a legacy book remote through books_update and lists the plain remote', async () => {
  const remote = {
    href: 'https://a.example/opds/t/tok_en/v1.2/items/1/file',
    feedUrl: LEGACY,
    connectionUrl: LEGACY,
    username: '',
  };
  const book = {
    id: 'b1',
    title: 'B',
    status: 'reading',
    progress: 0.4,
    remote,
  } as unknown as Book;
  ipc.mockImplementation(async (_command, args: any) => {
    if (args.action === 'list') return [book];
    if (args.action === 'get') return book;
    return null;
  });
  const plain = {
    href: 'https://a.example/opds/v1.2/items/1/file',
    feedUrl: PLAIN,
    connectionUrl: PLAIN,
    username: '',
  };
  const [listed] = await listBooks();
  expect(listed.remote).toEqual(plain);
  expect(listed).toMatchObject({ status: 'reading', progress: 0.4 });
  expect(calls().find((call) => call.action === 'books_update')).toEqual({
    action: 'books_update',
    args: { id: 'b1', changes: { remote: plain } },
  });
});

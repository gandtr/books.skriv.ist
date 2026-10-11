// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { getBook, listBooks, type Book } from '../src/lib/store';
import {
  forgetShelf,
  saveShelf,
  shelves,
  type Shelf,
} from '../src/lib/shelves';
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
    // A saved token is the connection's: its other shelves are read to share it.
    { action: 'list', args: { store: 'shelves' } },
  ]);
});
/** Native shelves in memory, answering list, get, put and delete. */
function nativeShelves(initial: Shelf[]) {
  const rows = new Map(initial.map((s) => [s.url, s]));
  ipc.mockImplementation(async (_command, call: any) => {
    const { action, args } = call;
    if (action === 'list') return [...rows.values()];
    if (action === 'get') return rows.get(args.key) ?? null;
    if (action === 'put') rows.set(args.value.url, args.value);
    if (action === 'delete') rows.delete(args.key);
    return null;
  });
  return rows;
}
const SUB = 'https://a.example/opds/v1.2/series/3';
const OTHER = 'https://b.example/opds/v1.2/catalog';
const row = (url: string, connectionUrl: string, token?: string): Shelf => ({
  url,
  title: url,
  username: '',
  connectionUrl,
  ...(token ? { token } : {}),
});
it('re-pairing gives every shelf of the catalogue the new token in native storage', async () => {
  const rows = nativeShelves([
    row(PLAIN, PLAIN, 'A'),
    row(SUB, PLAIN, 'A'),
    row(OTHER, OTHER, 'X'),
  ]);
  await saveShelf(row(PLAIN, PLAIN, 'B'));
  expect([...rows.values()].map((s) => [s.url, s.token])).toEqual([
    [PLAIN, 'B'],
    [SUB, 'B'],
    [OTHER, 'X'],
  ]);
});
it('forgetting a catalogue deletes its shelves and their legacy rows from native storage', async () => {
  const rows = nativeShelves([
    row(LEGACY, LEGACY),
    row(PLAIN, PLAIN, 'A'),
    row(SUB, PLAIN, 'A'),
    row(OTHER, OTHER, 'X'),
  ]);
  await forgetShelf(PLAIN, { connectionUrl: PLAIN, username: '' });
  expect([...rows.keys()]).toEqual([OTHER]);
});
it('moves a legacy token out of shelf URLs: the plain shelf is written before the old one is deleted', async () => {
  const legacy: Shelf = {
    url: LEGACY,
    title: 'Old',
    username: '',
    connectionUrl: LEGACY,
  };
  const expected = {
    url: PLAIN,
    title: 'Old',
    username: '',
    connectionUrl: PLAIN,
    token: 'tok_en',
  };
  ipc.mockImplementation(async (_command, args: any) =>
    args.action === 'list' ? [legacy] : args.action === 'get' ? expected : null,
  );
  expect(await shelves()).toEqual([expected]);
  const writes = calls().filter(
    (call) => call.action !== 'list' && call.action !== 'get',
  );
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
    args.action === 'list'
      ? stored
      : args.action === 'get'
        ? {
            url: PLAIN,
            title: 'Old',
            username: '',
            connectionUrl: PLAIN,
            token: 'tok_en',
          }
        : null,
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
it('keeps the legacy shelf when the native library did not store the token', async () => {
  const legacy: Shelf = {
    url: LEGACY,
    title: 'Old',
    username: '',
    connectionUrl: LEGACY,
  };
  // An older runtime drops fields it does not know, such as token.
  ipc.mockImplementation(async (_command, args: any) => {
    if (args.action === 'list') return [legacy];
    if (args.action === 'get')
      return { url: PLAIN, title: 'Old', username: '', connectionUrl: PLAIN };
    return null;
  });
  const [shelf] = await shelves();
  expect(shelf).toMatchObject({ url: PLAIN, token: 'tok_en' });
  expect(calls().some((call) => call.action === 'delete')).toBe(false);
});
it('returns a plain remote from getBook, as listBooks does', async () => {
  const book = {
    id: 'b1',
    title: 'B',
    remote: {
      href: 'https://a.example/opds/t/tok_en/v1.2/items/1/file',
      feedUrl: LEGACY,
      connectionUrl: LEGACY,
      username: '',
    },
  };
  ipc.mockResolvedValue(book);
  expect((await getBook('b1'))?.remote).toEqual({
    href: 'https://a.example/opds/v1.2/items/1/file',
    feedUrl: PLAIN,
    connectionUrl: PLAIN,
    username: '',
  });
});
it('forgets a shelf together with a legacy row kept for its token', async () => {
  const stored: Shelf[] = [
    { url: LEGACY, title: 'Old', username: '', connectionUrl: LEGACY },
    { url: PLAIN, title: 'Old', username: '', connectionUrl: PLAIN },
    {
      url: 'https://b.example/opds/v1.2/catalog',
      title: 'Other',
      username: '',
      connectionUrl: 'https://b.example/opds/v1.2/catalog',
    },
  ];
  ipc.mockImplementation(async (_command, args: any) =>
    args.action === 'list' ? stored : null,
  );
  await forgetShelf(PLAIN);
  expect(
    calls()
      .filter((call) => call.action === 'delete')
      .map((call) => call.args.key)
      .sort(),
  ).toEqual([LEGACY, PLAIN].sort());
});
it('drops the legacy rows of shelves whose token was stored, and keeps only the others', async () => {
  const OTHER_LEGACY = 'https://b.example/opds/t/tok_b/v1.2/catalog';
  const OTHER_PLAIN = 'https://b.example/opds/v1.2/catalog';
  const stored: Shelf[] = [
    { url: LEGACY, title: 'A', username: '', connectionUrl: LEGACY },
    {
      url: OTHER_LEGACY,
      title: 'B',
      username: '',
      connectionUrl: OTHER_LEGACY,
    },
  ];
  ipc.mockImplementation(async (_command, args: any) => {
    if (args.action === 'list') return stored;
    // a.example's token reads back; b.example's was dropped.
    if (args.action === 'get')
      return args.args.key === PLAIN
        ? {
            url: PLAIN,
            title: 'A',
            username: '',
            connectionUrl: PLAIN,
            token: 'tok_en',
          }
        : {
            url: OTHER_PLAIN,
            title: 'B',
            username: '',
            connectionUrl: OTHER_PLAIN,
          };
    return null;
  });
  await shelves();
  expect(
    calls()
      .filter((call) => call.action === 'delete')
      .map((call) => call.args.key),
  ).toEqual([LEGACY]);
});
it('a pairing shelf saved with a username joins its connection in native storage too', async () => {
  const rows = nativeShelves([
    row(PLAIN, PLAIN, 'A'),
    { ...row(SUB, PLAIN, 'A'), username: 'reader' },
  ]);
  await saveShelf(row(PLAIN, PLAIN, 'B'));
  expect(rows.get(SUB)).toMatchObject({ username: '', token: 'B' });
  await forgetShelf(PLAIN, { connectionUrl: PLAIN, username: '' });
  expect([...rows.keys()]).toEqual([]);
});

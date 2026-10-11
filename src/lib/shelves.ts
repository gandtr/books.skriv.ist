// Saved shelves: catalogue bookmarks, each with the connection it opens with.
import { isDesktop, native, nativeGet } from './desktop';
import { plainRequest } from './opds';
import { db, done } from './store';

export interface Shelf {
  url: string;
  title: string;
  username: string;
  connectionUrl: string;
  /** An Armarium pairing token. Kept on this device in its own field, never in a URL. */
  token?: string;
}
const shelfRecord = (shelf: Shelf): Shelf => ({
  url: shelf.url,
  title: shelf.title,
  username: shelf.username,
  connectionUrl: shelf.connectionUrl,
  ...(shelf.token ? { token: shelf.token } : {}),
});
const sameConnection = (
  a: Pick<Shelf, 'connectionUrl' | 'username'>,
  b: Pick<Shelf, 'connectionUrl' | 'username'>,
) => a.connectionUrl === b.connectionUrl && a.username === b.username;
/**
 * A pairing token belongs to the connection, not to one shelf: saving it gives it
 * to every shelf saved from the same catalogue and login, so pairing again reaches
 * them all and no shelf keeps a revoked token.
 */
export async function saveShelf(shelf: Shelf) {
  const record = shelfRecord(shelf);
  const stale = (stored: Shelf[]) =>
    stored.filter(
      (s) =>
        s.url !== record.url &&
        sameConnection(s, record) &&
        s.token !== record.token,
    );
  if (isDesktop()) {
    await native('put', { store: 'shelves', value: record });
    if (!record.token) return;
    const stored: Shelf[] = (await native('list', { store: 'shelves' })) ?? [];
    for (const s of stale(stored))
      await native('put', {
        store: 'shelves',
        value: shelfRecord({ ...s, token: record.token }),
      });
    return;
  }
  const d = await db(),
    tx = d.transaction('shelves', 'readwrite'),
    finished = done(tx),
    store = tx.objectStore('shelves');
  store.put(record);
  if (record.token) {
    const req = store.getAll();
    req.onsuccess = () => {
      for (const s of stale(req.result))
        store.put(shelfRecord({ ...s, token: record.token }));
    };
  }
  await finished;
}
// A shelf saved before tokens had a field of their own carries its token inside
// its URLs (/opds/t/<token>/…): move it into the field and make the URLs plain.
function plainShelf(shelf: Shelf): Shelf {
  try {
    const plain = plainRequest(shelf.url, {
      url: shelf.connectionUrl,
      username: shelf.username,
      password: '',
      ...(shelf.token ? { token: shelf.token } : {}),
    });
    const { token: _, ...rest } = shelf;
    return {
      ...rest,
      url: plain.target,
      connectionUrl: plain.connection.url,
      ...(plain.connection.token ? { token: plain.connection.token } : {}),
    };
  } catch {
    return shelf;
  }
}
// Legacy shelves rewritten to plain URLs; shelves that become the same one merge,
// keeping a token. Pure: the stored records are not modified.
function planShelves(stored: Shelf[]): { result: Shelf[]; changed: boolean } {
  const plain = new Map<string, Shelf>();
  let changed = false;
  for (const shelf of stored) {
    const next = plainShelf(shelf);
    if (next.url !== shelf.url || next.connectionUrl !== shelf.connectionUrl)
      changed = true;
    const same = plain.get(next.url);
    if (!same) plain.set(next.url, next);
    else if (!same.token && next.token)
      plain.set(next.url, { ...same, token: next.token });
  }
  return { result: [...plain.values()], changed };
}
export async function shelves(): Promise<Shelf[]> {
  if (isDesktop()) {
    const stored: Shelf[] = await native('list', { store: 'shelves' });
    const { result, changed } = planShelves(stored);
    if (!changed) return result;
    // Native storage has no multi-record transaction: write the plain shelves
    // first and drop the legacy rows last, so an interrupted rewrite loses nothing.
    for (const shelf of result)
      await native('put', { store: 'shelves', value: shelfRecord(shelf) });
    // A native library that predates the token field drops it: a legacy row is
    // deleted only once the token of the shelf it became reads back.
    const verified = new Set<string>();
    for (const shelf of result)
      if (
        !shelf.token ||
        (await nativeGet<Shelf>('shelves', shelf.url))?.token === shelf.token
      )
        verified.add(shelf.url);
    for (const shelf of stored)
      if (
        !result.some((kept) => kept.url === shelf.url) &&
        verified.has(plainShelf(shelf).url)
      )
        await native('delete', { store: 'shelves', key: shelf.url });
    return result;
  }
  // One read-write transaction: rewriting old records must not race a save.
  const d = await db(),
    tx = d.transaction('shelves', 'readwrite'),
    finished = done(tx),
    store = tx.objectStore('shelves'),
    req = store.getAll();
  let result: Shelf[] = [];
  req.onsuccess = () => {
    const stored: Shelf[] = req.result;
    const plan = planShelves(stored);
    result = plan.result;
    if (!plan.changed) return;
    for (const shelf of stored) store.delete(shelf.url);
    for (const shelf of result) store.put(shelf);
  };
  await finished;
  return result;
}
/** Forgets a shelf; given its connection, every shelf saved from that catalogue and login too. */
export async function forgetShelf(
  url: string,
  connection?: Pick<Shelf, 'connectionUrl' | 'username'>,
) {
  const gone = (s: Shelf) =>
    s.url === url || (!!connection && sameConnection(s, connection));
  if (isDesktop()) {
    // Also any legacy row that becomes one of them (kept until its token was stored).
    const stored: Shelf[] = await native('list', { store: 'shelves' });
    for (const shelf of stored)
      if (gone(shelf) || gone(plainShelf(shelf)))
        await native('delete', { store: 'shelves', key: shelf.url });
    return;
  }
  const d = await db(),
    tx = d.transaction('shelves', 'readwrite'),
    finished = done(tx),
    store = tx.objectStore('shelves');
  store.delete(url);
  if (connection) {
    const req = store.getAll();
    req.onsuccess = () => {
      for (const s of req.result as Shelf[]) if (gone(s)) store.delete(s.url);
    };
  }
  await finished;
}

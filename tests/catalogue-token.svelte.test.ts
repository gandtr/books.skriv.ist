import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Catalogue from '../src/components/Catalogue.svelte';
import { db, shelves, forgetShelf } from '../src/lib/store';
import { forgetConnection, savedConnection } from '../src/lib/opds';

const TOKEN = 'tok_en-123';
const PAIRED = `https://a.example/opds/t/${TOKEN}/v1.2/catalog`;
const PLAIN = 'https://a.example/opds/v1.2/catalog';

// What Armarium emits: every link keeps the prefix the request used.
const atom = (title: string, prefix: string) =>
  `<feed xmlns="http://www.w3.org/2005/Atom"><title>${title}</title>
    <link rel="self" href="${prefix}/catalog" type="application/atom+xml"/>
    <entry><title>Recent</title><link rel="subsection" href="${prefix}/recent" type="application/atom+xml"/></entry>
    <entry><title>Book</title><link rel="http://opds-spec.org/acquisition" href="${prefix}/items/1/file" type="application/epub+zip"/></entry>
  </feed>`;

const realFetch = globalThis.fetch;
let requests: { url: string; authorization: string | null }[];
// A test can hold every response back, or turn the server into one that wants a login.
let gate: Promise<void> | undefined;
let requireAuth = false;
let target: HTMLElement;
let app: ReturnType<typeof mount> | undefined;

beforeEach(async () => {
  for (const shelf of await shelves()) await forgetShelf(shelf.url);
  requests = [];
  gate = undefined;
  requireAuth = false;
  // Each test starts as a fresh page load: nothing remembered in memory.
  forgetConnection(PLAIN, '');
  // A server that still emits token-bearing links, whatever the request used.
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    requests.push({
      url,
      authorization: new Headers(init?.headers).get('Authorization'),
    });
    if (gate) await gate;
    if (requireAuth && !requests.at(-1)!.authorization)
      return new Response('', { status: 401 });
    if (url.endsWith('/file')) return new Response('not an epub');
    return new Response(
      atom(
        url.endsWith('/recent') ? 'Recent' : 'Library',
        `/opds/t/${TOKEN}/v1.2`,
      ),
    );
  }) as typeof fetch;
  target = document.createElement('div');
  document.body.append(target);
});
afterEach(() => {
  globalThis.fetch = realFetch;
  if (app) unmount(app);
  app = undefined;
  target.remove();
});

// Several timer turns, not one: fake-indexeddb and the mocked fetch each queue
// macrotasks, and a single 20 ms wait flaked when the suite ran under load.
const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await tick();
    await new Promise((r) => setTimeout(r, 20));
  }
};
const mountCatalogue = (url = PAIRED) => {
  app = mount(Catalogue, {
    target,
    props: {
      pairing: { url, id: url ? 1 : 0 },
      onread: () => {},
      onadded: () => {},
    },
  });
  flushSync();
};
const urlField = () =>
  target.querySelector<HTMLInputElement>('input[type=url]')!;
const button = (label: RegExp) =>
  [...target.querySelectorAll('button')].find((b) =>
    label.test(b.textContent || ''),
  )!;

it('connects a pairing link with the plain URL and a Bearer header', async () => {
  mountCatalogue();
  urlField().closest('form')!.requestSubmit();
  await settle();
  expect(requests).toEqual([{ url: PLAIN, authorization: `Bearer ${TOKEN}` }]);
  expect(target.querySelector('.catalogue-heading')?.textContent).toContain(
    'Library',
  );
  // The form no longer holds the token URL; connecting again still works,
  // because the token is remembered.
  expect(urlField().value).toBe(PLAIN);
  urlField().closest('form')!.requestSubmit();
  await settle();
  expect(requests.at(-1)).toEqual({
    url: PLAIN,
    authorization: `Bearer ${TOKEN}`,
  });
});

it('never fetches a token URL while browsing, going back or paging', async () => {
  mountCatalogue();
  urlField().closest('form')!.requestSubmit();
  await settle();
  button(/Browse/).click();
  await settle();
  button(/Back/).click();
  await settle();
  expect(requests.map((r) => r.url)).toEqual([
    PLAIN,
    'https://a.example/opds/v1.2/recent',
    PLAIN,
  ]);
  for (const request of requests) {
    expect(request.url).not.toContain(TOKEN);
    expect(request.authorization).toBe(`Bearer ${TOKEN}`);
  }
});

it('downloads a book from a plain URL with the Bearer header', async () => {
  mountCatalogue();
  urlField().closest('form')!.requestSubmit();
  await settle();
  button(/Read book/).click();
  await settle();
  expect(requests.at(-1)).toEqual({
    url: 'https://a.example/opds/v1.2/items/1/file',
    authorization: `Bearer ${TOKEN}`,
  });
  for (const request of requests) expect(request.url).not.toContain(TOKEN);
});

const rawShelves = async () => {
  const d = await db();
  return new Promise<any[]>((resolve, reject) => {
    const req = d.transaction('shelves').objectStore('shelves').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};
const reload = async (url = '') => {
  unmount(app!);
  target.replaceChildren();
  // A reload drops everything held in memory, the remembered token too.
  forgetConnection(PLAIN, '');
  requests = [];
  mountCatalogue(url);
  await settle();
};

it('keeps the token in its own field of the saved shelf, never in a URL', async () => {
  mountCatalogue();
  urlField().closest('form')!.requestSubmit();
  await settle();
  const saved = await shelves();
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({
    url: PLAIN,
    connectionUrl: PLAIN,
    username: '',
    token: TOKEN,
  });
  expect(saved[0].url + saved[0].connectionUrl).not.toContain(TOKEN);
  button(/Save this shelf/).click();
  await settle();
  expect(await shelves()).toEqual(saved);
});

it('reopens a saved shelf in the same session with the remembered token', async () => {
  mountCatalogue();
  urlField().closest('form')!.requestSubmit();
  await settle();
  unmount(app!);
  target.replaceChildren();
  requests = [];
  mountCatalogue('');
  await settle();
  button(/Library/).click();
  await settle();
  expect(requests).toEqual([{ url: PLAIN, authorization: `Bearer ${TOKEN}` }]);
});

it('reopens a paired shelf after a reload without pairing again', async () => {
  mountCatalogue();
  urlField().closest('form')!.requestSubmit();
  await settle();
  await reload();
  button(/Library/).click();
  await settle();
  expect(requests).toEqual([{ url: PLAIN, authorization: `Bearer ${TOKEN}` }]);
  expect(target.querySelector('.catalogue-heading')?.textContent).toContain(
    'Library',
  );
  expect(target.querySelector('[role=alert]')).toBeNull();
});

it('opens a shelf saved with the token in its URL and scrubs the stored record', async () => {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction('shelves', 'readwrite');
    tx.objectStore('shelves').put({
      url: PAIRED,
      connectionUrl: PAIRED,
      username: '',
      title: 'Library',
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  mountCatalogue('');
  await settle();
  expect(await rawShelves()).toEqual([
    {
      url: PLAIN,
      connectionUrl: PLAIN,
      username: '',
      title: 'Library',
      token: TOKEN,
    },
  ]);
  button(/Library/).click();
  await settle();
  expect(requests).toEqual([{ url: PLAIN, authorization: `Bearer ${TOKEN}` }]);
});

it('deletes the stored token when the shelf is forgotten', async () => {
  mountCatalogue();
  urlField().closest('form')!.requestSubmit();
  await settle();
  expect(await rawShelves()).toHaveLength(1);
  target.querySelector<HTMLButtonElement>('[aria-label^=Forget]')!.click();
  await settle();
  expect(await rawShelves()).toEqual([]);
  await reload();
  expect(target.querySelector('.saved-shelf')).toBeNull();
});

it('does not restore a shelf forgotten while it was still loading', async () => {
  mountCatalogue();
  urlField().closest('form')!.requestSubmit();
  await settle();
  await reload();
  let release!: () => void;
  gate = new Promise<void>((resolve) => (release = resolve));
  button(/Library/).click();
  await settle();
  expect(requests).toHaveLength(1);
  target.querySelector<HTMLButtonElement>('[aria-label^=Forget]')!.click();
  await settle();
  release();
  await settle();
  expect(await rawShelves()).toEqual([]);
  expect(savedConnection(PLAIN, '')?.token).toBeUndefined();
  expect(target.querySelector('.catalogue-heading')).toBeNull();
  expect(target.querySelector('.saved-shelf')).toBeNull();
  expect(button(/Connect/).disabled).toBe(false);
});

it('does not bring a forgotten shelf back when Connect is pressed again', async () => {
  mountCatalogue();
  urlField().closest('form')!.requestSubmit();
  await settle();
  target.querySelector<HTMLButtonElement>('[aria-label^=Forget]')!.click();
  await settle();
  requireAuth = true;
  requests = [];
  urlField().closest('form')!.requestSubmit();
  await settle();
  expect(requests).toEqual([{ url: PLAIN, authorization: null }]);
  expect(await rawShelves()).toEqual([]);
  expect(target.querySelector('.catalogue-heading')).toBeNull();
});

it('takes a token out of the form when its shelf is forgotten', async () => {
  mountCatalogue();
  urlField().closest('form')!.requestSubmit();
  await settle();
  urlField().value = PAIRED;
  urlField().dispatchEvent(new Event('input'));
  flushSync();
  target.querySelector<HTMLButtonElement>('[aria-label^=Forget]')!.click();
  await settle();
  expect(urlField().value).toBe(PLAIN);
});

it('never takes a feed link carrying the token to another origin', async () => {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    requests.push({
      url,
      authorization: new Headers(init?.headers).get('Authorization'),
    });
    return new Response(`<feed xmlns="http://www.w3.org/2005/Atom"><title>Library</title>
      <entry><title>Away</title><link rel="subsection" href="https://cdn.example/opds/t/${TOKEN}/v1.2/recent" type="application/atom+xml"/></entry>
    </feed>`);
  }) as typeof fetch;
  mountCatalogue();
  urlField().closest('form')!.requestSubmit();
  await settle();
  expect(target.querySelector('.catalogue-entry button')).toBeNull();
  expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe(PLAIN);
});

it('connects a token URL typed into the field the same way', async () => {
  mountCatalogue('');
  urlField().value = PAIRED;
  urlField().dispatchEvent(new Event('input'));
  flushSync();
  urlField().closest('form')!.requestSubmit();
  await settle();
  expect(requests).toEqual([{ url: PLAIN, authorization: `Bearer ${TOKEN}` }]);
});

it('keeps Basic-auth catalogues unchanged', async () => {
  mountCatalogue('https://a.example/opds');
  const fill = (label: string, value: string) => {
    const input = [...target.querySelectorAll('label')]
      .find((l) => l.textContent?.startsWith(label))!
      .querySelector('input')!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };
  fill('Username', 'reader');
  fill('Password', 'secret');
  flushSync();
  urlField().closest('form')!.requestSubmit();
  await settle();
  expect(requests).toEqual([
    {
      url: 'https://a.example/opds',
      authorization: `Basic ${btoa('reader:secret')}`,
    },
  ]);
  // Passwords are never saved, and there is no token to save.
  const [stored] = await rawShelves();
  expect(stored).toEqual({
    url: 'https://a.example/opds',
    connectionUrl: 'https://a.example/opds',
    username: 'reader',
    title: 'Library',
  });
});

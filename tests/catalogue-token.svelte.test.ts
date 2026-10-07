import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Catalogue from '../src/components/Catalogue.svelte';
import { shelves, forgetShelf } from '../src/lib/store';

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
let target: HTMLElement;
let app: ReturnType<typeof mount> | undefined;

beforeEach(async () => {
  for (const shelf of await shelves()) await forgetShelf(shelf.url);
  requests = [];
  // A server that still emits token-bearing links, whatever the request used.
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    requests.push({
      url,
      authorization: new Headers(init?.headers).get('Authorization'),
    });
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

const settle = async () => {
  for (let i = 0; i < 5; i++) await tick();
  await new Promise((r) => setTimeout(r, 20));
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
  // Connecting again from the same form works the same way.
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

it('stores no token in the saved shelf', async () => {
  mountCatalogue();
  urlField().closest('form')!.requestSubmit();
  await settle();
  button(/Save this shelf/).click();
  await settle();
  const saved = await shelves();
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({
    url: PLAIN,
    connectionUrl: PLAIN,
    username: '',
  });
  expect(JSON.stringify(saved)).not.toContain(TOKEN);
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
});

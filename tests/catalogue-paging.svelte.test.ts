import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, expect, it } from 'vitest';
import Catalogue from '../src/components/Catalogue.svelte';
import { forgetShelf, shelves } from '../src/lib/shelves';

const ROOT = 'https://paging.example/opds/catalog';
const NEXT = 'https://paging.example/opds/catalog?page=2';
const PREVIOUS = 'https://paging.example/opds/catalog?page=0';
// 30 books, more than one screen of 24, and a server-side next and previous page.
const feed = (title: string) =>
  `<feed xmlns="http://www.w3.org/2005/Atom"><title>${title}</title>
    <link rel="next" href="${NEXT}" type="application/atom+xml"/>
    <link rel="previous" href="${PREVIOUS}" type="application/atom+xml"/>
    ${Array.from({ length: 30 }, (_, i) => `<entry><title>Book ${i + 1}</title><link rel="http://opds-spec.org/acquisition" href="/b${i + 1}.epub" type="application/epub+zip"/></entry>`).join('')}
  </feed>`;

const realFetch = globalThis.fetch;
let requests: string[];
let target: HTMLElement;
let app: ReturnType<typeof mount> | undefined;
beforeEach(async () => {
  for (const shelf of await shelves()) await forgetShelf(shelf.url);
  requests = [];
  globalThis.fetch = (async (url: string) => {
    requests.push(url);
    return new Response(
      feed(
        url === NEXT ? 'Page two' : url === PREVIOUS ? 'Page zero' : 'Library',
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
  for (let i = 0; i < 5; i++) {
    await tick();
    await new Promise((r) => setTimeout(r, 20));
  }
};
const button = (label: RegExp) =>
  [...target.querySelectorAll('button')].find((b) =>
    label.test(b.textContent || ''),
  )!;
const heading = () =>
  target.querySelector('.catalogue-heading')?.textContent?.replace(/\s+/g, ' ');

it('pages through a feed on screen first, then follows its next and previous links', async () => {
  app = mount(Catalogue, {
    target,
    props: {
      pairing: { url: ROOT, id: 1 },
      onread: () => {},
      onadded: () => {},
    },
  });
  flushSync();
  target.querySelector('form')!.requestSubmit();
  await settle();
  expect(heading()).toContain('1–24 of 30 entries');
  expect(target.textContent).toContain('Page 1');
  button(/Next/).click();
  await settle();
  expect(heading()).toContain('25–30 of 30 entries');
  expect(requests).toEqual([ROOT]);
  button(/Next/).click();
  await settle();
  expect(requests.at(-1)).toBe(NEXT);
  expect(heading()).toContain('Page two');
  expect(target.textContent).toContain('Page 1');
  button(/Back/).click();
  await settle();
  expect(requests.at(-1)).toBe(ROOT);
  button(/Previous/).click();
  await settle();
  expect(requests.at(-1)).toBe(PREVIOUS);
  expect(button(/Back/)).toBeUndefined();
});

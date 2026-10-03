import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const feeds = vi.hoisted(() => ({ pending: [] as ((title: string) => void)[] }));
vi.mock('../src/lib/opds', async (actual) => ({
  ...(await actual<typeof import('../src/lib/opds')>()),
  getFeed: vi.fn(
    () =>
      new Promise((resolve) =>
        feeds.pending.push((title) => resolve({ title, entries: [], links: [] })),
      ),
  ),
}));

import Catalogue from '../src/components/Catalogue.svelte';
import { shelves } from '../src/lib/store';

const A = 'https://a.example/opds/t/aaa/v1.2/catalog';
const B = 'https://b.example/opds/t/bbb/v1.2/catalog';

let target: HTMLElement;
let app: ReturnType<typeof mount> | undefined;
let props: { pairing: { url: string; id: number }; onread: () => void; onadded: () => void };

beforeEach(() => {
  feeds.pending = [];
  target = document.createElement('div');
  document.body.append(target);
  const initial = $state({ pairing: { url: A, id: 1 }, onread: () => {}, onadded: () => {} });
  props = initial;
  app = mount(Catalogue, { target, props });
  flushSync();
});
afterEach(() => {
  if (app) unmount(app);
  target.remove();
});

const urlField = () => target.querySelector<HTMLInputElement>('input[type=url]')!;
const connectButton = () => target.querySelector<HTMLButtonElement>('form button')!;
const pair = (url: string) => {
  props.pairing = { url, id: props.pairing.id + 1 };
  flushSync();
};
const settle = async () => {
  for (let i = 0; i < 5; i++) await tick();
  await new Promise((r) => setTimeout(r, 20));
};

it('drops a pending request when a new pairing arrives', async () => {
  urlField().closest('form')!.requestSubmit();
  flushSync();
  expect(connectButton().disabled).toBe(true);

  pair(B);
  expect(urlField().value).toBe(B);
  expect(connectButton().disabled).toBe(false);

  feeds.pending[0]('Library A');
  await settle();
  expect(target.querySelector('.catalogue-heading')).toBeNull();
  expect((await shelves()).map((s) => s.url)).not.toContain(A);
});

it('clears the feed already on screen when a new pairing arrives', async () => {
  urlField().closest('form')!.requestSubmit();
  flushSync();
  feeds.pending[0]('Library A');
  await settle();
  expect(target.querySelector('.catalogue-heading')?.textContent).toContain('Library A');

  pair(B);
  expect(target.querySelector('.catalogue-heading')).toBeNull();
  expect(urlField().value).toBe(B);
});

it('applies the same link again when it is scanned again', () => {
  urlField().value = 'https://edited.example/opds';
  urlField().dispatchEvent(new Event('input'));
  flushSync();
  pair(A);
  expect(urlField().value).toBe(A);
});

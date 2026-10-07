import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('virtual:pwa-register', () => ({ registerSW: () => async () => {} }));

import App from '../src/App.svelte';

const A = 'https://a.example/opds/t/aaa/v1.2/catalog';
const B = 'https://b.example/opds/t/bbb/v1.2/catalog';

let target: HTMLElement;
let app: ReturnType<typeof mount> | undefined;

const settle = async () => {
  for (let i = 0; i < 5; i++) await tick();
  await new Promise((r) => setTimeout(r, 20));
};
const nav = (label: string) =>
  [
    ...target.querySelectorAll<HTMLButtonElement>(
      'nav[aria-label=Main] button',
    ),
  ].find((b) => b.textContent === label)!;
const urlField = () =>
  target.querySelector<HTMLInputElement>('input[type=url]');
const scan = async (link: string) => {
  sessionStorage.setItem('skrivist.opds', link);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  await settle();
};
const go = async (label: string) => {
  nav(label).click();
  flushSync();
  await settle();
};

beforeEach(async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  sessionStorage.clear();
  history.replaceState(null, '', '/');
  target = document.createElement('div');
  document.body.append(target);
  app = mount(App, { target });
  await settle();
});
afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  target.remove();
  vi.unstubAllGlobals();
});

it('opens Catalogues with the scanned pairing link filled in', async () => {
  await scan(A);
  expect(urlField()?.value).toBe(A);
});

it('does not replay a consumed pairing link when Catalogues is opened again', async () => {
  await scan(A);
  expect(urlField()?.value).toBe(A);
  await go('Library');
  await go('Catalogues');
  expect(urlField()?.value).toBe('');
});

it('does not bring an older link back after a newer one was consumed', async () => {
  await scan(A);
  await scan(B);
  expect(urlField()?.value).toBe(B);
  await go('Library');
  await go('Catalogues');
  expect(urlField()?.value).toBe('');
});

it('applies the same link again when it is scanned again', async () => {
  await scan(A);
  await go('Library');
  await scan(A);
  expect(urlField()?.value).toBe(A);
});

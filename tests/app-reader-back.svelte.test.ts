import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('virtual:pwa-register', () => ({ registerSW: () => async () => {} }));

import App from '../src/App.svelte';
import { importBook } from '../src/lib/import';
import { getBook } from '../src/lib/store';
import { epubFile } from './fixtures';

let target: HTMLElement;
let app: ReturnType<typeof mount> | undefined;

const settle = async () => {
  for (let i = 0; i < 5; i++) await tick();
  await new Promise((r) => setTimeout(r, 20));
};
const button = (label: string) =>
  target.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const footer = () =>
  target.querySelector('.reader-footer')?.textContent?.replace(/\s+/g, ' ');

beforeEach(async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  history.replaceState(null, '', '/');
  target = document.createElement('div');
  document.body.append(target);
});
afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  target.remove();
  vi.unstubAllGlobals();
});

it('keeps the reading position when the reader is left with browser Back', async () => {
  const book = await importBook(epubFile());
  app = mount(App, { target });
  await settle();

  button('Read A Small Book')!.click();
  flushSync();
  await vi.waitFor(() => expect(footer()).toContain('Chapter 1 of 2'));
  await vi.waitFor(() => expect(button('Next page')?.disabled).toBe(false));
  // Turning past the last page of chapter 1 opens chapter 2 and saves it.
  button('Next page')!.click();
  await vi.waitFor(() => expect(footer()).toContain('Chapter 2 of 2'));
  await vi.waitFor(async () =>
    expect((await getBook(book.id))?.position.chapter).toBe(1),
  );

  // Browser Back: the fragment goes away without "← Library".
  history.pushState(null, '', '/');
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  await vi.waitFor(() => expect(button('Read A Small Book')).not.toBeNull());
  // The library shows the progress made in the reader.
  await vi.waitFor(() =>
    expect(target.querySelector('.status-button')?.textContent).toBe(
      '50% read',
    ),
  );

  button('Read A Small Book')!.click();
  flushSync();
  await vi.waitFor(() => expect(footer()).toContain('Chapter 2 of 2'));
  await settle();
  expect((await getBook(book.id))?.position.chapter).toBe(1);
});

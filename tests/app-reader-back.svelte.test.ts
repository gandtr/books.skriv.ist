import { File } from 'node:buffer';
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('virtual:pwa-register', () => ({ registerSW: () => async () => {} }));
// Slow storage: while blocked, every position save waits until the test lets
// it through, one at a time and in order.
const storage = vi.hoisted(() => ({
  blocked: false,
  waiting: [] as (() => void)[],
}));
vi.mock('../src/lib/store', async (original) => {
  const store = await original<typeof import('../src/lib/store')>();
  return {
    ...store,
    updateBook: async (...args: Parameters<typeof store.updateBook>) => {
      if (storage.blocked)
        await new Promise<void>((r) => storage.waiting.push(r));
      return store.updateBook(...args);
    },
  };
});

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
  // vi.unstubAllGlobals below also drops setup.ts's File stub.
  vi.stubGlobal('File', File);
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
  storage.blocked = false;
  storage.waiting.splice(0).forEach((r) => r());
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

it('reopening right after Back resumes where the queued saves end', async () => {
  const book = await importBook(
    epubFile({
      'OPS/package.opf':
        '<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>A Small Book</dc:title></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/><item id="three" href="three.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/><itemref idref="three"/></spine></package>',
      'OPS/three.xhtml':
        '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Night.</p></body></html>',
    }),
  );
  storage.blocked = true;
  app = mount(App, { target });
  await settle();

  button('Read A Small Book')!.click();
  flushSync();
  for (const n of [1, 2, 3]) {
    await vi.waitFor(() => expect(footer()).toContain(`Chapter ${n} of 3`));
    await vi.waitFor(() =>
      expect(button(n < 3 ? 'Next page' : 'Previous page')?.disabled).toBe(
        false,
      ),
    );
    if (n < 3) button('Next page')!.click();
  }
  // Three saves are queued behind the slow storage.
  history.pushState(null, '', '/');
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  // Storage catches up one save at a time; the reader comes back as soon as
  // the library offers it.
  for (let i = 0; !button('Read A Small Book') && i < 20; i++) {
    storage.waiting.shift()?.();
    await settle();
  }
  button('Read A Small Book')!.click();
  flushSync();
  storage.blocked = false;
  storage.waiting.splice(0).forEach((r) => r());
  await vi.waitFor(() => expect(footer()).toContain('Chapter 3 of 3'));
  await settle();
  expect((await getBook(book.id))?.position.chapter).toBe(2);
});

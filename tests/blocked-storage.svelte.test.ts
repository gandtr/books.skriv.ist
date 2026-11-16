import { mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('virtual:pwa-register', () => ({ registerSW: () => async () => {} }));

import App from '../src/App.svelte';
import { importBook } from '../src/lib/import';
import { epubFile } from './fixtures';

// With all site data blocked, reading or writing localStorage throws.
let target: HTMLElement;
let app: ReturnType<typeof mount> | undefined;
const blocked = () => {
  throw new DOMException('The operation is insecure.', 'SecurityError');
};
const settle = async () => {
  for (let i = 0; i < 5; i++) await tick();
  await new Promise((r) => setTimeout(r, 20));
};

beforeEach(() => {
  window.matchMedia = (() => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  history.replaceState(null, '', '/');
  target = document.createElement('div');
  document.body.append(target);
});
afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  target.remove();
  vi.restoreAllMocks();
});

it('opens the library and a book when site storage is blocked', async () => {
  await importBook(epubFile());
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
  app = mount(App, { target });
  await settle();
  expect(target.textContent).not.toContain('Opening your library');
  const read = target.querySelector<HTMLButtonElement>(
    'button[aria-label="Read A Small Book"]',
  )!;
  expect(read).not.toBeNull();

  // Theme and text size changes still apply for this visit.
  target.querySelector<HTMLButtonElement>('.header-actions button')!.click();
  read.click();
  await vi.waitFor(() =>
    expect(target.querySelector('.reader-footer')?.textContent).toContain(
      'Chapter 1 of 2',
    ),
  );
  target
    .querySelector<HTMLButtonElement>('button[aria-label="Larger text"]')!
    .click();
  await settle();
  expect(target.querySelector('[role="alert"]')).toBeNull();
});

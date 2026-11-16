import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('virtual:pwa-register', () => ({ registerSW: () => async () => {} }));

import App from '../src/App.svelte';
import { importBook } from '../src/lib/import';
import { epubFile } from './fixtures';

let target: HTMLElement;
let app: ReturnType<typeof mount> | undefined;
const settle = async () => {
  for (let i = 0; i < 5; i++) await tick();
  await new Promise((r) => setTimeout(r, 20));
};
const buttons = (selector: string) => [
  ...target.querySelectorAll<HTMLButtonElement>(`${selector} button`),
];
const named = (selector: string, text: string) =>
  buttons(selector).find((b) => b.textContent?.trim().startsWith(text))!;

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
});

// WCAG 4.1.2: the selected view, filter and chapter are not shown by colour alone.
it('marks the current view, status filter and chapter for assistive technology', async () => {
  await importBook(epubFile());
  app = mount(App, { target });
  await settle();

  expect(
    named('nav[aria-label="Main"]', 'Library').getAttribute('aria-current'),
  ).toBe('page');
  expect(
    named('nav[aria-label="Main"]', 'Calibre').hasAttribute('aria-current'),
  ).toBe(false);

  const filters = '.status-tabs';
  expect(named(filters, 'All books').getAttribute('aria-pressed')).toBe('true');
  expect(named(filters, 'Unread').getAttribute('aria-pressed')).toBe('false');
  named(filters, 'Unread').click();
  flushSync();
  expect(named(filters, 'Unread').getAttribute('aria-pressed')).toBe('true');
  expect(named(filters, 'All books').getAttribute('aria-pressed')).toBe(
    'false',
  );
  named(filters, 'All books').click();
  flushSync();

  target
    .querySelector<HTMLButtonElement>('button[aria-label="Read A Small Book"]')!
    .click();
  await vi.waitFor(() =>
    expect(target.querySelector('.reader-footer')?.textContent).toContain(
      'Chapter 1 of 2',
    ),
  );
  named('.reader-toolbar', 'Contents').click();
  flushSync();
  expect(named('.contents-panel', 'Morning').getAttribute('aria-current')).toBe(
    'true',
  );
  expect(named('.contents-panel', 'Evening').hasAttribute('aria-current')).toBe(
    false,
  );

  named('.reader-toolbar', '← Library').click();
  await vi.waitFor(() =>
    expect(target.querySelector('nav[aria-label="Main"]')).not.toBeNull(),
  );
  named('nav[aria-label="Main"]', 'Calibre').click();
  flushSync();
  expect(
    named('nav[aria-label="Main"]', 'Calibre').getAttribute('aria-current'),
  ).toBe('page');
  expect(
    named('nav[aria-label="Main"]', 'Library').hasAttribute('aria-current'),
  ).toBe(false);
});

import { mount, tick, unmount } from 'svelte';
import { expect, it, vi } from 'vitest';

vi.mock('virtual:pwa-register', () => ({ registerSW: () => async () => {} }));

import App from '../src/App.svelte';

// Apple guideline 5.1.1(i): the privacy policy must be reachable in the app.
it('links the privacy policy and support from the footer', async () => {
  window.matchMedia = (() => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  const target = document.createElement('div');
  document.body.append(target);
  const app = mount(App, { target });
  for (let i = 0; i < 5; i++) await tick();
  const links = [...target.querySelectorAll<HTMLAnchorElement>('footer a')].map(
    (a) => a.href,
  );
  expect(links).toContain('https://skriv.ist/privacy');
  expect(links).toContain('https://skriv.ist/support');
  unmount(app);
  target.remove();
});

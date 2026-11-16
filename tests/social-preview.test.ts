import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// skriv.ist/media/poster-en.jpg was removed (404); og-image.jpg is the
// 1920x1080 image skriv.ist itself shares.
it('shares the current skriv.ist preview image', () => {
  const html = readFileSync('index.html', 'utf8').replace(/\s+/g, ' ');
  const meta = (attr: string, name: string) =>
    html.match(new RegExp(`${attr}="${name}" content="([^"]+)"`))?.[1];
  const image = 'https://skriv.ist/media/og-image.jpg';
  expect(meta('property', 'og:image')).toBe(image);
  expect(meta('name', 'twitter:image')).toBe(image);
  expect(meta('property', 'og:image:width')).toBe('1920');
  expect(meta('property', 'og:image:height')).toBe('1080');
});

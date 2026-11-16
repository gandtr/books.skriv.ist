import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// WCAG 1.4.3: secondary text is 9 to 13 px, so it needs 4.5:1.
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const token = (css: string, name: string) =>
  css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'))![1];

it('light-theme muted text reads at 4.5:1 on every light surface', () => {
  const css = readFileSync('src/style.css', 'utf8');
  const muted = token(css, 'muted');
  for (const surface of ['bg', 'panel', 'soft', 'reader'])
    expect(contrast(muted, token(css, surface))).toBeGreaterThanOrEqual(4.5);
  const page = readFileSync('public/404.html', 'utf8');
  expect(
    contrast(token(page, 'muted'), token(page, 'bg')),
  ).toBeGreaterThanOrEqual(4.5);
});

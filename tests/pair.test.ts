import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
import { takeOpdsLink } from '../src/lib/pair';

const U = 'https://a.example/opds/t/x_y-z/v1.2/catalog';
const READ = '#read=' + 'a'.repeat(64);

beforeEach(() => {
  sessionStorage.clear();
  history.replaceState(null, '', '/');
});

it('takes the link the scrubber stored and forgets it', () => {
  sessionStorage.setItem('skrivist.opds', U);
  expect(takeOpdsLink()).toBe(U);
  expect(sessionStorage.getItem('skrivist.opds')).toBeNull();
});

it('takes the link from the fragment and strips it', () => {
  history.replaceState(null, '', '/?x=1#opds=' + encodeURIComponent(U));
  expect(takeOpdsLink()).toBe(U);
  expect(location.hash).toBe('');
  expect(location.search).toBe('?x=1');
});

it('treats a fragment with opds and read as a pairing link', () => {
  history.replaceState(null, '', '/#opds=' + encodeURIComponent(U) + '&' + READ.slice(1));
  expect(takeOpdsLink()).toBe(U);
  expect(location.hash).toBe('');
});

it('leaves reading links alone', () => {
  history.replaceState(null, '', '/' + READ);
  expect(takeOpdsLink()).toBe('');
  expect(location.hash).toBe(READ);
});

it('returns nothing without a fragment', () => {
  expect(takeOpdsLink()).toBe('');
});

it('falls back to the fragment when storage is denied', () => {
  const denied = () => {
    throw new DOMException('denied', 'SecurityError');
  };
  const win = {
    location,
    history,
    sessionStorage: { getItem: denied, removeItem: denied },
  };
  history.replaceState(null, '', '/#opds=' + encodeURIComponent(U));
  expect(takeOpdsLink(win)).toBe(U);
  expect(location.hash).toBe('');
});

it('the early scrubber moves the link into sessionStorage before the app runs', () => {
  history.replaceState(null, '', '/?x=1#opds=' + encodeURIComponent(U));
  new Function(readFileSync('public/opds-hash.js', 'utf8'))();
  expect(sessionStorage.getItem('skrivist.opds')).toBe(U);
  expect(location.hash).toBe('');
  expect(location.search).toBe('?x=1');
});

it('the scrubber ignores reading links', () => {
  history.replaceState(null, '', '/' + READ);
  new Function(readFileSync('public/opds-hash.js', 'utf8'))();
  expect(sessionStorage.getItem('skrivist.opds')).toBeNull();
  expect(location.hash).toBe(READ);
});

it('the scrubber still strips the fragment when storage is denied, and the app still gets the link', () => {
  history.replaceState(null, '', '/#opds=' + encodeURIComponent(U));
  const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('quota', 'QuotaExceededError');
  });
  try {
    new Function(readFileSync('public/opds-hash.js', 'utf8'))();
    expect(location.hash).toBe('');
  } finally {
    setItem.mockRestore();
  }
  expect(takeOpdsLink()).toBe(U);
  expect(takeOpdsLink()).toBe('');
});

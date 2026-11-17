import { mount, unmount } from 'svelte';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import Reader from '../src/components/Reader.svelte';
import { Epub } from '../src/lib/epub';
import { importBook } from '../src/lib/import';
import { getBook } from '../src/lib/store';
import { epubFile } from './fixtures';

// jsdom has no layout: give the page a width and every chapter three spreads
// (step 448 px), and put the link targets in known columns.
const columns: Record<string, number> = { fn3: 900, page_12: 460 };
let target: HTMLElement;
let reader: ReturnType<typeof mount> | undefined;

const footer = () =>
  target.querySelector('.reader-footer')?.textContent?.replace(/\s+/g, ' ');
const shadow = () => target.querySelector('.reading-page')!.shadowRoot!;
const backButton = () =>
  [...target.querySelectorAll<HTMLButtonElement>('.reader-footer button')].find(
    (b) => b.textContent?.includes('Back to your page'),
  );

beforeEach(() => {
  // Set directly: vi.unstubAllGlobals would also drop setup.ts's File stub.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
  vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockImplementation(
    function (this: Element) {
      return this.id === 'flow' ? 1296 : 0;
    },
  );
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: Element) {
      return { left: columns[this.id] ?? 0 } as DOMRect;
    },
  );
  target = document.createElement('div');
  document.body.append(target);
});
afterEach(() => {
  if (reader) unmount(reader);
  reader = undefined;
  target.remove();
  vi.restoreAllMocks();
});

async function open() {
  const book = await importBook(
    epubFile(
      {},
      '<p>See note <a href="#fn3">3</a> and <a href="two.xhtml#page_12">page 12</a>.</p><p id="fn3">The note.</p>',
    ),
  );
  reader = mount(Reader, {
    target,
    props: { book, onclose: () => {}, onchanged: () => {} },
  });
  await vi.waitFor(() => expect(footer()).toContain('Chapter 1 of 2 · 1 / 3'));
  return book;
}

it('turns to a footnote in the same chapter without leaving the chapter', async () => {
  const book = await open();
  const note = shadow().querySelector('#fn3');
  shadow().querySelector<HTMLAnchorElement>('a[data-anchor="fn3"]')!.click();
  await vi.waitFor(() => expect(footer()).toContain('Chapter 1 of 2 · 3 / 3'));
  // Not re-rendered: the same element is still on the page.
  expect(shadow().querySelector('#fn3')).toBe(note);
  await vi.waitFor(async () =>
    expect((await getBook(book.id))?.position).toMatchObject({
      chapter: 0,
      fraction: 1,
    }),
  );

  backButton()!.click();
  await vi.waitFor(() => expect(footer()).toContain('Chapter 1 of 2 · 1 / 3'));
  expect(backButton()).toBeUndefined();
  await vi.waitFor(async () =>
    expect((await getBook(book.id))?.position).toMatchObject({
      chapter: 0,
      fraction: 0,
    }),
  );
});

it('opens another chapter at the linked fragment and offers the way back', async () => {
  const book = await open();
  shadow()
    .querySelector<HTMLAnchorElement>('a[data-anchor="page_12"]')!
    .click();
  await vi.waitFor(() => expect(footer()).toContain('Chapter 2 of 2 · 2 / 3'));
  await vi.waitFor(async () =>
    expect((await getBook(book.id))?.position).toMatchObject({
      chapter: 1,
      fraction: 0.5,
    }),
  );

  backButton()!.click();
  await vi.waitFor(() => expect(footer()).toContain('Chapter 1 of 2 · 1 / 3'));
});

it('leaves the page alone when a same-chapter fragment names nothing', async () => {
  await open();
  const link = shadow().querySelector<HTMLAnchorElement>(
    'a[data-anchor="fn3"]',
  )!;
  link.setAttribute('data-anchor', 'missing');
  link.click();
  await new Promise((r) => setTimeout(r, 20));
  expect(footer()).toContain('Chapter 1 of 2 · 1 / 3');
  expect(backButton()).toBeUndefined();
});

it('keeps the way back when it is chosen while the linked chapter loads', async () => {
  await open();
  const chapter = Epub.prototype.chapter;
  let release = () => {};
  const loaded = new Promise<void>((r) => (release = r));
  vi.spyOn(Epub.prototype, 'chapter').mockImplementation(async function (
    this: Epub,
    index: number,
  ) {
    if (index === 1) await loaded;
    return chapter.call(this, index);
  });
  shadow()
    .querySelector<HTMLAnchorElement>('a[data-anchor="page_12"]')!
    .click();
  await vi.waitFor(() => expect(backButton()).toBeDefined());
  backButton()!.click();
  release();
  await vi.waitFor(() => expect(footer()).toContain('Chapter 2 of 2 · 2 / 3'));
  backButton()!.click();
  await vi.waitFor(() => expect(footer()).toContain('Chapter 1 of 2 · 1 / 3'));
});

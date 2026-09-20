import { describe, it, expect } from 'vitest';
import { Epub, resolvePath } from '../src/lib/epub';
import { epubFile } from './fixtures';
describe('EPUB', () => {
  it('reads package metadata and only the selected spine chapter', async () => {
    const book = await Epub.open(epubFile());
    expect(book.info.title).toBe('A Small Book');
    expect(book.info.sections.map((s) => s.title)).toEqual([
      'Morning',
      'Evening',
    ]);
    expect((await book.chapter(1)).textContent).toContain('The last page.');
    book.close();
  });
  it('removes executable markup, styles, forms and external resource requests', async () => {
    const book = await Epub.open(
      epubFile(
        {},
        '<h1 style="position:fixed">Hello</h1><script>alert(1)</script><img src="https://evil.example/track" onerror="alert(1)"><iframe src="https://evil.example"></iframe><form><input></form><style>body{display:none}</style><a href="javascript:alert(1)">bad</a><a href="https://example.org/">external</a>',
      ),
    );
    const fragment = await book.chapter(0);
    expect(
      fragment.querySelector(
        'script,iframe,style,form,input,[onerror],[style],[src]',
      ),
    ).toBeNull();
    expect(fragment.querySelector('a')?.getAttribute('href')).toBeNull();
    expect(fragment.querySelector('a[target]')?.getAttribute('rel')).toBe(
      'noopener noreferrer',
    );
    book.close();
  });
  it('rewrites only valid internal spine links', async () => {
    const book = await Epub.open(
      epubFile(
        {},
        '<a href="two.xhtml#end">Next</a><a href="../../outside">Invalid</a>',
      ),
    );
    const fragment = await book.chapter(0);
    expect(fragment.querySelector('a')?.getAttribute('data-chapter')).toBe('1');
    expect(fragment.querySelectorAll('a')[1].hasAttribute('href')).toBe(false);
  });
  it('rejects traversal and external paths', () => {
    expect(resolvePath('../img/cover.png', 'OPS/text/ch.xhtml')).toBe(
      'OPS/img/cover.png',
    );
    for (const path of [
      '../../outside',
      'https://evil.test/a',
      '//evil.test/a',
      '..\\outside',
    ])
      expect(() => resolvePath(path)).toThrow();
  });
  it('rejects missing packages and XML entities', async () => {
    await expect(
      Epub.open(
        epubFile({
          'META-INF/container.xml':
            '<!DOCTYPE x [<!ENTITY bad "test">]><container/>',
        }),
      ),
    ).rejects.toThrow();
    await expect(Epub.open(new Blob(['not a zip']))).rejects.toThrow();
  });
  it('rejects entries that expand beyond the resource limit', async () => {
    await expect(
      Epub.open(epubFile({ 'oversized.txt': 'x'.repeat(25 * 1024 * 1024) })),
    ).rejects.toThrow('safe size limit');
  });
});
it('reads standard EPUB navigation DOCTYPE and literal percent paths', async () => {
  const epub = await Epub.open(
    epubFile({
      'OPS/nav.xhtml':
        '<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><body><nav><a href="one.xhtml">Real title</a></nav></body></html>',
    }),
  );
  expect(epub.info.sections[0].title).toBe('Real title');
  expect(resolvePath('100% free.jpg', 'OPS/package.opf')).toBe(
    'OPS/100% free.jpg',
  );
  epub.close();
});
it('keeps a readable spine when optional manifest media is external or malformed', async () => {
  const epub = await Epub.open(
    epubFile({
      $manifest:
        '<item id="remote" href="https://cdn.example/audio.mp3" media-type="audio/mpeg"/><item id="bad" href="audio\\track.mp3" media-type="audio/mpeg"/>',
    }),
  );
  expect(epub.info.sections).toHaveLength(2);
  expect((await epub.chapter(0)).textContent).toContain('A quiet morning');
  epub.close();
});

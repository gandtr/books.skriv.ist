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
        '<h1 style="position:fixed">Hello</h1><script>alert(1)</script><img src="https://evil.example/track" onerror="alert(1)"/><iframe src="https://evil.example"></iframe><form><input/></form><style>body{display:none}</style><a href="javascript:alert(1)">bad</a><a href="https://example.org/">external</a>',
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
describe('XHTML chapters', () => {
  it('reads self-closing tags as XHTML', async () => {
    const book = await Epub.open(epubFile());
    // <title/> and <script src/> in the head no longer swallow the chapter.
    expect((await book.chapter(0)).textContent).toContain('A quiet morning');
    const two = await book.chapter(1);
    // A page anchor does not wrap the rest of the chapter in a link.
    expect(two.querySelectorAll('#page_12')).toHaveLength(1);
    expect(two.querySelector('#page_12')?.childNodes).toHaveLength(0);
    expect(two.querySelector('.spacer')?.childNodes).toHaveLength(0);
    expect(
      [...two.querySelectorAll('p')]
        .find((p) => p.textContent?.includes('The last page.'))
        ?.closest('a'),
    ).toBeNull();
    book.close();
  });
  it('reads CDATA in a chapter body as text', async () => {
    const book = await Epub.open(
      epubFile({}, '<p><![CDATA[Fish & chips]]></p><p id="next">Next.</p>'),
    );
    const fragment = await book.chapter(0);
    expect(fragment.querySelector('p')?.textContent).toBe('Fish & chips');
    expect(fragment.querySelector('#next')?.textContent).toBe('Next.');
    book.close();
  });
});

// The sanitiser is the boundary for untrusted books. Chapters are parsed as
// XML first and fall back to an HTML parse of the string; both paths must
// strip the same things, including what only an XML parse can express.
describe('chapter sanitiser', () => {
  const ns =
    'xmlns="http://www.w3.org/1999/xhtml" xmlns:svg="http://www.w3.org/2000/svg" xmlns:m="http://www.w3.org/1998/Math/MathML" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:x="urn:x-evil" xmlns:h="http://www.w3.org/1999/xhtml"';
  // In an HTML parse the self-closing anchor is an open tag that is copied
  // into the next paragraph, so the probe count shows which path ran.
  const payload = `<p>probe<a id="probe"/></p><p>after</p>
<script>alert(1)</script>
<h:script>alert(2)</h:script>
<x:script>alert(3)</x:script>
<x:img src="https://evil.example/x.png" onerror="alert(4)"/>
<svg:svg><svg:script>alert(5)</svg:script><svg:image xlink:href="https://evil.example/svg.png"/><svg:a xlink:href="javascript:alert(6)"><svg:text>t</svg:text></svg:a></svg:svg>
<svg xmlns="http://www.w3.org/2000/svg"><script>alert(7)</script><foreignObject><img xmlns="http://www.w3.org/1999/xhtml" src="https://evil.example/fo.png"/></foreignObject></svg>
<m:math><m:mi xlink:href="javascript:alert(8)">x</m:mi></m:math>
<a xlink:href="javascript:alert(9)">xlink</a>
<a href="javascript:alert(10)" onclick="alert(11)">js</a>
<img src="https://evil.example/track.png" onerror="alert(12)" x:onerror="alert(13)" srcset="https://evil.example/s.png 2x"/>
<?xml-stylesheet href="https://evil.example/pi.css"?>
<div style="background:url(https://evil.example/bg.png)" background="https://evil.example/b.png">styled</div>
<iframe src="https://evil.example/frame"></iframe>
<object data="https://evil.example/o"></object>
<embed src="https://evil.example/e"/>
<link rel="stylesheet" href="https://evil.example/l.css"/>
<style>@import url(https://evil.example/s.css);</style>
<form action="https://evil.example/f"><input name="q"/><button formaction="https://evil.example/b">b</button></form>
<video poster="https://evil.example/p.png" src="https://evil.example/v.mp4"></video>
<audio src="https://evil.example/a.mp3"></audio>
<base href="https://evil.example/"/>
<meta http-equiv="refresh" content="0;url=https://evil.example/"/>
<a ping="https://evil.example/ping" href="https://example.org/">ok</a>
<p data-x="1">data</p>
<template><script>alert(14)</script></template>
<!-- <img src="https://evil.example/c.png"> -->
<![CDATA[<script>alert(15)</script>]]>
<p id="end">end</p>`;
  const xmlChapter = `<?xml version="1.0" encoding="utf-8"?><html ${ns}><head><title/><script src="https://evil.example/head.js"/></head><body onload="alert(0)">${payload}</body></html>`;
  // &nbsp; is not declared in XML, so this file takes the fallback path.
  const htmlChapter = `<html ${ns}><head><title>T</title></head><body onload="alert(0)">&nbsp;${payload}</body></html>`;
  const chapterOf = async (xhtml: string) => {
    const book = await Epub.open(epubFile({ 'OPS/one.xhtml': xhtml }));
    try {
      return await book.chapter(0);
    } finally {
      book.close();
    }
  };
  const nodes = (root: Node) => {
    const all: Node[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
    while (walker.nextNode()) all.push(walker.currentNode);
    return all;
  };
  const forbidden = [
    'script',
    'iframe',
    'object',
    'embed',
    'link',
    'style',
    'form',
    'input',
    'button',
    'video',
    'audio',
    'source',
    'base',
    'meta',
    'svg',
    'math',
    'image',
    'foreignobject',
    'mi',
    'textarea',
    'select',
  ];
  const expectClean = (fragment: DocumentFragment) => {
    for (const node of nodes(fragment)) {
      // Comments, processing instructions and CDATA never reach the reader
      // as markup.
      expect([1, 3]).toContain(node.nodeType);
      if (!(node instanceof Element)) continue;
      expect(forbidden).not.toContain(node.localName.toLowerCase());
      expect(node.prefix).toBeNull();
      expect(node.namespaceURI).toBe('http://www.w3.org/1999/xhtml');
      for (const attr of Array.from(node.attributes)) {
        expect(attr.localName.toLowerCase()).not.toMatch(/^on/);
        expect(attr.prefix).toBeNull();
        expect(attr.namespaceURI).toBeNull();
        expect([
          'style',
          'srcset',
          'background',
          'poster',
          'ping',
          'action',
          'formaction',
          'data-x',
          'src',
          'data',
          'http-equiv',
        ]).not.toContain(attr.localName.toLowerCase());
        expect(attr.value).not.toMatch(/evil\.example|javascript:/i);
      }
    }
    // Script bodies are dropped; the text of unknown elements (h:script,
    // x:script) stays as inert text, as it always has with the HTML parse.
    expect(fragment.textContent).not.toMatch(
      /alert\((0|1|7|9|10|11|12|13|14)\)/,
    );
    expect(fragment.querySelector('#end')?.textContent).toBe('end');
    expect(
      fragment.querySelector('a[href="https://example.org/"]'),
    ).not.toBeNull();
  };
  it('cleans an XHTML chapter parsed as XML', async () => {
    const fragment = await chapterOf(xmlChapter);
    expect(fragment.querySelectorAll('#probe')).toHaveLength(1);
    expectClean(fragment);
  });
  it('cleans a chapter that falls back to the HTML parser', async () => {
    const fragment = await chapterOf(htmlChapter);
    expect(fragment.querySelectorAll('#probe').length).toBeGreaterThan(1);
    expectClean(fragment);
  });
  it('does not expand entities declared in the chapter', async () => {
    const fragment = await chapterOf(
      `<?xml version="1.0"?><!DOCTYPE html [<!ENTITY x "&#60;img src='https://evil.example/e.png' onerror='alert(16)'/&#62;"><!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]><html ${ns}><body><p>&x;&b;</p><p id="end">end</p><a href="https://example.org/">ok</a></body></html>`,
    );
    expect(fragment.querySelector('img')).toBeNull();
    expect(fragment.textContent).not.toContain('aaaaaaaaaa');
    expectClean(fragment);
  });
});

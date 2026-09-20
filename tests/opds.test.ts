// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseFeed, safeUrl, acquisition, fetchLimited } from '../src/lib/opds';
afterEach(() => vi.unstubAllGlobals());
describe('OPDS', () => {
  it('resolves Atom links, xml:base and namespaces without rendering markup', () => {
    const feed = parseFeed(
      `<a:feed xmlns:a="http://www.w3.org/2005/Atom" xml:base="/books/"><a:title>Library</a:title><a:entry xml:base="one/"><a:title>&lt;script&gt;bad&lt;/script&gt;</a:title><a:link rel="http://opds-spec.org/acquisition" type="application/pdf" href="book.pdf"/></a:entry></a:feed>`,
      'https://example.org/opds',
    );
    expect(feed.entries[0].title).toBe('<script>bad</script>');
    expect(feed.entries[0].links[0].href).toBe(
      'https://example.org/books/one/book.pdf',
    );
    expect(acquisition(feed.entries[0].links[0])).toBe(true);
  });
  it('reads OPDS 2 navigation and grouped publications', () => {
    const feed = parseFeed(
      JSON.stringify({
        metadata: { title: 'Shelf' },
        navigation: [{ href: 'next', title: 'Next' }],
        groups: [
          {
            publications: [
              {
                metadata: { title: 'Book' },
                links: [
                  {
                    href: '/b.epub',
                    rel: 'http://opds-spec.org/acquisition',
                    type: 'application/epub+zip',
                  },
                ],
              },
            ],
          },
        ],
      }),
      'https://example.org/opds/',
    );
    expect(feed.entries).toHaveLength(2);
    expect(feed.entries[0].links[0].href).toBe('https://example.org/opds/next');
  });
  it('rejects unsafe URLs and excludes unsupported purchases', () => {
    for (const url of [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'https://user:pass@example.org',
    ])
      expect(() => safeUrl(url)).toThrow();
    expect(
      acquisition({
        href: 'https://x/b.pdf',
        type: 'application/pdf',
        rel: 'http://opds-spec.org/acquisition/buy',
        title: '',
      }),
    ).toBe(false);
    expect(() => parseFeed('<html/>', 'https://x/')).toThrow();
  });
  it('never sends credentials to a linked foreign origin or permits redirects', async () => {
    const fetcher = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('ok'),
    );
    vi.stubGlobal('fetch', fetcher);
    const connection = {
      url: 'https://a.example/opds',
      username: 'user',
      password: 'secret',
    };
    await fetchLimited('https://b.example/book', connection, 10);
    const init = fetcher.mock.calls[0][1] as RequestInit;
    expect((init.headers as Headers).has('Authorization')).toBe(false);
    expect(init.redirect).toBe('error');
    expect(init.credentials).toBe('omit');
  });
  it('bounds streamed downloads without trusting Content-Length', async () => {
    vi.stubGlobal('fetch', async () => new Response('too much content'));
    await expect(
      fetchLimited(
        'https://a.example/',
        { url: 'https://a.example/', username: '', password: '' },
        2,
      ),
    ).rejects.toThrow('size limit');
  });
});
it('ignores an invalid xml:base without dropping neighboring entries', () => {
  const feed = parseFeed(
    '<feed xmlns="http://www.w3.org/2005/Atom"><entry xml:base="mailto:x@y"><link href="book.epub" type="application/epub+zip" rel="http://opds-spec.org/acquisition"/></entry></feed>',
    'https://a.example/feed',
  );
  expect(feed.entries[0].links[0].href).toBe('https://a.example/book.epub');
});
it('continues a slow download as long as chunks arrive within the idle deadline', async () => {
  vi.useFakeTimers();
  let stream: ReadableStreamDefaultController<Uint8Array>;
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            stream = controller;
          },
        }),
      ),
  );
  const pending = fetchLimited(
    'https://a.example/book',
    { url: 'https://a.example/feed', username: '', password: '' },
    100,
  );
  await vi.advanceTimersByTimeAsync(40000);
  stream!.enqueue(new Uint8Array([1]));
  await vi.advanceTimersByTimeAsync(40000);
  stream!.enqueue(new Uint8Array([2]));
  stream!.close();
  expect((await pending).blob.size).toBe(2);
  vi.useRealTimers();
});

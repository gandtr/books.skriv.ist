// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import {
  parseFeed,
  safeUrl,
  acquisition,
  fetchLimited,
  getFeed,
  splitToken,
  savedConnection,
  rememberConnection,
} from '../src/lib/opds';
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

describe('Armarium path tokens', () => {
  const TOKEN = 'tok_en-123';
  it('moves a /opds/t/<token>/ prefix out of the URL', () => {
    expect(
      splitToken(`https://a.example/opds/t/${TOKEN}/v1.2/catalog?q=1#x`),
    ).toEqual({
      url: 'https://a.example/opds/v1.2/catalog?q=1#x',
      token: TOKEN,
    });
    expect(splitToken(`https://a.example/opds/t/${TOKEN}`)).toEqual({
      url: 'https://a.example/opds',
      token: TOKEN,
    });
    expect(splitToken('https://a.example/opds/t/a%2Fb%20c/v1.2/')).toEqual({
      url: 'https://a.example/opds/v1.2/',
      token: 'a/b c',
    });
  });
  it('leaves every other URL alone', () => {
    for (const url of [
      'https://a.example/opds/v1.2/catalog',
      'https://a.example/opds/t/',
      'https://a.example/books/opds/t/x/v1.2',
      'https://a.example/opds/tx/y',
      'not a url',
    ])
      expect(splitToken(url)).toEqual({ url, token: '' });
  });
  it('sends the token as a Bearer header and never in the request URL', async () => {
    const fetcher = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('ok'),
    );
    vi.stubGlobal('fetch', fetcher);
    await fetchLimited(
      'https://a.example/opds/v1.2/catalog',
      {
        url: 'https://a.example/opds/v1.2/catalog',
        username: '',
        password: '',
        token: TOKEN,
      },
      10,
    );
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://a.example/opds/v1.2/catalog');
    expect((init.headers as Headers).get('Authorization')).toBe(
      `Bearer ${TOKEN}`,
    );
  });
  it('strips a same-origin token path before fetching and uses it as the Bearer', async () => {
    const fetcher = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('ok'),
    );
    vi.stubGlobal('fetch', fetcher);
    const connection = {
      url: 'https://a.example/opds/v1.2/catalog',
      username: '',
      password: '',
    };
    await fetchLimited(
      `https://a.example/opds/t/${TOKEN}/v1.2/recent`,
      connection,
      10,
    );
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://a.example/opds/v1.2/recent');
    expect(url).not.toContain(TOKEN);
    expect((init.headers as Headers).get('Authorization')).toBe(
      `Bearer ${TOKEN}`,
    );
  });
  it('never sends the token to another origin', async () => {
    const fetcher = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('ok'),
    );
    vi.stubGlobal('fetch', fetcher);
    await fetchLimited(
      'https://b.example/book.epub',
      {
        url: 'https://a.example/opds/v1.2/catalog',
        username: '',
        password: '',
        token: TOKEN,
      },
      10,
    );
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://b.example/book.epub');
    expect((init.headers as Headers).has('Authorization')).toBe(false);
    // Another origin's token path is not ours to strip or reuse.
    await fetchLimited(
      `https://b.example/opds/t/${TOKEN}/v1.2/catalog`,
      {
        url: 'https://a.example/opds/v1.2/catalog',
        username: '',
        password: '',
      },
      10,
    );
    const [foreign, foreignInit] = fetcher.mock.calls[1] as [
      string,
      RequestInit,
    ];
    expect(foreign).toBe(`https://b.example/opds/t/${TOKEN}/v1.2/catalog`);
    expect((foreignInit.headers as Headers).has('Authorization')).toBe(false);
  });
  it('rewrites same-origin token links in a feed to plain paths', async () => {
    const feed = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Library</title>
      <link rel="self" href="/opds/t/${TOKEN}/v1.2/catalog" type="application/atom+xml"/>
      <link rel="next" href="/opds/t/${TOKEN}/v1.2/recent?page=2" type="application/atom+xml"/>
      <entry><title>Book</title>
        <link rel="http://opds-spec.org/acquisition" href="/opds/t/${TOKEN}/v1.2/items/1/file" type="application/epub+zip"/>
        <link rel="subsection" href="https://b.example/opds/t/other/v1.2/catalog" type="application/atom+xml"/>
      </entry></feed>`;
    // afterEach unstubs setup.ts's node Blob; jsdom's has no text().
    vi.stubGlobal('Blob', NodeBlob);
    vi.stubGlobal('fetch', async () => new Response(feed));
    const result = await getFeed(`https://a.example/opds/v1.2/catalog`, {
      url: 'https://a.example/opds/v1.2/catalog',
      username: '',
      password: '',
      token: TOKEN,
    });
    expect(result.links.map((l) => l.href)).toEqual([
      'https://a.example/opds/v1.2/catalog',
      'https://a.example/opds/v1.2/recent?page=2',
    ]);
    expect(result.entries[0].links.map((l) => l.href)).toEqual([
      'https://a.example/opds/v1.2/items/1/file',
      'https://b.example/opds/t/other/v1.2/catalog',
    ]);
  });
  it('keeps Basic login working unchanged', async () => {
    const fetcher = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('ok'),
    );
    vi.stubGlobal('fetch', fetcher);
    await fetchLimited(
      'https://a.example/opds/v1.2/catalog',
      {
        url: 'https://a.example/opds/v1.2/catalog',
        username: 'user',
        password: 'secret',
      },
      10,
    );
    const init = fetcher.mock.calls[0][1] as RequestInit;
    expect((init.headers as Headers).get('Authorization')).toBe(
      `Basic ${btoa('user:secret')}`,
    );
  });
  it('keeps a token for the session like a password: in memory, per origin and username', () => {
    rememberConnection({
      url: 'https://a.example/opds/v1.2/catalog',
      username: '',
      password: '',
      token: TOKEN,
    });
    expect(
      savedConnection('https://a.example/opds/v1.2/catalog', '')?.token,
    ).toBe(TOKEN);
    expect(
      savedConnection('https://b.example/opds/v1.2/catalog', '')?.token,
    ).toBeUndefined();
  });
});

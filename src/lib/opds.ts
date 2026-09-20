/** OPDS 1 (Atom) and OPDS 2. Feed markup is never rendered as HTML. */
export interface Link {
  href: string;
  title: string;
  type: string;
  rel: string;
}
export interface Entry {
  title: string;
  author: string;
  links: Link[];
}
export interface Feed {
  title: string;
  entries: Entry[];
  links: Link[];
}
export interface Connection {
  url: string;
  username: string;
  password: string;
}
export const MAX_DOWNLOAD = 128 * 1024 * 1024;
const FEED_LIMIT = 4 * 1024 * 1024;
export function safeUrl(value: string, base?: string): string {
  const url = new URL(value, base);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error('Use an HTTP or HTTPS URL without embedded credentials.');
  return url.href;
}
export function acquisition(link: Link): boolean {
  return (
    link.rel
      .split(/\s+/)
      .some(
        (r) =>
          r === 'http://opds-spec.org/acquisition' ||
          r === 'http://opds-spec.org/acquisition/open-access',
      ) &&
    (/^(application\/(pdf|epub\+zip))$/i.test(link.type.split(';')[0]) ||
      /\.(epub|pdf)(?:[?#]|$)/i.test(link.href))
  );
}
export function navigation(link: Link): boolean {
  return (
    /atom\+xml|opds\+json/.test(link.type) &&
    !/type\s*=\s*entry/i.test(link.type) &&
    !link.rel
      .split(/\s+/)
      .some((rel) => ['self', 'search', 'alternate'].includes(rel))
  );
}
function links(raw: unknown, base: string): Link[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((v) => {
    if (!v || typeof v.href !== 'string') return [];
    try {
      return [
        {
          href: safeUrl(v.href, base),
          title: String(v.title ?? ''),
          type: String(v.type ?? ''),
          rel: Array.isArray(v.rel) ? v.rel.join(' ') : String(v.rel ?? ''),
        },
      ];
    } catch {
      return [];
    }
  });
}
export function parseFeed(text: string, url: string): Feed {
  if (text.trimStart().startsWith('{')) {
    const raw = JSON.parse(text);
    if (
      !raw ||
      !raw.metadata ||
      (!Array.isArray(raw.publications) &&
        !Array.isArray(raw.navigation) &&
        !Array.isArray(raw.groups))
    )
      throw new Error('This is not an OPDS catalogue.');
    const entries: Entry[] = [];
    const visit = (group: any) => {
      for (const p of group.publications ?? []) {
        const authors = Array.isArray(p.metadata?.author)
          ? p.metadata.author
          : [p.metadata?.author];
        entries.push({
          title: String(p.metadata?.title ?? 'Untitled'),
          author: authors
            .filter(Boolean)
            .map((a: any) => (typeof a === 'string' ? a : a.name))
            .join(', '),
          links: links(p.links, url),
        });
      }
      for (const n of group.navigation ?? [])
        entries.push({
          title: String(n.title ?? 'Browse'),
          author: '',
          links: links(
            [{ ...n, type: n.type || 'application/opds+json' }],
            url,
          ),
        });
    };
    visit(raw);
    for (const g of raw.groups ?? []) visit(g);
    return {
      title: String(raw.metadata.title ?? 'Catalogue'),
      entries,
      links: links(raw.links, url),
    };
  }
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (
    doc.querySelector('parsererror') ||
    doc.documentElement.localName !== 'feed'
  )
    throw new Error('This is not a valid OPDS Atom catalogue.');
  const children = (el: Element, name: string) =>
    Array.from(el.children).filter((c) => c.localName === name);
  const val = (el: Element, name: string) =>
    children(el, name)[0]?.textContent?.trim() ?? '';
  function xmlBase(el: Element): string {
    const parent = el.parentElement ? xmlBase(el.parentElement) : url;
    const declared = el.getAttributeNS(
      'http://www.w3.org/XML/1998/namespace',
      'base',
    );
    try {
      return declared ? safeUrl(declared, parent) : parent;
    } catch {
      return parent;
    }
  }
  const readLinks = (el: Element) =>
    children(el, 'link').flatMap((l) =>
      links(
        [
          {
            href: l.getAttribute('href'),
            type: l.getAttribute('type'),
            rel: l.getAttribute('rel'),
            title: l.getAttribute('title'),
          },
        ],
        xmlBase(l),
      ),
    );
  const root = doc.documentElement;
  return {
    title: val(root, 'title') || 'Catalogue',
    links: readLinks(root),
    entries: children(root, 'entry').map((el) => ({
      title: val(el, 'title') || 'Untitled',
      author: children(el, 'author')
        .map((a) => val(a, 'name'))
        .join(', '),
      links: readLinks(el),
    })),
  };
}
function headers(url: string, connection: Connection): Headers {
  const result = new Headers();
  // Credentials never follow a catalogue link to another origin.
  if (
    connection.username &&
    new URL(url).origin === new URL(connection.url).origin
  ) {
    const bytes = new TextEncoder().encode(
      `${connection.username}:${connection.password}`,
    );
    result.set(
      'Authorization',
      `Basic ${btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''))}`,
    );
  }
  return result;
}
export async function fetchLimited(
  url: string,
  connection: Connection,
  limit: number,
  signal?: AbortSignal,
): Promise<{ blob: Blob; type: string; url: string }> {
  url = safeUrl(url);
  if (location.protocol === 'https:' && new URL(url).protocol === 'http:')
    throw new Error(
      'This HTTPS reader needs an HTTPS catalogue. Use the local app for an HTTP server.',
    );
  const idle = new AbortController();
  const combined = signal
    ? AbortSignal.any([signal, idle.signal])
    : idle.signal;
  let timer: ReturnType<typeof setTimeout>;
  const reset = () => {
    clearTimeout(timer);
    timer = setTimeout(() => idle.abort(), 60000);
  };
  reset();
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: headers(url, connection),
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        redirect: 'error',
        signal: combined,
      });
    } catch (error) {
      if (combined.aborted) throw error;
      throw new Error(
        'Cannot reach the catalogue. Check its URL, HTTPS and CORS settings. Redirects are disabled; enter the final feed URL.',
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        response.status === 401 || response.status === 403
          ? 'Catalogue login was rejected. Check your username and password.'
          : `Catalogue returned HTTP ${response.status}.`,
      );
    }
    if (Number(response.headers.get('content-length')) > limit) {
      await response.body?.cancel();
      throw new Error('Download exceeds the size limit.');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('The catalogue returned an empty response.');
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    try {
      for (;;) {
        reset();
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) {
          await reader.cancel();
          throw new Error('Download exceeds the size limit.');
        }
        chunks.push(value as Uint8Array<ArrayBuffer>);
      }
    } finally {
      reader.releaseLock();
    }
    return {
      blob: new Blob(chunks),
      type: response.headers.get('content-type') ?? '',
      url: response.url || url,
    };
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (idle.signal.aborted)
      throw new Error(
        'The catalogue stopped responding for a minute. Try again.',
      );
    throw error;
  } finally {
    clearTimeout(timer!);
  }
}

export async function getFeed(
  url: string,
  connection: Connection,
  signal?: AbortSignal,
): Promise<Feed> {
  const result = await fetchLimited(url, connection, FEED_LIMIT, signal);
  return parseFeed(await result.blob.text(), result.url);
}
export async function getBookFile(
  entry: Entry,
  link: Link,
  connection: Connection,
  signal?: AbortSignal,
): Promise<File> {
  const result = await fetchLimited(
    link.href,
    connection,
    MAX_DOWNLOAD,
    signal,
  );
  const ext =
    /pdf/i.test(link.type) || /\.pdf(?:[?#]|$)/i.test(link.href)
      ? 'pdf'
      : 'epub';
  return new File(
    [result.blob],
    `${entry.title.replace(/[\\/]/g, '-')}.${ext}`,
    { type: result.type },
  );
}

// Passwords stay in memory and are scoped to their exact account and origin.
const sessions = new Map<string, Connection>();
const sessionKey = (url: string, username: string) =>
  new URL(url).origin + '\n' + username;
export function rememberConnection(connection: Connection) {
  sessions.set(sessionKey(connection.url, connection.username), {
    ...connection,
  });
}
export function savedConnection(
  url: string,
  username: string,
): Connection | undefined {
  const session = sessions.get(sessionKey(url, username));
  return session
    ? { ...session, url }
    : username
      ? undefined
      : { url, username: '', password: '' };
}

export function forgetConnection(url: string, username: string) {
  sessions.delete(sessionKey(url, username));
}

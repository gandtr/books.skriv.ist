/** OPDS connections: tokens, credentials and size-limited fetches. */
import { anySignal } from './abort';
import { parseFeed, safeUrl, type Entry, type Feed, type Link } from './feed';
export interface Connection {
  url: string;
  username: string;
  password: string;
  /** An Armarium API token: sent as a Bearer header, never part of a URL. */
  token?: string;
}
export const MAX_DOWNLOAD = 128 * 1024 * 1024;
const FEED_LIMIT = 4 * 1024 * 1024;
const TOKEN_PATH = /^\/opds\/t\/([^/]+)(\/.*)?$/;
/**
 * Armarium accepts its API token in the path (/opds/t/<token>/v1.2/…). A request
 * URL is logged by every proxy on the way, so the token is moved out of it: the
 * plain /opds/… URL and the token, to send as a Bearer header.
 */
export function splitToken(value: string): { url: string; token: string } {
  try {
    const url = new URL(value);
    const match = TOKEN_PATH.exec(url.pathname);
    if (!match || !['http:', 'https:'].includes(url.protocol))
      return { url: value, token: '' };
    url.pathname = '/opds' + (match[2] ?? '');
    let token = match[1];
    try {
      token = decodeURIComponent(token);
    } catch {
      // Not valid percent-encoding: use the token as written.
    }
    return { url: url.href, token };
  } catch {
    return { url: value, token: '' };
  }
}
/**
 * A request with the path token moved into the connection, so the URL fetched,
 * remembered and stored stays plain. Only the connection's own origin is
 * touched: another origin's token path is not ours to strip or reuse.
 */
export function plainRequest(
  target: string,
  connection: Connection,
): { target: string; connection: Connection } {
  const own = splitToken(connection.url);
  const linked =
    new URL(target).origin === new URL(own.url).origin
      ? splitToken(target)
      : { url: target, token: '' };
  const token = connection.token || own.token || linked.token;
  return {
    target: linked.url,
    connection: { ...connection, url: own.url, ...(token ? { token } : {}) },
  };
}
/**
 * Whether a URL carries the token in its path (a /opds/t/<token>/ prefix or any
 * other segment) or in a query value. Such a URL never leaves the origin the
 * token belongs to.
 */
export function carriesToken(href: string, token?: string): boolean {
  if (!token) return false;
  try {
    const url = new URL(href);
    const decode = (part: string) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    };
    return (
      url.pathname
        .split('/')
        .some((part) => part === token || decode(part) === token) ||
      [...url.searchParams.values()].includes(token)
    );
  } catch {
    return false;
  }
}
const leaksToken = (href: string, connection: Connection) =>
  new URL(href).origin !== new URL(connection.url).origin &&
  carriesToken(href, connection.token);
function headers(url: string, connection: Connection): Headers {
  const result = new Headers();
  // Credentials never follow a catalogue link to another origin.
  if (new URL(url).origin !== new URL(connection.url).origin) return result;
  if (connection.token)
    result.set('Authorization', `Bearer ${connection.token}`);
  else if (connection.username) {
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
  const plain = plainRequest(safeUrl(url), connection);
  url = plain.target;
  connection = plain.connection;
  if (leaksToken(url, connection))
    throw new Error(
      'That link would send your pairing token to another server, so it was not opened.',
    );
  if (location.protocol === 'https:' && new URL(url).protocol === 'http:')
    throw new Error(
      'This HTTPS reader needs an HTTPS catalogue. Use the local app for an HTTP server.',
    );
  const idle = new AbortController();
  const combined = signal ? anySignal([signal, idle.signal]) : idle.signal;
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
          ? 'Catalogue login was rejected. Check your username and password, or open the pairing link again.'
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
  const request = plainRequest(safeUrl(url), connection);
  connection = request.connection;
  const result = await fetchLimited(
    request.target,
    connection,
    FEED_LIMIT,
    signal,
  );
  const feed = parseFeed(await result.blob.text(), result.url);
  const origin = new URL(connection.url).origin;
  // A server that keeps the request's token prefix in its links must not get the
  // token back into the URLs we browse, remember or store; a link that would
  // carry the token to another origin is dropped, never shown or stored.
  const plain = (link: Link): Link[] =>
    leaksToken(link.href, connection)
      ? []
      : new URL(link.href).origin === origin
        ? [{ ...link, href: splitToken(link.href).url }]
        : [link];
  return {
    ...feed,
    links: feed.links.flatMap(plain),
    entries: feed.entries.map((entry) => ({
      ...entry,
      links: entry.links.flatMap(plain),
    })),
  };
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

// Passwords stay in memory, scoped to their exact account and origin. A pairing
// token is remembered here too; the saved shelf keeps its own copy on the device.
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

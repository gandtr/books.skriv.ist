import { Inflate, unzipSync, strFromU8 } from 'fflate';
import DOMPurify from 'dompurify';

const MAX_RESOURCE = 24 * 1024 * 1024;
export const MAX_BOOK = 128 * 1024 * 1024;
export interface Section {
  path: string;
  title: string;
}
export interface EpubInfo {
  title: string;
  author: string;
  sections: Section[];
  cover?: Blob;
}
function xml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror') || /<!ENTITY/i.test(text))
    throw new Error('This EPUB contains invalid XML.');
  return doc;
}
// Chapters are XHTML: an HTML parse reads <title/> or <a id="p1"/> as open
// tags and swallows or wraps the rest of the chapter. Files that are not
// well-formed XML (undeclared &nbsp;) or declare entities keep the HTML parse.
function xhtmlBody(text: string): Element | undefined {
  if (/<!ENTITY/i.test(text)) return;
  const doc = new DOMParser().parseFromString(text, 'application/xhtml+xml');
  if (doc.getElementsByTagName('parsererror').length) return;
  const body = doc.getElementsByTagNameNS(
    'http://www.w3.org/1999/xhtml',
    'body',
  )[0];
  if (!body) return;
  // CDATA is text in XHTML, and an HTML document cannot import it.
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_CDATA_SECTION);
  const sections: Node[] = [];
  while (walker.nextNode()) sections.push(walker.currentNode);
  for (const node of sections)
    node.parentNode?.replaceChild(
      doc.createTextNode(node.nodeValue ?? ''),
      node,
    );
  return body;
}
interface ZipEntry {
  method: number;
  start: number;
  size: number;
  originalSize: number;
}
// Where each entry's data starts, read from the central directory the same
// way fflate's unzipSync reads it (open() has already validated it there).
function zipEntries(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => view.getUint16(at, true);
  const u32 = (at: number) => view.getUint32(at, true);
  const u64 = (at: number) => u32(at) + u32(at + 4) * 2 ** 32;
  const MAX = 0xffffffff;
  let end = bytes.length - 22;
  while (u32(end) !== 0x06054b50) end--;
  let count = u16(end + 8),
    at = u32(end + 16);
  if (end >= 20 && u32(end - 20) === 0x07064b50) {
    const zip64 = u32(end - 12);
    if (u32(zip64) === 0x06064b50) {
      count = u32(zip64 + 32);
      at = u32(zip64 + 48);
    }
  }
  const entries = new Map<string, ZipEntry>();
  for (let i = 0; i < count; i++) {
    const nameEnd = at + 46 + u16(at + 28),
      extraEnd = nameEnd + u16(at + 30);
    let size = u32(at + 20),
      originalSize = u32(at + 24),
      offset = u32(at + 42);
    for (let x = nameEnd; x + 4 < extraEnd; x += 4 + u16(x + 2)) {
      if (u16(x) !== 1) continue;
      let field = x + 4;
      if (originalSize === MAX) ((originalSize = u64(field)), (field += 8));
      if (size === MAX) ((size = u64(field)), (field += 8));
      if (offset === MAX) offset = u64(field);
      break;
    }
    entries.set(
      strFromU8(bytes.subarray(at + 46, nameEnd), !(u16(at + 8) & 2048)),
      {
        method: u16(at + 10),
        start: offset + 30 + u16(offset + 26) + u16(offset + 28),
        size,
        originalSize,
      },
    );
    at = extraEnd + u16(at + 32);
  }
  return entries;
}
const TOO_LARGE = 'This EPUB expands beyond the safe size limit.';
// The declared size cannot be trusted: inflate in small slices (deflate
// expands at most ~1032x, so 16 KiB yields at most ~17 MB) and stop as soon
// as the output passes the limit, yielding to the page between megabytes.
async function inflateLimited(
  data: Uint8Array,
  limit: number,
): Promise<Uint8Array> {
  const SLICE = 16 * 1024;
  const chunks: Uint8Array[] = [];
  let total = 0;
  const inflater = new Inflate((chunk) => {
    total += chunk.length;
    if (total <= limit) chunks.push(chunk);
  });
  for (let at = 0; at < data.length; at += SLICE) {
    inflater.push(data.subarray(at, at + SLICE), at + SLICE >= data.length);
    if (total > limit) throw new Error(TOO_LARGE);
    if ((at / SLICE) % 64 === 63) await new Promise((r) => setTimeout(r));
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks)
    out.set(chunk, (offset += chunk.length) - chunk.length);
  return out;
}
function local(doc: Document | Element, name: string): Element[] {
  return Array.from(doc.getElementsByTagNameNS('*', name));
}
export function resolvePath(value: string, base = ''): string {
  if (/^[a-z][a-z\d+.-]*:|^\/\/|\\/i.test(value))
    throw new Error('External book resource blocked.');
  const decoded = value
    .split(/[?#]/)[0]
    .split('/')
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    })
    .join('/');
  const parts = (
    decoded.startsWith('/')
      ? decoded
      : base.slice(0, base.lastIndexOf('/') + 1) + decoded
  ).split('/');
  const result: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!result.length) throw new Error('Invalid EPUB path.');
      result.pop();
    } else result.push(part);
  }
  return result.join('/');
}
export class Epub {
  private constructor(
    private bytes: Uint8Array,
    private entries: Map<string, ZipEntry>,
  ) {}
  info!: EpubInfo;
  private urls = new Map<string, string>();
  private pendingUrls = new Map<string, Promise<string | undefined>>();
  private closed = false;
  static async open(file: Blob | Uint8Array<ArrayBuffer>): Promise<Epub> {
    if ((file instanceof Uint8Array ? file.byteLength : file.size) > MAX_BOOK)
      throw new Error('Choose a book smaller than 128 MB.');
    const bytes =
      file instanceof Uint8Array
        ? file
        : new Uint8Array(await file.arrayBuffer());
    const names = new Set<string>();
    let total = 0;
    unzipSync(bytes, {
      filter: (entry) => {
        if (
          names.size > 10000 ||
          entry.originalSize > MAX_RESOURCE ||
          (total += entry.originalSize) > 512 * 1024 * 1024
        )
          throw new Error(TOO_LARGE);
        names.add(entry.name);
        return false;
      },
    });
    const epub = new Epub(bytes, zipEntries(bytes));
    await epub.metadata();
    return epub;
  }
  async read(path: string): Promise<Uint8Array> {
    const entry = this.entries.get(path);
    if (!entry) throw new Error(`Missing EPUB resource: ${path}`);
    const data = this.bytes.subarray(entry.start, entry.start + entry.size);
    const limit = Math.min(entry.originalSize, MAX_RESOURCE);
    if (entry.method === 0) {
      if (data.length > limit) throw new Error(TOO_LARGE);
      return data.slice();
    }
    if (entry.method !== 8) throw new Error('This EPUB could not be unpacked.');
    try {
      return await inflateLimited(data, limit);
    } catch (e) {
      if ((e as Error).message === TOO_LARGE) throw e;
      throw new Error('This EPUB could not be unpacked.');
    }
  }
  async text(path: string) {
    return strFromU8(await this.read(path));
  }
  resource(path: string): Promise<string | undefined> {
    if (this.closed) return Promise.resolve(undefined);
    let pending = this.pendingUrls.get(path);
    if (!pending) {
      pending = this.createResource(path);
      this.pendingUrls.set(path, pending);
    }
    return pending;
  }
  private async createResource(path: string): Promise<string | undefined> {
    if (this.urls.has(path)) return this.urls.get(path);
    const ext = path.split('.').pop()?.toLowerCase();
    const type = (
      {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        webp: 'image/webp',
        avif: 'image/avif',
      } as Record<string, string>
    )[ext || ''];
    if (!type) return;
    const data = await this.read(path);
    if (this.closed) return;
    const url = URL.createObjectURL(
      new Blob([data as Uint8Array<ArrayBuffer>], { type }),
    );
    this.urls.set(path, url);
    return url;
  }
  private async metadata() {
    const container = xml(await this.text('META-INF/container.xml'));
    const packagePath = resolvePath(
      local(container, 'rootfile')[0]?.getAttribute('full-path') || '',
    );
    if (!packagePath) throw new Error('This EPUB has no reading package.');
    const opf = xml(await this.text(packagePath));
    const items = new Map<
      string,
      { path: string; type: string; properties: string }
    >();
    for (const item of local(opf, 'item')) {
      try {
        items.set(item.getAttribute('id') || '', {
          path: resolvePath(item.getAttribute('href') || '', packagePath),
          type: item.getAttribute('media-type') || '',
          properties: item.getAttribute('properties') || '',
        });
      } catch {
        /* Unsupported external media must not prevent reading the local spine. */
      }
    }
    const sections = local(opf, 'itemref')
      .filter((item) => item.getAttribute('linear') !== 'no')
      .flatMap((ref) => {
        const item = items.get(ref.getAttribute('idref') || '');
        return item && /html/.test(item.type)
          ? [
              {
                path: item.path,
                title: `Chapter ${local(opf, 'itemref').indexOf(ref) + 1}`,
              },
            ]
          : [];
      });
    sections.forEach(
      (section, index) => (section.title = `Chapter ${index + 1}`),
    );
    if (!sections.length)
      throw new Error('This EPUB has no readable chapters.');
    const nav = [...items.values()].find((item) =>
      item.properties.split(/\s+/).includes('nav'),
    );
    const ncx = [...items.values()].find(
      (item) => item.type === 'application/x-dtbncx+xml',
    );
    // A section takes the first title the table of contents gives it; later
    // links to the same file are sub-headings.
    const titled = new Set<Section>();
    const name = (section: Section | undefined, title?: string | null) => {
      if (!section || titled.has(section) || !title?.trim()) return;
      section.title = title.trim();
      titled.add(section);
    };
    try {
      if (nav) {
        const doc = xml(await this.text(nav.path));
        // Only the toc list: landmarks and page-list link the same files.
        const navs = local(doc, 'nav');
        const toc =
          navs.find((el) =>
            (
              el.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ||
              el.getAttribute('epub:type') ||
              ''
            )
              .split(/\s+/)
              .includes('toc'),
          ) ?? navs[0];
        for (const link of local(toc ?? doc, 'a')) {
          const path = resolvePath(link.getAttribute('href') || '', nav.path);
          name(
            sections.find((s) => s.path === path),
            link.textContent,
          );
        }
      } else if (ncx) {
        const doc = xml(await this.text(ncx.path));
        for (const point of local(doc, 'navPoint')) {
          const path = resolvePath(
            local(point, 'content')[0]?.getAttribute('src') || '',
            ncx.path,
          );
          name(
            sections.find((s) => s.path === path),
            local(point, 'text')[0]?.textContent,
          );
        }
      }
    } catch {
      /* The spine remains readable when optional navigation is malformed. */
    }
    const coverId = local(opf, 'meta')
      .find((el) => el.getAttribute('name') === 'cover')
      ?.getAttribute('content');
    const cover =
      [...items.values()].find((item) =>
        item.properties.split(/\s+/).includes('cover-image'),
      ) || (coverId ? items.get(coverId) : undefined);
    this.info = {
      title: local(opf, 'title')[0]?.textContent?.trim() || 'Untitled book',
      author: local(opf, 'creator')
        .map((el) => el.textContent?.trim())
        .filter(Boolean)
        .join(', '),
      sections,
    };
    if (cover && /^image\/(jpeg|png|webp|gif|avif)$/.test(cover.type))
      try {
        this.info.cover = new Blob(
          [(await this.read(cover.path)) as Uint8Array<ArrayBuffer>],
          { type: cover.type },
        );
      } catch {
        /* Optional cover. */
      }
  }
  async chapter(index: number): Promise<DocumentFragment> {
    const section = this.info.sections[index];
    if (!section) throw new Error('Chapter not found.');
    const html = await this.text(section.path);
    const fragment = DOMPurify.sanitize(xhtmlBody(html) ?? html, {
      RETURN_DOM_FRAGMENT: true,
      USE_PROFILES: { html: true },
      FORBID_TAGS: [
        'style',
        'form',
        'input',
        'button',
        'textarea',
        'select',
        'video',
        'audio',
        'source',
        'iframe',
        'object',
        'embed',
        'link',
        'meta',
        'base',
        'map',
        'area',
      ],
      FORBID_ATTR: [
        'style',
        'srcset',
        'background',
        'poster',
        'ping',
        'action',
        'formaction',
        'usemap',
      ],
      ALLOW_DATA_ATTR: false,
    });
    for (const el of Array.from(fragment.querySelectorAll('[src]'))) {
      const src = el.getAttribute('src') || '';
      el.removeAttribute('src');
      if (el.tagName !== 'IMG') continue;
      try {
        const url = await this.resource(resolvePath(src, section.path));
        if (url) el.setAttribute('src', url);
      } catch {
        /* Missing image leaves its alt text. */
      }
    }
    for (const link of Array.from(fragment.querySelectorAll('a'))) {
      const href = link.getAttribute('href') || '';
      link.removeAttribute('href');
      if (/^https?:\/\//i.test(href)) {
        link.setAttribute('href', href);
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
      } else
        try {
          const path = href.startsWith('#')
            ? section.path
            : resolvePath(href, section.path);
          const chapter = this.info.sections.findIndex((s) => s.path === path);
          if (chapter >= 0) {
            link.setAttribute('href', '#');
            link.setAttribute('data-chapter', String(chapter));
            // The reader turns to the element the fragment names (a footnote).
            const hash = href.indexOf('#');
            let anchor = hash >= 0 ? href.slice(hash + 1) : '';
            try {
              anchor = decodeURIComponent(anchor);
            } catch {
              /* Keep the literal fragment. */
            }
            if (anchor) link.setAttribute('data-anchor', anchor);
          }
        } catch {
          /* Unsupported link. */
        }
    }
    return fragment;
  }
  close() {
    this.closed = true;
    this.pendingUrls.clear();
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }
}

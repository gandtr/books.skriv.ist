import { unzip, unzipSync, strFromU8 } from 'fflate';
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
    private names: Set<string>,
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
          throw new Error('This EPUB expands beyond the safe size limit.');
        names.add(entry.name);
        return false;
      },
    });
    const epub = new Epub(bytes, names);
    await epub.metadata();
    return epub;
  }
  async read(path: string): Promise<Uint8Array> {
    if (!this.names.has(path))
      throw new Error(`Missing EPUB resource: ${path}`);
    return new Promise((resolve, reject) =>
      unzip(
        this.bytes,
        { filter: (entry) => entry.name === path },
        (error, files) =>
          error
            ? reject(new Error('This EPUB could not be unpacked.'))
            : resolve(files[path]),
      ),
    );
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
    const items = new Map(
      local(opf, 'item').map((item) => [
        item.getAttribute('id')!,
        {
          path: resolvePath(item.getAttribute('href') || '', packagePath),
          type: item.getAttribute('media-type') || '',
          properties: item.getAttribute('properties') || '',
        },
      ]),
    );
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
    try {
      if (nav) {
        const doc = xml(await this.text(nav.path));
        for (const link of local(doc, 'a')) {
          const path = resolvePath(link.getAttribute('href') || '', nav.path);
          const section = sections.find((s) => s.path === path);
          if (section)
            section.title = link.textContent?.trim() || section.title;
        }
      } else if (ncx) {
        const doc = xml(await this.text(ncx.path));
        for (const point of local(doc, 'navPoint')) {
          const path = resolvePath(
            local(point, 'content')[0]?.getAttribute('src') || '',
            ncx.path,
          );
          const section = sections.find((s) => s.path === path);
          if (section)
            section.title =
              local(point, 'text')[0]?.textContent?.trim() || section.title;
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
    const fragment = DOMPurify.sanitize(html, {
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
      ],
      FORBID_ATTR: [
        'style',
        'srcset',
        'background',
        'poster',
        'ping',
        'action',
        'formaction',
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

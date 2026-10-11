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

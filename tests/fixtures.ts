import { zipSync, strToU8 } from 'fflate';
export function epubFile(
  extra: Record<string, string> = {},
  body = '<h1>A small book</h1><p>A quiet morning. A page turned slowly.</p>',
) {
  const files: Record<string, string> = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml':
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/package.opf"/></rootfiles></container>',
    'OPS/package.opf':
      '<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>A Small Book</dc:title><dc:creator>Skrivist test fixture</dc:creator></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>',
    'OPS/one.xhtml': `<html xmlns="http://www.w3.org/1999/xhtml"><body>${body}</body></html>`,
    'OPS/two.xhtml':
      '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Evening</h1><p>The last page.</p></body></html>',
    'OPS/nav.xhtml':
      '<html xmlns="http://www.w3.org/1999/xhtml"><body><nav><ol><li><a href="one.xhtml">Morning</a></li><li><a href="two.xhtml">Evening</a></li></ol></nav></body></html>',
    ...extra,
  };
  if (extra['$manifest']) {
    files['OPS/package.opf'] = files['OPS/package.opf'].replace(
      '</manifest>',
      extra['$manifest'] + '</manifest>',
    );
    delete files['$manifest'];
  }
  const archive = zipSync(
    Object.fromEntries(
      Object.entries(files).map(([path, text]) => [path, strToU8(text)]),
    ),
  );
  return new File([archive as Uint8Array<ArrayBuffer>], 'small.epub', {
    type: 'application/epub+zip',
  });
}

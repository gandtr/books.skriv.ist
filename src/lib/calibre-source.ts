import { MAX_CALIBRE_DB } from './calibre-db';
export interface CalibreSource {
  name: string;
  snapshot: boolean;
  file: (path: string) => Promise<File>;
}
export function calibrePath(path: string): string[] {
  const parts = path.split('/');
  if (
    parts.some((p) => !p || p === '.' || p === '..' || /[\\\x00-\x1f:]/.test(p))
  )
    throw new Error('The Calibre database contains an unsafe file path.');
  return parts;
}
export function calibreBookPath(path: string, name: string, format: string) {
  if (!['epub', 'pdf'].includes(format))
    throw new Error(
      'Only EPUB and PDF can be read here. Convert other formats in Calibre first.',
    );
  if (calibrePath(name).length !== 1)
    throw new Error('Invalid Calibre book filename.');
  const result = `${path}/${name}.${format}`;
  calibrePath(result);
  return result;
}
export function sourceFromFiles(files: File[]): CalibreSource {
  const root = files
    .find(
      (f) =>
        f.webkitRelativePath.split('/').length === 2 &&
        f.name === 'metadata.db',
    )
    ?.webkitRelativePath.split('/')[0];
  if (!root)
    throw new Error(
      'Select the Calibre library root folder, with metadata.db directly inside it.',
    );
  const lookup = new Map(
    files
      .filter((f) => f.webkitRelativePath.startsWith(root + '/'))
      .map((f) => [f.webkitRelativePath.slice(root.length + 1), f]),
  );
  return {
    name: root,
    snapshot: true,
    file: async (path) => {
      calibrePath(path);
      const file = lookup.get(path);
      if (!file)
        throw new DOMException(
          `File missing from the selected library: ${path}. Reselect the library if Calibre moved or changed it.`,
          'NotFoundError',
        );
      return file;
    },
  };
}
// Only the read methods are exposed; no writable handles or recursive scan.
export interface ReadDirectory {
  name: string;
  getDirectoryHandle(name: string): Promise<ReadDirectory>;
  getFileHandle(name: string): Promise<{ getFile(): Promise<File> }>;
}
export function sourceFromDirectory(root: ReadDirectory): CalibreSource {
  return {
    name: root.name,
    snapshot: false,
    file: async (path) => {
      const parts = calibrePath(path);
      let directory = root;
      for (const part of parts.slice(0, -1))
        directory = await directory.getDirectoryHandle(part);
      return (await directory.getFileHandle(parts[parts.length - 1])).getFile();
    },
  };
}

export async function readCalibreSnapshot(source: CalibreSource) {
  const file = await source.file('metadata.db');
  if (file.size > MAX_CALIBRE_DB)
    throw new Error('Choose a metadata.db smaller than 64 MB.');
  // Browser snapshots cannot replay pending SQLite transactions.
  for (const suffix of ['-wal', '-journal']) {
    let pending: File | undefined;
    try {
      pending = await source.file('metadata.db' + suffix);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'NotFoundError')) throw e;
    }
    if (pending && pending.size > 0)
      throw new Error(
        `Close Calibre so it can finish saving this library, then select the folder again. A pending metadata.db${suffix} file was found.`,
      );
  }
  return file.arrayBuffer();
}

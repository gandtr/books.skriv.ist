export const papers = {
  auto: { label: 'Match theme' },
  white: {
    label: 'White',
    background: '#ffffff',
    ink: '#273831',
    muted: '#657065',
    line: '#d7ddd6',
    accent: '#365941',
    soft: '#edf1ec',
  },
  cream: {
    label: 'Cream',
    background: '#faf7ef',
    ink: '#35382e',
    muted: '#6d705f',
    line: '#dedccd',
    accent: '#4b633b',
    soft: '#eeecdf',
  },
  sepia: {
    label: 'Sepia',
    background: '#eee0c9',
    ink: '#493828',
    muted: '#75604a',
    line: '#d0bfa5',
    accent: '#744b28',
    soft: '#e3d3b9',
  },
  sage: {
    label: 'Sage',
    background: '#e4ebdd',
    ink: '#2b3d30',
    muted: '#586a58',
    line: '#bccbb5',
    accent: '#345b3d',
    soft: '#d4dfcd',
  },
  night: {
    label: 'Night',
    background: '#202621',
    ink: '#e6e7dc',
    muted: '#a1aaa0',
    line: '#3b453c',
    accent: '#b8cca0',
    soft: '#303b30',
  },
} as const;
export type Paper = keyof typeof papers;
export function isPaper(value: string | null): value is Paper {
  return value !== null && Object.hasOwn(papers, value);
}
export function paperStyle(paper: Paper) {
  const p = papers[paper];
  if (!('background' in p)) return '';
  return `--reader:${p.background};--bg:${p.background};--panel:${p.background};--ink:${p.ink};--muted:${p.muted};--line:${p.line};--accent:${p.accent};--soft:${p.soft};color:${p.ink};color-scheme:${paper === 'night' ? 'dark' : 'light'}`;
}
export function pdfPaper(paper: Paper) {
  const p = papers[paper];
  return 'background' in p
    ? { background: p.background, foreground: p.ink }
    : undefined;
}

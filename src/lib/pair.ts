// Pairing links from Armarium: <reader>/#opds=<catalogue URL>. The catalogue URL
// carries an API token, so public/opds-hash.js moves it out of the fragment into
// sessionStorage (or, if storage is denied, a page global) before any other script
// runs; a fragment-only navigation in an open tab still arrives in the fragment.
// Kept identical in books.skriv.ist and comics.skriv.ist.
export type PairWindow = {
  location: Pick<Location, 'hash' | 'pathname' | 'search'>;
  history: Pick<History, 'state' | 'replaceState'>;
  sessionStorage: Pick<Storage, 'getItem' | 'removeItem'>;
  __skrivistOpds?: string;
};

const KEY = 'skrivist.opds';

export function takeOpdsLink(win: PairWindow = window): string {
  try {
    const stored = win.sessionStorage.getItem(KEY);
    if (stored) {
      win.sessionStorage.removeItem(KEY);
      return stored;
    }
  } catch {
    // Storage denied: the scrubber kept the link on the page instead.
  }
  if (win.__skrivistOpds) {
    const kept = win.__skrivistOpds;
    delete win.__skrivistOpds;
    return kept;
  }
  const link = new URLSearchParams(win.location.hash.slice(1)).get('opds');
  if (!link) return '';
  win.history.replaceState(win.history.state, '', win.location.pathname + win.location.search);
  return link;
}

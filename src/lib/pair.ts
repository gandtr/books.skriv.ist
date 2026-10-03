// Pairing links from Armarium: <reader>/#opds=<catalogue URL>. The catalogue URL
// carries an API token, so public/opds-hash.js moves it out of the fragment into
// sessionStorage before any other script runs; a fragment-only navigation in an
// open tab still arrives in the fragment.
export type PairWindow = {
  location: Pick<Location, 'hash' | 'pathname' | 'search'>;
  history: Pick<History, 'state' | 'replaceState'>;
  sessionStorage: Pick<Storage, 'getItem' | 'removeItem'>;
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
    // Storage denied: the scrubber couldn't stash it either, so it is still in the fragment.
  }
  const link = new URLSearchParams(win.location.hash.slice(1)).get('opds');
  if (!link) return '';
  win.history.replaceState(win.history.state, '', win.location.pathname + win.location.search);
  return link;
}

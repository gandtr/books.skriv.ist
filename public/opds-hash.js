// Runs before every other script: moves an Armarium pairing link (#opds=, which
// carries an API token) out of the address bar into sessionStorage, so analytics
// and history never see it. src/lib/pair.ts picks it up. Kept identical in
// books.skriv.ist (public/) and comics.skriv.ist (static/).
(function () {
  try {
    var link = new URLSearchParams(location.hash.slice(1)).get('opds');
    if (!link) return;
    try {
      sessionStorage.setItem('skrivist.opds', link);
    } catch (e) {
      window.__skrivistOpds = link; // storage denied: keep it for this page only
    }
    history.replaceState(history.state, '', location.pathname + location.search);
  } catch (e) {
    // Leave the page alone; the app reads the fragment instead.
  }
})();

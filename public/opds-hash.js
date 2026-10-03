// Runs before every other script: moves an Armarium pairing link (#opds=, which
// carries an API token) out of the address bar into sessionStorage, so analytics
// and history never see it. src/lib/pair.ts picks it up.
(function () {
  try {
    var link = new URLSearchParams(location.hash.slice(1)).get('opds');
    if (!link) return;
    sessionStorage.setItem('skrivist.opds', link);
    history.replaceState(history.state, '', location.pathname + location.search);
  } catch (e) {
    // Leave the page alone; the app reads the fragment instead.
  }
})();

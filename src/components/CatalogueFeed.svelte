<script lang="ts">
  import {
    acquisition,
    navigation,
    type Entry,
    type Feed,
    type Link,
  } from '../lib/feed';
  // One catalogue feed, a page at a time: its entries, its paging links and the
  // actions on them. The connection and the Back history stay with Catalogue.
  let {
    feed,
    feedUrl,
    busy,
    downloading,
    canGoBack,
    onback,
    onsave,
    onread,
    onfollow,
  }: {
    feed: Feed;
    feedUrl: string;
    busy: boolean;
    downloading: string;
    canGoBack: boolean;
    onback: () => void;
    onsave: () => void;
    onread: (entry: Entry, link: Link) => void;
    /** Opens a link of the feed: forward into it (Back returns), or to its previous page. */
    onfollow: (link: Link, forward: boolean) => void;
  } = $props();
  const size = 24;
  let page = $state(0);
  const entries = $derived(feed.entries.slice(page * size, (page + 1) * size));
  const rel = (link: Link, name: string) =>
    link.rel.split(/\s+/).includes(name);
  const next = $derived(feed.links.find((link) => rel(link, 'next')));
  const previous = $derived(
    feed.links.find((link) => rel(link, 'previous') || rel(link, 'prev')),
  );
  function nextPage() {
    if ((page + 1) * size < feed.entries.length) page++;
    else if (next) onfollow(next, true);
  }
  function previousPage() {
    if (page > 0) page--;
    else if (previous) onfollow(previous, false);
  }
</script>

<div class="catalogue-heading">
  <div>
    {#if canGoBack}<button class="quiet" disabled={busy} onclick={onback}
        >← Back</button
      >{/if}
    <h2>{feed.title}</h2>
    <span class="muted"
      >{page * size + 1}–{Math.min((page + 1) * size, feed.entries.length)} of
      {feed.entries.length} entries on this feed</span
    >
  </div>
  <button class="secondary" onclick={onsave}>Save this shelf</button>
</div>
<div class="catalogue-grid" aria-busy={busy}>
  {#each entries as entry, i (feedUrl + ':' + page + ':' + i)}{@const file =
      entry.links.find(acquisition)}{@const folder =
      entry.links.find(navigation)}
    <article class="catalogue-entry">
      <span class="entry-symbol" aria-hidden="true">{file ? '▤' : '↳'}</span>
      <div>
        <h3>{entry.title}</h3>
        <p>
          {entry.author || (file ? 'Ready to fetch' : 'Browse this shelf')}
        </p>
      </div>
      {#if file}<button
          class="secondary"
          disabled={!!downloading || busy}
          onclick={() => onread(entry, file)}
          >{downloading === file.href ? 'Fetching…' : 'Read book'}</button
        >{:else if folder}<button
          class="secondary"
          disabled={busy}
          onclick={() => onfollow(folder, true)}>Browse →</button
        >{:else}<span class="muted">No EPUB or PDF</span>{/if}
    </article>{/each}
</div>
{#if !entries.length}<p class="empty-note">This shelf is empty.</p>{/if}
<nav class="pagination" aria-label="Catalogue pages">
  <button disabled={busy || (!page && !previous)} onclick={previousPage}
    >← Previous</button
  ><span>Page {page + 1}</span><button
    disabled={busy || (!(feed.entries.length > (page + 1) * size) && !next)}
    onclick={nextPage}>Next →</button
  >
</nav>

<script lang="ts">
  import { onMount } from 'svelte';
  import { getCover, type Book } from '../lib/store';
  export let book: Book;
  export let onread: (book: Book) => void;
  export let onstatus: (book: Book) => void;
  export let onremove: (book: Book) => void;
  let cover = '';
  onMount(() => {
    let active = true;
    getCover(book.id)
      .then((blob) => {
        if (blob && active) cover = URL.createObjectURL(blob);
      })
      .catch(() => {});
    return () => {
      active = false;
      if (cover) URL.revokeObjectURL(cover);
    };
  });
</script>

<article class="book-card">
  <button
    class="book-cover"
    class:paper={!cover}
    onclick={() => onread(book)}
    aria-label={`Read ${book.title}`}
  >
    {#if cover}<img src={cover} alt="" loading="lazy" />{:else}<span
        class="cover-rule"
      ></span><span class="cover-title">{book.title}</span><span
        class="cover-author">{book.author || 'Your collection'}</span
      >{/if}
    <span class="format-label">{book.format.toUpperCase()}</span>
    {#if book.status !== 'unread'}<span
        class="cover-progress"
        style={`--progress:${book.status === 'read' ? 100 : book.progress * 100}%`}
      ></span>{/if}
  </button>
  <div class="book-caption">
    <button class="title-button" onclick={() => onread(book)}
      >{book.title}</button
    >
    <p>{book.author || 'Unknown author'}</p>
    <div class="book-actions">
      <button
        class="status-button"
        onclick={() => onstatus(book)}
        title={book.status === 'read' ? 'Mark unread' : 'Mark read'}
        >{book.status === 'read'
          ? '✓ Read'
          : book.status === 'reading'
            ? `${Math.round(book.progress * 100)}% read`
            : 'Unread'}</button
      ><button
        class="quiet"
        aria-label={`Remove ${book.title}`}
        onclick={() => onremove(book)}>Remove</button
      >
    </div>
  </div>
</article>

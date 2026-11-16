<!--
  Desktop only: shows where the library is stored and lets the user move it.
  Hidden where the host reports the folder is not configurable.

  The folder is picked in the host's system dialog, so the page never names a
  path. After a move the page reloads: every record and blob URL in memory
  belongs to the library that was just closed.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { chooseLibraryFolder, libraryLocation, openLibraryFolder, type LibraryLocation } from '../lib/desktop';
  let { disabled = false }: { disabled?: boolean } = $props();
  let place = $state<LibraryLocation | null>(null);
  let busy = $state(false);
  let error = $state('');
  onMount(() => {
    libraryLocation().then((value) => (place = value)).catch((e) => (error = message(e)));
  });
  function message(e: unknown): string {
    return typeof e === 'string' ? e : e instanceof Error ? e.message : 'The library folder could not be changed.';
  }
  async function change() {
    if (busy || disabled) return;
    busy = true;
    error = '';
    try {
      const next = await chooseLibraryFolder();
      if (next && next.path !== place?.path) {
        place = next;
        location.reload();
        return;
      }
    } catch (e) {
      error = message(e);
    }
    busy = false;
  }
</script>
{#if place?.configurable}
  <div class="library-folder">
    <p class="where"><strong>Library folder</strong> <span class="path">{place.path}</span></p>
    <p class="actions">
      <button onclick={change} disabled={busy || disabled}>Change folder…</button>
      <button onclick={() => openLibraryFolder().catch((e) => (error = message(e)))} disabled={busy}>Open folder</button>
    </p>
    {#if busy}<p role="status">Choose a folder in the window that opened. Copying a large library there can take a few minutes.</p>{/if}
    {#if error}<p class="caution" role="alert">{error}</p>{/if}
    {#if place.notice}<p role="status">{place.notice}</p>{/if}
    {#if place.private}<p class="caution">This folder belongs to the app and is removed if the app is uninstalled. Choose another folder to keep your library.</p>{/if}
    {#if place.cloud}<p class="caution">This folder is inside OneDrive. OneDrive can remove files from this device and sync the library while it is in use; a folder outside OneDrive is safer.</p>{/if}
    {#if place.previousPath}<p>An earlier copy of this library remains in {place.previousPath}. It is no longer used and can be deleted.</p>{/if}
    <p>Changing the folder copies your library there, or opens the library already in it. The current folder is left as it is.</p>
  </div>
{/if}
<style>
  .library-folder { font-size: 0.85em; line-height: 1.5; text-align: left; }
  .library-folder p { margin: 0.35em 0; }
  .path { font-family: ui-monospace, Consolas, monospace; overflow-wrap: anywhere; user-select: text; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  button { font: inherit; padding: 4px 10px; border: 1px solid #82919e80; border-radius: 6px; background: transparent; color: inherit; cursor: pointer; }
  button:hover:not(:disabled) { background: #82919e30; }
  button:disabled { opacity: 0.5; cursor: default; }
  .caution { color: #b4532a; }
</style>

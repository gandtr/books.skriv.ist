<script lang="ts">
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  let zoom = $state(1);
  let error = $state('');
  let changes = Promise.resolve();
  const key = 'skrivist.desktop.zoom';
  function apply(value: number) {
    const previous = zoom;
    zoom = Math.min(2, Math.max(0.75, Math.round(value * 100) / 100));
    const requested = zoom;
    changes = changes.then(async () => {
      try {
        await invoke('set_ui_zoom', { scale: requested });
        try { localStorage.setItem(key, String(requested)); } catch { /* Zoom still works if preferences cannot be stored. */ }
        error = '';
      } catch {
        if (zoom === requested) zoom = previous;
        error = 'Could not change the interface zoom.';
      }
    });
  }
  onMount(() => {
    let saved = 1;
    try { saved = Number(localStorage.getItem(key) || '1'); } catch { /* Use the default zoom. */ }
    apply(Number.isFinite(saved) ? saved : 1);
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.key === '+' || event.key === '=') { event.preventDefault(); apply(zoom + 0.1); }
      else if (event.key === '-') { event.preventDefault(); apply(zoom - 0.1); }
      else if (event.key === '0') { event.preventDefault(); apply(1); }
    };
    window.addEventListener('keydown', shortcut, true);
    return () => window.removeEventListener('keydown', shortcut, true);
  });
</script>
<div class="desktop-zoom" role="group" aria-label="Interface zoom" title={error || 'Interface zoom · Ctrl + / − · Ctrl 0 to reset'}>
  <button onclick={() => apply(zoom - 0.1)} disabled={zoom <= 0.75} aria-label="Zoom out">−</button>
  <button class="percentage" onclick={() => apply(1)} aria-label={`Reset zoom (${Math.round(zoom * 100)} percent)`}>{Math.round(zoom * 100)}%</button>
  <button onclick={() => apply(zoom + 0.1)} disabled={zoom >= 2} aria-label="Zoom in">+</button>
  {#if error}<span role="alert">{error}</span>{/if}
</div>
<style>
  .desktop-zoom { position: fixed; right: 12px; bottom: 12px; z-index: 1000; display: flex; align-items: center; gap: 2px; padding: 3px; border: 1px solid #82919e80; border-radius: 8px; background: Canvas; color: CanvasText; box-shadow: 0 2px 8px #0002; font: 14px system-ui, sans-serif; }
  button { padding: 5px 8px; min-width: 30px; border: 0; border-radius: 4px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
  button:hover { background: #82919e30; } button:focus-visible { outline: 2px solid #6a9fc0; } button:disabled { opacity: .4; cursor: default; }
  .percentage { min-width: 50px; font-variant-numeric: tabular-nums; }
  span { position: absolute; right: 0; bottom: 100%; width: 230px; padding: 8px; border-radius: 6px; background: Canvas; color: CanvasText; }
</style>

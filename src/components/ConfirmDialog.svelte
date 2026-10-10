<script lang="ts">
  // In-app confirmation. window.confirm() is unavailable in the macOS desktop
  // app (WKWebView without a dialog delegate returns false), and this matches
  // on every platform. Any close other than the confirm button is a Cancel.
  import { onMount } from 'svelte';
  export let message: string;
  export let confirmLabel: string;
  export let onconfirm: () => void;
  export let oncancel: () => void;
  let dialog: HTMLDialogElement;
  let settled = false;
  function settle(confirmed: boolean) {
    if (settled) return;
    settled = true;
    if (dialog.open) dialog.close();
    (confirmed ? onconfirm : oncancel)();
  }
  onMount(() => dialog.showModal());
</script>

<dialog
  bind:this={dialog}
  class="confirm-dialog"
  aria-labelledby="confirm-message"
  oncancel={(e) => {
    e.preventDefault();
    settle(false);
  }}
  onclose={() => settle(false)}
>
  <p id="confirm-message">{message}</p>
  <div class="confirm-actions">
    <button class="secondary" onclick={() => settle(false)}>Cancel</button>
    <button class="confirm-action" onclick={() => settle(true)}
      >{confirmLabel}</button
    >
  </div>
</dialog>

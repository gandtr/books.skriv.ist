import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('virtual:pwa-register', () => ({ registerSW: () => async () => {} }));

import App from '../src/App.svelte';
import ConfirmDialog from '../src/components/ConfirmDialog.svelte';
import Notes from '../src/components/Notes.svelte';
import { listNotes, saveNote } from '../src/lib/notes';
import { importBook } from '../src/lib/import';
import { listBooks } from '../src/lib/store';
import { epubFile } from './fixtures';

// jsdom has HTMLDialogElement without showModal()/close().
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    if (!this.open) return;
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});

const settle = async () => {
  for (let i = 0; i < 5; i++) await tick();
  await new Promise((r) => setTimeout(r, 20));
};
const dialog = () =>
  document.querySelector<HTMLDialogElement>('dialog.confirm-dialog');
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === label,
  )!;
const confirmButton = () =>
  dialog()!.querySelector<HTMLButtonElement>('.confirm-action')!;
const cancelButton = () =>
  dialog()!.querySelector<HTMLButtonElement>('.secondary')!;

it('confirms once and treats Cancel, Escape and close as Cancel', async () => {
  const onconfirm = vi.fn();
  const oncancel = vi.fn();
  const target = document.createElement('div');
  document.body.append(target);
  let component = mount(ConfirmDialog, {
    target,
    props: { message: 'Remove?', confirmLabel: 'Remove', onconfirm, oncancel },
  });
  flushSync();
  expect(dialog()?.open).toBe(true);
  const confirm = confirmButton();
  confirm.click();
  confirm.click();
  expect(onconfirm).toHaveBeenCalledTimes(1);
  expect(oncancel).not.toHaveBeenCalled();
  unmount(component);

  for (const close of [
    () => cancelButton().click(),
    () => dialog()!.dispatchEvent(new Event('cancel', { cancelable: true })),
    () => dialog()!.close(),
  ]) {
    oncancel.mockClear();
    component = mount(ConfirmDialog, {
      target,
      props: {
        message: 'Remove?',
        confirmLabel: 'Remove',
        onconfirm,
        oncancel,
      },
    });
    flushSync();
    close();
    close();
    expect(oncancel).toHaveBeenCalledTimes(1);
    expect(onconfirm).toHaveBeenCalledTimes(1);
    unmount(component);
  }
  target.remove();
});

it('keeps a book after Escape and removes it only after confirming', async () => {
  // jsdom has no matchMedia. Assigned rather than vi.stubGlobal'd: unstubbing
  // all globals would also drop the File/Blob stubs from tests/setup.ts.
  window.matchMedia = (() => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  const book = await importBook(epubFile());
  const target = document.createElement('div');
  document.body.append(target);
  const app = mount(App, { target });
  await settle();
  const remove = () =>
    target.querySelector<HTMLButtonElement>(
      `button[aria-label="Remove ${book.title}"]`,
    )!;

  remove().click();
  await settle();
  dialog()!.dispatchEvent(new Event('cancel', { cancelable: true }));
  await settle();
  expect(dialog()).toBeNull();
  expect((await listBooks()).map((b) => b.id)).toContain(book.id);

  remove().click();
  await settle();
  confirmButton().click();
  await settle();
  expect((await listBooks()).map((b) => b.id)).not.toContain(book.id);
  unmount(app);
  target.remove();
});

it('keeps a note after Cancel and deletes it only after confirming', async () => {
  const book = await importBook(epubFile());
  await saveNote({
    id: 'n1',
    bookId: book.id,
    quote: 'A passage',
    text: '',
    position: { chapter: 0, fraction: 0, page: 1 },
    section: 'Chapter 1',
    created: 1,
    updated: 1,
  });
  const target = document.createElement('div');
  document.body.append(target);
  const notes = mount(Notes, {
    target,
    props: {
      book,
      capture: () => ({
        position: { chapter: 0, fraction: 0, page: 1 },
        section: '',
        quote: '',
      }),
      jump: () => {},
    },
  }) as unknown as { open: () => Promise<void> };
  await notes.open();
  await settle();

  button('Delete').click();
  await settle();
  cancelButton().click();
  await settle();
  expect((await listNotes(book.id)).map((n) => n.id)).toEqual(['n1']);

  button('Delete').click();
  await settle();
  confirmButton().click();
  await settle();
  expect(await listNotes(book.id)).toEqual([]);
  unmount(notes as never);
  target.remove();
});

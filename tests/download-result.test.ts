import { expect, it, vi } from 'vitest';
import { onDownloadResult } from '../src/lib/desktop';

const result = (detail: unknown) =>
  window.dispatchEvent(new CustomEvent('skrivist-download-result', { detail }));

it('reports the host verdict on the next export once', () => {
  const saved = vi.fn();
  onDownloadResult(saved);
  result({ success: true });
  result({ success: false });
  expect(saved.mock.calls).toEqual([[true]]);
});

it('treats a refused or cancelled save, or a malformed event, as not saved', () => {
  const refused = vi.fn(),
    malformed = vi.fn();
  onDownloadResult(refused);
  result({ success: false });
  onDownloadResult(malformed);
  result(null);
  expect(refused).toHaveBeenCalledWith(false);
  expect(malformed).toHaveBeenCalledWith(false);
});

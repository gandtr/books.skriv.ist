import { afterEach, expect, it, vi } from 'vitest';
import { anySignal } from '../src/lib/abort';

afterEach(() => vi.restoreAllMocks());

const withoutAny = () => {
  const original = AbortSignal.any;
  // WebKit before 17.4 has no AbortSignal.any.
  (AbortSignal as { any?: unknown }).any = undefined;
  return () => ((AbortSignal as { any?: unknown }).any = original);
};

it('aborts when either input aborts, with that reason, without AbortSignal.any', () => {
  const restore = withoutAny();
  try {
    const a = new AbortController(),
      b = new AbortController();
    const combined = anySignal([a.signal, b.signal]);
    expect(combined.aborted).toBe(false);
    b.abort('idle');
    expect(combined.aborted).toBe(true);
    expect(combined.reason).toBe('idle');
    a.abort('later');
    expect(combined.reason).toBe('idle');
  } finally {
    restore();
  }
});

it('is already aborted when an input already is, without AbortSignal.any', () => {
  const restore = withoutAny();
  try {
    const a = new AbortController();
    a.abort('gone');
    const combined = anySignal([a.signal, new AbortController().signal]);
    expect(combined.aborted).toBe(true);
    expect(combined.reason).toBe('gone');
  } finally {
    restore();
  }
});

it('uses AbortSignal.any where the engine has it', () => {
  const spy = vi.spyOn(AbortSignal, 'any');
  const signals = [new AbortController().signal];
  anySignal(signals);
  expect(spy).toHaveBeenCalledWith(signals);
});

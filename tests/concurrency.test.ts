import { describe, expect, it, vi } from 'vitest';
import { mapWithConcurrency, normalizeConcurrency } from '../src/utils/concurrency';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('normalizeConcurrency', () => {
  it('falls back for illegal limits and floors valid ones', () => {
    expect(normalizeConcurrency(undefined, 8)).toBe(8);
    expect(normalizeConcurrency(NaN, 8)).toBe(8);
    expect(normalizeConcurrency(0, 8)).toBe(8);
    expect(normalizeConcurrency(-3, 8)).toBe(8);
    expect(normalizeConcurrency(Infinity, 8)).toBe(8);
    expect(normalizeConcurrency(3.7, 8)).toBe(3);
    expect(normalizeConcurrency(1, 8)).toBe(1);
  });
});

describe('mapWithConcurrency', () => {
  it('preserves input order even when workers resolve out of order', async () => {
    const items = [40, 10, 30, 20];
    const result = await mapWithConcurrency(items, 4, async (ms) => {
      await sleep(ms);
      return ms;
    });
    expect(result).toEqual([40, 10, 30, 20]);
  });

  it('never exceeds the in-flight limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);

    await mapWithConcurrency(items, 3, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await sleep(5);
      inFlight--;
      return null;
    });

    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it('stops starting new items once aborted', async () => {
    const abortSignal = { aborted: false };
    const started: number[] = [];
    const items = Array.from({ length: 50 }, (_, i) => i);

    await mapWithConcurrency(items, 2, async (i) => {
      started.push(i);
      if (i === 1) abortSignal.aborted = true;
      await sleep(2);
      return i;
    }, { abortSignal });

    expect(started.length).toBeLessThan(items.length);
  });

  it('reports monotonic progress ending at items.length', async () => {
    const seen: number[] = [];
    const items = Array.from({ length: 12 }, (_, i) => i);

    await mapWithConcurrency(items, 3, async (i) => i, {
      onProgress: (done) => seen.push(done),
    });

    expect(seen.length).toBe(12);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThan(seen[i - 1]);
    }
    expect(seen[seen.length - 1]).toBe(12);
  });

  it('routes worker errors to onError and keeps the pool running', async () => {
    const onError = vi.fn();
    const items = [1, 2, 3, 4];

    const result = await mapWithConcurrency(items, 2, async (i) => {
      if (i % 2 === 0) throw new Error(`boom-${i}`);
      return i * 10;
    }, { onError });

    expect(result).toEqual([10, undefined, 30, undefined]);
    expect(onError).toHaveBeenCalledTimes(2);
    expect((onError.mock.calls[0][0] as Error).message).toMatch(/^boom-/);
  });

  it('returns an empty array for empty input without invoking the worker', async () => {
    const worker = vi.fn();
    const result = await mapWithConcurrency([], 4, worker as any);
    expect(result).toEqual([]);
    expect(worker).not.toHaveBeenCalled();
  });
});

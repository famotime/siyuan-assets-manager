/**
 * 保序并发池。
 *
 * 与"按批 Promise.all 分块"的区别：分块会让整批阻塞在最慢的一项上，
 * 池化则是每完成一项立刻补入下一项，吞吐不受最慢项拖累。
 */

export interface IConcurrencyOptions<T> {
  /** 中止信号。置位后不再启动新项，已启动的等待收敛 */
  abortSignal?: { aborted: boolean };
  /** 每完成一项回调一次，done 单调递增 */
  onProgress?: (done: number, total: number) => void;
  /**
   * 单项失败时的回调。池本身不吞异常：worker 抛错会转交此回调，
   * 对应位置的结果为 undefined。未提供 onError 时同样不中断池，
   * 但错误将无从记录——调用方应始终提供。
   */
  onError?: (err: unknown, item: T, index: number) => void;
}

/**
 * 把非法并发度规整为可用的正整数。
 * 非法值（undefined / NaN / Infinity / < 1）一律回退到 fallback，
 * 避免把 undefined 直接当池大小导致死锁或零并发。
 */
export function normalizeConcurrency(limit: number | undefined, fallback: number): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 1) {
    return fallback;
  }
  return Math.floor(limit);
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  options: IConcurrencyOptions<T> = {}
): Promise<R[]> {
  const total = items.length;
  const results = new Array<R>(total);
  if (total === 0) return results;

  const poolSize = normalizeConcurrency(limit, 1);
  const { abortSignal, onProgress, onError } = options;

  let cursor = 0;
  let done = 0;

  const runNext = async (): Promise<void> => {
    for (;;) {
      if (abortSignal?.aborted) return;
      const index = cursor++;
      if (index >= total) return;

      try {
        results[index] = await worker(items[index], index);
      } catch (err) {
        results[index] = undefined as unknown as R;
        if (onError) onError(err, items[index], index);
      }

      done++;
      if (onProgress) onProgress(done, total);
    }
  };

  const runners: Array<Promise<void>> = [];
  const runnerCount = Math.min(poolSize, total);
  for (let i = 0; i < runnerCount; i++) {
    runners.push(runNext());
  }
  await Promise.all(runners);

  return results;
}

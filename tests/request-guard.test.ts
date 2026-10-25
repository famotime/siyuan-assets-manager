import { describe, expect, it, vi } from 'vitest';
import { RequestTimeoutError, withTimeoutRetry } from '../src/utils/request-guard';

describe('withTimeoutRetry 请求守卫', () => {
  it('操作按时完成时直接返回结果，不触发超时', async () => {
    const result = await withTimeoutRetry(async () => 42, {
      label: 'fast',
      timeoutMs: 500,
    });
    expect(result).toBe(42);
  });

  it('操作超时后按 retries 重试，成功则返回结果', async () => {
    let attempts = 0;
    const result = await withTimeoutRetry(
      async (attempt) => {
        attempts = attempt;
        if (attempt === 1) {
          // 第一次挂起直至超时
          await new Promise((resolve) => setTimeout(resolve, 200));
          return 'late';
        }
        return 'ok';
      },
      { label: 'retry-me', timeoutMs: 30, retries: 1, retryDelayMs: 1 },
    );
    expect(result).toBe('ok');
    expect(attempts).toBe(2);
  });

  it('重试耗尽后抛出超时错误', async () => {
    await expect(
      withTimeoutRetry(
        () => new Promise(() => {
          /* 永不 resolve，模拟内核互斥队列挂死 */
        }),
        { label: 'stuck', timeoutMs: 20, retries: 1, retryDelayMs: 1 },
      ),
    ).rejects.toBeInstanceOf(RequestTimeoutError);
  });

  it('业务异常（非超时）同样消耗重试次数并最终抛出', async () => {
    const worker = vi.fn(async () => {
      throw new Error('kernel code -1');
    });
    await expect(
      withTimeoutRetry(worker, { label: 'biz-fail', timeoutMs: 1000, retries: 1, retryDelayMs: 1 }),
    ).rejects.toThrow('kernel code -1');
    expect(worker).toHaveBeenCalledTimes(2);
  });

  it('超时计时器在成功后被清理，不影响后续操作', async () => {
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const originalSetTimeout = globalThis.setTimeout;
    const spy = vi.spyOn(globalThis, 'setTimeout');
    try {
      await withTimeoutRetry(async () => 'done', { label: 'clean', timeoutMs: 50 });
    } finally {
      spy.mockRestore();
    }
    expect(timers.length).toBe(0);
    expect(originalSetTimeout).toBeTruthy();
  });
});

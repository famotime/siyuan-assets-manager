/**
 * 内核请求超时与重试守卫。
 *
 * 背景：`fetchSyncPost` 没有任何超时机制；内核侧 `/api/file/readDir` 这类
 * 非 get/list/search 开头的接口还共用一把按路径互斥锁（ControlConcurrency），
 * 一旦有大目录枚举在跑，后续同路径请求会无限排队。守卫保证插件永远不会
 * 在单个请求上永久挂起，超时后可重试或向 UI 上抛可感知的错误。
 */

export class RequestTimeoutError extends Error {
  constructor(
    public readonly label: string,
    public readonly timeoutMs: number,
    public readonly attempt: number,
  ) {
    super(`[${label}] 第 ${attempt} 次请求超过 ${timeoutMs}ms 未响应`);
    this.name = 'RequestTimeoutError';
  }
}

export interface RequestGuardOptions {
  /** 请求标识，用于错误信息与日志定位 */
  label: string;
  /** 单次尝试的超时毫秒数（应大于该请求在大工作空间上的合法耗时） */
  timeoutMs: number;
  /** 超时/失败后的重试次数，0 表示不重试 */
  retries?: number;
  /** 两次尝试之间的退避毫秒数 */
  retryDelayMs?: number;
}

const DEFAULT_RETRY_DELAY_MS = 1000;

/**
 * 为一次可能永久挂起的异步操作加超时与重试。
 *
 * 注意：底层 fetch 无法被中止（fetchSyncPost 未暴露 signal），
 * 超时只是"不再等待"，原请求仍可能在后台完成并被内核处理。
 * 因此重试应配合足够的超时与退避，避免在内核互斥队列里堆积过多请求。
 */
export async function withTimeoutRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RequestGuardOptions,
): Promise<T> {
  const retries = Math.max(0, options.retries ?? 0);
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        operation(attempt),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new RequestTimeoutError(options.label, options.timeoutMs, attempt)),
            options.timeoutMs,
          );
        }),
      ]);
      return result;
    } catch (err) {
      lastError = err;
      if (attempt > retries) break;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

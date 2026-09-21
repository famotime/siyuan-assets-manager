# 去重扫描增量更新与并发化 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为去重比对扫描加入 per-asset 指纹复用（增量）与两阶段并发化，使 10000+ 图片场景下的重复扫描近乎瞬时、首次扫描显著加速，且不产生错误的去重结论。

**Architecture:** 新增两个互不耦合的工具模块——`concurrency.ts`（保序并发池）与 `dedup-fingerprint-store.ts`（指纹的加载/校验/裁剪/落盘）——再把它们接入 `scanDuplicates` 的三阶段流水线。指纹以 `size + updated` 双判失效，`score` 每次重算绝不复用。分组 id 由位置生成改为内容派生，使「已忽略/已处理」真正跨扫描生效。并发度经 options 传入，由设置项在运行时配置。

**Tech Stack:** TypeScript、Vue 3 SFC、Vitest（jsdom）、思源插件 API（`plugin.saveData` / `loadData` / `removeData`）

**Spec:** [`docs/superpowers/specs/2026-09-21-dedup-incremental-scan-design.md`](../specs/2026-09-21-dedup-incremental-scan-design.md)

## Global Constraints

- **测试命令**：`npm test`（= `vitest run`，跑全部套件）；单文件 `npx vitest run tests/<file>.test.ts`
- **测试环境**：jsdom，`siyuan` 已被 `vitest.config.ts` 别名到 `tests/mocks/siyuan.ts`。jsdom 下 `Image` 未定义，故 `computeImageDHash` 会立即返回 `null` —— 阶段三的测试须 mock `computeImageDHash` 或直接构造指纹入参
- **构建格式**：CommonJS（`lib: { formats: ["cjs"] }`），`siyuan` 与 `process` 外部化
- **Test-First**：本项目规约要求先补测试再改 `src/utils/` 业务逻辑。每个任务的 Step 顺序都遵循"写失败测试 → 跑失败 → 实现 → 跑通过"
- **模块边界**：`src/utils/**` 禁止 `import` 指向 Vue 应用根模块（`../main` / `@/main`），由 `tests/module-boundaries.test.ts` 强制。新增的 `concurrency.ts` 与 `dedup-fingerprint-store.ts` 都不得违反
- **`deduplicate.ts` 不得读取设置**：它只认入参。设置由对话框读取后经 `options.concurrency` 传入（spec §4.3.1）
- **i18n**：用户可见文案须同步维护 `src/i18n/zh_CN.json` 与 `src/i18n/en_US.json`
- **分支**：执行前先建分支 `feat/dedup-incremental-scan`（当前在 `master`）
- **不改动**：聚类算法（O(n²) 保留）、`asset-catalog.ts` 的 50 一批分块写法
- **版本号命名空间**：分组缓存 → `2`；指纹文件 → `1`（新引入，从 1 起）。二者独立判废

---

## 文件结构

| 类型 | 路径 | 职责 |
|---|---|---|
| 新增 | `src/utils/concurrency.ts` | 保序并发池。不感知业务，可被任何模块复用 |
| 新增 | `src/utils/dedup-fingerprint-store.ts` | 指纹的持久化与校验。不感知扫描流水线 |
| 修改 | `src/utils/deduplicate.ts` | `scanDuplicates` 接入增量与并发；`deriveGroupId`；缓存 version 2 |
| 修改 | `src/utils/storage/http-adapter.ts` | `stat()` 的 `updated` 伪值改为 `0` |
| 修改 | `src/components/DeduplicateDialog.vue` | 增量默认、重建索引入口、进度文案、读设置传 options |
| 修改 | `src/index.ts` | `settings` 两个并发度字段 + 载入兜底 + 两个设置项 |
| 修改 | `src/i18n/zh_CN.json`、`src/i18n/en_US.json` | 4 条设置项文案 |
| 修改 | `tests/deduplicate.test.ts` | 扩展：增量正确性、score 重算、组身份、缓存版本 |
| 修改 | `tests/settings.test.ts` | 设置项数量 5 → 7 |
| 新增 | `tests/concurrency.test.ts` | 并发池契约 |
| 新增 | `tests/dedup-fingerprint-store.test.ts` | 失效判据、裁剪、存取 |

任务顺序按依赖排列：Task 1–2 建两个独立模块（互相无依赖），Task 3–6 逐层改造扫描器，Task 7–8 接 UI，Task 9 收尾。

---

### Task 1: 并发池工具

**Files:**
- Create: `src/utils/concurrency.ts`
- Test: `tests/concurrency.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `normalizeConcurrency(limit: number | undefined, fallback: number): number`
  - `mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>, options?: IConcurrencyOptions<T>): Promise<R[]>`
  - `interface IConcurrencyOptions<T> { abortSignal?: { aborted: boolean }; onProgress?: (done: number, total: number) => void; onError?: (err: unknown, item: T, index: number) => void }` —— 泛型参数 `T` 是必要的，`onError` 需要回传出错的原始项

**关键契约（spec §4.3）：** 保序返回；在飞数 ≤ `limit`；每项开始前检查 `abortSignal.aborted`；进度单调递增。

- [ ] **Step 1: 写失败测试**

创建 `tests/concurrency.test.ts`：

```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/concurrency.test.ts`
Expected: FAIL —— `Failed to resolve import "../src/utils/concurrency"`

- [ ] **Step 3: 实现**

创建 `src/utils/concurrency.ts`：

```ts
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/concurrency.test.ts`
Expected: PASS，7 个用例全绿（`normalizeConcurrency` 1 个 + `mapWithConcurrency` 6 个）

- [ ] **Step 5: 跑全量测试确认无回归**

Run: `npm test`
Expected: PASS（本任务只新增文件，不应影响既有套件）

- [ ] **Step 6: 提交**

```bash
git add src/utils/concurrency.ts tests/concurrency.test.ts
git commit -m "feat(utils): add order-preserving concurrency pool"
```

---

### Task 2: 指纹存储模块

**Files:**
- Create: `src/utils/dedup-fingerprint-store.ts`
- Test: `tests/dedup-fingerprint-store.test.ts`

**Interfaces:**
- Consumes: `usePlugin` from `./plugin-context`（已存在）；`AssetInfo` type from `./siyuan-db`（type-only import）
- Produces:
  - `FINGERPRINT_STORE_FILE: string` = `'deduplicate-fingerprints.json'`
  - `FINGERPRINT_STORE_VERSION: number` = `1`
  - `interface IAssetFingerprint { size: number; updated: number; sha256?: string; dHash?: string; width?: number; height?: number }`
  - `interface IFingerprintStore { version: number; entries: Record<string, IAssetFingerprint> }`
  - `createEmptyFingerprintStore(): IFingerprintStore`
  - `isFingerprintValid(entry: IAssetFingerprint | undefined, asset: AssetInfo): boolean`
  - `pruneFingerprintStore(store: IFingerprintStore, liveAssetNames: Set<string>): number`
  - `countFingerprintEntries(store: IFingerprintStore): number`
  - `loadFingerprintStore(): Promise<IFingerprintStore>`
  - `saveFingerprintStore(store: IFingerprintStore): Promise<boolean>`
  - `clearFingerprintStore(): Promise<boolean>`

**关键契约（spec §2.1 / §3.1）：** 失效判据 = `size` 相等 且 `updated` 相等 且 `updated > 0`。**指纹只走 `plugin.saveData`，绝不写 localStorage**（避免 1.5–3MB 顶爆 5MB 配额）。

- [ ] **Step 1: 写失败测试**

创建 `tests/dedup-fingerprint-store.test.ts`：

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlugin } from '../src/utils/plugin-context';
import {
  FINGERPRINT_STORE_FILE,
  FINGERPRINT_STORE_VERSION,
  createEmptyFingerprintStore,
  isFingerprintValid,
  pruneFingerprintStore,
  countFingerprintEntries,
  loadFingerprintStore,
  saveFingerprintStore,
  clearFingerprintStore,
} from '../src/utils/dedup-fingerprint-store';
import type { AssetInfo } from '../src/utils/siyuan-db';

function makeAsset(name: string, size: number, updated: number): AssetInfo {
  return {
    name,
    size,
    updated,
    isDir: false,
    references: [],
    refCount: 0,
    docCount: 0,
    isReEditable: false,
    isOriginal: false,
  };
}

describe('isFingerprintValid', () => {
  const asset = makeAsset('a.png', 1024, 1700000000000);

  it('accepts an entry matching both size and updated', () => {
    expect(isFingerprintValid({ size: 1024, updated: 1700000000000 }, asset)).toBe(true);
  });

  it('rejects when the entry is missing', () => {
    expect(isFingerprintValid(undefined, asset)).toBe(false);
  });

  it('rejects when size changed', () => {
    expect(isFingerprintValid({ size: 2048, updated: 1700000000000 }, asset)).toBe(false);
  });

  it('rejects when updated changed', () => {
    expect(isFingerprintValid({ size: 1024, updated: 1700000000001 }, asset)).toBe(false);
  });

  it('rejects when updated is not a positive timestamp', () => {
    // HTTP 回退路径可能给出 0（见 http-adapter 的 stat 实现）——语义为"未知"，必须判失效
    expect(isFingerprintValid({ size: 1024, updated: 0 }, makeAsset('a.png', 1024, 0))).toBe(false);
  });
});

describe('pruneFingerprintStore', () => {
  it('drops entries whose asset is no longer present and reports the count', () => {
    const store = createEmptyFingerprintStore();
    store.entries['a.png'] = { size: 1, updated: 1 };
    store.entries['b.png'] = { size: 2, updated: 2 };
    store.entries['gone.png'] = { size: 3, updated: 3 };

    const removed = pruneFingerprintStore(store, new Set(['a.png', 'b.png']));

    expect(removed).toBe(1);
    expect(countFingerprintEntries(store)).toBe(2);
    expect(store.entries['gone.png']).toBeUndefined();
  });

  it('is a no-op when everything is live', () => {
    const store = createEmptyFingerprintStore();
    store.entries['a.png'] = { size: 1, updated: 1 };
    expect(pruneFingerprintStore(store, new Set(['a.png']))).toBe(0);
  });
});

describe('fingerprint store persistence', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('round-trips through plugin.saveData / loadData', async () => {
    const store = new Map<string, any>();
    usePlugin({
      saveData: vi.fn(async (file: string, data: any) => { store.set(file, data); }),
      loadData: vi.fn(async (file: string) => store.get(file) ?? null),
      removeData: vi.fn(async (file: string) => { store.delete(file); }),
    } as any);

    const fp = createEmptyFingerprintStore();
    fp.entries['a.png'] = { size: 1024, updated: 1700000000000, sha256: 'deadbeef', dHash: '0101', width: 9, height: 8 };

    expect(await saveFingerprintStore(fp)).toBe(true);
    expect(store.has(FINGERPRINT_STORE_FILE)).toBe(true);

    const loaded = await loadFingerprintStore();
    expect(loaded.version).toBe(FINGERPRINT_STORE_VERSION);
    expect(loaded.entries['a.png'].sha256).toBe('deadbeef');
    expect(loaded.entries['a.png'].dHash).toBe('0101');
  });

  it('returns an empty store when the stored version does not match', async () => {
    usePlugin({
      loadData: vi.fn(async () => ({ version: 999, entries: { 'a.png': { size: 1, updated: 1 } } })),
      saveData: vi.fn(),
      removeData: vi.fn(),
    } as any);

    const loaded = await loadFingerprintStore();
    expect(loaded.version).toBe(FINGERPRINT_STORE_VERSION);
    expect(countFingerprintEntries(loaded)).toBe(0);
  });

  it('returns an empty store when loadData throws', async () => {
    usePlugin({
      loadData: vi.fn(async () => { throw new Error('nope'); }),
      saveData: vi.fn(),
      removeData: vi.fn(),
    } as any);

    expect(countFingerprintEntries(await loadFingerprintStore())).toBe(0);
  });

  it('clears the persisted file via removeData', async () => {
    const removeData = vi.fn(async () => {});
    usePlugin({ loadData: vi.fn(), saveData: vi.fn(), removeData } as any);

    expect(await clearFingerprintStore()).toBe(true);
    expect(removeData).toHaveBeenCalledWith(FINGERPRINT_STORE_FILE);
  });

  it('never falls back to localStorage when plugin.saveData is unavailable', async () => {
    // 指纹规模是 O(全部资源)，10000 条约 1.5–3MB，写入 5MB 上限的 localStorage
    // 会顶爆配额并连带破坏分组缓存。故此处刻意不设兜底。
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    usePlugin({ loadData: vi.fn() } as any);

    const ok = await saveFingerprintStore(createEmptyFingerprintStore());

    expect(ok).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/dedup-fingerprint-store.test.ts`
Expected: FAIL —— `Failed to resolve import "../src/utils/dedup-fingerprint-store"`

- [ ] **Step 3: 实现**

创建 `src/utils/dedup-fingerprint-store.ts`：

```ts
import type { AssetInfo } from './siyuan-db';
import { usePlugin } from './plugin-context';
import { warn } from './logger';

/**
 * 去重扫描的文件指纹持久化。
 *
 * 独立于 deduplicate-cache.json：指纹规模是 O(全部资源)（10000 条约 1.5–3MB），
 * 而分组结果只含重复项。二者混存会让 localStorage 兜底路径顶爆 5MB 配额。
 */

export const FINGERPRINT_STORE_FILE = 'deduplicate-fingerprints.json';
export const FINGERPRINT_STORE_VERSION = 1;

export interface IAssetFingerprint {
  size: number;
  updated: number;
  /** 精确内容哈希。仅"按 size 分桶后冲突"的候选需要 */
  sha256?: string;
  /** 64 位感知哈希。仅图片需要 */
  dHash?: string;
  width?: number;
  height?: number;
}

export interface IFingerprintStore {
  version: number;
  entries: Record<string, IAssetFingerprint>;
}

export function createEmptyFingerprintStore(): IFingerprintStore {
  return { version: FINGERPRINT_STORE_VERSION, entries: {} };
}

/**
 * 条目是否可复用。
 *
 * 双判 (size + updated) 而非单判：只看 size 会漏掉"同字节数的重新编辑图"，
 * 可能被误判为重复进而误删；只看 updated 会在 mtime 不可信时全线失效。
 * 双判偏保守，失败方向安全——多算一次，不会少算。
 *
 * updated 必须是正数：0 的语义是"未知"（HTTP 回退路径拿不到 last-modified 时即如此），
 * 未知即不可复用。
 */
export function isFingerprintValid(
  entry: IAssetFingerprint | undefined,
  asset: AssetInfo
): boolean {
  if (!entry) return false;
  if (!(entry.updated > 0)) return false;
  return entry.size === asset.size && entry.updated === asset.updated;
}

/** 丢弃已删除/已重命名文件的条目，返回裁剪条数 */
export function pruneFingerprintStore(
  store: IFingerprintStore,
  liveAssetNames: Set<string>
): number {
  let removed = 0;
  for (const name of Object.keys(store.entries)) {
    if (!liveAssetNames.has(name)) {
      delete store.entries[name];
      removed++;
    }
  }
  return removed;
}

export function countFingerprintEntries(store: IFingerprintStore): number {
  return Object.keys(store.entries).length;
}

export async function loadFingerprintStore(): Promise<IFingerprintStore> {
  try {
    const plugin = usePlugin();
    if (plugin && typeof plugin.loadData === 'function') {
      const data = await plugin.loadData(FINGERPRINT_STORE_FILE);
      if (data) {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        if (
          parsed &&
          parsed.version === FINGERPRINT_STORE_VERSION &&
          parsed.entries &&
          typeof parsed.entries === 'object'
        ) {
          return { version: FINGERPRINT_STORE_VERSION, entries: parsed.entries };
        }
      }
    }
  } catch (e) {
    warn('[dedup-fingerprint-store] 加载指纹缓存失败:', e);
  }
  return createEmptyFingerprintStore();
}

/**
 * 落盘。仅走 plugin.saveData，**不设 localStorage 兜底**。
 * 拿不到 plugin 时退化为纯内存（本次会话内有效），宁可无持久化也不写爆配额。
 */
export async function saveFingerprintStore(store: IFingerprintStore): Promise<boolean> {
  try {
    const plugin = usePlugin();
    if (plugin && typeof plugin.saveData === 'function') {
      await plugin.saveData(FINGERPRINT_STORE_FILE, store);
      return true;
    }
  } catch (e) {
    warn('[dedup-fingerprint-store] 保存指纹缓存失败:', e);
  }
  return false;
}

export async function clearFingerprintStore(): Promise<boolean> {
  try {
    const plugin = usePlugin();
    if (plugin && typeof plugin.removeData === 'function') {
      await plugin.removeData(FINGERPRINT_STORE_FILE);
      return true;
    }
  } catch (e) {}
  return false;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/dedup-fingerprint-store.test.ts`
Expected: PASS，12 个用例全绿（`isFingerprintValid` 5 个 + `pruneFingerprintStore` 2 个 + 持久化 5 个）

- [ ] **Step 5: 验证模块边界未被破坏**

Run: `npx vitest run tests/module-boundaries.test.ts`
Expected: PASS（新模块只导入 `plugin-context` / `siyuan-db` / `logger`，未触碰 `main`）

- [ ] **Step 6: 提交**

```bash
git add src/utils/dedup-fingerprint-store.ts tests/dedup-fingerprint-store.test.ts
git commit -m "feat(dedup): add per-asset fingerprint store"
```

---

### Task 3: 修复 `updated` 被伪造成当前时间

**Files:**
- Modify: `src/utils/storage/http-adapter.ts:18`
- Test: `tests/storage.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `HttpStorageAdapter.stat()` 在响应缺 `last-modified` 时返回 `updated: 0`（语义 = 未知），不再返回 `Date.now()`

**为何必须改（spec §3.2）：** 返回 `Date.now()` 时每次扫描该值都不同，条目必然失配 → 增量静默退化为全量，且用户看到"复用 0 个指纹"却无从排查。这不是正确性缺陷（方向安全），是**可诊断性**缺陷。改为 `0` 后，配合 `isFingerprintValid` 的 `updated > 0` 判据即为确定性行为。

- [ ] **Step 1: 写失败测试**

在 `tests/storage.test.ts` 中，紧跟既有的 `describe('HttpStorageAdapter trash support', ...)` 块之后插入：

```ts
  describe('HttpStorageAdapter stat timestamp honesty', () => {
    it('reports updated as 0 when last-modified is absent, instead of Date.now()', async () => {
      const { HttpStorageAdapter } = await import('../src/utils/storage/http-adapter');
      const adapter = new HttpStorageAdapter();

      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        headers: {
          get: (key: string) => (key === 'content-length' ? '2048' : null),
        },
      })));

      const stat = await adapter.stat('/data/assets/a.png');

      expect(stat).not.toBeNull();
      expect(stat!.size).toBe(2048);
      // 未知时间戳必须是 0，绝不能是当前时间——后者的语义是"刚刚改过"，
      // 会让依赖 mtime 做失效判定的增量缓存每次必然失配。
      expect(stat!.updated).toBe(0);

      vi.unstubAllGlobals();
    });

    it('parses last-modified into a real timestamp when present', async () => {
      const { HttpStorageAdapter } = await import('../src/utils/storage/http-adapter');
      const adapter = new HttpStorageAdapter();

      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        headers: {
          get: (key: string) => {
            if (key === 'content-length') return '2048';
            if (key === 'last-modified') return 'Tue, 14 Nov 2023 22:13:20 GMT';
            return null;
          },
        },
      })));

      const stat = await adapter.stat('/data/assets/a.png');

      expect(stat!.updated).toBe(Date.parse('Tue, 14 Nov 2023 22:13:20 GMT'));

      vi.unstubAllGlobals();
    });
  });
```

若 `tests/storage.test.ts` 顶部尚未导入 `vi`，把首行 import 补成 `import { describe, expect, it, vi } from 'vitest';`。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/storage.test.ts`
Expected: FAIL —— 第一个用例 `expected 1758... to be 0`（当前实现返回 `Date.now()`）

- [ ] **Step 3: 实现**

把 `src/utils/storage/http-adapter.ts:16-20` 改为：

```ts
      return {
        size: contentLength ? parseInt(contentLength, 10) : 0,
        // 缺 last-modified 时返回 0（语义 = 未知），而非 Date.now()。
        // Date.now() 谎称"刚刚修改过"，会让依赖 mtime 的失效判定每次必然失配，
        // 使增量扫描静默退化为全量且无从排查。
        updated: lastModified ? Date.parse(lastModified) || 0 : 0,
        isDir: false,
      };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/storage.test.ts`
Expected: PASS（含新增 2 例与既有全部用例）

- [ ] **Step 5: 确认既有消费点不受影响**

Run: `npm test`
Expected: PASS。`updated = 0` 的三个消费点均已自洽：`siyuan-db.ts:258` 仅在 `statAsset` 成功时覆盖；`asset-catalog.ts:354` 的 `if (!asset.updated)` 保留 0 而非写入；`scoreAssetCandidate` 有 `if (asset.updated)` 守卫

- [ ] **Step 6: 提交**

```bash
git add src/utils/storage/http-adapter.ts tests/storage.test.ts
git commit -m "fix(storage): report unknown mtime as 0 instead of Date.now()"
```

---

### Task 4: 分组身份改为内容派生 + 缓存版本升 2

**Files:**
- Modify: `src/utils/deduplicate.ts`（新增 `deriveGroupId` 与 `fnv1a32`；`DEDUP_CACHE_VERSION`；`IDeduplicateCache.version` 语义；`loadDeduplicateCache` 版本校验；两处 `id:` 赋值）
- Test: `tests/deduplicate.test.ts`

**Interfaces:**
- Consumes: `IDuplicateItem`（已存在）
- Produces:
  - `deriveGroupId(mode: DeduplicateMode, items: IDuplicateItem[]): string` —— 返回形如 `exact_7f3a91c2`
  - `DEDUP_CACHE_VERSION: number` = `2`

**为何要改（spec §5）：** 位置 id（`exact_${idx++}`）在增量下每次扫描都会漂移，用户忽略的 `exact_3` 下次可能指向完全无关的一组，「已忽略」实际不可靠。

**注意：本任务会打破既有测试。** `tests/deduplicate.test.ts:441` 的往返用例当前写入 `version: 1` 并期望加载成功——这正是本任务要反转的行为，须一并更新。

- [ ] **Step 1: 写失败测试**

在 `tests/deduplicate.test.ts` 的 import 列表中追加 `deriveGroupId`（与 `DEDUP_CACHE_VERSION`），然后在 `describe('deduplicate persistence cache', ...)` 之前插入新的 describe：

```ts
  describe('deriveGroupId', () => {
    const mk = (names: string[]): IDuplicateItem[] =>
      names.map((name) => ({
        asset: makeAsset(name, 100),
        score: 0,
        isCanonical: false,
      }));

    it('is independent of member order', () => {
      const a = deriveGroupId('exact', mk(['a.png', 'b.png', 'c.png']));
      const b = deriveGroupId('exact', mk(['c.png', 'a.png', 'b.png']));
      expect(a).toBe(b);
    });

    it('differs when the member set changes', () => {
      const a = deriveGroupId('exact', mk(['a.png', 'b.png']));
      const b = deriveGroupId('exact', mk(['a.png', 'b.png', 'c.png']));
      expect(a).not.toBe(b);
    });

    it('differs across modes for the same members', () => {
      const items = mk(['a.png', 'b.png']);
      expect(deriveGroupId('exact', items)).not.toBe(deriveGroupId('similar', items));
    });

    it('is prefixed by mode and stable in format', () => {
      const id = deriveGroupId('similar', mk(['a.png', 'b.png']));
      expect(id).toMatch(/^similar_[0-9a-f]{8}$/);
    });
  });
```

**先解决一个测试隔离问题。** `usePlugin(...)` 设置的是模块级单例，且**无法重置为 null**（`plugin-context.ts` 的 `if (pluginProps)` 守卫使 `usePlugin(null)` 变成空操作）。既有往返用例（`:439`）目前依赖"plugin 为 null → 走 localStorage 兜底"这条路径；一旦文件里前面任何用例设过 plugin，该用例就会静默改走 plugin 路径——测试仍会通过，但它实际断言的东西变了。

因此在 `describe('deduplicate persistence cache', ...)` 开头加显式 `beforeEach`，让该 describe 内所有用例都跑在受控的 plugin 上、且与顺序无关：

```ts
  describe('deduplicate persistence cache', () => {
    let pluginStore: Map<string, any>;

    beforeEach(() => {
      pluginStore = new Map<string, any>();
      pluginContext.usePlugin({
        saveData: async (file: string, data: any) => { pluginStore.set(file, data); },
        loadData: async (file: string) => pluginStore.get(file) ?? null,
        removeData: async (file: string) => { pluginStore.delete(file); },
      } as any);
    });
```

并在 `tests/deduplicate.test.ts` 顶部加入 `import * as pluginContext from '../src/utils/plugin-context';`

随后把既有往返用例的 `version: 1` 改成 `version: DEDUP_CACHE_VERSION`，并追加一个版本不匹配用例（不再需要动态 import）：

```ts
    it('rejects a cache written by an older schema version', async () => {
      await saveDeduplicateCache({
        version: 1,
        lastScanTime: 1700000000000,
        similarityThreshold: 95,
        exactGroups: [],
        similarGroups: [],
      } as any);

      // v1 缓存直接丢弃：本版本不迁移 isIgnored/isProcessed
      expect(await loadDeduplicateCache()).toBeNull();
    });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/deduplicate.test.ts`
Expected: FAIL —— `deriveGroupId is not a function`；版本用例失败（当前 `loadDeduplicateCache` 不校验 `version`）

- [ ] **Step 3: 实现**

在 `src/utils/deduplicate.ts` 的 `pickCanonicalAsset` 之后插入：

```ts
/**
 * FNV-1a 32 位哈希，输出 8 位十六进制。
 * 不复用 computeFileHash：后者是 async 且面向 Blob，此处只需同步纯函数。
 */
function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * 由组内容派生稳定 id。
 *
 * 位置 id（exact_1 / exact_2 …）会随扫描顺序漂移，使「已忽略/已处理」
 * 在重扫后落到无关的组上。改用成员文件名集合派生，与扫描顺序、分桶顺序、
 * 聚类遍历顺序均无关；成员不变则 id 不变。
 *
 * 代价：成员变动（又混入一张重复图）时 id 变化，该组重新变为待处理。
 * 这是有意为之——成员的引用关系确实变了，值得重新过目。
 *
 * 分隔符用 \x00 / \x1f 而非逗号：文件名本身可能含逗号，
 * 无分隔约定会让 ["a,b"] 与 ["a","b"] 派生出同一 id。
 */
export function deriveGroupId(mode: DeduplicateMode, items: IDuplicateItem[]): string {
  const names = items.map((it) => it.asset.name).sort();
  return `${mode}_${fnv1a32(`${mode}\x00${names.join('\x1f')}`)}`;
}
```

把 `scanDuplicates` 内两处 id 赋值改为派生：

```ts
      exactGroups.push({
        id: deriveGroupId('exact', items),
        // …其余字段不变
      });
```

```ts
      similarGroups.push({
        id: deriveGroupId('similar', items),
        // …其余字段不变
      });
```

同时删除已成死代码的 `let exactGroupIdx = 1;` 与 `let similarGroupIdx = 1;`。

在 `saveDeduplicateCache` 上方加入版本常量，并让 `IDeduplicateCache` 的注释与加载校验使用它：

```ts
/** 分组缓存的 schema 版本。指纹文件另有一套独立的版本命名空间，勿混用 */
export const DEDUP_CACHE_VERSION = 2;
```

把 `loadDeduplicateCache` 中 plugin 分支与 localStorage 分支的校验条件都改为加上版本判定：

```ts
        if (
          parsed &&
          parsed.version === DEDUP_CACHE_VERSION &&
          Array.isArray(parsed.exactGroups) &&
          Array.isArray(parsed.similarGroups)
        ) {
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/deduplicate.test.ts`
Expected: PASS，含新增 5 个用例

- [ ] **Step 5: 提交**

```bash
git add src/utils/deduplicate.ts tests/deduplicate.test.ts
git commit -m "feat(dedup): derive stable group ids and bump cache schema to v2"
```

---

### Task 5: `scanDuplicates` 接入指纹复用（增量）

**Files:**
- Modify: `src/utils/deduplicate.ts`（`scanDuplicates` 的 options / 返回值 / 阶段二三的指纹来源 / 裁剪）
- Test: `tests/deduplicate.test.ts`

**Interfaces:**
- Consumes: `IFingerprintStore`、`createEmptyFingerprintStore`、`isFingerprintValid`、`pruneFingerprintStore` from `./dedup-fingerprint-store`（Task 2）
- Produces:
  - `interface IDeduplicateScanStats { reused: number; computed: number }`
  - `interface IDeduplicateScanResult { exactGroups: IDuplicateGroup[]; similarGroups: IDuplicateGroup[]; fingerprints: IFingerprintStore; stats: IDeduplicateScanStats }`
  - `scanDuplicates` options 新增 `fingerprints?: IFingerprintStore` 与 `forceRehash?: boolean`；返回类型由 `{ exactGroups, similarGroups }` 变为 `IDeduplicateScanResult`

**本任务只做增量，不引入并发**（并发在 Task 6）。这样"复用是否生效"可由 `readAssetFile` 调用次数独立断言，两件事的测试互不干扰。

**三条必须严守的规则：**
1. **条目失效即整体替换，绝不合并**——内容已变的文件，其旧 `sha256` / `dHash` 全部作废，合并会留下陈旧字段
2. **`score` 每次重算**——它依赖 `refCount` / `docCount` / `isReEditable`，这些会在文件字节不变时变化（spec §3.3，最高风险）
3. **中止时不裁剪，但仍返回已合并的指纹**——每条目写入时都独立通过了校验，部分完成的结果依然有效（spec §4.2 / §4.4）

- [ ] **Step 1: 写失败测试**

在 `tests/deduplicate.test.ts` 顶部补充 mock（`readAssetFile` 需可断言调用次数，已有 `vi.mock` 覆盖，无需改动），并在文件顶部 import 中追加 `createEmptyFingerprintStore`。然后在 `describe('scanDuplicates', ...)` 内追加：

```ts
    it('reuses fingerprints on a second scan without re-reading unchanged files', async () => {
      const assets = [makeAsset('dup1.png', 500), makeAsset('dup2.png', 500)];
      readAssetFileMock.mockResolvedValue(new Blob(['same-bytes']));

      const first = await scanDuplicates(assets);
      expect(first.stats.computed).toBeGreaterThan(0);
      const callsAfterFirst = readAssetFileMock.mock.calls.length;

      const second = await scanDuplicates(assets, { fingerprints: first.fingerprints });

      expect(readAssetFileMock.mock.calls.length).toBe(callsAfterFirst);
      expect(second.stats.computed).toBe(0);
      expect(second.stats.reused).toBeGreaterThan(0);
      expect(second.exactGroups.length).toBe(first.exactGroups.length);
      expect(second.exactGroups[0].id).toBe(first.exactGroups[0].id);
    });

    it('recomputes only the file whose updated timestamp changed', async () => {
      const assets = [makeAsset('dup1.png', 500), makeAsset('dup2.png', 500)];
      readAssetFileMock.mockResolvedValue(new Blob(['same-bytes']));

      const first = await scanDuplicates(assets);
      const callsAfterFirst = readAssetFileMock.mock.calls.length;

      const bumped = [
        { ...assets[0], updated: assets[0].updated + 1 },
        assets[1],
      ];
      await scanDuplicates(bumped, { fingerprints: first.fingerprints });

      expect(readAssetFileMock.mock.calls.length - callsAfterFirst).toBe(1);
    });

    it('recomputes everything when forceRehash is set', async () => {
      const assets = [makeAsset('dup1.png', 500), makeAsset('dup2.png', 500)];
      readAssetFileMock.mockResolvedValue(new Blob(['same-bytes']));

      const first = await scanDuplicates(assets);
      readAssetFileMock.mockClear();

      const second = await scanDuplicates(assets, {
        fingerprints: first.fingerprints,
        forceRehash: true,
      });

      expect(second.stats.reused).toBe(0);
      expect(readAssetFileMock.mock.calls.length).toBeGreaterThan(0);
    });

    it('discards every stale field when an entry is invalidated', async () => {
      const assets = [makeAsset('dup1.png', 500), makeAsset('dup2.png', 500)];
      readAssetFileMock.mockResolvedValue(new Blob(['same-bytes']));

      const first = await scanDuplicates(assets);

      // 伪造一条"size/updated 不符但字段齐全"的旧条目
      const poisoned = createEmptyFingerprintStore();
      poisoned.entries['dup1.png'] = {
        size: 1, updated: 1, sha256: 'stale-hash', dHash: '0000', width: 1, height: 1,
      };

      const second = await scanDuplicates(assets, { fingerprints: poisoned });

      // 失效条目必须被整体替换：陈旧 sha256 不得残留，否则会与 dup2 误配成一组
      expect(second.fingerprints.entries['dup1.png'].sha256).not.toBe('stale-hash');
      expect(second.fingerprints.entries['dup1.png'].size).toBe(500);
      expect(second.exactGroups.length).toBe(1);
      expect(second.exactGroups[0].items.length).toBe(2);
    });

    it('recomputes score for reused fingerprints so canonical follows fresh refCount', async () => {
      // 最高风险用例：若 score 被误缓存，canonical 会停留在过期推荐上，
      // 用户据此合并将丢失引用数更多的那个文件。
      const assets = [makeAsset('dup1.png', 500, 1), makeAsset('dup2.png', 500, 0)];
      readAssetFileMock.mockResolvedValue(new Blob(['same-bytes']));

      const first = await scanDuplicates(assets);
      expect(first.exactGroups[0].canonicalAssetName).toBe('dup1.png');

      // 文件字节未变（size/updated 不变，指纹应全命中），但引用数反转
      const refsChanged = [
        { ...assets[0], refCount: 0, docCount: 0, references: [] },
        { ...assets[1], refCount: 5, docCount: 3, references: [] },
      ];
      const second = await scanDuplicates(refsChanged, { fingerprints: first.fingerprints });

      expect(second.stats.reused).toBeGreaterThan(0);
      expect(second.exactGroups[0].canonicalAssetName).toBe('dup2.png');
      expect(second.exactGroups[0].items.find(i => i.asset.name === 'dup2.png')!.score)
        .toBeGreaterThan(second.exactGroups[0].items.find(i => i.asset.name === 'dup1.png')!.score);
    });

    it('prunes fingerprints for assets no longer present', async () => {
      const assets = [makeAsset('dup1.png', 500), makeAsset('dup2.png', 500)];
      readAssetFileMock.mockResolvedValue(new Blob(['same-bytes']));

      const first = await scanDuplicates(assets);
      expect(first.fingerprints.entries['dup1.png']).toBeDefined();

      const second = await scanDuplicates([assets[0]], { fingerprints: first.fingerprints });

      expect(second.fingerprints.entries['dup2.png']).toBeUndefined();
    });

    it('reuses cached perceptual hashes without re-reading image files', async () => {
      // jsdom 下 Image 未定义，computeImageDHash 必然返回 null。
      // 因此阶段三的复用路径只能靠"直接注入 dHash 指纹"来覆盖——
      // 这恰好也是最纯粹的形式：两个文件 size 不同（不进精确候选），
      // 但 dHash 相同，应当直接聚为相似组且全程零文件读取。
      const assets = [makeAsset('a.png', 100), makeAsset('b.png', 200)];
      const seeded = createEmptyFingerprintStore();
      seeded.entries['a.png'] = { size: 100, updated: assets[0].updated, dHash: '0'.repeat(64) };
      seeded.entries['b.png'] = { size: 200, updated: assets[1].updated, dHash: '0'.repeat(64) };

      const result = await scanDuplicates(assets, { fingerprints: seeded });

      expect(readAssetFileMock).not.toHaveBeenCalled();
      expect(result.stats.reused).toBe(2);
      expect(result.stats.computed).toBe(0);
      expect(result.similarGroups.length).toBe(1);
      expect(result.similarGroups[0].items.length).toBe(2);
      expect(result.similarGroups[0].similarity).toBe(1);
    });

    it('returns merged fingerprints but no groups, and skips pruning, when aborted', async () => {
      const assets = Array.from({ length: 6 }, (_, i) => makeAsset(`d${i}.png`, 500));
      const abortSignal = { aborted: false };

      // 中止点由读取次数驱动，不依赖进度回调的触发时机，
      // 因此该用例在串行（Task 5）与并发（Task 6）两种实现下都稳定
      readAssetFileMock.mockImplementation(async () => {
        abortSignal.aborted = true;
        return new Blob(['same-bytes']);
      });

      const seeded = createEmptyFingerprintStore();
      seeded.entries['ghost.png'] = { size: 9, updated: 9 }; // 不在 assets 中

      const result = await scanDuplicates(assets, { fingerprints: seeded, abortSignal });

      expect(result.exactGroups).toEqual([]);
      expect(result.similarGroups).toEqual([]);
      // 中止路径不得裁剪：按不完整集合删除会误伤有效指纹。
      // ghost.png 本来会被完整扫描裁掉，此处必须存活。
      expect(result.fingerprints.entries['ghost.png']).toBeDefined();
      // 但本次已算出的条目不得被丢弃
      expect(Object.keys(result.fingerprints.entries).length).toBeGreaterThan(1);
    });
```

**中止检查的落点（实现时必须照此放置）：** 阶段二结束后的中止检查须在**构建 `exactGroups` 之前**。现有代码在构建之后检查（`deduplicate.ts:453`）并返回部分分组，本次刻意收紧为**中止一律返回空分组**，使返回契约统一、且上面的用例在两种并发度下都确定。弹窗本就以 `if (!aborted)` 守卫，不会采用部分分组，故无行为损失。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/deduplicate.test.ts`
Expected: FAIL —— `second.stats` 为 `undefined`（当前无此返回字段）

- [ ] **Step 3: 实现**

在 `src/utils/deduplicate.ts` 顶部加入 import：

```ts
import {
  createEmptyFingerprintStore,
  isFingerprintValid,
  pruneFingerprintStore,
  type IAssetFingerprint,
  type IFingerprintStore,
} from './dedup-fingerprint-store';
```

加入类型定义（放在 `IDeduplicateScanProgress` 附近）：

```ts
export interface IDeduplicateScanStats {
  /** 复用既有指纹的条目数 */
  reused: number;
  /** 本次实际重算的条目数 */
  computed: number;
}

export interface IDeduplicateScanResult {
  exactGroups: IDuplicateGroup[];
  similarGroups: IDuplicateGroup[];
  /** 含本次新增/回写的条目，由调用方落盘 */
  fingerprints: IFingerprintStore;
  stats: IDeduplicateScanStats;
}
```

把 `scanDuplicates` 的签名与返回类型改为：

```ts
export async function scanDuplicates(
  assets: AssetInfo[],
  options: {
    minSimilarity?: number;
    onProgress?: (progress: IDeduplicateScanProgress) => void;
    abortSignal?: { aborted: boolean };
    fingerprints?: IFingerprintStore;
    forceRehash?: boolean;
  } = {}
): Promise<IDeduplicateScanResult> {
  const minSimilarity = options.minSimilarity ?? 0.90;
  const onProgress = options.onProgress || (() => {});
  const abortSignal = options.abortSignal || { aborted: false };
  const forceRehash = options.forceRehash === true;

  // 复制入参条目，避免污染调用方持有的对象
  const fingerprints: IFingerprintStore = options.fingerprints
    ? { version: options.fingerprints.version, entries: { ...options.fingerprints.entries } }
    : createEmptyFingerprintStore();

  let reused = 0;
  let computed = 0;

  /** 取可复用的条目；forceRehash 或失效时返回 null */
  const reusableEntry = (asset: AssetInfo): IAssetFingerprint | null => {
    if (forceRehash) return null;
    const entry = fingerprints.entries[asset.name];
    return isFingerprintValid(entry, asset) ? entry! : null;
  };
```

现有代码有 4 处中止返回（`:374` 阶段一后、`:393` 阶段二循环内、`:453` 构建 `exactGroups` 后、`:483` 阶段三循环内）。全部统一为**空分组 + 完整结果形状**：

```ts
    return {
      exactGroups: [],
      similarGroups: [],
      fingerprints,
      stats: { reused, computed },
    };
```

**注意第 3 处（`:453`）需前移**：把它从"构建 `exactGroups` 之后"移到"阶段二循环结束、开始构建 `exactGroups` 之前"。这样中止时永远不会返回部分分组，返回契约统一为"中止 ⇒ 空分组"，且 abort 用例的断言在串行/并发两种实现下都确定。弹窗以 `if (!aborted)` 守卫，无行为损失。

把阶段二的循环体改为指纹感知：

```ts
  const assetHashMap = new Map<string, string>(); // assetName -> sha256
  const exactClusters = new Map<string, AssetInfo[]>(); // hash -> assets

  let hashProcessed = 0;
  for (const asset of candidateAssets) {
    if (abortSignal.aborted) {
      return { exactGroups: [], similarGroups: [], fingerprints, stats: { reused, computed } };
    }

    const cached = reusableEntry(asset);
    if (cached?.sha256) {
      reused++;
      assetHashMap.set(asset.name, cached.sha256);
      if (!exactClusters.has(cached.sha256)) {
        exactClusters.set(cached.sha256, []);
      }
      exactClusters.get(cached.sha256)!.push(asset);
    } else {
      try {
        const blob = await readAssetFile(asset.name);
        if (blob) {
          const hash = await computeFileHash(blob);
          assetHashMap.set(asset.name, hash);

          if (!exactClusters.has(hash)) {
            exactClusters.set(hash, []);
          }
          exactClusters.get(hash)!.push(asset);

          // 失效条目整体替换，绝不合并旧字段：文件内容已变，
          // 旧的 sha256/dHash 全部作废，合并会留下陈旧值
          fingerprints.entries[asset.name] = {
            size: asset.size,
            updated: asset.updated,
            sha256: hash,
          };
          computed++;
        }
      } catch (e) {
        warn(`[deduplicate] 读取文件 ${asset.name} 计算哈希失败:`, e);
      }
    }

    hashProcessed++;
    if (hashProcessed % 5 === 0 || hashProcessed === candidateAssets.length) {
      onProgress({
        phase: 'hashing',
        current: hashProcessed,
        total: candidateAssets.length,
        message: `复用 ${reused} 个指纹，重算 ${computed} 个精确哈希 (${hashProcessed}/${candidateAssets.length})...`,
      });
    }
  }
```

把阶段三的循环体改为指纹感知。注意 `computeImageDHash` 仍需真实调用（jsdom 下返回 `null`，测试通过 mock 或直接构造指纹入参）：

```ts
  for (const asset of imageAssets) {
    if (abortSignal.aborted) {
      return { exactGroups, similarGroups: [], fingerprints, stats: { reused, computed } };
    }

    const cached = reusableEntry(asset);
    if (cached?.dHash) {
      reused++;
      imageFeatures.push({
        asset,
        dHash: cached.dHash,
        width: cached.width || 0,
        height: cached.height || 0,
        // score 必须每次重算：它依赖 refCount/docCount/isReEditable，
        // 这些会在文件字节完全不变的情况下变化
        score: scoreAssetCandidate(asset, cached.width || 0, cached.height || 0),
      });
    } else {
      try {
        const blob = await readAssetFile(asset.name);
        if (blob) {
          const feature = await computeImageDHash(blob);
          if (feature) {
            imageFeatures.push({
              asset,
              dHash: feature.dHash,
              width: feature.width,
              height: feature.height,
              score: scoreAssetCandidate(asset, feature.width, feature.height),
            });

            const prev = fingerprints.entries[asset.name];
            const prevValid = !forceRehash && isFingerprintValid(prev, asset);
            fingerprints.entries[asset.name] = {
              size: asset.size,
              updated: asset.updated,
              // 阶段二刚写入的 sha256 必须保留（此时条目有效）；
              // 若条目本就失效则一并丢弃
              ...(prevValid && prev?.sha256 ? { sha256: prev.sha256 } : {}),
              dHash: feature.dHash,
              width: feature.width,
              height: feature.height,
            };
            computed++;
          }
        }
      } catch (e) {
        warn(`[deduplicate] 提取图片特征 ${asset.name} 失败:`, e);
      }
    }

    dHashProcessed++;
    if (dHashProcessed % 5 === 0 || dHashProcessed === imageAssets.length) {
      onProgress({
        phase: 'perceptual',
        current: dHashProcessed,
        total: imageAssets.length,
        message: `复用 ${reused} 张图片特征，重算 ${computed} 张 (${dHashProcessed}/${imageAssets.length})...`,
      });
    }
  }
```

在函数末尾（`onProgress({ phase: 'done', ... })` 之前）加入裁剪：

```ts
  // 裁剪只在完整扫描后执行：中止时资源集合可能不完整，
  // 按不完整集合删除条目会误伤有效指纹
  pruneFingerprintStore(fingerprints, new Set(validAssets.map((a) => a.name)));
```

并把收尾的 return 改为：

```ts
  return { exactGroups, similarGroups, fingerprints, stats: { reused, computed } };
```

注意：`stats.reused` 在阶段二与阶段三各自累加，故同一张图片若既算了 sha256 又算了 dHash，会被计入两次。这是刻意的——`reused + computed` 的语义是"指纹条目操作数"，与进度文案的分母对应，不是"文件数"。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/deduplicate.test.ts`
Expected: PASS，含新增 7 个用例

- [ ] **Step 5: 跑全量测试确认无回归**

Run: `npm test`
Expected: PASS。`scanDuplicates` 的返回类型变了，若有其他调用方（目前只有 `DeduplicateDialog.vue:589`）需在 Task 8 一并适配——本步骤若报该处类型错误属预期，记下即可，Task 8 会修

- [ ] **Step 6: 提交**

```bash
git add src/utils/deduplicate.ts tests/deduplicate.test.ts
git commit -m "feat(dedup): reuse cached fingerprints in scan pipeline"
```

---

### Task 6: 两阶段并发化

**Files:**
- Modify: `src/utils/deduplicate.ts`（阶段二/三的循环换用 `mapWithConcurrency`；新增 `DEFAULT_HASH_CONCURRENCY` / `DEFAULT_DECODE_CONCURRENCY`；options 新增 `concurrency`）
- Test: `tests/deduplicate.test.ts`

**Interfaces:**
- Consumes: `mapWithConcurrency`、`normalizeConcurrency` from `./concurrency`（Task 1）；Task 5 的 `IDeduplicateScanStats` / `IDeduplicateScanResult`
- Produces:
  - `DEFAULT_HASH_CONCURRENCY: number` = `8`
  - `DEFAULT_DECODE_CONCURRENCY: number` = `3`
  - `scanDuplicates` options 新增 `concurrency?: { hash?: number; decode?: number }`

**为何两个常量而非一个（spec §4.3）：** 阶段二是 IO + `crypto.subtle.digest`（真异步、不占主线程，每项只有一个 Blob），阶段三是 `Image` 解码（每项一个全分辨率位图，内存是硬约束）。共用一值必然对一方不合适。

- [ ] **Step 1: 写失败测试**

在 `tests/deduplicate.test.ts` 的 `describe('scanDuplicates', ...)` 内追加：

```ts
    it('respects an injected concurrency limit for the hashing phase', async () => {
      const assets = Array.from({ length: 12 }, (_, i) => makeAsset(`d${i}.png`, 500));
      let inFlight = 0;
      let peak = 0;

      readAssetFileMock.mockImplementation(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 3));
        inFlight--;
        return new Blob(['same-bytes']);
      });

      await scanDuplicates(assets, { concurrency: { hash: 2 } });

      expect(peak).toBeLessThanOrEqual(2);
      expect(peak).toBeGreaterThan(1);
    });

    it('falls back to defaults when concurrency is absent or malformed', async () => {
      const assets = [makeAsset('dup1.png', 500), makeAsset('dup2.png', 500)];
      readAssetFileMock.mockResolvedValue(new Blob(['same-bytes']));

      await expect(scanDuplicates(assets, { concurrency: {} })).resolves.toBeDefined();
      await expect(
        scanDuplicates(assets, { concurrency: { hash: NaN, decode: -1 } })
      ).resolves.toBeDefined();
    });

    it('reports combined reuse and recompute counts in progress messages', async () => {
      const assets = [makeAsset('dup1.png', 500), makeAsset('dup2.png', 500)];
      readAssetFileMock.mockResolvedValue(new Blob(['same-bytes']));

      const first = await scanDuplicates(assets);
      const messages: string[] = [];
      await scanDuplicates(assets, {
        fingerprints: first.fingerprints,
        onProgress: (p) => messages.push(p.message),
      });

      expect(messages.some((m) => m.includes('复用'))).toBe(true);
    });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/deduplicate.test.ts`
Expected: FAIL —— 第一个用例 `peak` 为 1（当前串行，`expect(peak).toBeGreaterThan(1)` 不成立）

- [ ] **Step 3: 实现**

在 `src/utils/deduplicate.ts` 加入 import：

```ts
import { mapWithConcurrency, normalizeConcurrency } from './concurrency';
```

在 `IMAGE_EXTENSIONS` 附近加入常量：

```ts
/** 阶段二并发度：IO + crypto.subtle.digest，后者真异步且不占主线程，每项仅一个 Blob */
export const DEFAULT_HASH_CONCURRENCY = 8;
/**
 * 阶段三并发度：Image 解码，每项一个全分辨率位图（一张 4000×3000 约 48MB RGBA），
 * 内存是硬约束。故显著低于阶段二。
 */
export const DEFAULT_DECODE_CONCURRENCY = 3;
```

options 类型追加字段：

```ts
    concurrency?: { hash?: number; decode?: number };
```

在 `let reused = 0;` 附近解析并发度：

```ts
  const hashLimit = normalizeConcurrency(options.concurrency?.hash, DEFAULT_HASH_CONCURRENCY);
  const decodeLimit = normalizeConcurrency(options.concurrency?.decode, DEFAULT_DECODE_CONCURRENCY);
```

把阶段二的整个 `for` 循环替换为池化版本。**顺序必须确定**：`exactClusters` 的构建依赖 `candidateAssets` 的原始顺序（否则分组输出会抖动），故先保序收集结果，再按序归并：

```ts
  const hashResults = await mapWithConcurrency(
    candidateAssets,
    hashLimit,
    async (asset) => {
      const cached = reusableEntry(asset);
      if (cached?.sha256) {
        reused++;
        return { asset, hash: cached.sha256 };
      }
      try {
        const blob = await readAssetFile(asset.name);
        if (blob) {
          const hash = await computeFileHash(blob);
          // 失效条目整体替换，绝不合并旧字段
          fingerprints.entries[asset.name] = {
            size: asset.size,
            updated: asset.updated,
            sha256: hash,
          };
          computed++;
          return { asset, hash };
        }
      } catch (e) {
        warn(`[deduplicate] 读取文件 ${asset.name} 计算哈希失败:`, e);
      }
      return null;
    },
    {
      abortSignal,
      onError: (e, asset) => warn(`[deduplicate] 计算哈希 ${asset.name} 异常:`, e),
      onProgress: (done, total) => {
        if (done % 5 === 0 || done === total) {
          onProgress({
            phase: 'hashing',
            current: done,
            total,
            message: `复用 ${reused} 个指纹，重算 ${computed} 个精确哈希 (${done}/${total})...`,
          });
        }
      },
    }
  );

  // 按原始顺序归并，保证分组输出不随并发完成顺序抖动
  for (const item of hashResults) {
    if (!item) continue;
    assetHashMap.set(item.asset.name, item.hash);
    if (!exactClusters.has(item.hash)) {
      exactClusters.set(item.hash, []);
    }
    exactClusters.get(item.hash)!.push(item.asset);
  }
```

注意 `hashResults` 中 `null` 的位置会被跳过，但非 null 项的相对顺序仍与 `candidateAssets` 一致——这是保序池的保证。

把阶段三的 `for` 循环同样替换。`imageFeatures` 的构建顺序影响聚类输出，故同样保序：

```ts
  const featureResults = await mapWithConcurrency(
    imageAssets,
    decodeLimit,
    async (asset) => {
      const cached = reusableEntry(asset);
      if (cached?.dHash) {
        reused++;
        return {
          asset,
          dHash: cached.dHash,
          width: cached.width || 0,
          height: cached.height || 0,
          // score 必须每次重算
          score: scoreAssetCandidate(asset, cached.width || 0, cached.height || 0),
        };
      }
      try {
        const blob = await readAssetFile(asset.name);
        if (blob) {
          const feature = await computeImageDHash(blob);
          if (feature) {
            const prev = fingerprints.entries[asset.name];
            const prevValid = !forceRehash && isFingerprintValid(prev, asset);
            fingerprints.entries[asset.name] = {
              size: asset.size,
              updated: asset.updated,
              ...(prevValid && prev?.sha256 ? { sha256: prev.sha256 } : {}),
              dHash: feature.dHash,
              width: feature.width,
              height: feature.height,
            };
            computed++;
            return {
              asset,
              dHash: feature.dHash,
              width: feature.width,
              height: feature.height,
              score: scoreAssetCandidate(asset, feature.width, feature.height),
            };
          }
        }
      } catch (e) {
        warn(`[deduplicate] 提取图片特征 ${asset.name} 失败:`, e);
      }
      return null;
    },
    {
      abortSignal,
      onError: (e, asset) => warn(`[deduplicate] 提取特征 ${asset.name} 异常:`, e),
      onProgress: (done, total) => {
        if (done % 5 === 0 || done === total) {
          onProgress({
            phase: 'perceptual',
            current: done,
            total,
            message: `复用 ${reused} 张图片特征，重算 ${computed} 张 (${done}/${total})...`,
          });
        }
      },
    }
  );

  const imageFeatures: IImageFeature[] = featureResults.filter(
    (f): f is IImageFeature => f !== null
  );
```

保留 `interface IImageFeature` 的定义并将其提到 `scanDuplicates` 之前（原先定义在函数体内的接口需移到模块层级，`IImageFeature` 现在被池化的闭包引用）。

在中止检查上，池内已逐项检查 `abortSignal.aborted`，故原先循环开头的显式中止返回可删除，但**阶段之间**的中止检查须保留，且位置与 Task 5 一致：阶段二的池返回后、**构建 `exactGroups` 之前**立即检查一次，中止则返回空分组 + 完整结果形状。阶段三的池返回后同理。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/deduplicate.test.ts`
Expected: PASS，含新增 3 个用例

- [ ] **Step 5: 跑全量测试**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/utils/deduplicate.ts tests/deduplicate.test.ts
git commit -m "perf(dedup): parallelize hash and decode phases"
```

---

### Task 7: 并发度设置项与 i18n

**Files:**
- Modify: `src/index.ts`（`settings` 定义 `:132`、载入兜底 `:242`、`openSetting()` 末尾新增两项）
- Modify: `src/i18n/zh_CN.json`、`src/i18n/en_US.json`
- Test: `tests/settings.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_HASH_CONCURRENCY`、`DEFAULT_DECODE_CONCURRENCY` from `./utils/deduplicate`（Task 6）
- Produces: `plugin.settings.dedupHashConcurrency: number`、`plugin.settings.dedupDecodeConcurrency: number`

**关键：两项必须追加在 `openSetting()` 的末尾。** `tests/settings.test.ts` 按位置断言 `addedItems[0..4]`，追加可保持既有索引不变，只需把总数从 5 改为 7。

- [ ] **Step 1: 写失败测试**

修改 `tests/settings.test.ts`，把 `expect(addedItems.length).toBe(5);` 及其上方注释改为：

```ts
    // 验证 7 个设置项：页签打开、删除提示、开启日志、删除历史保留上限、
    // 图片编辑器工具栏、去重哈希并发度、去重解码并发度
    expect(addedItems.length).toBe(7);
```

并在该用例末尾（`toolsChip` 相关断言之后）追加对第 6、7 项的断言：

```ts
    // 第 6 项为去重哈希并发度 (1~16)
    const hashItem = addedItems[5];
    expect(hashItem.direction).toBe('row');
    const hashInput = hashItem.createActionElement() as HTMLInputElement;
    expect(hashInput.type).toBe('number');
    expect(hashInput.value).toBe('8');
    expect(hashInput.min).toBe('1');
    expect(hashInput.max).toBe('16');

    // 第 7 项为去重解码并发度 (1~8)
    const decodeItem = addedItems[6];
    expect(decodeItem.direction).toBe('row');
    const decodeInput = decodeItem.createActionElement() as HTMLInputElement;
    expect(decodeInput.type).toBe('number');
    expect(decodeInput.value).toBe('3');
    expect(decodeInput.min).toBe('1');
    expect(decodeInput.max).toBe('8');
```

在文件内另起一个用例，锁定越界钳制与默认值：

```ts
  it('clamps dedup concurrency settings into range and persists them', () => {
    const addedItems: any[] = [];
    vi.spyOn(siyuan, 'Setting').mockImplementation(function (this: any) {
      Object.assign(this, {
        addItem: (item: any) => { addedItems.push(item); },
        open: vi.fn(),
      });
      return this as any;
    });

    const plugin = new AssetsManagerPlugin();
    plugin.saveData = vi.fn().mockResolvedValue(undefined);

    expect(plugin.settings.dedupHashConcurrency).toBe(8);
    expect(plugin.settings.dedupDecodeConcurrency).toBe(3);

    plugin.openSetting();

    const hashInput = addedItems[5].createActionElement() as HTMLInputElement;
    hashInput.value = '999';
    hashInput.dispatchEvent(new Event('change'));
    expect(plugin.settings.dedupHashConcurrency).toBe(16);
    expect(hashInput.value).toBe('16');

    const decodeInput = addedItems[6].createActionElement() as HTMLInputElement;
    decodeInput.value = '0';
    decodeInput.dispatchEvent(new Event('change'));
    expect(plugin.settings.dedupDecodeConcurrency).toBe(1);
    expect(decodeInput.value).toBe('1');

    expect(plugin.saveData).toHaveBeenCalled();
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/settings.test.ts`
Expected: FAIL —— `expected 5 to be 7`

- [ ] **Step 3: 实现**

先在两个 i18n 文件中各追加 4 个键。

`src/i18n/zh_CN.json`：

```json
  "dedupHashConcurrencyTitle": "去重扫描：哈希并发度",
  "dedupHashConcurrencyDesc": "精确哈希阶段的并行文件数（范围 1~16，默认 8）。该阶段以磁盘读取与哈希计算为主，可适当调高",
  "dedupDecodeConcurrencyTitle": "去重扫描：解码并发度",
  "dedupDecodeConcurrencyDesc": "图片感知哈希阶段的并行解码数（范围 1~8，默认 3）。每张图解码后占用完整位图内存，图片较大或内存紧张时请调低",
```

`src/i18n/en_US.json`：

```json
  "dedupHashConcurrencyTitle": "Dedup scan: hash concurrency",
  "dedupHashConcurrencyDesc": "Parallel file count for the exact-hash phase (range 1-16, default 8). This phase is dominated by disk reads and hashing, so a higher value is usually fine",
  "dedupDecodeConcurrencyTitle": "Dedup scan: decode concurrency",
  "dedupDecodeConcurrencyDesc": "Parallel decode count for the perceptual-hash phase (range 1-8, default 3). Each decoded image holds a full-resolution bitmap in memory; lower this if images are large or memory is tight",
```

修改 `src/index.ts` 的 `settings` 定义：

```ts
  public settings: {
    promptOnDeleteOriginal: boolean;
    enableLogging: boolean;
    openInTab: boolean;
    imageEditorTools: string[];
    deletionHistoryLimit: number;
    dedupHashConcurrency: number;
    dedupDecodeConcurrency: number;
  } = {
    promptOnDeleteOriginal: true,
    enableLogging: false,
    openInTab: true,
    imageEditorTools: [...DEFAULT_IMAGE_EDITOR_TOOLS],
    deletionHistoryLimit: 10,
    dedupHashConcurrency: DEFAULT_HASH_CONCURRENCY,
    dedupDecodeConcurrency: DEFAULT_DECODE_CONCURRENCY,
  }
```

在 `src/index.ts` 顶部**新增**一条 import（该文件当前没有对 `./utils/deduplicate` 的引用，第 8 行区块）：

```ts
import { DEFAULT_HASH_CONCURRENCY, DEFAULT_DECODE_CONCURRENCY } from '@/utils/deduplicate'
```

**为何这样引不会污染单测依赖图：** `deduplicate.ts` 会牵入 `image-editor`（tui-image-editor）。但 `tests/settings.test.ts` 已导入 `../src/index`，后者第 9 行导入 `@/main`，而 `App.vue:68` 本就导入 `ImageEditorDialog.vue` —— 这条重量级链路**已在**该测试的依赖图中，多一条 import 不增加任何新依赖。反之，若把这两个常量另建一个轻量模块，则会引入"两个来源"的漂移风险，不如直接复用唯一真源。

把 `:242` 附近的载入逻辑补上兜底（紧跟 `imageEditorTools` 的既有兜底）：

```ts
      if (!Array.isArray(this.settings.imageEditorTools)) {
        this.settings.imageEditorTools = [...DEFAULT_IMAGE_EDITOR_TOOLS];
      }
      // 老用户 config.json 中无这两个字段，读出来是 undefined。
      // 必须在此补默认：undefined 传进并发池会让池大小失效。
      if (typeof this.settings.dedupHashConcurrency !== 'number') {
        this.settings.dedupHashConcurrency = DEFAULT_HASH_CONCURRENCY;
      }
      if (typeof this.settings.dedupDecodeConcurrency !== 'number') {
        this.settings.dedupDecodeConcurrency = DEFAULT_DECODE_CONCURRENCY;
      }
```

在 `openSetting()` 中，**紧接着** `imageEditorTools` 那个 `setting.addItem({...})` 之后追加两项：

```ts
    setting.addItem({
      title: this.i18n.dedupHashConcurrencyTitle || "去重扫描：哈希并发度",
      description: this.i18n.dedupHashConcurrencyDesc || "精确哈希阶段的并行文件数（范围 1~16，默认 8）",
      direction: "row",
      createActionElement: () => {
        const input = document.createElement("input");
        input.type = "number";
        input.min = "1";
        input.max = "16";
        input.className = "b3-text-field fn__flex-center";
        input.style.width = "72px";
        input.value = (this.settings.dedupHashConcurrency ?? DEFAULT_HASH_CONCURRENCY).toString();

        input.addEventListener("change", (e) => {
          let val = parseInt((e.target as HTMLInputElement).value, 10);
          if (isNaN(val) || val < 1) val = 1;
          if (val > 16) val = 16;
          input.value = val.toString();
          this.settings.dedupHashConcurrency = val;
          this.saveData("config.json", this.settings);
        });

        return input;
      },
    });

    setting.addItem({
      title: this.i18n.dedupDecodeConcurrencyTitle || "去重扫描：解码并发度",
      description: this.i18n.dedupDecodeConcurrencyDesc || "图片感知哈希阶段的并行解码数（范围 1~8，默认 3）",
      direction: "row",
      createActionElement: () => {
        const input = document.createElement("input");
        input.type = "number";
        input.min = "1";
        input.max = "8";
        input.className = "b3-text-field fn__flex-center";
        input.style.width = "72px";
        input.value = (this.settings.dedupDecodeConcurrency ?? DEFAULT_DECODE_CONCURRENCY).toString();

        input.addEventListener("change", (e) => {
          let val = parseInt((e.target as HTMLInputElement).value, 10);
          if (isNaN(val) || val < 1) val = 1;
          if (val > 8) val = 8;
          input.value = val.toString();
          this.settings.dedupDecodeConcurrency = val;
          this.saveData("config.json", this.settings);
        });

        return input;
      },
    });
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/settings.test.ts`
Expected: PASS（含改写后的 2 个用例）

- [ ] **Step 5: 跑全量测试**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/index.ts src/i18n/zh_CN.json src/i18n/en_US.json tests/settings.test.ts
git commit -m "feat(settings): expose dedup scan concurrency knobs"
```

---

### Task 8: 对话框接入增量与重建索引入口

**Files:**
- Modify: `src/components/DeduplicateDialog.vue`（import `:382-386`、`initDialogData` `:525`、`persistCurrentCache` `:562`、`startScan` `:579`、`handleManualRefresh` `:623`、footer 按钮 `:340-348`、空状态按钮 `:109`）

**Interfaces:**
- Consumes: `scanDuplicates` 的新 options 与 `IDeduplicateScanResult`（Task 5/6）；`loadFingerprintStore` / `saveFingerprintStore` / `clearFingerprintStore` from `../utils/dedup-fingerprint-store`（Task 2）；`usePlugin` from `../main`（已导入 `:378`）；`showConfirm` from `../utils/confirm`（已导入 `:393`）
- Produces: 无（叶子节点）

**本任务无单元测试**——`DeduplicateDialog.vue` 无既有测试文件，且本次改动是接线而非逻辑。验证靠 `npm test` 无回归 + 手动核对（Step 5）。

- [ ] **Step 0: 修正缓存写入的 schema 版本**

`persistCurrentCache`（`DeduplicateDialog.vue:562-574`）当前**硬编码 `version: 1`**，而 Task 4 已把 `loadDeduplicateCache` 改为要求 `version === 2`。若不修，写进去的缓存每次加载都会被判废，弹窗每次打开都退化为全量扫描——功能上看似正常，但增量收益归零且无任何报错。这是 Task 4 与本任务之间的跨任务耦合点。

把 `:564-570` 改为：

```ts
    await saveDeduplicateCache({
      version: DEDUP_CACHE_VERSION,
      lastScanTime: lastScanTime.value,
      similarityThreshold: similarityThreshold.value,
      exactGroups: exactGroups.value,
      similarGroups: similarGroups.value,
    });
```

并在 `:382-386` 的 `deduplicate` import 块中追加 `DEDUP_CACHE_VERSION`。

- [ ] **Step 1: 引入指纹存储函数**

在 `src/components/DeduplicateDialog.vue:382-386` 的 `deduplicate` import 块之后追加：

```ts
import {
  loadFingerprintStore,
  saveFingerprintStore,
  clearFingerprintStore,
} from '../utils/dedup-fingerprint-store';
import type { IFingerprintStore } from '../utils/dedup-fingerprint-store';
```

并在 `:427` 附近的「扫描状态」区加入指纹存储的持有变量：

```ts
// 指纹存储：跨会话复用未变更文件的哈希与感知特征
const fingerprintStore = ref<IFingerprintStore | null>(null);
```

- [ ] **Step 2: 改造 `startScan` 支持增量与全量重建**

把 `:579-618` 的 `startScan` 替换为：

```ts
/**
 * 启动扫描分析
 * @param forceRescan 为 true 时忽略既有分组，重新构建
 * @param forceRehash 为 true 时忽略全部指纹，全量重算（"重建索引"）
 */
async function startScan(forceRescan = false, forceRehash = false) {
  if (isScanning.value) return;
  if (!forceRescan && !forceRehash && (exactGroups.value.length > 0 || similarGroups.value.length > 0)) {
    return;
  }

  isScanning.value = true;
  abortController.value = { aborted: false };

  try {
    if (forceRehash) {
      await clearFingerprintStore();
      fingerprintStore.value = null;
    }

    if (!fingerprintStore.value) {
      fingerprintStore.value = await loadFingerprintStore();
    }

    // usePlugin() 的返回类型是思源基类 Plugin，其上并无 settings 字段
    // （settings 定义在 AssetsManagerPlugin 子类上）。此处 `as any` 是本仓库的既有写法，
    // 见 src/utils/logger.ts:5 与 src/components/ImageEditorDialog.vue:306。
    const plugin = usePlugin() as any;
    const res = await scanDuplicates(props.assets, {
      minSimilarity: similarityThreshold.value / 100,
      fingerprints: fingerprintStore.value || undefined,
      forceRehash,
      concurrency: {
        hash: plugin?.settings?.dedupHashConcurrency,
        decode: plugin?.settings?.dedupDecodeConcurrency,
      },
      onProgress: (prog) => {
        scanProgress.value = prog;
      },
      abortSignal: abortController.value,
    });

    // 指纹始终落盘：中止路径下也是有效的部分成果
    fingerprintStore.value = res.fingerprints;
    await saveFingerprintStore(res.fingerprints);

    if (!abortController.value.aborted) {
      exactGroups.value = res.exactGroups;
      similarGroups.value = res.similarGroups;
      lastScanTime.value = Date.now();

      const firstGroup = res.exactGroups[0] || res.similarGroups[0];
      if (firstGroup) {
        activeTab.value = res.exactGroups.length > 0 ? 'exact' : 'similar';
        selectedGroupId.value = firstGroup.id;
      }

      await persistCurrentCache();
    }
  } catch (err) {
    error('[DeduplicateDialog] 扫描重复失败:', err);
    pushMsg('扫描重复文件发生异常');
  } finally {
    isScanning.value = false;
  }
}
```

注意函数上方原注释「启动全量扫描分析」需改为「启动扫描分析」。

- [ ] **Step 3: 调整三个入口与新增「重建索引」**

`handleManualRefresh`（`:623`）保持调用 `startScan(true)`——现在它是增量的：

```ts
/**
 * 用户手动点击「扫描」按钮：增量刷新（未变更文件零读取）
 */
async function handleManualRefresh() {
  await startScan(true);
}
```

新增「重建索引」处理函数（放在 `handleManualRefresh` 之后）：

```ts
/**
 * 全量重建指纹索引：清空既有指纹并重算全部文件。
 * 用于哈希算法升级、或怀疑指纹陈旧时的逃生入口。
 */
async function handleRebuildIndex() {
  const ok = await showConfirm({
    title: '重建指纹索引',
    message: [
      '将清空已缓存的全部文件指纹，并重新读取、解码所有资源文件。',
      '此操作耗时较长（资源量大时可达数分钟），但不会修改或删除任何文件。',
    ].join('\n'),
    confirmText: '开始重建',
    cancelText: '取消',
    danger: false,
  });
  if (!ok) return;

  exactGroups.value = [];
  similarGroups.value = [];
  await startScan(true, true);
}
```

把 `:109` 空状态按钮从 `@click="startScan(true)"` 改为指向重建：

```html
          <button class="am-btn am-btn--primary" @click="handleRebuildIndex">重建指纹索引</button>
```

把 `:341-348` 的 footer「重新扫描」保持 `@click="startScan(true)"`（现为增量），并在其后追加「重建索引」按钮：

```html
          <button
            class="am-btn am-btn--ghost"
            @click="startScan(true)"
            :disabled="isScanning || isMerging"
            title="增量扫描：仅重算新增或已变更的文件"
          >
            重新扫描
          </button>
          <button
            class="am-btn am-btn--ghost"
            @click="handleRebuildIndex"
            :disabled="isScanning || isMerging"
            title="清空指纹缓存并重算全部文件（耗时较长，不会修改任何文件）"
          >
            重建索引
          </button>
```

同时把 `:55` 顶部「扫描」按钮的 `title` 改为 `"增量扫描：仅重算新增或已变更的文件"`。

- [ ] **Step 4: 确认无类型与编译错误**

Run: `npm test && npx tsc --noEmit`
Expected: `npm test` PASS。`tsc` 的基线是 **17 个既有错误**，存于 `.superpowers/sdd/2026-09-21-dedup-incremental-scan/tsc-baseline.txt`。比对方式：

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | sort > /tmp/tsc-after.txt
diff .superpowers/sdd/2026-09-21-dedup-incremental-scan/tsc-baseline.txt /tmp/tsc-after.txt
```

Expected: `diff` 无输出。`DeduplicateDialog.vue` 不在基线中，故任何指向它的错误都是本次引入的，必须修掉（这正是 Step 2 里 `as any` 的原因）。

- [ ] **Step 5: 手动核对**

Run: `npm run dev`，在思源中打开「去重比对」弹窗，依次确认：

1. 首次打开触发扫描，进度文案出现「重算 N 个精确哈希」
2. 关闭再打开，控制台无扫描日志（直接读缓存）
3. 点顶部「扫描」，进度文案出现「复用 N 个指纹」且秒级完成
4. 点「重建索引」→ 确认框 → 进度文案回到「复用 0 个」，全量重跑
5. 拖动相似度滑块，扫描瞬间完成且无「重算」计数增长
6. 设置面板中「去重扫描：解码并发度」调整为 1 后重扫，观察耗时变化

- [ ] **Step 6: 提交**

```bash
git add src/components/DeduplicateDialog.vue
git commit -m "feat(dedup): default to incremental scan with index rebuild escape hatch"
```

---

### Task 9: 文档同步与收尾

**Files:**
- Modify: `docs/project-structure.md`
- Modify: `docs/changelog.md`

**Interfaces:**
- Consumes: 全部前置任务
- Produces: 无

**依据：** 项目 CLAUDE.md 规约要求「重大架构改动时同步更新 `docs/project-structure.md` 与 `docs/refactor-plan.md`」。`docs/refactor-plan.md` 是重构计划，与本次功能改动无关，故只更新 `project-structure.md`，并在 `changelog.md` 记录。

- [ ] **Step 1: 更新 `docs/project-structure.md`**

在 Key Modules 表格中加入两行新模块，并更新 `src/utils/deduplicate.ts` 的描述：

```markdown
| `src/utils/deduplicate.ts` | 去重扫描（三阶段：size 分桶 → 精确哈希 → 感知哈希）、指纹复用增量、分组归一化、稳定组身份、缓存持久化 |
| `src/utils/dedup-fingerprint-store.ts` | per-asset 指纹（sha256/dHash/分辨率）的失效校验、裁剪与持久化；仅走 plugin.saveData |
| `src/utils/concurrency.ts` | 保序并发池：在飞数受限、可中止、进度上报 |
```

同时在「Development Rules & Invariants」中补一条约束：

```markdown
- **指纹复用安全性**: 去重扫描复用 `size + updated` 双判有效的指纹；`score`（依赖 refCount/docCount/isReEditable）必须每次重算，绝不复用，否则会给出过期的保留项推荐。
```

- [ ] **Step 1b: 修正 `CLAUDE.md` 中已过时的测试规模**

执行期间实测：全量套件为 **31 个测试文件 / 242 个测试**（命令 `npm test`）。而 `CLAUDE.md` 的构建命令表仍写着「运行全部 Vitest 单元测试（14 套件 / 66+ 测试）」——该数字已严重过时。

把 Build & Test Commands 表中 `npm test` 一行的描述改为：

```markdown
| `npm test` | 运行全部 Vitest 单元测试（31 个测试文件 / 242+ 测试） |
```

注意保留「+」：后续任务还会继续新增用例，本任务的收尾时刻以当时的实际数字为准，但不必为此反复改文档。

- [ ] **Step 2: 更新 `docs/changelog.md`**

在文件顶部（最新条目位置）按既有格式加入本次改动条目，列出：增量指纹复用、两阶段并发化（并发度可配置）、分组 id 内容派生、`http-adapter` 的 `updated` 语义修正、缓存 schema 升 v2（旧缓存丢弃）。

- [ ] **Step 3: 跑全量测试**

Run: `npm test`
Expected: PASS，全部套件

- [ ] **Step 4: 跑生产构建**

Run: `npm run build`
Expected: 构建成功，输出 `dist/` 与 `package.zip`

- [ ] **Step 5: 提交**

```bash
git add docs/project-structure.md docs/changelog.md
git commit -m "docs: record incremental dedup scan and concurrency knobs"
```

---

## 完成标准

全部任务完成后应满足：

1. `npm test` 全绿，且新增 37 个用例（Task 1: 8、Task 2: 11、Task 3: 2、Task 4: 5、Task 5: 8、Task 6: 3）
2. `npm run build` 成功
3. 重复扫描在资源未变更时 `readAssetFile` 调用数为 0（由 Task 5 Step 1 的用例锁定）
4. 「重建索引」入口可从有分组状态与空状态两处到达
5. spec §9 风险表逐条有对应用例或实现措施

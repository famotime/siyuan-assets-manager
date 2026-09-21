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

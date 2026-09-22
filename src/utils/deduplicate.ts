import { readAssetFile } from './file-system';
import type { AssetInfo } from './siyuan-db';
import { usePlugin } from './plugin-context';
import {
  createEmptyFingerprintStore,
  isFingerprintValid,
  pruneFingerprintStore,
  type IAssetFingerprint,
  type IFingerprintStore,
} from './dedup-fingerprint-store';
import { log, warn, error } from './logger';
import { mapWithConcurrency, normalizeConcurrency } from './concurrency';

// 重新导出纯算法模块中的函数与常量
export {
  IMAGE_EXTENSIONS,
  isImageFile,
  blobToArrayBuffer,
  computeFileHash,
  computeDHashFromGrayscale,
  computeImageDHash,
  calculateHammingDistance,
  calculateDHashSimilarity,
} from './dedup-hash';

// 重新导出归一化合并工作流模块
export {
  normalizeDuplicateGroup,
  batchNormalizeDuplicateGroups,
  type INormalizeStats,
  type INormalizeOptions,
} from './dedup-normalize';

import {
  isImageFile,
  computeFileHash,
  computeImageDHash,
  calculateHammingDistance,
  calculateDHashSimilarity,
} from './dedup-hash';

export type DeduplicateMode = 'exact' | 'similar';

export interface IDuplicateItem {
  asset: AssetInfo;
  hash?: string; // SHA-256 文件哈希 (精确模式)
  dHash?: string; // 64位感知哈希 (视觉相似模式)
  score: number; // 智能推荐分数
  isCanonical: boolean; // 是否为选中的主保留项
  width?: number; // 图片宽度
  height?: number; // 图片高度
}

export interface IDuplicateGroup {
  id: string; // 唯一分组标识
  mode: DeduplicateMode; // 去重模式
  similarity: number; // 相似度 0~1 (精确模式为 1.0)
  canonicalAssetName: string; // 当前选中的主资源文件名
  items: IDuplicateItem[]; // 组内资源列表
  redundantCount: number; // 冗余文件数量 (items.length - 1)
  redundantSize: number; // 预估可释放空间 (字节)
  isProcessed?: boolean; // 是否已归一化处理
  isIgnored?: boolean; // 是否已忽略
}

export interface IDeduplicateScanProgress {
  phase: 'grouping' | 'hashing' | 'perceptual' | 'done';
  current: number;
  total: number;
  message: string;
}

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

/** 阶段二并发度：IO + crypto.subtle.digest，后者真异步且不占主线程，每项仅一个 Blob */
export const DEFAULT_HASH_CONCURRENCY = 8;
/**
 * 阶段三并发度：Image 解码，每项一个全分辨率位图（一张 4000×3000 约 48MB RGBA），
 * 内存是硬约束。故显著低于阶段二。
 */
export const DEFAULT_DECODE_CONCURRENCY = 3;

/**
 * 第一阶段：按文件大小快速初筛
 * 过滤掉体积唯一的单文件（仅保留存在相同大小的多文件候选池）
 */
export function groupBySize(assets: AssetInfo[]): Map<number, AssetInfo[]> {
  const sizeMap = new Map<number, AssetInfo[]>();
  for (const asset of assets) {
    if (asset.isDir || asset.isOriginal) continue;
    const size = asset.size || 0;
    if (size <= 0) continue; // 忽略无效或空文件

    if (!sizeMap.has(size)) {
      sizeMap.set(size, []);
    }
    sizeMap.get(size)!.push(asset);
  }

  // 仅保留候选数量 >= 2 的分组
  const duplicateSizeMap = new Map<number, AssetInfo[]>();
  for (const [size, list] of sizeMap.entries()) {
    if (list.length >= 2) {
      duplicateSizeMap.set(size, list);
    }
  }
  return duplicateSizeMap;
}



/**
 * 候选主资源智能评分算法
 * 优先级：具备二次编辑元数据 > 引用次数多 > 引用文档多 > 分辨率/体积大 > 创建时间早
 */
export function scoreAssetCandidate(
  asset: AssetInfo,
  width: number = 0,
  height: number = 0
): number {
  let score = 0;
  // 1. 包含二次编辑元数据（最高权重，避免丢失图层标注）
  if (asset.isReEditable) {
    score += 10000;
  }
  // 2. 引用块总数权重
  score += (asset.refCount || 0) * 100;
  // 3. 引用文档数量权重
  score += (asset.docCount || 0) * 50;
  // 4. 图片物理像素面积（保留更高清晰度）
  if (width * height > 0) {
    score += Math.min(200, Math.floor((width * height) / 10000));
  }
  // 5. 文件体积
  score += Math.min(50, Math.floor((asset.size || 0) / 10240));
  // 6. 更新时间戳更早（越早越可能是原图）
  if (asset.updated) {
    score += Math.max(0, 10 - Math.floor((Date.now() - asset.updated) / (1000 * 3600 * 24 * 365)));
  }
  return score;
}

/**
 * 挑选出得分最高者作为默认主资源
 */
export function pickCanonicalAsset(items: IDuplicateItem[]): string {
  if (!items || items.length === 0) return '';
  let bestItem = items[0];
  for (let i = 1; i < items.length; i++) {
    if (items[i].score > bestItem.score) {
      bestItem = items[i];
    }
  }
  return bestItem.asset.name;
}

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

/**
 * 把上一轮分组的用户决策（已忽略 / 已处理）延续到本轮重算出的分组上。
 *
 * 组 id 由成员文件名集合派生，因此 id 相同即成员未变，用户的判断应当存活；
 * 成员发生变动的组会拿到新 id，自然回到待处理状态——这正是内容派生 id 的意义。
 * 没有这一步，重扫会把所有已忽略的组重新变回待处理，本特性等于没做。
 *
 * 刻意不延续 canonicalAssetName：那是与"忽略"不同的产品决策，另行讨论。
 *
 * @returns 实际延续了状态的分组数量
 */
export function carryOverGroupState(
  next: IDuplicateGroup[],
  prev: IDuplicateGroup[]
): number {
  const prevById = new Map(prev.map((g) => [g.id, g]));
  let carried = 0;
  for (const group of next) {
    const previous = prevById.get(group.id);
    if (!previous) continue;
    if (previous.isProcessed) group.isProcessed = true;
    if (previous.isIgnored) group.isIgnored = true;
    if (previous.isProcessed || previous.isIgnored) carried++;
  }
  return carried;
}

/**
 * 计算重复组的冗余空间
 */
export function calculateGroupRedundantSize(items: IDuplicateItem[], canonicalName: string): number {
  let total = 0;
  for (const item of items) {
    if (item.asset.name !== canonicalName) {
      total += item.asset.size || 0;
    }
  }
  return total;
}

/**
 * 阶段三提取出的单张图片特征。
 * 定义在模块层级：阶段三的池化闭包引用该类型，函数内的局部接口不再可见。
 */
interface IImageFeature {
  asset: AssetInfo;
  dHash: string;
  width: number;
  height: number;
  score: number;
}

/**
 * 异步执行完整的资源去重扫描流水线
 */
export async function scanDuplicates(
  assets: AssetInfo[],
  options: {
    minSimilarity?: number; // 相似度阈值 (0.80 ~ 1.0, 默认 0.90)
    onProgress?: (progress: IDeduplicateScanProgress) => void;
    abortSignal?: { aborted: boolean };
    fingerprints?: IFingerprintStore;
    forceRehash?: boolean;
    /** 并发度覆盖：hash 为阶段二，decode 为阶段三。非法值回退到各自默认值 */
    concurrency?: { hash?: number; decode?: number };
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

  const hashLimit = normalizeConcurrency(options.concurrency?.hash, DEFAULT_HASH_CONCURRENCY);
  const decodeLimit = normalizeConcurrency(options.concurrency?.decode, DEFAULT_DECODE_CONCURRENCY);

  let reused = 0;
  let computed = 0;

  /** 取可复用的条目；forceRehash 或失效时返回 null */
  const reusableEntry = (asset: AssetInfo): IAssetFingerprint | null => {
    if (forceRehash) return null;
    const entry = fingerprints.entries[asset.name];
    return isFingerprintValid(entry, asset) ? entry! : null;
  };

  // 1. 过滤有效常规资源
  const validAssets = assets.filter(a => !a.isDir && !a.isOriginal);

  // -------------------------------------------------------------
  // 阶段一：按文件大小初筛，快速排重
  // -------------------------------------------------------------
  onProgress({
    phase: 'grouping',
    current: 0,
    total: validAssets.length,
    message: '正在按文件大小初筛候选文件...',
  });

  const sizeCandidatesMap = groupBySize(validAssets);
  const candidateAssets: AssetInfo[] = [];
  for (const list of sizeCandidatesMap.values()) {
    candidateAssets.push(...list);
  }

  if (abortSignal.aborted) {
    return {
      exactGroups: [],
      similarGroups: [],
      fingerprints,
      stats: { reused, computed },
    };
  }

  // -------------------------------------------------------------
  // 阶段二：计算候选文件精确 SHA-256 哈希
  // -------------------------------------------------------------
  onProgress({
    phase: 'hashing',
    current: 0,
    total: candidateAssets.length,
    message: `正在计算 ${candidateAssets.length} 个候选文件的精确哈希...`,
  });

  const assetHashMap = new Map<string, string>(); // assetName -> sha256
  const exactClusters = new Map<string, AssetInfo[]>(); // hash -> assets

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
          // 失效条目整体替换，绝不合并旧字段：文件内容已变，
          // 旧的 sha256/dHash 全部作废，合并会留下陈旧值
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

  // 按原始顺序归并，保证分组输出不随并发完成顺序抖动。
  // 池中止时未认领的位置是空洞，出错的位置是 undefined，两者均由 !item 跳过。
  for (const item of hashResults) {
    if (!item) continue;
    assetHashMap.set(item.asset.name, item.hash);
    if (!exactClusters.has(item.hash)) {
      exactClusters.set(item.hash, []);
    }
    exactClusters.get(item.hash)!.push(item.asset);
  }

  // 中止检查前移：必须在构建 exactGroups 之前。否则中止时会返回"部分分组"，
  // 返回契约不统一（弹窗本就以 if (!aborted) 守卫，故无行为损失）。
  if (abortSignal.aborted) {
    return { exactGroups: [], similarGroups: [], fingerprints, stats: { reused, computed } };
  }

  // 构建精确重复组
  const exactGroups: IDuplicateGroup[] = [];
  const exactMatchedAssetNames = new Set<string>();

  for (const [hash, cluster] of exactClusters.entries()) {
    if (cluster.length >= 2) {
      const items: IDuplicateItem[] = cluster.map(asset => ({
        asset,
        hash,
        score: scoreAssetCandidate(asset),
        isCanonical: false,
      }));

      const canonicalName = pickCanonicalAsset(items);
      for (const item of items) {
        item.isCanonical = item.asset.name === canonicalName;
        exactMatchedAssetNames.add(item.asset.name);
      }

      exactGroups.push({
        id: deriveGroupId('exact', items),
        mode: 'exact',
        similarity: 1.0,
        canonicalAssetName: canonicalName,
        items,
        redundantCount: items.length - 1,
        redundantSize: calculateGroupRedundantSize(items, canonicalName),
      });
    }
  }

  // -------------------------------------------------------------
  // 阶段三：对图片资源异步计算感知哈希 (dHash) 与视觉相似比对
  // -------------------------------------------------------------
  const imageAssets = validAssets.filter(
    a => isImageFile(a.name) && !exactMatchedAssetNames.has(a.name)
  );

  onProgress({
    phase: 'perceptual',
    current: 0,
    total: imageAssets.length,
    message: `正在提取 ${imageAssets.length} 张图片的视觉感知特征...`,
  });

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
          // score 必须每次重算：它依赖 refCount/docCount/isReEditable，
          // 这些会在文件字节完全不变的情况下变化
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
              // 阶段二刚写入的 sha256 必须保留（此时条目有效）；
              // 若条目本就失效则一并丢弃
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

  // 保序收集：imageFeatures 的构建顺序影响聚类输出，须与 imageAssets 一致
  const imageFeatures: IImageFeature[] = featureResults.filter(
    (f): f is IImageFeature => f !== null
  );

  // 中止检查（阶段三池返回后）：与 Task 5 循环内中止返回的形状一致——
  // 保留已构建的 exactGroups，similarGroups 置空，且不得裁剪（资源集合不完整）
  if (abortSignal.aborted) {
    return { exactGroups, similarGroups: [], fingerprints, stats: { reused, computed } };
  }

  // 使用并查集 (Disjoint Set) 将汉明距离满足阈值的图片聚类为疑似相似组
  const parent = new Array(imageFeatures.length).fill(0).map((_, i) => i);
  function findRoot(i: number): number {
    if (parent[i] === i) return i;
    parent[i] = findRoot(parent[i]);
    return parent[i];
  }
  function union(i: number, j: number) {
    const rootI = findRoot(i);
    const rootJ = findRoot(j);
    if (rootI !== rootJ) {
      parent[rootI] = rootJ;
    }
  }

  for (let i = 0; i < imageFeatures.length; i++) {
    for (let j = i + 1; j < imageFeatures.length; j++) {
      const sim = calculateDHashSimilarity(imageFeatures[i].dHash, imageFeatures[j].dHash);
      if (sim >= minSimilarity) {
        union(i, j);
      }
    }
  }

  // 聚类归组
  const clusters = new Map<number, IImageFeature[]>();
  for (let i = 0; i < imageFeatures.length; i++) {
    const root = findRoot(i);
    if (!clusters.has(root)) {
      clusters.set(root, []);
    }
    clusters.get(root)!.push(imageFeatures[i]);
  }

  const similarGroups: IDuplicateGroup[] = [];

  for (const cluster of clusters.values()) {
    if (cluster.length >= 2) {
      const items: IDuplicateItem[] = cluster.map(feat => ({
        asset: feat.asset,
        dHash: feat.dHash,
        width: feat.width,
        height: feat.height,
        score: feat.score,
        isCanonical: false,
      }));

      const canonicalName = pickCanonicalAsset(items);
      for (const item of items) {
        item.isCanonical = item.asset.name === canonicalName;
      }

      // 计算平均相似度
      let simSum = 0;
      let pairCount = 0;
      for (let a = 0; a < cluster.length; a++) {
        for (let b = a + 1; b < cluster.length; b++) {
          simSum += calculateDHashSimilarity(cluster[a].dHash, cluster[b].dHash);
          pairCount++;
        }
      }
      const avgSimilarity = pairCount > 0 ? simSum / pairCount : minSimilarity;

      similarGroups.push({
        id: deriveGroupId('similar', items),
        mode: 'similar',
        similarity: Math.round(avgSimilarity * 100) / 100,
        canonicalAssetName: canonicalName,
        items,
        redundantCount: items.length - 1,
        redundantSize: calculateGroupRedundantSize(items, canonicalName),
      });
    }
  }

  // 裁剪只在完整扫描后执行：中止时资源集合可能不完整，
  // 按不完整集合删除条目会误伤有效指纹
  pruneFingerprintStore(fingerprints, new Set(validAssets.map((a) => a.name)));

  onProgress({
    phase: 'done',
    current: validAssets.length,
    total: validAssets.length,
    message: '扫描完成！',
  });

  return { exactGroups, similarGroups, fingerprints, stats: { reused, computed } };
}



// -------------------------------------------------------------
// 持久化存储相关
// -------------------------------------------------------------
export const DEDUP_CACHE_FILE = 'deduplicate-cache.json';
export const DEDUP_LOCAL_STORAGE_KEY = 'siyuan_assets_dedup_cache';

/** 分组缓存的 schema 版本。指纹文件另有一套独立的版本命名空间，勿混用 */
export const DEDUP_CACHE_VERSION = 2;

export interface IDeduplicateCache {
  version: number; // schema 版本，必须等于 DEDUP_CACHE_VERSION，否则缓存作废
  lastScanTime: number; // 扫描完成时间戳 (ms)
  similarityThreshold: number; // 相似度阈值 (80 ~ 100)
  exactGroups: IDuplicateGroup[];
  similarGroups: IDuplicateGroup[];
}

/**
 * 将去重比对分析数据持久化保存到思源插件存储 (优先 saveData，保底 localStorage)
 */
export async function saveDeduplicateCache(cache: IDeduplicateCache): Promise<boolean> {
  try {
    const plugin = usePlugin();
    if (plugin && typeof plugin.saveData === 'function') {
      await plugin.saveData(DEDUP_CACHE_FILE, cache);
      log(`[deduplicate] 成功持久化保存比对数据到 ${DEDUP_CACHE_FILE}`);
      return true;
    }
  } catch (e) {
    warn('[deduplicate] plugin.saveData cache error:', e);
  }

  // 保底 localStorage 存储
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(DEDUP_LOCAL_STORAGE_KEY, JSON.stringify(cache));
      log(`[deduplicate] 成功保存比对数据到 localStorage`);
      return true;
    }
  } catch (e) {
    warn('[deduplicate] localStorage cache error:', e);
  }

  return false;
}

/**
 * 从持久化存储中读取最近一次去重比对数据
 */
export async function loadDeduplicateCache(): Promise<IDeduplicateCache | null> {
  try {
    const plugin = usePlugin();
    if (plugin && typeof plugin.loadData === 'function') {
      const data = await plugin.loadData(DEDUP_CACHE_FILE);
      if (data) {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        if (
          parsed &&
          parsed.version === DEDUP_CACHE_VERSION &&
          Array.isArray(parsed.exactGroups) &&
          Array.isArray(parsed.similarGroups)
        ) {
          log(`[deduplicate] 成功从 ${DEDUP_CACHE_FILE} 加载缓存比对数据`);
          return parsed as IDeduplicateCache;
        }
      }
    }
  } catch (e) {
    warn('[deduplicate] plugin.loadData cache error:', e);
  }

  // 保底从 localStorage 读取
  try {
    if (typeof localStorage !== 'undefined') {
      const item = localStorage.getItem(DEDUP_LOCAL_STORAGE_KEY);
      if (item) {
        const parsed = JSON.parse(item);
        if (
          parsed &&
          parsed.version === DEDUP_CACHE_VERSION &&
          Array.isArray(parsed.exactGroups) &&
          Array.isArray(parsed.similarGroups)
        ) {
          log(`[deduplicate] 成功从 localStorage 加载缓存比对数据`);
          return parsed as IDeduplicateCache;
        }
      }
    }
  } catch (e) {
    warn('[deduplicate] localStorage load error:', e);
  }

  return null;
}

/**
 * 清空去重持久化缓存
 */
export async function clearDeduplicateCache(): Promise<boolean> {
  try {
    const plugin = usePlugin();
    if (plugin && typeof plugin.removeData === 'function') {
      await plugin.removeData(DEDUP_CACHE_FILE);
    }
  } catch (e) {}

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(DEDUP_LOCAL_STORAGE_KEY);
    }
    return true;
  } catch (e) {}

  return false;
}

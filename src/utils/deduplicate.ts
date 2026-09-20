import { readAssetFile, deleteAsset, readAssetMetadataFile, saveAssetMetadataFile, isTrashSupported } from './file-system';
import { replaceAssetInBlocks, queryCurrentAssetBlockReferences, verifyAssetZeroReferences, getImageBlockReEditData, setImageBlockReEditData } from './siyuan-block';
import { replaceAssetInAttributeViews } from './attribute-view';
import type { AssetInfo, BlockRef } from './siyuan-db';
import type { IAssetReEditMetadata } from '../types/reedit';
import { usePlugin } from './plugin-context';
import { recordDeletionBatch, type IDeletedItemRecord, type DeleteDestination } from './deletion-logger';
import { captureAssetThumbnail } from './image-editor';
import { log, warn, error } from './logger';

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

export interface INormalizeStats {
  affectedDocsCount: number;
  affectedBlocksCount: number;
  deletedFilesCount: number;
  freedBytes: number;
}

const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'svg', 'ico', 'avif', 'tiff'
]);

/**
 * 判断是否为图片资源
 */
export function isImageFile(fileName: string): boolean {
  if (!fileName) return false;
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  return IMAGE_EXTENSIONS.has(ext);
}

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
 * 安全地将 Blob 转换为 ArrayBuffer (兼容各类环境)
 */
export async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof (blob as any).arrayBuffer === 'function') {
    return await (blob as any).arrayBuffer();
  }
  if (typeof (blob as any).bytes === 'function') {
    const bytes = await (blob as any).bytes();
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  if (typeof (blob as any).text === 'function') {
    try {
      const text = await (blob as any).text();
      const encoder = new TextEncoder();
      const u8 = encoder.encode(text);
      return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    } catch (e) {}
  }
  return new Promise((resolve) => {
    if (typeof FileReader === 'undefined') {
      resolve(new ArrayBuffer(0));
      return;
    }
    const reader = new FileReader();
    reader.onload = (event: any) => {
      const res = event?.target?.result || reader.result;
      resolve(res as ArrayBuffer);
    };
    reader.onerror = () => {
      resolve(new ArrayBuffer(0));
    };
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * 计算 Blob 数据的 SHA-256 哈希值
 */
export async function computeFileHash(blob: Blob): Promise<string> {
  const arrayBuffer = await blobToArrayBuffer(blob);
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // 简易保底哈希算法（极端无 crypto.subtle 环境）
  const u8 = new Uint8Array(arrayBuffer);
  let h1 = 0xdeadbeef, h2 = 0x41c64e6d;
  for (let i = 0; i < u8.length; i++) {
    const ch = u8[i];
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(16, '0');
}

/**
 * 基于 9x8 灰度矩阵生成 64-bit dHash（差异哈希）
 * 比较水平相邻像素亮度差，每行 8 次比较，共 64 位
 */
export function computeDHashFromGrayscale(grayMatrix: number[][]): string {
  let bits = '';
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const left = grayMatrix[row]?.[col] ?? 0;
      const right = grayMatrix[row]?.[col + 1] ?? 0;
      bits += left > right ? '1' : '0';
    }
  }
  return bits.padEnd(64, '0');
}

/**
 * 从图片 Blob 计算 dHash 感知哈希与分辨率
 */
export async function computeImageDHash(blob: Blob): Promise<{ dHash: string; width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || typeof Image === 'undefined') {
      resolve(null);
      return;
    }

    const img = new Image();
    let url = '';
    try {
      url = typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(blob) : '';
    } catch (e) {
      resolve(null);
      return;
    }

    let isDone = false;
    const timer = setTimeout(() => {
      if (!isDone) {
        isDone = true;
        if (url) {
          try { URL.revokeObjectURL(url); } catch (e) {}
        }
        resolve(null);
      }
    }, 1500);

    const cleanup = () => {
      isDone = true;
      clearTimeout(timer);
      if (url) {
        try { URL.revokeObjectURL(url); } catch (e) {}
      }
    };

    img.crossOrigin = 'anonymous';

    img.onload = () => {
      if (isDone) return;
      try {
        const width = img.naturalWidth || img.width || 0;
        const height = img.naturalHeight || img.height || 0;

        const canvas = document.createElement('canvas');
        canvas.width = 9;
        canvas.height = 8;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          cleanup();
          resolve(null);
          return;
        }

        ctx.drawImage(img, 0, 0, 9, 8);
        const imgData = ctx.getImageData(0, 0, 9, 8);
        const data = imgData.data;

        const grayMatrix: number[][] = [];
        for (let row = 0; row < 8; row++) {
          const rowData: number[] = [];
          for (let col = 0; col < 9; col++) {
            const idx = (row * 9 + col) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            // 标准灰度加权公式
            const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
            rowData.push(gray);
          }
          grayMatrix.push(rowData);
        }

        const dHash = computeDHashFromGrayscale(grayMatrix);
        cleanup();
        resolve({ dHash, width, height });
      } catch (err) {
        warn('[deduplicate] computeImageDHash error:', err);
        cleanup();
        resolve(null);
      }
    };

    img.onerror = () => {
      if (isDone) return;
      cleanup();
      resolve(null);
    };

    img.src = url;
  });
}

/**
 * 计算两个 64-bit 哈希的汉明距离（不同位的数量，0~64）
 */
export function calculateHammingDistance(hashA: string, hashB: string): number {
  if (!hashA || !hashB || hashA.length !== hashB.length) return 64;
  let dist = 0;
  for (let i = 0; i < hashA.length; i++) {
    if (hashA[i] !== hashB[i]) {
      dist++;
    }
  }
  return dist;
}

/**
 * 将汉明距离转换为 0.0 ~ 1.0 的相似度百分比
 */
export function calculateDHashSimilarity(hashA: string, hashB: string): number {
  const dist = calculateHammingDistance(hashA, hashB);
  return Math.max(0, 1 - dist / 64);
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
 * 异步执行完整的资源去重扫描流水线
 */
export async function scanDuplicates(
  assets: AssetInfo[],
  options: {
    minSimilarity?: number; // 相似度阈值 (0.80 ~ 1.0, 默认 0.90)
    onProgress?: (progress: IDeduplicateScanProgress) => void;
    abortSignal?: { aborted: boolean };
  } = {}
): Promise<{ exactGroups: IDuplicateGroup[]; similarGroups: IDuplicateGroup[] }> {
  const minSimilarity = options.minSimilarity ?? 0.90;
  const onProgress = options.onProgress || (() => {});
  const abortSignal = options.abortSignal || { aborted: false };

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
    return { exactGroups: [], similarGroups: [] };
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

  let hashProcessed = 0;
  for (const asset of candidateAssets) {
    if (abortSignal.aborted) return { exactGroups: [], similarGroups: [] };

    try {
      const blob = await readAssetFile(asset.name);
      if (blob) {
        const hash = await computeFileHash(blob);
        assetHashMap.set(asset.name, hash);

        if (!exactClusters.has(hash)) {
          exactClusters.set(hash, []);
        }
        exactClusters.get(hash)!.push(asset);
      }
    } catch (e) {
      warn(`[deduplicate] 读取文件 ${asset.name} 计算哈希失败:`, e);
    }

    hashProcessed++;
    if (hashProcessed % 5 === 0 || hashProcessed === candidateAssets.length) {
      onProgress({
        phase: 'hashing',
        current: hashProcessed,
        total: candidateAssets.length,
        message: `正在计算精确哈希 (${hashProcessed}/${candidateAssets.length})...`,
      });
    }
  }

  // 构建精确重复组
  const exactGroups: IDuplicateGroup[] = [];
  const exactMatchedAssetNames = new Set<string>();
  let exactGroupIdx = 1;

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
        id: `exact_${exactGroupIdx++}`,
        mode: 'exact',
        similarity: 1.0,
        canonicalAssetName: canonicalName,
        items,
        redundantCount: items.length - 1,
        redundantSize: calculateGroupRedundantSize(items, canonicalName),
      });
    }
  }

  if (abortSignal.aborted) {
    return { exactGroups, similarGroups: [] };
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

  interface IImageFeature {
    asset: AssetInfo;
    dHash: string;
    width: number;
    height: number;
    score: number;
  }

  const imageFeatures: IImageFeature[] = [];
  let dHashProcessed = 0;

  for (const asset of imageAssets) {
    if (abortSignal.aborted) return { exactGroups, similarGroups: [] };

    try {
      const blob = await readAssetFile(asset.name);
      if (blob) {
        const feature = await computeImageDHash(blob);
        if (feature) {
          const score = scoreAssetCandidate(asset, feature.width, feature.height);
          imageFeatures.push({
            asset,
            dHash: feature.dHash,
            width: feature.width,
            height: feature.height,
            score,
          });
        }
      }
    } catch (e) {
      warn(`[deduplicate] 提取图片特征 ${asset.name} 失败:`, e);
    }

    dHashProcessed++;
    if (dHashProcessed % 5 === 0 || dHashProcessed === imageAssets.length) {
      onProgress({
        phase: 'perceptual',
        current: dHashProcessed,
        total: imageAssets.length,
        message: `正在提取视觉感知特征 (${dHashProcessed}/${imageAssets.length})...`,
      });
    }
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
  let similarGroupIdx = 1;

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
        id: `similar_${similarGroupIdx++}`,
        mode: 'similar',
        similarity: Math.round(avgSimilarity * 100) / 100,
        canonicalAssetName: canonicalName,
        items,
        redundantCount: items.length - 1,
        redundantSize: calculateGroupRedundantSize(items, canonicalName),
      });
    }
  }

  onProgress({
    phase: 'done',
    current: validAssets.length,
    total: validAssets.length,
    message: '扫描完成！',
  });

  return { exactGroups, similarGroups };
}

export interface INormalizeOptions {
  skipRecordBatch?: boolean;
  outRecords?: IDeletedItemRecord[];
}

/**
 * 对单个重复组执行归一化合并
 */
export async function normalizeDuplicateGroup(
  group: IDuplicateGroup,
  assetsMap?: Map<string, AssetInfo>,
  options?: INormalizeOptions
): Promise<INormalizeStats> {
  const stats: INormalizeStats = {
    affectedDocsCount: 0,
    affectedBlocksCount: 0,
    deletedFilesCount: 0,
    freedBytes: 0,
  };

  const canonicalName = group.canonicalAssetName;
  if (!canonicalName) {
    throw new Error('未指定主保留资源文件');
  }

  const canonicalItem = group.items.find(it => it.asset.name === canonicalName);
  const canonicalAsset = canonicalItem?.asset || assetsMap?.get(canonicalName);

  // 检查主资源是否携带二次编辑元数据
  let canonicalReEditMeta: IAssetReEditMetadata | null = null;
  try {
    canonicalReEditMeta = await readAssetMetadataFile(canonicalName);
  } catch (e) {}

  if (!canonicalReEditMeta && canonicalAsset?.isReEditable && canonicalAsset.reEditBlockId) {
    try {
      canonicalReEditMeta = await getImageBlockReEditData(canonicalAsset.reEditBlockId);
    } catch (e) {
      warn(`[deduplicate] 获取主资源二次编辑元数据失败:`, e);
    }
  }

  if (canonicalReEditMeta) {
    try {
      await saveAssetMetadataFile(canonicalName, canonicalReEditMeta);
    } catch (e) {}
  }

  const affectedRootIds = new Set<string>();
  const deletedItemRecords: IDeletedItemRecord[] = [];

  for (const item of group.items) {
    if (item.asset.name === canonicalName) continue;

    const redundant = item.asset;

    // 1. 动态全库实时查询最新引用块，防止读取过期缓存导致漏掉后来新建或修改的文档
    const latestRefs = await queryCurrentAssetBlockReferences(redundant.name);
    const refMap = new Map<string, BlockRef>();
    for (const r of (redundant.references || [])) {
      if (r.id) refMap.set(r.id, r);
    }
    for (const r of latestRefs) {
      if (r.id) refMap.set(r.id, r);
    }
    const combinedRefs = Array.from(refMap.values());

    if (combinedRefs.length > 0) {
      // 2. 替换正文 Markdown 及 IAL 块属性（如封面图 title-img、custom-data-assets）
      await replaceAssetInBlocks(combinedRefs, redundant.name, canonicalName);
      stats.affectedBlocksCount += combinedRefs.length;
      for (const r of combinedRefs) {
        if (r.root_id) affectedRootIds.add(r.root_id);
      }
    }

    // 3. 属性视图 (Attribute View) 全局无条件原子替换（即便正文未引用，AV 中仍可能有引用）
    try {
      await replaceAssetInAttributeViews(redundant.name, canonicalName);
    } catch (avErr) {
      error(`[deduplicate] 归一化更新数据库属性视图失败:`, avErr);
      throw avErr;
    }

    // 4. 【核心生死线】删除前强制二次安全复核 (Pre-delete Double Check)
    // 结合思源内核事务主动刷新与内存 AST 树穿透核查，确认全库旧文件引用数确已为 0。
    // 若经真实 AST 深度核查后仍有真实残留引用，坚决禁止删除物理文件！
    const { isClean, remainingBlocks } = await verifyAssetZeroReferences(redundant.name);
    if (!isClean && remainingBlocks.length > 0) {
      const errMsg = `[去重安全拦截] 冗余资源 [${redundant.name}] 尚有 ${remainingBlocks.length} 处文档引用未完成替换，已终止删除该物理文件！受影响块ID: ${remainingBlocks.map(b => b.id).slice(0, 3).join(', ')}`;
      error(errMsg);
      throw new Error(errMsg);
    }

    // 5. 确认 0 引用后，安全删除多余冗余物理文件
    try {
      let thumbnail: string | undefined;
      try {
        thumbnail = await captureAssetThumbnail(`/assets/${redundant.name}`);
      } catch {}

      await deleteAsset(redundant.name);
      stats.deletedFilesCount += 1;
      stats.freedBytes += redundant.size || 0;
      log(`[deduplicate] 成功归一化并安全删除冗余资源: ${redundant.name}`);

      const record: IDeletedItemRecord = {
        fileName: redundant.name,
        originalRelativePath: `data/assets/${redundant.name}`,
        size: redundant.size || 0,
        canonicalName,
        thumbnail,
        affectedBlocks: combinedRefs.map((r) => ({ id: r.id, root_id: r.root_id })),
      };
      deletedItemRecords.push(record);
      if (options?.outRecords) {
        options.outRecords.push(record);
      }
    } catch (delErr) {
      error(`[deduplicate] 删除冗余文件 ${redundant.name} 失败:`, delErr);
      throw delErr;
    }
  }

  stats.affectedDocsCount = affectedRootIds.size;
  group.isProcessed = true;

  // 记录单组删除批次
  if (!options?.skipRecordBatch && deletedItemRecords.length > 0) {
    const destination: DeleteDestination = isTrashSupported() ? 'os-trash' : 'permanent';
    try {
      await recordDeletionBatch({
        actionType: 'deduplicate',
        destination,
        items: deletedItemRecords,
        freedBytes: stats.freedBytes,
        canRollback: true,
      });
    } catch (logErr) {
      warn('[deduplicate] 记录删除批次失败:', logErr);
    }
  }

  return stats;
}

/**
 * 批量执行多个重复组归一化合并
 */
export async function batchNormalizeDuplicateGroups(
  groups: IDuplicateGroup[],
  assetsMap?: Map<string, AssetInfo>,
  onProgress?: (current: number, total: number) => void
): Promise<INormalizeStats> {
  const totalStats: INormalizeStats = {
    affectedDocsCount: 0,
    affectedBlocksCount: 0,
    deletedFilesCount: 0,
    freedBytes: 0,
  };

  const pendingGroups = groups.filter(g => !g.isProcessed && !g.isIgnored);
  let processed = 0;
  const allBatchRecords: IDeletedItemRecord[] = [];

  for (const group of pendingGroups) {
    const singleStats = await normalizeDuplicateGroup(group, assetsMap, {
      skipRecordBatch: true,
      outRecords: allBatchRecords,
    });
    totalStats.affectedDocsCount += singleStats.affectedDocsCount;
    totalStats.affectedBlocksCount += singleStats.affectedBlocksCount;
    totalStats.deletedFilesCount += singleStats.deletedFilesCount;
    totalStats.freedBytes += singleStats.freedBytes;

    processed++;
    if (onProgress) {
      onProgress(processed, pendingGroups.length);
    }
  }

  // 批量记录统一去重批次
  if (allBatchRecords.length > 0) {
    const destination: DeleteDestination = isTrashSupported() ? 'os-trash' : 'permanent';
    try {
      await recordDeletionBatch({
        actionType: 'deduplicate',
        destination,
        items: allBatchRecords,
        freedBytes: totalStats.freedBytes,
        canRollback: true,
      });
    } catch (logErr) {
      warn('[deduplicate] 批量记录删除批次失败:', logErr);
    }
  }

  return totalStats;
}

// -------------------------------------------------------------
// 持久化存储相关
// -------------------------------------------------------------
export const DEDUP_CACHE_FILE = 'deduplicate-cache.json';
export const DEDUP_LOCAL_STORAGE_KEY = 'siyuan_assets_dedup_cache';

export interface IDeduplicateCache {
  version: number;
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
        if (parsed && Array.isArray(parsed.exactGroups) && Array.isArray(parsed.similarGroups)) {
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
        if (parsed && Array.isArray(parsed.exactGroups) && Array.isArray(parsed.similarGroups)) {
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

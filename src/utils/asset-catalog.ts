import { sql, readDir } from '../api';
import { queryAllReEditableBlocks } from './siyuan-block';
import {
  listOriginalImages,
  deleteOriginalImage,
  normalizeOriginalStoragePath,
  listAllAssetMetadataFiles,
  saveAssetMetadataFile,
} from './file-system';
import { defaultStorage } from './storage';
import type { IAssetReEditMetadata } from '../types/reedit';
import { log, warn, error } from './logger';
import {
  type BlockRef,
  type AssetInfo,
  type OrphanOriginalInfo,
  createAssetInfoMap,
  attachBlockReferences,
  updateAssetDocCounts,
  attachReEditMetadata,
  getNotebookMap,
} from './siyuan-db';

export interface CatalogInventory {
  allAssets: AssetInfo[];
  assetsMap: Map<string, AssetInfo>;
  originalAssets: AssetInfo[];
  orphanOriginals: OrphanOriginalInfo[];
  totalOrphanSize: number;
}

/**
 * 统一领域解析流水线：
 * 将物理资产文件、Markdown SQL 块引用、二次编辑块属性、全局 Sidecar 元数据与隔离底图融合成一致的模型图
 */
export function resolveCatalogPipeline(
  files: any[],
  blocks: any[],
  reEditBlocks: Array<{ blockId: string; rootId: string; metadata: IAssetReEditMetadata }>,
  originalFiles: Array<{ name: string; path: string; size: number; updated: number }>,
  notebookMap: Map<string, string>,
  sidecarMetadataList: Array<{ assetName: string; metadata: IAssetReEditMetadata }> = []
): CatalogInventory {
  // 1. 构建常规资产 Map 并挂载引用
  const assetsMap = createAssetInfoMap(files);
  if (blocks && blocks.length > 0) {
    attachBlockReferences(assetsMap, blocks, notebookMap);
  }
  updateAssetDocCounts(assetsMap.values());

  // 1.1 挂载 Sidecar 元数据（优先全局真理源）
  if (sidecarMetadataList && sidecarMetadataList.length > 0) {
    for (const item of sidecarMetadataList) {
      const renderedName = item.metadata.renderedAssetName || item.assetName;
      if (renderedName && assetsMap.has(renderedName)) {
        const asset = assetsMap.get(renderedName)!;
        asset.isReEditable = true;
        asset.originalStoragePath = item.metadata.originalStoragePath;
        if (!asset.reEditBlockId && asset.references && asset.references.length > 0) {
          asset.reEditBlockId = asset.references[0].id;
        }
      }
    }
  }

  // 1.2 补充挂载块级元数据（向前兼容历史数据）
  if (reEditBlocks && reEditBlocks.length > 0) {
    attachReEditMetadata(assetsMap, reEditBlocks);
  }

  // 2. 建立底图与有效文档引用的双向拓扑映射
  const originalToRefsMap = new Map<string, BlockRef[]>();

  // 2.1 从 Sidecar 关联底图与有效引用
  if (sidecarMetadataList && sidecarMetadataList.length > 0) {
    for (const item of sidecarMetadataList) {
      const normPath = normalizeOriginalStoragePath(item.metadata.originalStoragePath);
      if (!normPath) continue;

      const renderedName = item.metadata.renderedAssetName || item.assetName;
      const renderedAsset = renderedName ? assetsMap.get(renderedName) : undefined;
      // 渲染图片必须在 assetsMap 中真实存在且仍有文档引用
      if (!renderedAsset || !renderedAsset.references || renderedAsset.references.length === 0) {
        continue;
      }

      let refs = originalToRefsMap.get(normPath);
      if (!refs) {
        refs = [];
        originalToRefsMap.set(normPath, refs);
      }

      for (const ref of renderedAsset.references) {
        if (!refs.some((r) => r.id === ref.id)) {
          refs.push(ref);
        }
      }
    }
  }

  // 2.2 从块级元数据关联底图与有效引用（向前兼容）
  for (const item of reEditBlocks) {
    const normPath = normalizeOriginalStoragePath(item.metadata.originalStoragePath);
    if (!normPath) continue;

    const renderedName = item.metadata.renderedAssetName;
    const renderedAsset = renderedName ? assetsMap.get(renderedName) : undefined;
    // 渲染图片必须在 assetsMap 中真实存在且仍有文档引用
    if (!renderedAsset || !renderedAsset.references || renderedAsset.references.length === 0) {
      continue;
    }

    let refs = originalToRefsMap.get(normPath);
    if (!refs) {
      refs = [];
      originalToRefsMap.set(normPath, refs);
    }

    for (const ref of renderedAsset.references) {
      if (!refs.some((r) => r.id === ref.id)) {
        refs.push(ref);
      }
    }
  }

  // 2.3 补充遍历 assetsMap 中具备 originalStoragePath 的资产（双向保障）
  for (const asset of assetsMap.values()) {
    if (!asset.originalStoragePath || !asset.references || asset.references.length === 0) {
      continue;
    }
    const normPath = normalizeOriginalStoragePath(asset.originalStoragePath);
    if (!normPath) continue;

    let refs = originalToRefsMap.get(normPath);
    if (!refs) {
      refs = [];
      originalToRefsMap.set(normPath, refs);
    }

    for (const ref of asset.references) {
      if (!refs.some((r) => r.id === ref.id)) {
        refs.push(ref);
      }
    }
  }

  // 3. 构建原始底图模型并判定孤立状态
  const originalAssets: AssetInfo[] = [];
  const orphanOriginals: OrphanOriginalInfo[] = [];
  let totalOrphanSize = 0;

  for (const orig of originalFiles) {
    const normOrigPath = normalizeOriginalStoragePath(orig.path);
    const refs = originalToRefsMap.get(normOrigPath) || [];
    const docIds = new Set(refs.map((r) => r.root_id));

    originalAssets.push({
      name: orig.name,
      size: orig.size,
      updated: orig.updated,
      isDir: false,
      references: refs,
      refCount: refs.length,
      docCount: docIds.size,
      isReEditable: false,
      isOriginal: true,
      originalStoragePath: orig.path,
    });

    if (refs.length === 0) {
      orphanOriginals.push(orig);
      totalOrphanSize += orig.size;
    }
  }

  const allAssets = [...Array.from(assetsMap.values()), ...originalAssets];

  return {
    allAssets,
    assetsMap,
    originalAssets,
    orphanOriginals,
    totalOrphanSize,
  };
}

/**
 * 异步获取全量目录库存与装配模型
 */
export async function fetchCatalogInventory(): Promise<CatalogInventory> {
  const rawFiles = await readDir('/data/assets').catch(() => null);
  if (!rawFiles || !Array.isArray(rawFiles)) {
    return {
      allAssets: [],
      assetsMap: new Map(),
      originalAssets: [],
      orphanOriginals: [],
      totalOrphanSize: 0,
    };
  }

  const files = rawFiles;
  const [notebookMap, blocks, reEditBlocks, originalFiles, sidecarMetadataList] = await Promise.all([
    getNotebookMap().catch(() => new Map<string, string>()),
    sql(`SELECT id, root_id, box, content, markdown, path, hpath FROM blocks WHERE markdown LIKE '%assets/%' LIMIT 1000000`).catch(() => []),
    queryAllReEditableBlocks().catch(() => []),
    listOriginalImages().catch(() => []),
    listAllAssetMetadataFiles().catch(() => []),
  ]);

  // 自动平滑向后迁移：将存在于块 IAL 但尚未落盘 Sidecar 的元数据自动持久化到 Sidecar
  if (reEditBlocks && reEditBlocks.length > 0) {
    const existingSidecarNames = new Set(sidecarMetadataList.map((s) => s.assetName));
    for (const item of reEditBlocks) {
      const assetName = item.metadata.renderedAssetName;
      if (assetName && !existingSidecarNames.has(assetName)) {
        try {
          await saveAssetMetadataFile(assetName, item.metadata);
          existingSidecarNames.add(assetName);
          sidecarMetadataList.push({ assetName, metadata: item.metadata });
          log(`[asset-catalog] 成功将块 ${item.blockId} 中的历史二次编辑元数据迁移至 Sidecar: ${assetName}.json`);
        } catch (migErr) {
          warn(`[asset-catalog] 迁移块 ${item.blockId} 元数据至 Sidecar 失败:`, migErr);
        }
      }
    }
  }

  const inventory = resolveCatalogPipeline(files, blocks, reEditBlocks, originalFiles, notebookMap, sidecarMetadataList);

  // 批量通过 storage stat 补全缺失的 size 与 updated
  const assetsToStat = inventory.allAssets.filter((a) => !a.isOriginal && (a.size === 0 || !a.updated));
  if (assetsToStat.length > 0) {
    const limit = 50;
    for (let i = 0; i < assetsToStat.length; i += limit) {
      const batch = assetsToStat.slice(i, i + limit);
      await Promise.all(
        batch.map(async (asset) => {
          try {
            const st = await defaultStorage.statAsset(asset.name);
            if (st) {
              if (asset.size === 0) asset.size = st.size;
              if (!asset.updated) asset.updated = st.updated;
            }
          } catch (e) {}
        })
      );
    }
  }

  return inventory;
}

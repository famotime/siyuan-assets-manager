import { sql, readDir } from '../api';
import { queryAllReEditableBlocks } from './siyuan-block';
import {
  listOriginalImages,
  deleteOriginalImage,
  normalizeOriginalStoragePath,
  listAllAssetMetadataFiles,
  saveAssetMetadataFile,
} from './file-system';
import { defaultStorage, blobToText } from './storage';
import type { IAssetReEditMetadata } from '../types/reedit';
import { log, warn, error } from './logger';
import {
  type BlockRef,
  type AssetInfo,
  type OrphanOriginalInfo,
  SYSTEM_PROTECTED_ASSETS,
  createAssetInfoMap,
  attachBlockReferences,
  attachAttributeViewReferences,
  updateAssetDocCounts,
  attachReEditMetadata,
  getNotebookMap,
} from './siyuan-db';
import { resolveAttributeViewReferences } from './attribute-view';
import { extractAssetNamesFromMarkdown } from './asset-markdown';

export { SYSTEM_PROTECTED_ASSETS };

/**
 * 判定是否为操作系统生成的临时/隐藏垃圾文件（如 .DS_Store, Thumbs.db 等）
 */
export function isIgnoredSystemAsset(fileName: string): boolean {
  if (!fileName) return true;
  const baseName = fileName.split('/').pop() || fileName;
  if (baseName.startsWith('.')) return true;
  const lower = baseName.toLowerCase();
  return lower === 'thumbs.db' || lower === 'desktop.ini' || lower === '$recycle.bin';
}

/** 思源 AI Agent 会话历史存储目录 */
export const AGENT_SESSIONS_STORAGE_DIR = '/data/storage/ai/agent/sessions';

/**
 * 扫描思源内置 AI Agent 的会话存储目录，提取对话上下文中引用的图片资产
 * 对齐思源官方 UnusedAssets 中的 agentSessionImageAssetDests
 */
export async function scanAgentSessionAssets(): Promise<Set<string>> {
  const agentAssets = new Set<string>();
  try {
    const entries = await defaultStorage.list(AGENT_SESSIONS_STORAGE_DIR).catch(() => []);
    const sessionDirs = entries.filter((e) => e.isDir);
    for (const sDir of sessionDirs) {
      for (const jsonName of ['session.json', 'runtime.json']) {
        try {
          const filePath = `${AGENT_SESSIONS_STORAGE_DIR}/${sDir.name}/${jsonName}`;
          const blob = await defaultStorage.read(filePath);
          if (blob) {
            const text = await blobToText(blob);
            if (text) {
              const names = extractAssetNamesFromMarkdown(text);
              for (const name of names) {
                agentAssets.add(name);
              }
            }
          }
        } catch (e) {}
      }
    }
  } catch (e) {}
  return agentAssets;
}

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
  sidecarMetadataList: Array<{ assetName: string; metadata: IAssetReEditMetadata }> = [],
  avReferencesMap: Map<string, BlockRef[]> = new Map(),
  agentAssets: Set<string> = new Set()
): CatalogInventory {
  // 1. 构建常规资产 Map 并挂载文档块引用
  const assetsMap = createAssetInfoMap(files);
  if (blocks && blocks.length > 0) {
    attachBlockReferences(assetsMap, blocks, notebookMap);
  }

  // 1.0 挂载数据库属性视图引用 (Attribute View)
  if (avReferencesMap && avReferencesMap.size > 0) {
    attachAttributeViewReferences(assetsMap, avReferencesMap);
  }

  updateAssetDocCounts(assetsMap.values());

  // 1.1 标记思源系统关键保护文件（如 ocr-texts.json），免于孤儿判定与误清理
  for (const asset of assetsMap.values()) {
    if (SYSTEM_PROTECTED_ASSETS.has(asset.name)) {
      asset.isSystemProtected = true;
    }
  }

  // 1.2 PDF 标注伴生文件 (.pdf.sya) 联动拓扑保活
  // 对齐思源官方 UnusedAssets: 只要母体 xxx.pdf 存在有效文档引用，其标注伴生文件 xxx.pdf.sya 自动保活，绝不能被当作孤儿误删
  for (const [name, asset] of assetsMap.entries()) {
    if (name.toLowerCase().endsWith('.pdf.sya')) {
      asset.isCompanion = true;
      const parentPdfName = name.slice(0, -4);
      const parentAsset = assetsMap.get(parentPdfName);
      if (parentAsset && parentAsset.docCount > 0) {
        asset.references = [...parentAsset.references];
        asset.refCount = parentAsset.refCount;
        asset.docCount = parentAsset.docCount;
      }
    }
  }

  // 1.3 AI Agent 会话上下文中的资源保活
  if (agentAssets && agentAssets.size > 0) {
    for (const agentAssetName of agentAssets) {
      const asset = assetsMap.get(agentAssetName);
      if (asset && asset.docCount === 0) {
        asset.docCount = 1;
        asset.refCount = (asset.refCount || 0) + 1;
        asset.references.push({
          id: 'ai-agent-session',
          root_id: 'ai-agent-session',
          box: '',
          content: '思源 AI Agent 会话上下文引用',
          markdown: '',
          path: '',
          readablePath: '思源 AI 对话',
        });
      }
    }
  }

  // 1.4 挂载 Sidecar 元数据（优先全局真理源）
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

  // 1.5 补充挂载块级元数据（向前兼容历史数据）
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

  const files = (rawFiles || []).filter((f) => !isIgnoredSystemAsset(f.name));
  const notebookMap = await getNotebookMap().catch(() => new Map<string, string>());
  const [blocks, reEditBlocks, originalFiles, sidecarMetadataList, avReferencesMap, agentAssets] = await Promise.all([
    sql(`SELECT id, root_id, box, content, markdown, path, hpath, ial FROM blocks WHERE markdown LIKE '%assets/%' OR ial LIKE '%assets/%' LIMIT 1000000`).catch(() => []),
    queryAllReEditableBlocks().catch(() => []),
    listOriginalImages().catch(() => []),
    listAllAssetMetadataFiles().catch(() => []),
    resolveAttributeViewReferences(notebookMap).catch(() => new Map<string, BlockRef[]>()),
    scanAgentSessionAssets().catch(() => new Set<string>()),
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

  const inventory = resolveCatalogPipeline(
    files,
    blocks,
    reEditBlocks,
    originalFiles,
    notebookMap,
    sidecarMetadataList,
    avReferencesMap,
    agentAssets
  );

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

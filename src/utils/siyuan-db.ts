import { sql, readDir, removeFile, lsNotebooks } from "../api";
import { extractAssetNamesFromMarkdown } from "./asset-markdown";
import { warn, error } from "./logger";
import { queryAllReEditableBlocks } from "./siyuan-block";
import {
  listOriginalImages,
  deleteOriginalImage,
  normalizeOriginalStoragePath,
  readAssetMetadataFile,
  saveAssetMetadataFile,
  deleteAssetMetadataFile,
} from "./file-system";
import { defaultStorage } from "./storage";
import { fetchCatalogInventory } from "./asset-catalog";
import { resolveAttributeViewReferences } from "./attribute-view";
import type { IAssetReEditMetadata } from "../types/reedit";

export interface BlockRef {
  id: string;
  root_id: string;
  box: string;
  content: string;
  markdown: string;
  path: string; // document path
  hpath?: string; // 人类可读文档路径 (如 /前端/Vue)
  boxName?: string; // 笔记本名称
  readablePath?: string; // 易读路径 (如 笔记本名称/前端/Vue)
}

/**
 * 思源内核系统关键保留文件白名单
 * 对齐思源官方 UnusedAssets: 无论是否有文档引用，此类系统文件绝对禁止作为孤儿删除
 */
export const SYSTEM_PROTECTED_ASSETS = new Set([
  'ocr-texts.json',
  'android-notification-texts.txt',
]);

export interface AssetInfo {
  name: string;
  size: number;
  updated: number;
  isDir: boolean;
  references: BlockRef[];
  refCount: number;
  docCount: number; // 引用数
  isReEditable?: boolean; // 是否包含可二次编辑元数据
  reEditBlockId?: string; // 关联的二次编辑文档块 ID
  originalStoragePath?: string; // 关联的隔离原始底图路径
  isOriginal?: boolean; // 是否为隔离存储的原始底图
  isSystemProtected?: boolean; // 是否为思源系统保留受保护文件 (如 ocr-texts.json)
  isCompanion?: boolean; // 是否为伴生文件 (如 xxx.pdf.sya)
}

export function createAssetInfoMap(files: any[]): Map<string, AssetInfo> {
  const assetsMap = new Map<string, AssetInfo>();

  for (const file of files) {
    if (!file.isDir) {
      let fileSize = file.size || 0;
      assetsMap.set(file.name, {
        name: file.name,
        size: fileSize, // bytes
        updated: file.updated || 0,
        isDir: false,
        references: [],
        refCount: 0,
        docCount: 0,
        isReEditable: false,
        isOriginal: false,
      });
    }
  }

  return assetsMap;
}

/**
 * 格式化以笔记本名称为根目录的易读文档路径 (例如: "我的笔记本/技术文档/Vue3进阶")
 */
export function formatReadableDocPath(boxName: string, hpath?: string, fallbackPath?: string): string {
  const cleanHpath = (hpath || "").replace(/^\/+/, "");
  if (boxName) {
    return cleanHpath ? `${boxName}/${cleanHpath}` : boxName;
  }
  return hpath || fallbackPath || "";
}

export function attachBlockReferences(
  assetsMap: Map<string, AssetInfo>,
  blocks: any[] = [],
  notebookMap: Map<string, string> = new Map()
): void {
  for (const block of blocks) {
    const mdAssets = extractAssetNamesFromMarkdown(block.markdown || "");
    const ialAssets = block.ial ? extractAssetNamesFromMarkdown(block.ial) : [];
    const referencedAssets = Array.from(new Set([...mdAssets, ...ialAssets]));
    const boxName = notebookMap.get(block.box) || "";
    const readablePath = formatReadableDocPath(boxName, block.hpath, block.path);

    for (const assetName of referencedAssets) {
      if (assetsMap.has(assetName)) {
        const asset = assetsMap.get(assetName)!;
        if (!asset.references.some((r) => r.id === block.id)) {
          asset.references.push({
            id: block.id,
            root_id: block.root_id,
            box: block.box,
            content: block.content,
            markdown: block.markdown,
            path: block.path,
            hpath: block.hpath,
            boxName,
            readablePath,
          });
          asset.refCount++;
        }
      }
    }
  }
}

/**
 * 将数据库属性视图中的引用合并挂载到资产对象上
 */
export function attachAttributeViewReferences(
  assetsMap: Map<string, AssetInfo>,
  avReferencesMap: Map<string, BlockRef[]> = new Map()
): void {
  if (!avReferencesMap || avReferencesMap.size === 0) return;

  for (const [assetName, avRefs] of avReferencesMap.entries()) {
    if (assetsMap.has(assetName) && Array.isArray(avRefs)) {
      const asset = assetsMap.get(assetName)!;
      for (const ref of avRefs) {
        if (!asset.references.some((r) => r.id === ref.id)) {
          asset.references.push(ref);
          asset.refCount++;
        }
      }
    }
  }
}

/**
 * 统计引用涉及的文档数（同一篇文档中的多个引用块只计一次文档）
 */
export function countReferencedDocs(references: BlockRef[] = []): number {
  const docIds = new Set(references.map(r => r.root_id));
  return docIds.size;
}

export function updateAssetDocCounts(assets: Iterable<AssetInfo>): void {
  for (const asset of assets) {
    asset.docCount = countReferencedDocs(asset.references);
  }
}

/**
 * 将二次编辑块元数据绑定到对应的资产对象上
 */
export function attachReEditMetadata(
  assetsMap: Map<string, AssetInfo>,
  reEditableBlocks: Array<{ blockId: string; rootId: string; metadata: IAssetReEditMetadata }> = []
): void {
  for (const item of reEditableBlocks) {
    const renderedName = item.metadata.renderedAssetName;
    if (renderedName && assetsMap.has(renderedName)) {
      const asset = assetsMap.get(renderedName)!;
      asset.isReEditable = true;
      asset.reEditBlockId = item.blockId;
      asset.originalStoragePath = item.metadata.originalStoragePath;
    }
  }
}

/**
 * 获取笔记本映射表（boxId -> boxName）
 */
export async function getNotebookMap(): Promise<Map<string, string>> {
  const notebookMap = new Map<string, string>();
  try {
    const res = await lsNotebooks();
    if (res && res.notebooks && Array.isArray(res.notebooks)) {
      for (const nb of res.notebooks) {
        if (nb.id && nb.name) {
          notebookMap.set(nb.id, nb.name);
        }
      }
    }
  } catch (e) {}

  // 尝试从全局 window.siyuan.notebooks 补充
  if (notebookMap.size === 0 && (window as any).siyuan?.notebooks) {
    const nbs = (window as any).siyuan.notebooks;
    if (Array.isArray(nbs)) {
      for (const nb of nbs) {
        if (nb.id && nb.name) {
          notebookMap.set(nb.id, nb.name);
        }
      }
    }
  }

  return notebookMap;
}

/**
 * 获取所有的 Asset 信息，包括物理文件和它被哪些 Block 引用以及二次编辑状态
 */
export async function getAllAssetsInfo(): Promise<AssetInfo[]> {
  const inventory = await fetchCatalogInventory();
  return inventory.allAssets;
}

/**
 * 删除资产文件
 */
export async function deleteAssetFile(fileName: string): Promise<void> {
  if (SYSTEM_PROTECTED_ASSETS.has(fileName)) {
    throw new Error(`系统关键文件 [${fileName}] 受保护，禁止删除`);
  }
  await removeFile("/data/assets/" + fileName);
  try {
    await deleteAssetMetadataFile(fileName);
  } catch (e) {}
}

/**
 * 根据资源文件名获取单个 Asset 信息
 */
export async function getAssetInfoByName(fileName: string): Promise<AssetInfo | null> {
  // 1. 优先检查是否为隔离存储目录中的原始底图
  try {
    const originalFiles = await listOriginalImages();
    const origMatch = originalFiles.find(
      (f) => f.name === fileName || normalizeOriginalStoragePath(f.path) === normalizeOriginalStoragePath(fileName)
    );
    if (origMatch) {
      const inventory = await fetchCatalogInventory();
      const normOrigPath = normalizeOriginalStoragePath(origMatch.path);
      const found = inventory.originalAssets.find(
        (a) => a.name === origMatch.name || normalizeOriginalStoragePath(a.originalStoragePath || '') === normOrigPath
      );
      return found || null;
    }
  } catch (e) {
    warn("[siyuan-db] 查询底图信息失败:", e);
  }

  let size = 0;
  let updated = Date.now();
  try {
    const st = await defaultStorage.statAsset(fileName);
    if (st) {
      size = st.size;
      updated = st.updated;
    }
  } catch (e) {}

  // 只按 assets/ 粗筛，不把文件名插值进 SQL：
  // 文件名可能含单引号（破坏语句）或 % _ 通配符（造成误匹配）；
  // 且 Markdown 中的引用可能是 URI 编码形式，按原始名 LIKE 反而会漏掉真实引用。
  // 精确匹配交由下方的 extractAssetNamesFromMarkdown 完成（与 getAllAssetsInfo 一致）。
  const blocks: any[] = await sql(
    `SELECT id, root_id, box, content, markdown, path, hpath, ial FROM blocks WHERE markdown LIKE '%assets/%' OR ial LIKE '%assets/%' LIMIT 1000000`
  );

  const references: BlockRef[] = [];
  const notebookMap = await getNotebookMap();
  if (blocks && blocks.length > 0) {
    for (const block of blocks) {
      const mdAssets = extractAssetNamesFromMarkdown(block.markdown || "");
      const ialAssets = block.ial ? extractAssetNamesFromMarkdown(block.ial) : [];
      const referencedAssets = Array.from(new Set([...mdAssets, ...ialAssets]));
      if (referencedAssets.includes(fileName)) {
        references.push({
          id: block.id,
          root_id: block.root_id,
          box: block.box,
          content: block.content,
          markdown: block.markdown,
          path: block.path,
          hpath: block.hpath,
          readablePath: formatReadableDocPath(
            block.box && notebookMap ? notebookMap.get(block.box) : undefined,
            block.hpath || block.path
          ),
        });
      }
    }
  }

  // 补充检索数据库属性视图中的关联引用
  try {
    const avRefsMap = await resolveAttributeViewReferences(notebookMap);
    const avRefs = avRefsMap.get(fileName) || [];
    for (const ref of avRefs) {
      if (!references.some((r) => r.id === ref.id)) {
        references.push(ref);
      }
    }
  } catch (avErr) {
    warn("[siyuan-db] 查询属性视图关联引用失败:", avErr);
  }

  const docIds = new Set(references.map(r => r.root_id));

  // 检查是否具备二次编辑属性
  let isReEditable = false;
  let reEditBlockId: string | undefined;
  let originalStoragePath: string | undefined;

  // 1. 优先从 Sidecar 读取元数据（解耦单点块属性）
  try {
    const sidecarMeta = await readAssetMetadataFile(fileName);
    if (sidecarMeta) {
      isReEditable = true;
      originalStoragePath = sidecarMeta.originalStoragePath;
    }
  } catch (e) {}

  // 2. 尝试从块属性补充 reEditBlockId 或作为 fallback
  try {
    const reEditBlocks = await queryAllReEditableBlocks();
    const match = reEditBlocks.find((b) => b.metadata.renderedAssetName === fileName);
    if (match) {
      isReEditable = true;
      reEditBlockId = match.blockId;
      if (!originalStoragePath) {
        originalStoragePath = match.metadata.originalStoragePath;
      }
      // 即时自愈：如果 Sidecar 还没写，写入 Sidecar
      try {
        const sidecarMeta = await readAssetMetadataFile(fileName);
        if (!sidecarMeta) {
          await saveAssetMetadataFile(fileName, match.metadata);
        }
      } catch (migErr) {}
    }
  } catch (e) {}

  if (!reEditBlockId && references.length > 0) {
    reEditBlockId = references[0].id;
  }

  return {
    name: fileName,
    size,
    updated,
    isDir: false,
    references,
    refCount: references.length,
    docCount: docIds.size,
    isReEditable,
    reEditBlockId,
    originalStoragePath,
    isOriginal: false,
  };
}

export interface OrphanOriginalInfo {
  name: string;
  path: string;
  size: number;
  updated: number;
}

/**
 * 扫描隔离存储目录中所有未被任何现有文档块引用的孤立原始底图
 */
export async function getOrphanOriginals(): Promise<{
  orphans: OrphanOriginalInfo[];
  totalSize: number;
  totalCount: number;
}> {
  try {
    const inventory = await fetchCatalogInventory();
    return {
      orphans: inventory.orphanOriginals,
      totalSize: inventory.totalOrphanSize,
      totalCount: inventory.orphanOriginals.length,
    };
  } catch (e) {
    error("[siyuan-db] 获取孤立原始底图失败:", e);
    return { orphans: [], totalSize: 0, totalCount: 0 };
  }
}

/**
 * 一键清理所有无主的孤立原始底图
 */
export async function cleanupOrphanOriginals(): Promise<{ deletedCount: number; freedSize: number }> {
  const { orphans } = await getOrphanOriginals();
  let deletedCount = 0;
  let freedSize = 0;

  for (const orphan of orphans) {
    const ok = await deleteOriginalImage(orphan.path);
    if (ok) {
      deletedCount++;
      freedSize += orphan.size;
    }
  }

  return { deletedCount, freedSize };
}

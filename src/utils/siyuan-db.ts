import { sql, readDir, removeFile, lsNotebooks } from "../api";
import { extractAssetNamesFromMarkdown } from "./asset-markdown";
import { warn, error } from "./logger";
import { queryAllReEditableBlocks } from "./siyuan-block";
import { listOriginalImages, deleteOriginalImage, normalizeOriginalStoragePath } from "./file-system";
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
    const referencedAssets = extractAssetNamesFromMarkdown(block.markdown || "");
    const boxName = notebookMap.get(block.box) || "";
    const readablePath = formatReadableDocPath(boxName, block.hpath, block.path);

    for (const assetName of referencedAssets) {
      if (assetsMap.has(assetName)) {
        const asset = assetsMap.get(assetName)!;
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
  // 1. 获取 /data/assets 下的所有物理文件
  const files: any[] = await readDir("/data/assets");
  if (!files) return [];

  const assetsMap = createAssetInfoMap(files);

  // 获取笔记本列表构建 boxId -> boxName 映射
  const notebookMap = await getNotebookMap();

  // 尝试通过 Node fs 或者 HEAD 请求补全 file size
  let fs: any;
  let pathLib: any;
  let dataDir = "";
  try {
    fs = (window as any).require("fs");
    pathLib = (window as any).require("path");
    dataDir = (window as any).siyuan?.config?.system?.dataDir;
  } catch (e) {}

  if (fs && pathLib && dataDir) {
    // 桌面端 Electron 环境
    for (const [name, asset] of assetsMap.entries()) {
      try {
        const absolutePath = pathLib.join(dataDir, "assets", name);
        const stat = fs.statSync(absolutePath);
        if (asset.size === 0) {
          asset.size = stat.size;
        }
        if (stat.mtimeMs) {
          asset.updated = stat.mtimeMs;
        }
      } catch (e) {}
    }
  } else {
    // 浏览器或移动端环境，并发批量获取大小与时间
    const assetsToFetch = Array.from(assetsMap.values()).filter(a => a.size === 0 || !a.updated);
    const limit = 50;
    for (let i = 0; i < assetsToFetch.length; i += limit) {
      const batch = assetsToFetch.slice(i, i + limit);
      await Promise.all(batch.map(async (asset) => {
        try {
          const response = await fetch(`/assets/${asset.name}`, { method: 'HEAD' });
          const contentLength = response.headers.get('content-length');
          if (contentLength) {
            asset.size = parseInt(contentLength, 10);
          }
          const lastModified = response.headers.get('last-modified');
          if (lastModified && !asset.updated) {
            const time = Date.parse(lastModified);
            if (!isNaN(time)) {
              asset.updated = time;
            }
          }
        } catch (e) {}
      }));
    }
  }

  // 2. 查询所有可能引用了 assets 的 blocks (包含 hpath 以构建易读文档路径)
  const blocks: any[] = await sql(
    `SELECT id, root_id, box, content, markdown, path, hpath FROM blocks WHERE markdown LIKE '%assets/%' LIMIT 1000000`
  );

  if (blocks && blocks.length > 0) {
    attachBlockReferences(assetsMap, blocks, notebookMap);
  }

  updateAssetDocCounts(assetsMap.values());

  // 3. 关联查询所有具备 custom-asset-reedit 的文档块
  let reEditBlocks: Array<{ blockId: string; rootId: string; metadata: IAssetReEditMetadata }> = [];
  try {
    reEditBlocks = await queryAllReEditableBlocks();
    attachReEditMetadata(assetsMap, reEditBlocks);
  } catch (err) {
    warn("[siyuan-db] 查询二次编辑块元数据失败:", err);
  }

  // 4. 扫描并聚合隔离存储目录中的原始底图资源
  const originalAssets: AssetInfo[] = [];
  try {
    const originalFiles = await listOriginalImages();
    if (originalFiles && originalFiles.length > 0) {
      // 建立底图相对路径与二次编辑块/文档的映射
      const originalToRefsMap = new Map<string, BlockRef[]>();

      for (const item of reEditBlocks) {
        const normPath = normalizeOriginalStoragePath(item.metadata.originalStoragePath);
        if (!normPath) continue;

        const renderedName = item.metadata.renderedAssetName;
        // 关键校验 1：二次编辑渲染图片必须在物理 assetsMap 中存在（未被删除）
        const renderedAsset = renderedName ? assetsMap.get(renderedName) : undefined;
        if (!renderedAsset) {
          continue;
        }

        // 关键校验 2：只要对应的编辑后图片仍有文档引用，底图就继承该编辑后图片的所有有效引用
        if (!renderedAsset.references || renderedAsset.references.length === 0) {
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

      // 补充遍历 assetsMap 中具备 originalStoragePath 的资产（双向保障，防止块属性由于文档变动丢失）
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
      }
    }
  } catch (err) {
    warn("[siyuan-db] 扫描原始底图列表失败:", err);
  }

  return [...Array.from(assetsMap.values()), ...originalAssets];
}

/**
 * 删除资产文件
 */
export async function deleteAssetFile(fileName: string): Promise<void> {
  await removeFile("/data/assets/" + fileName);
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
      const reEditBlocks = await queryAllReEditableBlocks();
      const normOrigPath = normalizeOriginalStoragePath(origMatch.path);
      const refs: BlockRef[] = [];

      // 查询所有引用了 assets 的文档块进行交叉验证
      const blocks: any[] = await sql(
        `SELECT id, root_id, box, content, markdown, path, hpath FROM blocks WHERE markdown LIKE '%assets/%' LIMIT 100000`
      );

      // 获取当前 assets 物理文件集合，确保对应的编辑后图片真实存在且未被删除
      const files: any[] = (await readDir("/data/assets")) || [];
      const existingAssetNames = new Set(files.filter((f) => !f.isDir).map((f) => f.name));
      const notebookMap = await getNotebookMap();

      for (const item of reEditBlocks) {
        if (normalizeOriginalStoragePath(item.metadata.originalStoragePath) === normOrigPath) {
          const renderedName = item.metadata.renderedAssetName;
          if (!renderedName || !existingAssetNames.has(renderedName)) continue;

          // 只要编辑后图片在任何文档块中仍有引用，均收集为底图的有效引用
          if (blocks && Array.isArray(blocks)) {
            for (const b of blocks) {
              const names = extractAssetNamesFromMarkdown(b.markdown || '');
              if (names.includes(renderedName)) {
                if (!refs.some((r) => r.id === b.id)) {
                  refs.push({
                    id: b.id,
                    root_id: b.root_id,
                    box: b.box || '',
                    content: b.content || '',
                    markdown: b.markdown || '',
                    path: b.path || '',
                    hpath: b.hpath || '',
                    readablePath: formatReadableDocPath(
                      b.box && notebookMap ? notebookMap.get(b.box) : undefined,
                      b.hpath || b.path
                    ),
                  });
                }
              }
            }
          }
        }
      }
      const docIds = new Set(refs.map(r => r.root_id));
      return {
        name: origMatch.name,
        size: origMatch.size,
        updated: origMatch.updated,
        isDir: false,
        references: refs,
        refCount: refs.length,
        docCount: docIds.size,
        isReEditable: false,
        isOriginal: true,
        originalStoragePath: origMatch.path,
      };
    }
  } catch (e) {
    warn("[siyuan-db] 查询底图信息失败:", e);
  }

  let size = 0;
  let updated = Date.now();
  
  let fs: any;
  let pathLib: any;
  let dataDir = "";
  try {
    fs = (window as any).require("fs");
    pathLib = (window as any).require("path");
    dataDir = (window as any).siyuan?.config?.system?.dataDir;
  } catch (e) {}

  if (fs && pathLib && dataDir) {
    try {
      let absolutePath = pathLib.join(dataDir, "assets", fileName);
      if (!fs.existsSync(absolutePath)) {
        try {
          const decoded = decodeURIComponent(fileName);
          const decodedPath = pathLib.join(dataDir, "assets", decoded);
          if (fs.existsSync(decodedPath)) {
            absolutePath = decodedPath;
          }
        } catch (decErr) {}
      }

      if (fs.existsSync(absolutePath)) {
        const stat = fs.statSync(absolutePath);
        size = stat.size;
        updated = stat.mtimeMs || Date.now();
      }
    } catch (e) {}
  } else {
    try {
      const response = await fetch(`/assets/${fileName}`, { method: 'HEAD' });
      const contentLength = response.headers.get('content-length');
      if (contentLength) {
        size = parseInt(contentLength, 10);
      }
    } catch (e) {
      warn("HEAD request failed for", fileName, e);
    }
  }

  // 只按 assets/ 粗筛，不把文件名插值进 SQL：
  // 文件名可能含单引号（破坏语句）或 % _ 通配符（造成误匹配）；
  // 且 Markdown 中的引用可能是 URI 编码形式，按原始名 LIKE 反而会漏掉真实引用。
  // 精确匹配交由下方的 extractAssetNamesFromMarkdown 完成（与 getAllAssetsInfo 一致）。
  const blocks: any[] = await sql(
    `SELECT id, root_id, box, content, markdown, path, hpath FROM blocks WHERE markdown LIKE '%assets/%' LIMIT 1000000`
  );

  const references: BlockRef[] = [];
  if (blocks && blocks.length > 0) {
    const notebookMap = await getNotebookMap();
    for (const block of blocks) {
      const referencedAssets = extractAssetNamesFromMarkdown(block.markdown || "");
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

  const docIds = new Set(references.map(r => r.root_id));

  // 检查是否具备二次编辑属性
  let isReEditable = false;
  let reEditBlockId: string | undefined;
  let originalStoragePath: string | undefined;

  try {
    const reEditBlocks = await queryAllReEditableBlocks();
    const match = reEditBlocks.find((b) => b.metadata.renderedAssetName === fileName);
    if (match) {
      isReEditable = true;
      reEditBlockId = match.blockId;
      originalStoragePath = match.metadata.originalStoragePath;
    }
  } catch (e) {}

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
    const allOriginals = await listOriginalImages();
    const reEditBlocks = await queryAllReEditableBlocks();

    // 获取所有 assets 物理文件
    const files: any[] = (await readDir("/data/assets")) || [];
    const existingAssetNames = new Set(files.filter((f) => !f.isDir).map((f) => f.name));

    // 查询所有可能引用了 assets 的 blocks 进行交叉验证
    const blocks: any[] = await sql(
      `SELECT id, markdown FROM blocks WHERE markdown LIKE '%assets/%' LIMIT 1000000`
    );
    const referencedAssetNames = new Set<string>();
    if (blocks && Array.isArray(blocks)) {
      for (const b of blocks) {
        const names = extractAssetNamesFromMarkdown(b.markdown || '');
        for (const name of names) {
          referencedAssetNames.add(name);
        }
      }
    }

    const activePaths = new Set<string>();

    for (const b of reEditBlocks) {
      const renderedName = b.metadata.renderedAssetName;
      const origPath = normalizeOriginalStoragePath(b.metadata.originalStoragePath);
      if (!origPath || !renderedName) continue;

      // 只要对应的编辑后图片物理存在，且仍有文档引用，则该原始底图活跃（非孤立）
      if (existingAssetNames.has(renderedName) && referencedAssetNames.has(renderedName)) {
        activePaths.add(origPath);
      }
    }

    const orphans: OrphanOriginalInfo[] = [];
    let totalSize = 0;

    for (const orig of allOriginals) {
      const normalized = normalizeOriginalStoragePath(orig.path);
      if (!activePaths.has(normalized)) {
        orphans.push(orig);
        totalSize += orig.size;
      }
    }

    return {
      orphans,
      totalSize,
      totalCount: orphans.length,
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

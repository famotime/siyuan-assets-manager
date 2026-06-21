import { sql, readDir, removeFile, sql as sqlQuery } from "../api";
import { extractAssetNamesFromMarkdown } from "./asset-markdown";

export interface BlockRef {
  id: string;
  root_id: string;
  box: string;
  content: string;
  markdown: string;
  path: string; // document path
}

export interface AssetInfo {
  name: string;
  size: number;
  updated: number;
  isDir: boolean;
  references: BlockRef[];
  refCount: number;
  docCount: number; // 引用文档数
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
      });
    }
  }

  return assetsMap;
}

export function attachBlockReferences(assetsMap: Map<string, AssetInfo>, blocks: any[] = []): void {
  for (const block of blocks) {
    const referencedAssets = extractAssetNamesFromMarkdown(block.markdown || "");
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
        });
        asset.refCount++;
      }
    }
  }
}

export function updateAssetDocCounts(assets: Iterable<AssetInfo>): void {
  for (const asset of assets) {
    const docIds = new Set(asset.references.map(r => r.root_id));
    asset.docCount = docIds.size;
  }
}

/**
 * 获取所有的 Asset 信息，包括物理文件和它被哪些 Block 引用
 */
export async function getAllAssetsInfo(): Promise<AssetInfo[]> {
  // 1. 获取 /data/assets 下的所有物理文件
  const files: any[] = await readDir("/data/assets");
  if (!files) return [];

  const assetsMap = createAssetInfoMap(files);

  // 尝试通过 Node fs 或者 HEAD 请求补全 file size (针对部分 Siyuan 版本 readDir 不返回 size 的情况)
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
      if (asset.size === 0) {
        try {
          const absolutePath = pathLib.join(dataDir, "assets", name);
          const stat = fs.statSync(absolutePath);
          asset.size = stat.size;
        } catch (e) {}
      }
    }
  } else {
    // 浏览器或移动端环境，并发批量获取大小 (由于可能几千个文件，这里控制并发防止阻塞)
    const assetsToFetch = Array.from(assetsMap.values()).filter(a => a.size === 0);
    const limit = 50; // 并发数
    for (let i = 0; i < assetsToFetch.length; i += limit) {
      const batch = assetsToFetch.slice(i, i + limit);
      await Promise.all(batch.map(async (asset) => {
        try {
          const response = await fetch(`/assets/${asset.name}`, { method: 'HEAD' });
          const contentLength = response.headers.get('content-length');
          if (contentLength) {
            asset.size = parseInt(contentLength, 10);
          }
        } catch (e) {}
      }));
    }
  }

  // 2. 查询所有可能引用了 assets 的 blocks
  const blocks: any[] = await sqlQuery(
    `SELECT id, root_id, box, content, markdown, path FROM blocks WHERE markdown LIKE '%assets/%' LIMIT 1000000`
  );

  if (blocks && blocks.length > 0) {
    attachBlockReferences(assetsMap, blocks);
  }

  updateAssetDocCounts(assetsMap.values());

  return Array.from(assetsMap.values());
}

/**
 * 删除资产文件
 */
export async function deleteAssetFile(fileName: string): Promise<void> {
  await removeFile("/data/assets/" + fileName);
}

/**
 * 根据资源文件名获取单个 Asset 信息，包括物理文件大小和被哪些 Block 引用
 */
export async function getAssetInfoByName(fileName: string): Promise<AssetInfo | null> {
  // 1. 尝试获取物理文件大小。如果 Electron 环境可用，用 fs.stat，否则通过 HEAD 请求
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
      const absolutePath = pathLib.join(dataDir, "assets", fileName);
      const stat = fs.statSync(absolutePath);
      size = stat.size;
      updated = stat.mtimeMs || Date.now();
    } catch (e) {
      console.warn("FS stat failed for", fileName, e);
    }
  } else {
    try {
      const response = await fetch(`/assets/${fileName}`, { method: 'HEAD' });
      const contentLength = response.headers.get('content-length');
      if (contentLength) {
        size = parseInt(contentLength, 10);
      }
    } catch (e) {
      console.warn("HEAD request failed for", fileName, e);
    }
  }

  // 2. 查询所有引用了该 asset 的 blocks
  const blocks: any[] = await sqlQuery(
    `SELECT id, root_id, box, content, markdown, path FROM blocks WHERE markdown LIKE '%assets/${fileName}%' LIMIT 1000`
  );

  const references: BlockRef[] = [];
  if (blocks && blocks.length > 0) {
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
        });
      }
    }
  }

  const docIds = new Set(references.map(r => r.root_id));

  return {
    name: fileName,
    size,
    updated,
    isDir: false,
    references,
    refCount: references.length,
    docCount: docIds.size
  };
}

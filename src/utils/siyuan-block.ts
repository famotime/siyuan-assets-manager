import { updateBlock, deleteBlock, sql, getBlockAttrs, setBlockAttrs } from "../api";
import { BlockRef } from "./siyuan-db";
import {
  removeAssetFromMarkdown,
  replaceAssetInMarkdown,
} from "./asset-markdown";
import type { IAssetReEditMetadata } from "../types/reedit";
import { serializeReEditMetadata, deserializeReEditMetadata, decodeHtmlEntities } from "./reedit-data";
import { replaceAssetInAttributeViews } from "./attribute-view";
import { log, warn, error } from "./logger";

/** 思源图像块二次编辑自定义属性名称 */
export const CUSTOM_ATTR_REEDIT = "custom-asset-reedit";

export interface ReplaceAssetOptions {
  /** 是否自动同步更新相关块 custom-asset-reedit 属性中的 renderedAssetName（适用于重命名场景） */
  updateReEditMeta?: boolean;
  /** 如果提供全新的二次编辑元数据，将原子写入到所有受影响的块（适用于保存新编辑或去重合并） */
  newReEditMetadata?: IAssetReEditMetadata;
  /** 额外的目标块 ID 集合（例如当前正在编辑但可能尚未建立 Markdown 引用的块 ID） */
  additionalBlockIds?: string[];
}

/**
 * 实时从思源 SQLite 数据库中查询当前所有引用指定资产的文档块与根块
 * 支持原始名称与 URI 编码名称，防止读取到过期的持久化缓存导致漏替
 */
export async function queryCurrentAssetBlockReferences(assetName: string): Promise<BlockRef[]> {
  if (!assetName) return [];
  const refs: BlockRef[] = [];
  const encodedName = encodeURIComponent(assetName);

  try {
    const safeOld = assetName.replace(/'/g, "''");
    const safeEnc = encodedName.replace(/'/g, "''");

    const query = `
      SELECT id, root_id, box, content, markdown, path, hpath, ial 
      FROM blocks 
      WHERE markdown LIKE '%assets/${safeOld}%' 
         OR markdown LIKE '%assets/${safeEnc}%' 
         OR ial LIKE '%assets/${safeOld}%' 
         OR ial LIKE '%assets/${safeEnc}%'
      LIMIT 100000
    `;
    const rows = await sql(query);
    if (Array.isArray(rows)) {
      for (const row of rows) {
        refs.push({
          id: row.id,
          root_id: row.root_id,
          box: row.box,
          content: row.content,
          markdown: row.markdown,
          path: row.path,
          hpath: row.hpath,
          readablePath: row.hpath || row.path,
        });
      }
    }
  } catch (err) {
    warn(`[siyuan-block] 实时查询资产 [${assetName}] 引用块失败:`, err);
  }

  return refs;
}

/**
 * 替换给定 Block 集合中的资源引用，并原子同步维护二次编辑元数据与块属性（如封面图 title-img）
 * @param references 涉及该资源的所有 Block 引用信息
 * @param oldAssetName 旧资源名称（如 123.png）
 * @param newAssetName 新资源名称（如 123_edited.png）
 * @param options 可选原子同步配置
 */
export async function replaceAssetInBlocks(
  references: BlockRef[],
  oldAssetName: string,
  newAssetName: string,
  options?: ReplaceAssetOptions
): Promise<void> {
  const affectedBlockIds = new Set<string>();
  const encodedOld = encodeURIComponent(oldAssetName);

  for (const ref of references) {
    if (ref.id) {
      affectedBlockIds.add(ref.id);
    }
    // 重新获取最新的 markdown 与 ial，防止并发修改导致丢失
    const blocks = await sql(`SELECT id, markdown, ial FROM blocks WHERE id = '${ref.id}'`);
    if (blocks && blocks.length > 0) {
      const currentMarkdown = blocks[0].markdown || "";
      const currentIal = blocks[0].ial || "";

      // 1. 替换正文 Markdown 中的引用（兼容普通与 URI 编码路径）
      const hasMdOld = currentMarkdown.includes(`assets/${oldAssetName}`) ||
                       (encodedOld !== oldAssetName && currentMarkdown.includes(`assets/${encodedOld}`));
      if (hasMdOld) {
        const newMarkdown = replaceAssetInMarkdown(currentMarkdown, oldAssetName, newAssetName);
        const updateRes = await updateBlock("markdown", newMarkdown, ref.id);
        if (updateRes === null) {
          throw new Error(`[siyuan-block] 替换正文资源失败: updateBlock 返回异常 (块ID: ${ref.id})`);
        }
      }

      // 2. 检查并替换块属性 IAL 中的引用（如文档题头图 title-img、custom-data-assets 等）
      const hasIalOld = currentIal.includes(`assets/${oldAssetName}`) ||
                        (encodedOld !== oldAssetName && currentIal.includes(`assets/${encodedOld}`));
      if (hasIalOld) {
        try {
          const attrs = await getBlockAttrs(ref.id);
          if (attrs && typeof attrs === 'object') {
            let attrChanged = false;
            const updatedAttrs: { [key: string]: string } = {};

            for (const [k, v] of Object.entries(attrs)) {
              if (typeof v === 'string' && (v.includes(`assets/${oldAssetName}`) || (encodedOld !== oldAssetName && v.includes(`assets/${encodedOld}`)))) {
                updatedAttrs[k] = replaceAssetInMarkdown(v, oldAssetName, newAssetName);
                attrChanged = true;
              }
            }

            if (attrChanged) {
              const setRes = await setBlockAttrs(ref.id, updatedAttrs);
              if (setRes === null) {
                throw new Error(`[siyuan-block] 更新块属性失败: setBlockAttrs 返回异常 (块ID: ${ref.id})`);
              }
              log(`[siyuan-block] 成功更新块 ${ref.id} 属性中的资源引用: ${oldAssetName} -> ${newAssetName}`);
            }
          }
        } catch (attrErr) {
          error(`[siyuan-block] 获取或更新块 ${ref.id} 属性失败:`, attrErr);
          throw attrErr;
        }
      }
    }
  }

  if (options?.additionalBlockIds) {
    for (const bId of options.additionalBlockIds) {
      if (bId) affectedBlockIds.add(bId);
    }
  }

  // 原子维护二次编辑元数据
  if (affectedBlockIds.size > 0) {
    if (options?.newReEditMetadata) {
      for (const bId of affectedBlockIds) {
        await setImageBlockReEditData(bId, options.newReEditMetadata);
      }
    } else if (options?.updateReEditMeta) {
      for (const bId of affectedBlockIds) {
        try {
          const meta = await getImageBlockReEditData(bId);
          if (meta && (meta.renderedAssetName === oldAssetName || !meta.renderedAssetName)) {
            meta.renderedAssetName = newAssetName;
            meta.updatedAt = Date.now();
            await setImageBlockReEditData(bId, meta);
          }
        } catch (attrErr) {
          warn(`[siyuan-block] 重命名更新块 ${bId} 二次编辑属性失败:`, attrErr);
        }
      }
    }
  }

  // 同步原子更新属性视图 (Attribute View) 中的资源引用
  try {
    await replaceAssetInAttributeViews(oldAssetName, newAssetName);
  } catch (avErr) {
    warn(`[siyuan-block] 同步更新属性视图资源 ${oldAssetName} -> ${newAssetName} 失败:`, avErr);
    throw avErr;
  }
}

/**
 * 从文档块中彻底移除指定资产的引用。如果移除后该块变为空白，则删除该块。
 * @param references 涉及该资源的所有 Block 引用信息
 * @param assetName 被删除的资源名称
 */
export async function removeAssetFromBlocks(
  references: BlockRef[],
  assetName: string
): Promise<void> {
  for (const ref of references) {
    const blocks = await sql(`SELECT markdown FROM blocks WHERE id = '${ref.id}'`);
    if (blocks && blocks.length > 0) {
      const currentMarkdown = blocks[0].markdown;
      if (currentMarkdown.includes(`assets/${assetName}`)) {
        const newMarkdown = removeAssetFromMarkdown(currentMarkdown, assetName);
        
        // 若该块上绑定了此二次编辑图片的元数据，同步清除块属性
        try {
          const meta = await getImageBlockReEditData(ref.id);
          if (meta && meta.renderedAssetName === assetName) {
            await removeImageBlockReEditData(ref.id);
          }
        } catch (e) {}

        // 清理前后的空格，若为空白块则直接删除
        if (newMarkdown.trim() === "") {
          await deleteBlock(ref.id);
        } else {
          await updateBlock("markdown", newMarkdown, ref.id);
        }
      }
    }
  }
}

/**
 * 获取指定图像块的二次编辑元数据
 * @param blockId 思源块 ID
 */
export async function getImageBlockReEditData(blockId: string): Promise<IAssetReEditMetadata | null> {
  if (!blockId) return null;
  try {
    const attrs = await getBlockAttrs(blockId);
    if (!attrs || !attrs[CUSTOM_ATTR_REEDIT]) {
      return null;
    }
    return deserializeReEditMetadata(attrs[CUSTOM_ATTR_REEDIT]);
  } catch (err) {
    warn(`[siyuan-block] 获取块 ${blockId} 二次编辑属性失败:`, err);
    return null;
  }
}

/**
 * 设置指定图像块的二次编辑元数据
 * @param blockId 思源块 ID
 * @param metadata 二次编辑元数据对象
 */
export async function setImageBlockReEditData(
  blockId: string,
  metadata: IAssetReEditMetadata
): Promise<boolean> {
  if (!blockId || !metadata) return false;
  try {
    const serialized = serializeReEditMetadata(metadata);
    await setBlockAttrs(blockId, {
      [CUSTOM_ATTR_REEDIT]: serialized,
    });
    log(`[siyuan-block] 成功写入块 ${blockId} 二次编辑属性 (长度: ${serialized.length})`);
    return true;
  } catch (err) {
    error(`[siyuan-block] 写入块 ${blockId} 二次编辑属性失败:`, err);
    return false;
  }
}

/**
 * 移除指定图像块的二次编辑元数据（合并固化为普通图片时调用）
 * @param blockId 思源块 ID
 */
export async function removeImageBlockReEditData(blockId: string): Promise<boolean> {
  if (!blockId) return false;
  try {
    await setBlockAttrs(blockId, {
      [CUSTOM_ATTR_REEDIT]: "",
    });
    log(`[siyuan-block] 成功清除块 ${blockId} 二次编辑属性`);
    return true;
  } catch (err) {
    error(`[siyuan-block] 清除块 ${blockId} 二次编辑属性失败:`, err);
    return false;
  }
}

/**
 * 从 IAL 字符串中健壮地提取指定自定义属性值
 */
export function extractCustomAttrFromIal(ial: string, attrName: string): string | null {
  if (!ial) return null;

  // 1. 标准转义匹配 attr="((?:\\.|[^"\\])*)"
  const regex = new RegExp(`${attrName}="((?:\\\\.|[^"\\\\])*)"`);
  const match = ial.match(regex);
  if (match && match[1]) {
    let val = match[1];
    val = val.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    return decodeHtmlEntities(val);
  }

  // 2. HTML 实体转义格式匹配 (支持 &quot;, &#123;, &#34; 等形式)
  const entityRegex = new RegExp(`${attrName}="?((?:&quot;|&#123;|&amp;|&#34;).*?(?:&quot;|&#125;|&#34;))"?`);
  const entityMatch = ial.match(entityRegex);
  if (entityMatch && entityMatch[1]) {
    let val = entityMatch[1];
    if (val.startsWith('&quot;') && val.endsWith('&quot;')) {
      val = val.substring(6, val.length - 6);
    }
    return decodeHtmlEntities(val);
  }

  return null;
}

/**
 * 查询所有包含二次编辑属性的文档块及其元数据
 */
export async function queryAllReEditableBlocks(): Promise<Array<{ blockId: string; rootId: string; metadata: IAssetReEditMetadata }>> {
  try {
    const rows = await sql(
      `SELECT id, root_id, ial FROM blocks WHERE ial LIKE '%custom-asset-reedit%' LIMIT 100000`
    );
    if (!rows || !Array.isArray(rows)) return [];

    const results: Array<{ blockId: string; rootId: string; metadata: IAssetReEditMetadata }> = [];

    for (const row of rows) {
      if (row.ial) {
        const rawVal = extractCustomAttrFromIal(row.ial, CUSTOM_ATTR_REEDIT);
        if (rawVal) {
          const metadata = deserializeReEditMetadata(rawVal);
          if (metadata) {
            results.push({
              blockId: row.id,
              rootId: row.root_id,
              metadata,
            });
          }
        }
      }
    }

    return results;
  } catch (err) {
    error("[siyuan-block] 查询可二次编辑块失败:", err);
    return [];
  }
}

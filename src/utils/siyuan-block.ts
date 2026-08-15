import { updateBlock, deleteBlock, sql, getBlockAttrs, setBlockAttrs } from "../api";
import { BlockRef } from "./siyuan-db";
import {
  removeAssetFromMarkdown,
  replaceAssetInMarkdown,
} from "./asset-markdown";
import type { IAssetReEditMetadata } from "../types/reedit";
import { serializeReEditMetadata, deserializeReEditMetadata, decodeHtmlEntities } from "./reedit-data";
import { log, warn, error } from "./logger";

/** 思源图像块二次编辑自定义属性名称 */
export const CUSTOM_ATTR_REEDIT = "custom-asset-reedit";

/**
 * 替换给定 Block 集合中的资源引用，并更新到 Siyuan 数据库中
 * @param references 涉及该资源的所有 Block 引用信息
 * @param oldAssetName 旧资源名称（如 123.png）
 * @param newAssetName 新资源名称（如 123_edited.png）
 */
export async function replaceAssetInBlocks(
  references: BlockRef[],
  oldAssetName: string,
  newAssetName: string
): Promise<void> {
  for (const ref of references) {
    // 重新获取最新的 markdown，防止并发修改导致丢失
    const blocks = await sql(`SELECT markdown FROM blocks WHERE id = '${ref.id}'`);
    if (blocks && blocks.length > 0) {
      const currentMarkdown = blocks[0].markdown;
      if (currentMarkdown.includes(`assets/${oldAssetName}`)) {
        const newMarkdown = replaceAssetInMarkdown(currentMarkdown, oldAssetName, newAssetName);
        // 使用 Siyuan API 更新 Block，注意：更新时需要包含 data
        await updateBlock("markdown", newMarkdown, ref.id);
      }
    }
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

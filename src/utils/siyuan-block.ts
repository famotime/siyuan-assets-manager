import { updateBlock, deleteBlock, sql } from "../api";
import { BlockRef } from "./siyuan-db";

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
  const regex = new RegExp(`assets/${oldAssetName}`, "g");
  const newPath = `assets/${newAssetName}`;

  for (const ref of references) {
    // 重新获取最新的 markdown，防止并发修改导致丢失
    const blocks = await sql(`SELECT markdown FROM blocks WHERE id = '${ref.id}'`);
    if (blocks && blocks.length > 0) {
      const currentMarkdown = blocks[0].markdown;
      if (currentMarkdown.includes(`assets/${oldAssetName}`)) {
        const newMarkdown = currentMarkdown.replace(regex, newPath);
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
  // 转义资产文件名中的正则特殊字符
  const escapedName = assetName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  // 匹配图片：![alt](assets/xxx.png){...}
  const imgRegex = new RegExp(`!\\[.*?\\]\\(assets/${escapedName}\\)(\\{.*?\\})?`, "g");
  // 匹配链接：[text](assets/xxx.png){...}
  const linkRegex = new RegExp(`\\[.*?\\]\\(assets/${escapedName}\\)(\\{.*?\\})?`, "g");
  // 匹配纯路径：assets/xxx.png
  const pathRegex = new RegExp(`assets/${escapedName}`, "g");

  for (const ref of references) {
    const blocks = await sql(`SELECT markdown FROM blocks WHERE id = '${ref.id}'`);
    if (blocks && blocks.length > 0) {
      const currentMarkdown = blocks[0].markdown;
      if (currentMarkdown.includes(`assets/${assetName}`)) {
        let newMarkdown = currentMarkdown.replace(imgRegex, "");
        newMarkdown = newMarkdown.replace(linkRegex, "");
        newMarkdown = newMarkdown.replace(pathRegex, "");
        
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

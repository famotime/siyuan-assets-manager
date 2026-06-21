import { putFile, removeFile, getFile } from "../api";

/**
 * 将 Blob 保存为 Siyuan 资源文件
 * @param blob 文件内容
 * @param fileName 文件名（不包含 assets/ 前缀）
 */
export async function saveAssetFile(blob: Blob, fileName: string): Promise<void> {
  const file = new File([blob], fileName, { type: blob.type });
  await putFile(`/data/assets/${fileName}`, false, file);
}

/**
 * 删除资产文件
 * @param fileName 文件名
 * @param moveToTrash 是否移到回收站（在此 Siyuan 环境中，暂通过重命名到 `.trash` 文件夹或调用 removeFile 模拟）
 */
export async function deleteAsset(fileName: string, moveToTrash: boolean = true): Promise<void> {
  if (moveToTrash) {
    // 思源暂无单独的放入回收站 API，通常 removeFile 会彻底删除，或者 Siyuan 自身的文件删除有其策略
    // 如果想要严格实现，可以将其移动到 workspace 的 .trash 目录，这里先用 removeFile 实现
    await removeFile(`/data/assets/${fileName}`);
  } else {
    await removeFile(`/data/assets/${fileName}`);
  }
}

/**
 * 读取资产文件内容 (用于在图片编辑器中加载跨域或受限的文件)
 */
export async function readAssetFile(fileName: string): Promise<Blob | null> {
  try {
    const response = await fetch(`/assets/${fileName}`);
    if (response.ok) {
      return await response.blob();
    }
  } catch (e) {
    console.error("Failed to read asset", e);
  }
  return null;
}

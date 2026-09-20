import {
  defaultStorage,
  openOSRecycleBin,
  ORIGINALS_STORAGE_DIR,
  ORIGINALS_STORAGE_RELATIVE,
  normalizeOriginalStoragePath,
  getOriginalAbsoluteDataPath,
  METADATA_STORAGE_DIR,
  METADATA_STORAGE_RELATIVE,
  normalizeMetadataFileName,
  getMetadataAbsoluteDataPath,
} from './storage';
import type { IAssetReEditMetadata } from '../types/reedit';
import { error } from './logger';

export {
  openOSRecycleBin,
  ORIGINALS_STORAGE_DIR,
  ORIGINALS_STORAGE_RELATIVE,
  normalizeOriginalStoragePath,
  getOriginalAbsoluteDataPath,
  METADATA_STORAGE_DIR,
  METADATA_STORAGE_RELATIVE,
  normalizeMetadataFileName,
  getMetadataAbsoluteDataPath,
};

/**
 * 将 DataURL 安全转换为 Blob，避免大型 DataURL 调用 fetch 失败
 */
export function dataURLToBlob(dataUrl: string): Blob {
  const arr = dataUrl.split(',');
  const mimeMatch = arr[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/png';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

/**
 * 将 Blob 保存为 Siyuan 资源文件 (data/assets/xxx)
 * @param blob 文件内容
 * @param fileName 文件名（不包含 assets/ 前缀）
 */
export async function saveAssetFile(blob: Blob, fileName: string): Promise<void> {
  return defaultStorage.saveAsset(fileName, blob);
}

/**
 * 检查当前宿主环境是否支持操作系统回收站
 */
export function isTrashSupported(): boolean {
  return defaultStorage.isTrashSupported();
}

/**
 * 删除资产文件
 * @param fileName 文件名
 * @param moveToTrash 是否移到操作系统回收站（默认 true）
 */
export async function deleteAsset(fileName: string, moveToTrash: boolean = true): Promise<boolean> {
  if (moveToTrash && defaultStorage.isTrashSupported()) {
    return defaultStorage.deleteAssetToTrash(fileName);
  }
  return defaultStorage.deleteAsset(fileName);
}

export const deleteAssetFile = deleteAsset;

/**
 * 读取资产文件内容 (用于在图片编辑器中加载跨域或受限的文件)
 */
export async function readAssetFile(fileName: string): Promise<Blob | null> {
  return defaultStorage.readAsset(fileName);
}

/**
 * 重命名物理资源文件
 * @param oldName 旧文件名
 * @param newName 新文件名
 * @param deleteOld 是否删除旧文件
 */
export async function renameAssetFile(oldName: string, newName: string, deleteOld: boolean = true): Promise<boolean> {
  try {
    const blob = await readAssetFile(oldName);
    if (!blob) {
      error(`[file-system] 重命名失败，无法读取旧文件: ${oldName}`);
      return false;
    }
    await saveAssetFile(blob, newName);
    if (deleteOld) {
      await deleteAssetFile(oldName);
    }
    return true;
  } catch (e) {
    error('[file-system] 重命名物理文件失败:', e);
    return false;
  }
}

/**
 * 将原始底图保存到插件专属隔离存储目录 (data/storage/petal/siyuan-assets-manager/originals/)
 * @param blob 原始底图二进制
 * @param baseName 原始文件名或基础名
 * @returns 相对存储路径（如 storage/petal/siyuan-assets-manager/originals/172000_foo.png）
 */
export async function saveOriginalImage(blob: Blob, baseName: string): Promise<string> {
  return defaultStorage.saveOriginal(baseName, blob);
}

/**
 * 从隔离存储目录读取原始干净底图
 */
export async function readOriginalImage(storagePathOrName: string): Promise<Blob | null> {
  return defaultStorage.readOriginal(storagePathOrName);
}

/**
 * 删除隔离存储目录中的原始底图
 * @param storagePathOrName 底图路径或名称
 * @param moveToTrash 是否移到操作系统回收站（默认 true）
 */
export async function deleteOriginalImage(storagePathOrName: string, moveToTrash: boolean = true): Promise<boolean> {
  if (moveToTrash && defaultStorage.isTrashSupported()) {
    return defaultStorage.deleteOriginalToTrash(storagePathOrName);
  }
  return defaultStorage.deleteOriginal(storagePathOrName);
}

/**
 * 列出隔离存储目录中的所有原始底图文件
 */
export async function listOriginalImages(): Promise<Array<{ name: string; path: string; size: number; updated: number }>> {
  return defaultStorage.listOriginals();
}

/**
 * 将现有资产文件安全拷贝到隔离存储目录并作为原始底图
 */
export async function copyAssetToOriginals(assetName: string): Promise<string | null> {
  try {
    const blob = await readAssetFile(assetName);
    if (!blob) {
      error(`[file-system] 拷贝原始底图失败，无法读取资产: ${assetName}`);
      return null;
    }
    return await saveOriginalImage(blob, assetName);
  } catch (e) {
    error(`[file-system] 拷贝资产至原始底图目录异常:`, e);
    return null;
  }
}

/**
 * 将二次编辑元数据保存到插件专属存储目录 (data/storage/petal/siyuan-assets-manager/metadata/${assetName}.json)
 */
export async function saveAssetMetadataFile(assetName: string, metadata: IAssetReEditMetadata): Promise<void> {
  return defaultStorage.saveAssetMetadata(assetName, metadata);
}

/**
 * 从插件专属存储目录读取二次编辑元数据
 */
export async function readAssetMetadataFile(assetName: string): Promise<IAssetReEditMetadata | null> {
  return defaultStorage.readAssetMetadata(assetName);
}

/**
 * 删除插件专属存储目录中的二次编辑元数据
 */
export async function deleteAssetMetadataFile(assetName: string): Promise<boolean> {
  return defaultStorage.deleteAssetMetadata(assetName);
}

/**
 * 列出插件专属存储目录中的所有二次编辑元数据
 */
export async function listAllAssetMetadataFiles(): Promise<Array<{ assetName: string; metadata: IAssetReEditMetadata }>> {
  return defaultStorage.listAssetMetadata();
}

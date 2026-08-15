import { putFile, removeFile, readDir } from "../api";
import { log, error } from "./logger";

/** 原始底图在思源中的存储根目录（绝对路径） */
export const ORIGINALS_STORAGE_DIR = "/data/storage/petal/siyuan-assets-manager/originals";

/** 原始底图相对路径前缀 */
export const ORIGINALS_STORAGE_RELATIVE = "storage/petal/siyuan-assets-manager/originals";

/**
 * 规范化原始底图路径为相对路径 (如 "storage/petal/siyuan-assets-manager/originals/foo.png")
 */
export function normalizeOriginalStoragePath(pathOrName: string): string {
  if (!pathOrName) return "";
  let clean = pathOrName.replace(/^\/+/, "").replace(/^data\//, "");
  if (!clean.startsWith(ORIGINALS_STORAGE_RELATIVE)) {
    const baseName = clean.split("/").pop() || clean;
    clean = `${ORIGINALS_STORAGE_RELATIVE}/${baseName}`;
  }
  return clean;
}

/**
 * 获取原始底图的绝对访问路径 (如 "/data/storage/petal/siyuan-assets-manager/originals/foo.png")
 */
export function getOriginalAbsoluteDataPath(storagePath: string): string {
  const relative = normalizeOriginalStoragePath(storagePath);
  return `/data/${relative}`;
}

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
  // 1. 优先在桌面端 Electron 环境下直接使用 Node.js FS 秒写，避免大文件上传限制
  let fs: any;
  let pathLib: any;
  let dataDir = '';
  try {
    fs = (window as any).require('fs');
    pathLib = (window as any).require('path');
    dataDir = (window as any).siyuan?.config?.system?.dataDir;
  } catch (e) {}

  if (fs && pathLib && dataDir) {
    try {
      const destPath = pathLib.join(dataDir, 'assets', fileName);
      const arrayBuffer = await blob.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      fs.writeFileSync(destPath, buffer);
      log(`[saveAssetFile] FS writeFileSync succeeded for ${fileName}`);
      return;
    } catch (fsErr) {
      error(`[saveAssetFile] FS writeFileSync failed, fallback to API:`, fsErr);
    }
  }

  // 2. Web 环境保底：使用原生 fetch 提交 FormData
  const form = new FormData();
  form.append('path', `/data/assets/${fileName}`);
  form.append('isDir', 'false');
  form.append('modTime', Math.floor(Date.now() / 1000).toString());
  const file = new File([blob], fileName, { type: blob.type || 'image/png' });
  form.append('file', file);

  try {
    const res = await fetch('/api/file/putFile', {
      method: 'POST',
      body: form,
    });
    const json = await res.json();
    if (json.code !== 0) {
      throw new Error(json.msg || `putFile returned code ${json.code}`);
    }
    log(`[saveAssetFile] fetch putFile succeeded for ${fileName}`);
  } catch (apiErr) {
    error(`[saveAssetFile] fetch putFile failed:`, apiErr);
    await putFile(`/data/assets/${fileName}`, false, file);
  }
}

/**
 * 删除资产文件
 * @param fileName 文件名
 * @param moveToTrash 是否移到回收站
 */
export async function deleteAsset(fileName: string, moveToTrash: boolean = true): Promise<void> {
  await removeFile(`/data/assets/${fileName}`);
}

/**
 * 读取资产文件内容 (用于在图片编辑器中加载跨域或受限的文件)
 */
export async function readAssetFile(fileName: string): Promise<Blob | null> {
  // 1. 桌面端 Electron 环境下直接读取
  let fs: any;
  let pathLib: any;
  let dataDir = '';
  try {
    fs = (window as any).require('fs');
    pathLib = (window as any).require('path');
    dataDir = (window as any).siyuan?.config?.system?.dataDir;
  } catch (e) {}

  if (fs && pathLib && dataDir) {
    try {
      const absPath = pathLib.join(dataDir, 'assets', fileName);
      if (fs.existsSync(absPath)) {
        const buffer = fs.readFileSync(absPath);
        return new Blob([buffer]);
      }
    } catch (e) {}
  }

  // 2. Web 环境通过 fetch 读取
  try {
    const response = await fetch(`/assets/${fileName}`);
    if (response.ok) {
      return await response.blob();
    }
  } catch (e) {
    error("Failed to read asset", e);
  }
  return null;
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
      await removeFile(`/data/assets/${oldName}`);
    }
    return true;
  } catch (e) {
    error("[file-system] 重命名物理文件失败:", e);
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
  const cleanBase = baseName.split("/").pop() || "original.png";
  const uniqueName = `${Date.now()}_${cleanBase}`;
  const relativePath = `${ORIGINALS_STORAGE_RELATIVE}/${uniqueName}`;
  const absolutePath = `/data/${relativePath}`;

  // 1. Electron 环境极速直写
  let fs: any;
  let pathLib: any;
  let dataDir = '';
  try {
    fs = (window as any).require('fs');
    pathLib = (window as any).require('path');
    dataDir = (window as any).siyuan?.config?.system?.dataDir;
  } catch (e) {}

  if (fs && pathLib && dataDir) {
    try {
      const originalsDir = pathLib.join(dataDir, 'storage', 'petal', 'siyuan-assets-manager', 'originals');
      if (!fs.existsSync(originalsDir)) {
        fs.mkdirSync(originalsDir, { recursive: true });
      }
      const destPath = pathLib.join(originalsDir, uniqueName);
      const arrayBuffer = await blob.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      fs.writeFileSync(destPath, buffer);
      log(`[file-system] FS 成功写入原始底图: ${relativePath}`);
      return relativePath;
    } catch (fsErr) {
      error(`[file-system] FS 写入原始底图失败，回退 API:`, fsErr);
    }
  }

  // 2. Web API 环境
  const file = new File([blob], uniqueName, { type: blob.type || 'image/png' });
  const form = new FormData();
  form.append('path', absolutePath);
  form.append('isDir', 'false');
  form.append('modTime', Math.floor(Date.now() / 1000).toString());
  form.append('file', file);

  try {
    const res = await fetch('/api/file/putFile', {
      method: 'POST',
      body: form,
    });
    const json = await res.json();
    if (json.code !== 0) {
      throw new Error(json.msg || `putFile returned code ${json.code}`);
    }
    log(`[file-system] API 成功写入原始底图: ${relativePath}`);
    return relativePath;
  } catch (apiErr) {
    error(`[file-system] API 写入原始底图失败:`, apiErr);
    await putFile(absolutePath, false, file);
    return relativePath;
  }
}

/**
 * 从隔离存储目录读取原始干净底图
 */
export async function readOriginalImage(storagePathOrName: string): Promise<Blob | null> {
  const relativePath = normalizeOriginalStoragePath(storagePathOrName);
  const fileName = relativePath.split("/").pop() || "";
  const absolutePath = `/data/${relativePath}`;

  // 1. Electron 环境
  let fs: any;
  let pathLib: any;
  let dataDir = '';
  try {
    fs = (window as any).require('fs');
    pathLib = (window as any).require('path');
    dataDir = (window as any).siyuan?.config?.system?.dataDir;
  } catch (e) {}

  if (fs && pathLib && dataDir) {
    try {
      const destPath = pathLib.join(dataDir, 'storage', 'petal', 'siyuan-assets-manager', 'originals', fileName);
      if (fs.existsSync(destPath)) {
        const buffer = fs.readFileSync(destPath);
        return new Blob([buffer]);
      }
    } catch (e) {}
  }

  // 2. Web 环境
  try {
    const response = await fetch('/api/file/getFile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: absolutePath }),
    });
    if (response.ok) {
      return await response.blob();
    }
  } catch (e) {
    error("[file-system] 读取原始底图失败:", storagePathOrName, e);
  }
  return null;
}

/**
 * 删除隔离存储目录中的原始底图
 */
export async function deleteOriginalImage(storagePathOrName: string): Promise<boolean> {
  const absolutePath = getOriginalAbsoluteDataPath(storagePathOrName);
  try {
    await removeFile(absolutePath);
    return true;
  } catch (e) {
    error("[file-system] 删除原始底图失败:", absolutePath, e);
    return false;
  }
}

/**
 * 列出隔离存储目录中的所有原始底图文件
 */
export async function listOriginalImages(): Promise<Array<{ name: string; path: string; size: number; updated: number }>> {
  try {
    const files: any[] = await readDir(ORIGINALS_STORAGE_DIR);
    if (!files || !Array.isArray(files)) return [];

    return files
      .filter((file) => !file.isDir)
      .map((file) => ({
        name: file.name,
        path: `${ORIGINALS_STORAGE_RELATIVE}/${file.name}`,
        size: file.size || 0,
        updated: file.updated || 0,
      }));
  } catch (e) {
    error("[file-system] 列出原始底图失败:", e);
    return [];
  }
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

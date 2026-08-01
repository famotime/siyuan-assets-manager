import { putFile, removeFile } from "../api";
import { log, error } from "./logger";

/**
 * 将 DataURL 安全转换为 Blob，避免大型 DataURL 调用 fetch 失败
 */
export function dataURLToBlob(dataUrl: string): Blob {
  const arr = dataUrl.split(',')
  const mimeMatch = arr[0].match(/:(.*?);/)
  const mime = mimeMatch ? mimeMatch[1] : 'image/png'
  const bstr = atob(arr[1])
  let n = bstr.length
  const u8arr = new Uint8Array(n)
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n)
  }
  return new Blob([u8arr], { type: mime })
}

/**
 * 将 Blob 保存为 Siyuan 资源文件
 * @param blob 文件内容
 * @param fileName 文件名（不包含 assets/ 前缀）
 */
export async function saveAssetFile(blob: Blob, fileName: string): Promise<void> {
  // 1. 优先在桌面端 Electron 环境下直接使用 Node.js FS 秒写，避免大文件上传限制
  let fs: any
  let pathLib: any
  let dataDir = ''
  try {
    fs = (window as any).require('fs')
    pathLib = (window as any).require('path')
    dataDir = (window as any).siyuan?.config?.system?.dataDir
  } catch (e) {}

  if (fs && pathLib && dataDir) {
    try {
      const destPath = pathLib.join(dataDir, 'assets', fileName)
      const arrayBuffer = await blob.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      fs.writeFileSync(destPath, buffer)
      log(`[saveAssetFile] FS writeFileSync succeeded for ${fileName}`)
      return
    } catch (fsErr) {
      error(`[saveAssetFile] FS writeFileSync failed, fallback to API:`, fsErr)
    }
  }

  // 2. Web 环境保底：使用原生 fetch 提交 FormData，避免 SDK 将 FormData 错误转为 JSON
  const form = new FormData()
  form.append('path', `/data/assets/${fileName}`)
  form.append('isDir', 'false')
  form.append('modTime', Math.floor(Date.now() / 1000).toString())
  const file = new File([blob], fileName, { type: blob.type || 'image/png' })
  form.append('file', file)

  try {
    const res = await fetch('/api/file/putFile', {
      method: 'POST',
      body: form,
    })
    const json = await res.json()
    if (json.code !== 0) {
      throw new Error(json.msg || `putFile returned code ${json.code}`)
    }
    log(`[saveAssetFile] fetch putFile succeeded for ${fileName}`)
  } catch (apiErr) {
    error(`[saveAssetFile] fetch putFile failed:`, apiErr)
    await putFile(`/data/assets/${fileName}`, false, file)
  }
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


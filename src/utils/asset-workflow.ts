import type { AssetInfo, BlockRef } from './siyuan-db'
import type { IAssetReEditMetadata } from '../types/reedit'
import {
  saveAssetFile as defaultSaveAssetFile,
  renameAssetFile as defaultRenameAssetFile,
  dataURLToBlob,
  saveOriginalImage as defaultSaveOriginalImage,
  readAssetFile as defaultReadAssetFile,
  deleteAssetFile as defaultDeleteAssetFile,
} from './file-system'
import {
  replaceAssetInBlocks as defaultReplaceAssetInBlocks,
  setImageBlockReEditData as defaultSetImageBlockReEditData,
} from './siyuan-block'
import {
  getAssetInfoByName as defaultGetAssetInfoByName,
} from './siyuan-db'
import {
  buildEditedAssetName,
  resolveRenameAssetName,
} from './asset-actions'
import { log, error } from './logger'

export interface SaveEditedAssetParams {
  oldName: string
  dataUrl: string
  blockId?: string
  vectorData?: any
  isReEditMode?: boolean
  originalStoragePath?: string
  originalSize?: { width: number; height: number }
  promptOnDeleteOriginal?: boolean
  onConfirmDelete?: (oldName: string, newName: string) => Promise<boolean>
}

export interface SaveEditedAssetResult {
  success: boolean
  newName: string
  targetBlockCount: number
  originalPathSaved: string
  deletedOld: boolean
}

export interface SaveEditedWorkflowDeps {
  saveAssetFile?: typeof defaultSaveAssetFile
  getAssetInfoByName?: typeof defaultGetAssetInfoByName
  replaceAssetInBlocks?: typeof defaultReplaceAssetInBlocks
  readAssetFile?: typeof defaultReadAssetFile
  saveOriginalImage?: typeof defaultSaveOriginalImage
  setImageBlockReEditData?: typeof defaultSetImageBlockReEditData
  deleteAssetFile?: typeof defaultDeleteAssetFile
}

/**
 * 执行图片保存编辑完整工作流：
 * 1. 生成新文件名并物理写入 data/assets/
 * 2. 联动更新思源文档块中的资源引用
 * 3. 归档隔离原始底图（首次编辑）或复用现有底图
 * 4. 写入所有关联块的 custom-asset-reedit 自定义属性
 * 5. 根据设置提示并删除旧资源文件
 */
export async function executeSaveEditedAssetWorkflow(
  params: SaveEditedAssetParams,
  deps: SaveEditedWorkflowDeps = {},
): Promise<SaveEditedAssetResult> {
  const {
    oldName,
    dataUrl,
    blockId,
    vectorData,
    originalStoragePath,
    originalSize,
    promptOnDeleteOriginal = false,
    onConfirmDelete,
  } = params

  const saveAssetFile = deps.saveAssetFile || defaultSaveAssetFile
  const getAssetInfoByName = deps.getAssetInfoByName || defaultGetAssetInfoByName
  const replaceAssetInBlocks = deps.replaceAssetInBlocks || defaultReplaceAssetInBlocks
  const readAssetFile = deps.readAssetFile || defaultReadAssetFile
  const saveOriginalImage = deps.saveOriginalImage || defaultSaveOriginalImage
  const setImageBlockReEditData = deps.setImageBlockReEditData || defaultSetImageBlockReEditData
  const deleteAssetFile = deps.deleteAssetFile || defaultDeleteAssetFile

  const newName = buildEditedAssetName(oldName)
  const blob = dataURLToBlob(dataUrl)

  // 1. 保存物理位图文件
  await saveAssetFile(blob, newName)

  // 2. 异步获取旧图片的 AssetInfo 并联动更新引用
  const assetRecord = await getAssetInfoByName(oldName)
  if (assetRecord?.references && assetRecord.references.length > 0) {
    await replaceAssetInBlocks(assetRecord.references, oldName, newName)
  }

  // 3. 收集所有目标 Block ID
  const targetBlockIds = new Set<string>()
  if (blockId) {
    targetBlockIds.add(blockId)
  }
  if (assetRecord?.references) {
    for (const ref of assetRecord.references) {
      if (ref.id) {
        targetBlockIds.add(ref.id)
      }
    }
  }

  // 4. 处理原始底图持久化与块自定义属性 custom-asset-reedit
  let finalOriginalPath = originalStoragePath || ''
  if (targetBlockIds.size > 0) {
    if (!finalOriginalPath) {
      try {
        const originalBlob = await readAssetFile(oldName)
        if (originalBlob) {
          finalOriginalPath = await saveOriginalImage(originalBlob, oldName)
        }
      } catch (origErr) {
        error('[asset-workflow] 归档原始底图失败:', origErr)
      }
    }

    if (finalOriginalPath) {
      const metadata: IAssetReEditMetadata = {
        version: 1,
        originalStoragePath: finalOriginalPath,
        renderedAssetName: newName,
        canvasSize: {
          width: originalSize?.width || 800,
          height: originalSize?.height || 600,
        },
        compressed: false,
        vectorData: vectorData || { objects: [] },
        updatedAt: Date.now(),
      }

      for (const bId of targetBlockIds) {
        await setImageBlockReEditData(bId, metadata)
      }
    }
  }

  // 5. 询问是否删除旧图片
  let delOld = true
  if (promptOnDeleteOriginal && onConfirmDelete) {
    delOld = await onConfirmDelete(oldName, newName)
  }
  if (delOld) {
    await deleteAssetFile(oldName)
  }

  return {
    success: true,
    newName,
    targetBlockCount: targetBlockIds.size,
    originalPathSaved: finalOriginalPath,
    deletedOld: delOld,
  }
}

export interface RenameAssetWorkflowParams {
  asset: AssetInfo
  newNameInput: string
  promptOnDeleteOriginal?: boolean
  onConfirmExtChange?: (oldExt: string, newExt: string) => Promise<boolean>
  onConfirmDelete?: (oldName: string, newName: string) => Promise<boolean>
}

export interface RenameAssetWorkflowResult {
  ok: boolean
  reason?: string
  changed?: boolean
  newName?: string
  updatedBlockCount?: number
  deletedOld?: boolean
}

export interface RenameWorkflowDeps {
  renameAssetFile?: typeof defaultRenameAssetFile
  replaceAssetInBlocks?: typeof defaultReplaceAssetInBlocks
}

/**
 * 执行资源重命名完整工作流：
 * 1. 校验新文件名与扩展名合法性
 * 2. 物理重命名文件
 * 3. 联动更新文档中所有引用该资源的块
 */
export async function executeRenameAssetWorkflow(
  params: RenameAssetWorkflowParams,
  deps: RenameWorkflowDeps = {},
): Promise<RenameAssetWorkflowResult> {
  const {
    asset,
    newNameInput,
    promptOnDeleteOriginal = false,
    onConfirmExtChange,
    onConfirmDelete,
  } = params

  const renameAssetFile = deps.renameAssetFile || defaultRenameAssetFile
  const replaceAssetInBlocks = deps.replaceAssetInBlocks || defaultReplaceAssetInBlocks

  const oldName = asset.name
  const renameResult = await resolveRenameAssetName(
    oldName,
    newNameInput,
    onConfirmExtChange || (async () => true),
  )

  if (!renameResult.ok) {
    return {
      ok: false,
      reason: renameResult.reason,
    }
  }

  if (!renameResult.changed) {
    return {
      ok: true,
      changed: false,
      newName: oldName,
      updatedBlockCount: 0,
    }
  }

  const newName = renameResult.name

  let deleteOld = true
  if (promptOnDeleteOriginal && onConfirmDelete) {
    deleteOld = await onConfirmDelete(oldName, newName)
  }

  const success = await renameAssetFile(oldName, newName, deleteOld)
  if (!success) {
    return {
      ok: false,
      reason: 'fileSystemError',
    }
  }

  if (asset.references && asset.references.length > 0) {
    await replaceAssetInBlocks(asset.references, oldName, newName)
  }

  return {
    ok: true,
    changed: true,
    newName,
    updatedBlockCount: asset.references?.length || 0,
    deletedOld: deleteOld,
  }
}

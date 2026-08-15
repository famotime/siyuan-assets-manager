import { describe, expect, it, vi } from 'vitest'
import {
  executeSaveEditedAssetWorkflow,
  executeRenameAssetWorkflow,
  type SaveEditedWorkflowDeps,
  type RenameWorkflowDeps,
} from '../src/utils/asset-workflow'
import type { AssetInfo } from '../src/utils/siyuan-db'

describe('asset workflow', () => {
  it('executes save edited workflow for first-time edit, archives original and saves metadata', async () => {
    const saveAssetFile = vi.fn().mockResolvedValue(undefined)
    const getAssetInfoByName = vi.fn().mockResolvedValue({
      name: 'foo.png',
      references: [{ id: 'block-1', root_id: 'doc-1' }],
    })
    const replaceAssetInBlocks = vi.fn().mockResolvedValue(undefined)
    const readAssetFile = vi.fn().mockResolvedValue(new Blob(['original-bytes']))
    const saveOriginalImage = vi.fn().mockResolvedValue('storage/petal/siyuan-assets-manager/originals/foo_orig.png')
    const setImageBlockReEditData = vi.fn().mockResolvedValue(true)
    const deleteAssetFile = vi.fn().mockResolvedValue(undefined)

    const deps: SaveEditedWorkflowDeps = {
      saveAssetFile,
      getAssetInfoByName,
      replaceAssetInBlocks,
      readAssetFile,
      saveOriginalImage,
      setImageBlockReEditData,
      deleteAssetFile,
    }

    const result = await executeSaveEditedAssetWorkflow(
      {
        oldName: 'foo.png',
        dataUrl: 'data:image/png;base64,AAAA',
        blockId: 'block-2',
        vectorData: { objects: [{ type: 'rect' }] },
        isReEditMode: false,
        originalStoragePath: '',
        originalSize: { width: 800, height: 600 },
        promptOnDeleteOriginal: true,
        onConfirmDelete: async () => true,
      },
      deps,
    )

    expect(result.success).toBe(true)
    expect(result.newName).toContain('foo_edited_')
    expect(saveAssetFile).toHaveBeenCalledTimes(1)
    expect(replaceAssetInBlocks).toHaveBeenCalledWith(
      [{ id: 'block-1', root_id: 'doc-1' }],
      'foo.png',
      result.newName,
    )
    expect(saveOriginalImage).toHaveBeenCalledTimes(1)
    expect(setImageBlockReEditData).toHaveBeenCalledTimes(2) // block-2 and block-1
    expect(deleteAssetFile).toHaveBeenCalledWith('foo.png')
    expect(result.deletedOld).toBe(true)
  })

  it('reuses existing original storage path in secondary edit mode', async () => {
    const saveAssetFile = vi.fn().mockResolvedValue(undefined)
    const getAssetInfoByName = vi.fn().mockResolvedValue({
      name: 'foo_edited_123.png',
      references: [{ id: 'block-1', root_id: 'doc-1' }],
    })
    const replaceAssetInBlocks = vi.fn().mockResolvedValue(undefined)
    const readAssetFile = vi.fn()
    const saveOriginalImage = vi.fn()
    const setImageBlockReEditData = vi.fn().mockResolvedValue(true)
    const deleteAssetFile = vi.fn().mockResolvedValue(undefined)

    const deps: SaveEditedWorkflowDeps = {
      saveAssetFile,
      getAssetInfoByName,
      replaceAssetInBlocks,
      readAssetFile,
      saveOriginalImage,
      setImageBlockReEditData,
      deleteAssetFile,
    }

    const result = await executeSaveEditedAssetWorkflow(
      {
        oldName: 'foo_edited_123.png',
        dataUrl: 'data:image/png;base64,AAAA',
        blockId: 'block-1',
        vectorData: { objects: [] },
        isReEditMode: true,
        originalStoragePath: 'storage/petal/siyuan-assets-manager/originals/foo_orig.png',
        originalSize: { width: 800, height: 600 },
        promptOnDeleteOriginal: false,
      },
      deps,
    )

    expect(result.success).toBe(true)
    expect(saveOriginalImage).not.toHaveBeenCalled()
    expect(setImageBlockReEditData).toHaveBeenCalledWith(
      'block-1',
      expect.objectContaining({
        originalStoragePath: 'storage/petal/siyuan-assets-manager/originals/foo_orig.png',
      }),
    )
    expect(deleteAssetFile).toHaveBeenCalledWith('foo_edited_123.png')
    expect(result.deletedOld).toBe(true)
  })

  it('handles rename workflow successfully and updates block references', async () => {
    const renameAssetFile = vi.fn().mockResolvedValue(true)
    const replaceAssetInBlocks = vi.fn().mockResolvedValue(undefined)

    const asset: AssetInfo = {
      name: 'old.png',
      size: 100,
      updated: Date.now(),
      isDir: false,
      references: [{ id: 'block-1', root_id: 'doc-1', box: '', content: '', markdown: '', path: '' }],
      refCount: 1,
      docCount: 1,
    }

    const deps: RenameWorkflowDeps = {
      renameAssetFile,
      replaceAssetInBlocks,
    }

    const result = await executeRenameAssetWorkflow(
      {
        asset,
        newNameInput: 'renamed',
        promptOnDeleteOriginal: true,
        onConfirmExtChange: async () => true,
        onConfirmDelete: async () => true,
      },
      deps,
    )

    expect(result.ok).toBe(true)
    expect(result.newName).toBe('renamed.png')
    expect(renameAssetFile).toHaveBeenCalledWith('old.png', 'renamed.png', true)
    expect(replaceAssetInBlocks).toHaveBeenCalledWith(asset.references, 'old.png', 'renamed.png')
  })
})

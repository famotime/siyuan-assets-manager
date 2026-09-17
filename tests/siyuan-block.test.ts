import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/api', () => ({
  deleteBlock: vi.fn(),
  sql: vi.fn(),
  updateBlock: vi.fn(),
  getBlockAttrs: vi.fn(),
  setBlockAttrs: vi.fn(),
}))

import {
  deleteBlock,
  sql,
  updateBlock,
  getBlockAttrs,
  setBlockAttrs,
} from '../src/api'
import {
  removeAssetFromBlocks,
  replaceAssetInBlocks,
  getImageBlockReEditData,
  setImageBlockReEditData,
  removeImageBlockReEditData,
  queryAllReEditableBlocks,
  CUSTOM_ATTR_REEDIT,
} from '../src/utils/siyuan-block'
import type { BlockRef } from '../src/utils/siyuan-db'
import type { IAssetReEditMetadata } from '../src/types/reedit'

const sqlMock = vi.mocked(sql)
const updateBlockMock = vi.mocked(updateBlock)
const deleteBlockMock = vi.mocked(deleteBlock)
const getBlockAttrsMock = vi.mocked(getBlockAttrs)
const setBlockAttrsMock = vi.mocked(setBlockAttrs)

function ref(id: string): BlockRef {
  return {
    id,
    root_id: 'root',
    box: 'box',
    content: '',
    markdown: '',
    path: '/doc.sy',
  }
}

describe('siyuan block asset updates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('replaces asset references when asset name contains regexp characters', async () => {
    sqlMock.mockResolvedValue([
      {
        markdown: '![img](assets/a+b(1).png) and assets/a+b(1).png',
      },
    ])

    await replaceAssetInBlocks([ref('block-1')], 'a+b(1).png', 'renamed.png')

    expect(updateBlockMock).toHaveBeenCalledWith(
      'markdown',
      '![img](assets/renamed.png) and assets/renamed.png',
      'block-1',
    )
  })

  it('atomically updates re-edit metadata renderedAssetName when updateReEditMeta option is set', async () => {
    sqlMock.mockResolvedValue([
      { markdown: '![img](assets/old.png)' },
    ])
    getBlockAttrsMock.mockResolvedValue({
      [CUSTOM_ATTR_REEDIT]: JSON.stringify({
        version: 1,
        originalStoragePath: 'storage/petal/siyuan-assets-manager/originals/old_orig.png',
        renderedAssetName: 'old.png',
        canvasSize: { width: 800, height: 600 },
        compressed: false,
        vectorData: { objects: [] },
        updatedAt: 100,
      }),
    })
    setBlockAttrsMock.mockResolvedValue({} as any)

    await replaceAssetInBlocks([ref('block-1')], 'old.png', 'new.png', {
      updateReEditMeta: true,
    })

    expect(updateBlockMock).toHaveBeenCalledWith('markdown', '![img](assets/new.png)', 'block-1')
    expect(setBlockAttrsMock).toHaveBeenCalledWith(
      'block-1',
      expect.objectContaining({
        [CUSTOM_ATTR_REEDIT]: expect.stringContaining('"renderedAssetName":"new.png"'),
      }),
    )
  })

  it('atomically writes new re-edit metadata to affected blocks and additional blocks', async () => {
    sqlMock.mockResolvedValue([
      { markdown: '![img](assets/old.png)' },
    ])
    setBlockAttrsMock.mockResolvedValue({} as any)

    const newMeta: IAssetReEditMetadata = {
      version: 1,
      originalStoragePath: 'storage/petal/siyuan-assets-manager/originals/foo.png',
      renderedAssetName: 'new.png',
      canvasSize: { width: 400, height: 300 },
      compressed: false,
      vectorData: { objects: [] },
      updatedAt: 200,
    }

    await replaceAssetInBlocks([ref('block-1')], 'old.png', 'new.png', {
      newReEditMetadata: newMeta,
      additionalBlockIds: ['block-extra'],
    })

    expect(updateBlockMock).toHaveBeenCalledWith('markdown', '![img](assets/new.png)', 'block-1')
    expect(setBlockAttrsMock).toHaveBeenCalledTimes(2)
    expect(setBlockAttrsMock).toHaveBeenCalledWith('block-1', expect.anything())
    expect(setBlockAttrsMock).toHaveBeenCalledWith('block-extra', expect.anything())
  })

  it('removes asset references and updates non-empty blocks', async () => {
    sqlMock.mockResolvedValue([
      {
        markdown: 'keep ![img](assets/a+b(1).png) and [file](assets/a+b(1).png)',
      },
    ])

    await removeAssetFromBlocks([ref('block-1')], 'a+b(1).png')

    expect(updateBlockMock).toHaveBeenCalledWith('markdown', 'keep  and ', 'block-1')
    expect(deleteBlockMock).not.toHaveBeenCalled()
  })

  it('deletes blocks that become empty after removing asset references', async () => {
    sqlMock.mockResolvedValue([
      {
        markdown: '![img](assets/a+b(1).png)',
      },
    ])

    await removeAssetFromBlocks([ref('block-1')], 'a+b(1).png')

    expect(deleteBlockMock).toHaveBeenCalledWith('block-1')
    expect(updateBlockMock).not.toHaveBeenCalled()
  })

  it('reads and writes custom-asset-reedit block attributes', async () => {
    const meta: IAssetReEditMetadata = {
      version: 1,
      originalStoragePath: 'storage/petal/siyuan-assets-manager/originals/123_foo.png',
      renderedAssetName: 'foo-edited.png',
      canvasSize: { width: 800, height: 600 },
      compressed: false,
      vectorData: { objects: [{ type: 'rect', left: 10, top: 10 }] },
      updatedAt: 1720000000000,
    }

    setBlockAttrsMock.mockResolvedValue({} as any)
    const success = await setImageBlockReEditData('block-123', meta)
    expect(success).toBe(true)
    expect(setBlockAttrsMock).toHaveBeenCalled()
    const callArgs = setBlockAttrsMock.mock.calls[0]
    expect(callArgs[0]).toBe('block-123')
    expect(callArgs[1][CUSTOM_ATTR_REEDIT]).toBeTypeOf('string')

    // Mock 读取
    getBlockAttrsMock.mockResolvedValue({
      [CUSTOM_ATTR_REEDIT]: callArgs[1][CUSTOM_ATTR_REEDIT],
    })

    const readMeta = await getImageBlockReEditData('block-123')
    expect(readMeta).not.toBeNull()
    expect(readMeta?.renderedAssetName).toBe('foo-edited.png')
    expect(readMeta?.vectorData.objects.length).toBe(1)

    // 清除属性
    await removeImageBlockReEditData('block-123')
    expect(setBlockAttrsMock).toHaveBeenCalledWith('block-123', {
      [CUSTOM_ATTR_REEDIT]: '',
    })
  })

  it('queries all blocks with custom-asset-reedit correctly', async () => {
    sqlMock.mockResolvedValue([
      {
        id: 'b-1',
        root_id: 'doc-1',
        ial: '{: id="b-1" custom-asset-reedit="{\\"version\\":1,\\"originalStoragePath\\":\\"orig.png\\",\\"renderedAssetName\\":\\"rend.png\\",\\"canvasSize\\":{\\"width\\":100,\\"height\\":100},\\"compressed\\":false,\\"vectorData\\":{\\"objects\\":[]},\\"updatedAt\\":123}"}',
      },
    ])

    const results = await queryAllReEditableBlocks()
    expect(results.length).toBe(1)
    expect(results[0].blockId).toBe('b-1')
    expect(results[0].metadata.renderedAssetName).toBe('rend.png')
  })

  it('synchronously updates attribute view references when replacing assets', async () => {
    sqlMock.mockResolvedValue([])
    const avModule = await import('../src/utils/attribute-view')
    const spy = vi.spyOn(avModule, 'replaceAssetInAttributeViews').mockResolvedValue(1)

    await replaceAssetInBlocks([], 'old-photo.png', 'new-photo.png')
    expect(spy).toHaveBeenCalledWith('old-photo.png', 'new-photo.png')
  })
})

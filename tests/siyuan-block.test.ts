import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/api', () => ({
  deleteBlock: vi.fn(),
  sql: vi.fn(),
  updateBlock: vi.fn(),
  getBlockAttrs: vi.fn(),
  setBlockAttrs: vi.fn(),
  flushTransaction: vi.fn().mockResolvedValue({ code: 0 }),
  getBlockKramdown: vi.fn(),
}))

import {
  deleteBlock,
  sql,
  updateBlock,
  getBlockAttrs,
  setBlockAttrs,
  flushTransaction,
  getBlockKramdown,
} from '../src/api'
import {
  removeAssetFromBlocks,
  replaceAssetInBlocks,
  queryCurrentAssetBlockReferences,
  verifyAssetZeroReferences,
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
const flushTransactionMock = vi.mocked(flushTransaction)
const getBlockKramdownMock = vi.mocked(getBlockKramdown)

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

  it('replaces URI-encoded asset paths and updates root block IAL title-img', async () => {
    sqlMock.mockResolvedValue([
      {
        id: 'root-doc-1',
        markdown: '这是正文 ![封面](assets/%E6%9E%B6%E6%9E%84%E5%9B%BE.png)',
        ial: '{: id="root-doc-1" title-img="background-image: url(&quot;assets/%E6%9E%B6%E6%9E%84%E5%9B%BE.png&quot;)"}',
      },
    ])

    getBlockAttrsMock.mockResolvedValue({
      'title-img': 'background-image: url("assets/架构图.png")',
    })
    setBlockAttrsMock.mockResolvedValue({} as any)
    updateBlockMock.mockResolvedValue({} as any)

    await replaceAssetInBlocks([ref('root-doc-1')], '架构图.png', '新架构.png')

    // 1. 验证正文 markdown 被正确替换（包括编码格式）
    expect(updateBlockMock).toHaveBeenCalledWith('markdown', expect.stringContaining('assets/新架构.png'), 'root-doc-1')

    // 2. 验证根块 IAL 属性 title-img 被 setBlockAttrs 原子替换
    expect(setBlockAttrsMock).toHaveBeenCalledWith('root-doc-1', {
      'title-img': expect.stringContaining('assets/新架构.png'),
    })
  })

  it('throws error and halts when updateBlock fails (returns null)', async () => {
    sqlMock.mockResolvedValue([
      {
        id: 'block-fail',
        markdown: '![img](assets/fail.png)',
        ial: '',
      },
    ])
    updateBlockMock.mockResolvedValue(null)

    await expect(replaceAssetInBlocks([ref('block-fail')], 'fail.png', 'new.png')).rejects.toThrow('updateBlock 返回异常')
  })

  it('queries current asset references from database accurately', async () => {
    sqlMock.mockResolvedValue([
      {
        id: 'block-live-1',
        root_id: 'doc-live',
        box: 'box-1',
        content: '',
        markdown: '![pic](assets/live.png)',
        path: '/live.sy',
        hpath: '/实时文档',
        ial: '',
      },
    ])

    const results = await queryCurrentAssetBlockReferences('live.png')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('block-live-1')
    expect(results[0].readablePath).toBe('/实时文档')
  })

  describe('verifyAssetZeroReferences', () => {
    it('returns isClean: true when there are no references in DB', async () => {
      sqlMock.mockResolvedValue([])

      const result = await verifyAssetZeroReferences('clean.png')
      expect(result.isClean).toBe(true)
      expect(result.remainingBlocks).toEqual([])
      expect(flushTransactionMock).toHaveBeenCalled()
    })

    it('filters out stale SQLite references when real Kramdown is already updated', async () => {
      // 模拟 SQLite 延迟返回旧块，但真实 AST 节点的 kramdown 已经不含 clean.png
      sqlMock.mockResolvedValue([
        {
          id: 'stale-block',
          root_id: 'root-1',
          box: 'box-1',
          content: '',
          markdown: '![pic](assets/clean.png)',
          path: '/doc.sy',
          ial: '',
        },
      ])

      getBlockKramdownMock.mockResolvedValue({
        id: 'stale-block',
        kramdown: '![pic](assets/replaced.png)\n{: id="stale-block"}',
      })
      getBlockAttrsMock.mockResolvedValue({})

      const result = await verifyAssetZeroReferences('clean.png')
      expect(result.isClean).toBe(true)
      expect(result.remainingBlocks).toHaveLength(0)
    })

    it('identifies real remaining references when real Kramdown still contains old asset', async () => {
      sqlMock.mockResolvedValue([
        {
          id: 'real-stale-block',
          root_id: 'root-1',
          box: 'box-1',
          content: '',
          markdown: '![pic](assets/unreplaced.png)',
          path: '/doc.sy',
          ial: '',
        },
      ])

      getBlockKramdownMock.mockResolvedValue({
        id: 'real-stale-block',
        kramdown: '![pic](assets/unreplaced.png)\n{: id="real-stale-block"}',
      })

      const result = await verifyAssetZeroReferences('unreplaced.png')
      expect(result.isClean).toBe(false)
      expect(result.remainingBlocks).toHaveLength(1)
      expect(result.remainingBlocks[0].id).toBe('real-stale-block')
    })
  })
})

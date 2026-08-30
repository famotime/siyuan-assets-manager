import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/api', () => ({
  readDir: vi.fn(),
  removeFile: vi.fn(),
  sql: vi.fn(),
  lsNotebooks: vi.fn(),
}))

import {
  readDir,
  removeFile,
  sql,
  lsNotebooks,
} from '../src/api'
import {
  getAllAssetsInfo,
  getAssetInfoByName,
  attachReEditMetadata,
  getOrphanOriginals,
  cleanupOrphanOriginals,
  formatReadableDocPath,
} from '../src/utils/siyuan-db'

const readDirMock = vi.mocked(readDir)
const removeFileMock = vi.mocked(removeFile)
const sqlMock = vi.mocked(sql)
const lsNotebooksMock = vi.mocked(lsNotebooks)

describe('siyuan asset database helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('window', {})
    vi.stubGlobal('fetch', vi.fn(async () => ({
      headers: {
        get: () => '2048',
      },
      ok: true,
    })))
  })

  it('builds asset info from physical files and block references', async () => {
    readDirMock.mockImplementation(async (path: string) => {
      if (path === '/data/assets') {
        return [
          {
            name: 'a.png',
            size: 10,
            updated: 1,
            isDir: false,
          },
          {
            name: 'folder',
            size: 0,
            updated: 1,
            isDir: true,
          },
          {
            name: 'b.pdf',
            size: 0,
            updated: 2,
            isDir: false,
          },
        ]
      }
      return []
    })

    sqlMock.mockImplementation(async (query: string) => {
      if (query.includes('custom-asset-reedit')) {
        return []
      }
      return [
        {
          id: 'block-1',
          root_id: 'doc-1',
          box: 'box',
          content: '',
          markdown: '![a](assets/a.png) assets/a.png [b](assets/b.pdf)',
          path: '/doc1.sy',
        },
        {
          id: 'block-2',
          root_id: 'doc-2',
          box: 'box',
          content: '',
          markdown: '![a2](assets/a.png)',
          path: '/doc2.sy',
        },
      ]
    })

    const result = await getAllAssetsInfo()

    expect(result.map((item) => item.name)).toEqual(['a.png', 'b.pdf'])
    expect(result.find((item) => item.name === 'a.png')).toMatchObject({
      size: 10,
      refCount: 2,
      docCount: 2,
    })
    expect(result.find((item) => item.name === 'b.pdf')).toMatchObject({
      size: 2048,
      refCount: 1,
      docCount: 1,
    })
  })

  it('formats readable doc path starting from notebook name', () => {
    expect(formatReadableDocPath('我的笔记本', '/前端/Vue3/组件通信.sy')).toBe('我的笔记本/前端/Vue3/组件通信.sy')
    expect(formatReadableDocPath('知识库', '日常笔记/今日心得')).toBe('知识库/日常笔记/今日心得')
    expect(formatReadableDocPath('默认笔记本', '')).toBe('默认笔记本')
    expect(formatReadableDocPath('', '/前端/Vue3.sy', '/fallback.sy')).toBe('/前端/Vue3.sy')
    expect(formatReadableDocPath('', '', '/fallback.sy')).toBe('/fallback.sy')
  })

  it('attaches reedit metadata to matching asset', () => {
    const map = new Map<string, any>()
    map.set('annotated.png', { name: 'annotated.png', isReEditable: false })

    attachReEditMetadata(map, [
      {
        blockId: 'b-100',
        rootId: 'doc-1',
        metadata: {
          version: 1,
          originalStoragePath: 'storage/.../orig.png',
          renderedAssetName: 'annotated.png',
          canvasSize: { width: 100, height: 100 },
          compressed: false,
          vectorData: { objects: [] },
          updatedAt: 1000,
        },
      },
    ])

    const asset = map.get('annotated.png')
    expect(asset.isReEditable).toBe(true)
    expect(asset.reEditBlockId).toBe('b-100')
    expect(asset.originalStoragePath).toBe('storage/.../orig.png')
  })

  it('scans and cleans up orphan originals', async () => {
    readDirMock.mockImplementation(async (path: string) => {
      if (path === '/data/assets') {
        return [{ name: 'rend.png', size: 100, isDir: false }]
      }
      if (path.includes('originals')) {
        return [
          { name: 'active.png', size: 100, isDir: false },
          { name: 'orphan.png', size: 200, isDir: false },
        ]
      }
      return []
    })

    sqlMock.mockImplementation(async (query: string) => {
      if (query.includes('custom-asset-reedit')) {
        return [
          {
            id: 'b-1',
            root_id: 'doc-1',
            ial: '{: id="b-1" custom-asset-reedit="{\\"version\\":1,\\"originalStoragePath\\":\\"storage/petal/siyuan-assets-manager/originals/active.png\\",\\"renderedAssetName\\":\\"rend.png\\",\\"canvasSize\\":{\\"width\\":100,\\"height\\":100},\\"compressed\\":false,\\"vectorData\\":{\\"objects\\":[]},\\"updatedAt\\":123}"}',
          },
        ]
      }
      return [
        {
          id: 'b-1',
          root_id: 'doc-1',
          markdown: '![rend](assets/rend.png)',
        },
      ]
    })

    const { orphans, totalCount, totalSize } = await getOrphanOriginals()
    expect(totalCount).toBe(1)
    expect(totalSize).toBe(200)
    expect(orphans[0].name).toBe('orphan.png')

    removeFileMock.mockResolvedValue({} as any)
    const cleanupResult = await cleanupOrphanOriginals()
    expect(cleanupResult.deletedCount).toBe(1)
    expect(cleanupResult.freedSize).toBe(200)
    expect(removeFileMock).toHaveBeenCalledWith('/data/storage/petal/siyuan-assets-manager/originals/orphan.png')
  })

  it('returns empty assets when readDir returns no files', async () => {
    readDirMock.mockResolvedValue(null)

    await expect(getAllAssetsInfo()).resolves.toEqual([])
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('builds single asset info by exact parsed references', async () => {
    sqlMock.mockResolvedValue([
      {
        id: 'block-1',
        root_id: 'doc-1',
        box: 'box',
        content: '',
        markdown: 'assets/a+b(1).png assets/aXb(1).png',
        path: '/doc.sy',
      },
    ])

    const result = await getAssetInfoByName('a+b(1).png')

    expect(result).toMatchObject({
      name: 'a+b(1).png',
      size: 2048,
      refCount: 1,
      docCount: 1,
      isOriginal: false,
    })
  })

  it('aggregates original images into getAllAssetsInfo and links references', async () => {
    readDirMock.mockImplementation(async (path: string) => {
      if (path === '/data/assets') {
        return [{ name: 'annotated.png', size: 500, updated: 1, isDir: false }]
      }
      if (path.includes('originals')) {
        return [
          { name: '100_orig.png', size: 1000, updated: 2, isDir: false },
          { name: 'orphan_orig.png', size: 800, updated: 3, isDir: false },
        ]
      }
      return []
    })

    sqlMock.mockImplementation(async (query: string) => {
      if (query.includes('custom-asset-reedit')) {
        return [
          {
            id: 'b-edit-1',
            root_id: 'doc-1',
            ial: '{: id="b-edit-1" custom-asset-reedit="{\\"version\\":1,\\"originalStoragePath\\":\\"storage/petal/siyuan-assets-manager/originals/100_orig.png\\",\\"renderedAssetName\\":\\"annotated.png\\",\\"canvasSize\\":{\\"width\\":100,\\"height\\":100},\\"compressed\\":false,\\"vectorData\\":{\\"objects\\":[]},\\"updatedAt\\":123}"}',
          },
        ]
      }
      return [
        {
          id: 'b-edit-1',
          root_id: 'doc-1',
          box: 'box1',
          content: '',
          markdown: '![edit](assets/annotated.png)',
          path: '/doc1.sy',
        },
      ]
    })

    const allAssets = await getAllAssetsInfo()
    expect(allAssets).toHaveLength(3)

    const rendered = allAssets.find((a) => a.name === 'annotated.png')
    expect(rendered).toMatchObject({
      name: 'annotated.png',
      isReEditable: true,
      isOriginal: false,
      docCount: 1,
    })

    const origUsed = allAssets.find((a) => a.name === '100_orig.png')
    expect(origUsed).toMatchObject({
      name: '100_orig.png',
      isOriginal: true,
      docCount: 1,
      refCount: 1,
    })
    expect(origUsed?.references[0].id).toBe('b-edit-1')

    const origOrphan = allAssets.find((a) => a.name === 'orphan_orig.png')
    expect(origOrphan).toMatchObject({
      name: 'orphan_orig.png',
      isOriginal: true,
      docCount: 0,
      refCount: 0,
    })
  })

  it('queries original asset info directly by name in getAssetInfoByName', async () => {
    readDirMock.mockImplementation(async (path: string) => {
      if (path.includes('originals')) {
        return [{ name: 'my_orig.png', size: 1234, updated: 10, isDir: false }]
      }
      return []
    })

    sqlMock.mockImplementation(async (query: string) => {
      if (query.includes('custom-asset-reedit')) {
        return [
          {
            id: 'b-2',
            root_id: 'doc-2',
            ial: '{: id="b-2" custom-asset-reedit="{\\"version\\":1,\\"originalStoragePath\\":\\"storage/petal/siyuan-assets-manager/originals/my_orig.png\\",\\"renderedAssetName\\":\\"r.png\\",\\"canvasSize\\":{\\"width\\":100,\\"height\\":100},\\"compressed\\":false,\\"vectorData\\":{\\"objects\\":[]},\\"updatedAt\\":123}"}',
          },
        ]
      }
      return []
    })

    const result = await getAssetInfoByName('my_orig.png')
    expect(result).toMatchObject({
      name: 'my_orig.png',
      size: 1234,
      isOriginal: true,
      docCount: 0, // 因为 r.png 物理文件未在 blocks 中有效引用，所以 docCount 正确为 0
    })
  })

  it('correctly sets original image docCount to 0 when rendered image was deleted', async () => {
    // 假设 /data/assets 下已经删除了二次编辑图片
    readDirMock.mockImplementation(async (path: string) => {
      if (path === '/data/assets') {
        return [] // 渲染图片已被删除
      }
      if (path.includes('originals')) {
        return [{ name: 'my_orig.png', size: 1000, updated: 1, isDir: false }]
      }
      return []
    })

    // 但思源数据库中残留了该块的 custom-asset-reedit 属性
    sqlMock.mockImplementation(async (query: string) => {
      if (query.includes('custom-asset-reedit')) {
        return [
          {
            id: 'b-deleted',
            root_id: 'doc-1',
            ial: '{: id="b-deleted" custom-asset-reedit="{\\"version\\":1,\\"originalStoragePath\\":\\"storage/petal/siyuan-assets-manager/originals/my_orig.png\\",\\"renderedAssetName\\":\\"deleted_rendered.png\\",\\"canvasSize\\":{\\"width\\":100,\\"height\\":100},\\"compressed\\":false,\\"vectorData\\":{\\"objects\\":[]},\\"updatedAt\\":123}"}',
          },
        ]
      }
      return []
    })

    const allAssets = await getAllAssetsInfo()
    expect(allAssets).toHaveLength(1)
    
    const originalAsset = allAssets[0]
    expect(originalAsset.name).toBe('my_orig.png')
    expect(originalAsset.isOriginal).toBe(true)
    // 核心断言：当渲染图片被删除后，原始底图的引用数必须正确为 0，不再显示为 1！
    expect(originalAsset.docCount).toBe(0)
    expect(originalAsset.refCount).toBe(0)
    expect(originalAsset.references).toHaveLength(0)

    // 孤立底图扫描也能正确识别出该底图为孤立底图
    const { orphans, totalCount } = await getOrphanOriginals()
    expect(totalCount).toBe(1)
    expect(orphans[0].name).toBe('my_orig.png')
  })
})

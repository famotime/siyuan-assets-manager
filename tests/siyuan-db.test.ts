import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/api', () => ({
  readDir: vi.fn(),
  removeFile: vi.fn(),
  sql: vi.fn(),
}))

import {
  readDir,
  removeFile,
  sql,
} from '../src/api'
import {
  getAllAssetsInfo,
  getAssetInfoByName,
  attachReEditMetadata,
  getOrphanOriginals,
  cleanupOrphanOriginals,
} from '../src/utils/siyuan-db'

const readDirMock = vi.mocked(readDir)
const removeFileMock = vi.mocked(removeFile)
const sqlMock = vi.mocked(sql)

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
      return []
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
    })
  })
})

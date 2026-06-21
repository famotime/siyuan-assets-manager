import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/api', () => ({
  readDir: vi.fn(),
  removeFile: vi.fn(),
  sql: vi.fn(),
}))

import {
  readDir,
  sql,
} from '../src/api'
import {
  getAllAssetsInfo,
  getAssetInfoByName,
} from '../src/utils/siyuan-db'

const readDirMock = vi.mocked(readDir)
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
    readDirMock.mockResolvedValue([
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
    ])
    sqlMock.mockResolvedValue([
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
    ])

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

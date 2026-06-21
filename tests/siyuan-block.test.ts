import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/api', () => ({
  deleteBlock: vi.fn(),
  sql: vi.fn(),
  updateBlock: vi.fn(),
}))

import {
  deleteBlock,
  sql,
  updateBlock,
} from '../src/api'
import {
  removeAssetFromBlocks,
  replaceAssetInBlocks,
} from '../src/utils/siyuan-block'
import type { BlockRef } from '../src/utils/siyuan-db'

const sqlMock = vi.mocked(sql)
const updateBlockMock = vi.mocked(updateBlock)
const deleteBlockMock = vi.mocked(deleteBlock)

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
})

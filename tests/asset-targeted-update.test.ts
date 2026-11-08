import { describe, expect, it, vi } from 'vitest';
import type { AssetInfo, BlockRef } from '../src/utils/asset-model';
import {
  applyTargetedAssetUpdate,
  type AssetTargetedUpdateDetail,
} from '../src/utils/asset-targeted-update';

const ORIGINAL_PATH = '/data/storage/petal/siyuan-assets-manager/originals/orig.png'

function makeBlockRef(id: string, rootId: string): BlockRef {
  return {
    id,
    root_id: rootId,
    box: '20240101010101-box',
    content: `content of ${id}`,
    markdown: `![](assets/demo.png)`,
    path: '/note/demo/20240101010101.md',
  }
}

function makeAsset(overrides: Partial<AssetInfo> = {}): AssetInfo {
  return {
    name: 'demo.png',
    size: 100,
    updated: 1000,
    isDir: false,
    references: [],
    refCount: 0,
    docCount: 0,
    isReEditable: false,
    isOriginal: false,
    ...overrides,
  }
}

/** 场景 1：rename 且旧资产在列表中 → 原位替换，未提供的字段保留旧值 */
describe('applyTargetedAssetUpdate · rename', () => {
  it('原位替换：更新名称/引用/统计与可选字段，其余字段保留', () => {
    const oldItem = makeAsset({
      name: 'old.png',
      size: 77,
      updated: 1,
      isSystemProtected: false,
    })
    const other = makeAsset({ name: 'b.png' })
    const refs = [makeBlockRef('b1', 'root1'), makeBlockRef('b2', 'root2')]
    const detail: AssetTargetedUpdateDetail = {
      action: 'rename',
      oldName: 'old.png',
      newName: 'new.png',
      references: refs,
      updated: 20240101,
      size: 555,
      isReEditable: true,
      reEditBlockId: 'blk-1',
      originalStoragePath: ORIGINAL_PATH,
    }

    const { list } = applyTargetedAssetUpdate([oldItem, other], new Set(), detail)

    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({
      name: 'new.png',
      size: 555,
      updated: 20240101,
      refCount: 2,
      docCount: 2,
      isReEditable: true,
      reEditBlockId: 'blk-1',
      originalStoragePath: ORIGINAL_PATH,
      isSystemProtected: false,
    })
    expect(list[0].references).toBe(refs)
    expect(list[1]).toEqual(other)
  })

  it('size 缺省或为 0 时保留旧 size，可选字段缺省时保留旧值', () => {
    const oldItem = makeAsset({
      name: 'old.png',
      size: 77,
      isReEditable: false,
      reEditBlockId: 'old-blk',
    })
    const refs = [makeBlockRef('b1', 'root1')]

    for (const size of [undefined, 0]) {
      const { list } = applyTargetedAssetUpdate([oldItem], new Set(), {
        action: 'rename',
        oldName: 'old.png',
        newName: 'new.png',
        references: refs,
      })
      void size
      expect(list[0]).toMatchObject({
        name: 'new.png',
        size: 77,
        isReEditable: false,
        reEditBlockId: 'old-blk',
        refCount: 1,
        docCount: 1,
      })
    }
  })

  it('旧资产不在列表中时头部插入新条目（isOriginal: false）', () => {
    const existing = makeAsset({ name: 'b.png' })
    const refs = [makeBlockRef('b1', 'root1')]

    const { list } = applyTargetedAssetUpdate([existing], new Set(), {
      action: 'rename',
      oldName: 'ghost.png',
      newName: 'new.png',
      references: refs,
      updated: 42,
    })

    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({
      name: 'new.png',
      size: 0,
      updated: 42,
      isDir: false,
      refCount: 1,
      docCount: 1,
      isReEditable: false,
      isOriginal: false,
    })
  })

  it('持有 originalStoragePath 时同步关联原始底图的引用数据（含按名称兜底匹配）', () => {
    const original = makeAsset({
      name: 'fallback-name.png',
      isOriginal: true,
      originalStoragePath: ORIGINAL_PATH,
    })
    const refs = [makeBlockRef('b1', 'root1'), makeBlockRef('b2', 'root1')]

    const { list } = applyTargetedAssetUpdate([original], new Set(), {
      action: 'rename',
      oldName: 'old.png',
      newName: 'new.png',
      references: refs,
      originalStoragePath: ORIGINAL_PATH,
    })

    // new 条目 unshift 到头部，原底图排在后面
    expect(list[1].isOriginal).toBe(true)
    expect(list[1].refCount).toBe(2)
    expect(list[1].docCount).toBe(1)
    expect(list[1].references).toEqual([...refs])
  })
})

/** 场景 2：edit 更新与 deletedOld 双态 */
describe('applyTargetedAssetUpdate · edit', () => {
  it('deletedOld（默认）时原位替换：size 与 originalStoragePath 缺省回退旧值，isReEditable 默认 true', () => {
    const oldItem = makeAsset({ name: 'old.png', size: 77, originalStoragePath: ORIGINAL_PATH })
    const refs = [makeBlockRef('b1', 'root1')]

    const { list } = applyTargetedAssetUpdate([oldItem], new Set(), {
      action: 'edit',
      oldName: 'old.png',
      newName: 'new.png',
      references: refs,
      updated: 99,
    })

    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      name: 'new.png',
      size: 77,
      updated: 99,
      refCount: 1,
      docCount: 1,
      isReEditable: true,
      originalStoragePath: ORIGINAL_PATH,
      isOriginal: false,
    })
  })

  it('deletedOld 为 false 时旧条目转为未引用，新条目插入到旧条目之前', () => {
    const oldItem = makeAsset({
      name: 'old.png',
      references: [makeBlockRef('b1', 'root1')],
      refCount: 1,
      docCount: 1,
    })
    const refs = [makeBlockRef('b2', 'root2')]

    const { list } = applyTargetedAssetUpdate([oldItem], new Set(), {
      action: 'edit',
      oldName: 'old.png',
      newName: 'new.png',
      references: refs,
      deletedOld: false,
    })

    expect(list).toHaveLength(2)
    expect(list[0].name).toBe('new.png')
    expect(list[0].refCount).toBe(1)
    expect(list[1]).toMatchObject({
      name: 'old.png',
      references: [],
      refCount: 0,
      docCount: 0,
    })
  })

  it('旧资产不在列表中时头部插入', () => {
    const refs = [makeBlockRef('b1', 'root1')]

    const { list } = applyTargetedAssetUpdate([], new Set(), {
      action: 'edit',
      oldName: 'ghost.png',
      newName: 'new.png',
      references: refs,
      size: 10,
    })

    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ name: 'new.png', size: 10, refCount: 1, docCount: 1 })
  })

  it('持有 originalStoragePath 时同步关联原始底图的引用数据', () => {
    const original = makeAsset({ name: 'orig.png', isOriginal: true, originalStoragePath: ORIGINAL_PATH })
    const refs = [makeBlockRef('b1', 'root1')]

    const { list } = applyTargetedAssetUpdate([original], new Set(), {
      action: 'edit',
      oldName: 'old.png',
      newName: 'new.png',
      references: refs,
      originalStoragePath: ORIGINAL_PATH,
    })

    expect(list).toHaveLength(2)
    const synced = list.find((a) => a.isOriginal)
    expect(synced?.refCount).toBe(1)
    expect(synced?.docCount).toBe(1)
    expect(synced?.references).toEqual([...refs])
  })
})

/** 场景 3：selectedNames 迁移矩阵（表驱动） */
describe('applyTargetedAssetUpdate · selectedNames 迁移', () => {
  const matrix = [
    { action: 'rename', deletedOld: undefined, wasSelected: true, shouldMigrate: true },
    { action: 'rename', deletedOld: undefined, wasSelected: false, shouldMigrate: false },
    { action: 'edit', deletedOld: true, wasSelected: true, shouldMigrate: true },
    { action: 'edit', deletedOld: false, wasSelected: true, shouldMigrate: false },
    { action: 'edit', deletedOld: true, wasSelected: false, shouldMigrate: false },
  ] as const

  for (const row of matrix) {
    it(`${row.action} deletedOld=${row.deletedOld} 旧名${row.wasSelected ? '已' : '未'}选中 → ${row.shouldMigrate ? '迁移到新名' : '保持不变'}`, () => {
      const oldItem = makeAsset({ name: 'old.png' })
      const selected = new Set(row.wasSelected ? ['old.png', 'keep.png'] : ['keep.png'])
      const detail: AssetTargetedUpdateDetail = {
        action: row.action,
        oldName: 'old.png',
        newName: 'new.png',
      }
      if (row.deletedOld !== undefined) {
        detail.deletedOld = row.deletedOld
      }

      const { list, selectedNames } = applyTargetedAssetUpdate([oldItem], selected, detail)

      if (row.shouldMigrate) {
        expect(selectedNames.has('new.png')).toBe(true)
        expect(selectedNames.has('old.png')).toBe(false)
      } else {
        expect(selectedNames).toBe(selected)
      }
      expect(selectedNames.has('keep.png')).toBe(true)
      void list
    })
  }
})

/** 场景 4：缩略图失效回调 */
describe('applyTargetedAssetUpdate · 副作用注入', () => {
  it('onInvalidateThumbnail 依次收到 oldName 与 newName，deps 缺省时不抛错', () => {
    const oldItem = makeAsset({ name: 'old.png' })
    const onInvalidate = vi.fn()

    applyTargetedAssetUpdate([oldItem], new Set(), {
      action: 'rename',
      oldName: 'old.png',
      newName: 'new.png',
    }, { onInvalidateThumbnail: onInvalidate })

    expect(onInvalidate.mock.calls.map((c) => c[0])).toEqual(['old.png', 'new.png'])

    expect(() => applyTargetedAssetUpdate([oldItem], new Set(), {
      action: 'edit',
      oldName: 'old.png',
      newName: 'new.png',
    })).not.toThrow()
  })
})

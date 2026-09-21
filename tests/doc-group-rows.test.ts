import { describe, expect, it } from 'vitest'
import {
  buildDocRows,
  DOC_ROW_HEIGHTS,
  type DocAssetRow,
  type DocHeaderRow,
} from '../src/utils/doc-group-rows'
import type { DocAssetGroup } from '../src/utils/asset-list'
import type { AssetInfo } from '../src/utils/siyuan-db'

function createAsset(name: string, options: { size?: number } = {}): AssetInfo {
  return {
    name,
    size: options.size ?? 1024,
    updated: 1700000000000,
    isDir: false,
    references: [],
    refCount: 0,
    docCount: 1,
    isReEditable: false,
    isOriginal: false,
  }
}

function createGroup(options: {
  id: string
  assetNames: string[]
  isUnreferenced?: boolean
}): DocAssetGroup {
  const assets = options.assetNames.map((name) => createAsset(name))
  return {
    id: options.id,
    title: `文档 ${options.id}`,
    readablePath: `笔记本/文档 ${options.id}`,
    assets,
    totalSize: assets.reduce((sum, a) => sum + a.size, 0),
    assetCount: assets.length,
    isUnreferenced: options.isUnreferenced ?? false,
    firstBlockId: `blk-${options.id}`,
  }
}

const GROUP_A = createGroup({ id: 'doc-a', assetNames: ['a1.png', 'a2.png'] })
const GROUP_B = createGroup({ id: 'unreferenced', assetNames: ['orphan.png'], isUnreferenced: true })

describe('buildDocRows', () => {
  it('returns no rows for an empty group list', () => {
    expect(buildDocRows([])).toEqual([])
  })

  it('emits only a header and a trailing gap for a collapsed group', () => {
    const rows = buildDocRows([GROUP_A], { collapsedDocIds: new Set(['doc-a']) })

    expect(rows.map((row) => row.kind)).toEqual(['header', 'gap'])
  })

  it('emits header, column header, every asset, then a gap for an expanded group', () => {
    const rows = buildDocRows([GROUP_A])

    expect(rows.map((row) => row.kind)).toEqual([
      'header',
      'subheader',
      'asset',
      'asset',
      'gap',
    ])

    const assetRows = rows.filter((row): row is DocAssetRow => row.kind === 'asset')
    expect(assetRows.map((row) => row.asset.name)).toEqual(['a1.png', 'a2.png'])
  })

  it('emits a gap after every group so cards keep their spacing', () => {
    const rows = buildDocRows([GROUP_A, GROUP_B])

    expect(rows.filter((row) => row.kind === 'gap')).toHaveLength(2)
  })

  it('force-expands every group while a search query is active', () => {
    const collapsedDocIds = new Set(['doc-a', 'unreferenced'])
    const rows = buildDocRows([GROUP_A, GROUP_B], { collapsedDocIds, searchQuery: 'a1' })

    expect(rows.filter((row) => row.kind === 'asset')).toHaveLength(3)
    expect(rows.every((row) => row.kind !== 'header' || row.collapsed === false)).toBe(true)
  })

  it('treats a whitespace-only search query as no search', () => {
    const rows = buildDocRows([GROUP_A], {
      collapsedDocIds: new Set(['doc-a']),
      searchQuery: '   ',
    })

    expect(rows.map((row) => row.kind)).toEqual(['header', 'gap'])
  })

  it('carries the group and its collapsed state on the header row', () => {
    const rows = buildDocRows([GROUP_A, GROUP_B], { collapsedDocIds: new Set(['doc-a']) })
    const headers = rows.filter((row): row is DocHeaderRow => row.kind === 'header')

    expect(headers).toHaveLength(2)
    expect(headers[0].group).toBe(GROUP_A)
    expect(headers[0].collapsed).toBe(true)
    expect(headers[1].group).toBe(GROUP_B)
    expect(headers[1].collapsed).toBe(false)
  })

  it('marks each row with a key that stays unique when one asset belongs to two documents', () => {
    const shared = createAsset('shared.png')
    const groupOne = createGroup({ id: 'doc-1', assetNames: [] })
    const groupTwo = createGroup({ id: 'doc-2', assetNames: [] })
    groupOne.assets = [shared]
    groupOne.assetCount = 1
    groupTwo.assets = [shared]
    groupTwo.assetCount = 1

    const rows = buildDocRows([groupOne, groupTwo])
    const keys = rows.map((row) => row.key)

    expect(new Set(keys).size).toBe(keys.length)
  })

  it('exposes the within-group index and last-row flag needed for shift selection and card borders', () => {
    const rows = buildDocRows([GROUP_A])
    const assetRows = rows.filter((row): row is DocAssetRow => row.kind === 'asset')

    expect(assetRows.map((row) => row.indexInGroup)).toEqual([0, 1])
    expect(assetRows.map((row) => row.isLastInGroup)).toEqual([false, true])
  })

  it('gives every row the height declared for its kind', () => {
    const rows = buildDocRows([GROUP_A, GROUP_B], { collapsedDocIds: new Set(['unreferenced']) })

    for (const row of rows) {
      expect(row.height).toBe(DOC_ROW_HEIGHTS[row.kind])
    }
  })

  it('skips the column header when a group has no assets to list', () => {
    const emptyGroup = createGroup({ id: 'doc-empty', assetNames: [] })
    const rows = buildDocRows([emptyGroup])

    expect(rows.map((row) => row.kind)).toEqual(['header', 'gap'])
  })

  it('carries the owning group on body rows so the view never has to look it up again', () => {
    const rows = buildDocRows([GROUP_A, GROUP_B])

    // 资源行必须自带 group：Shift 连续多选要用 group.assets 与 indexInGroup，
    // 若改由组件按 id 回查当前 props，扁平化时算出的下标可能和回查到的数组不同代。
    const assetRows = rows.filter((row): row is DocAssetRow => row.kind === 'asset')
    expect(assetRows.map((row) => row.group)).toEqual([
      GROUP_A,
      GROUP_A,
      GROUP_B,
    ])
    expect(assetRows.map((row) => row.group.assets[row.indexInGroup].name)).toEqual(
      assetRows.map((row) => row.asset.name)
    )

    const subheaderGroups = rows
      .filter((row) => row.kind === 'subheader')
      .map((row) => (row as { group: DocAssetGroup }).group)
    expect(subheaderGroups).toEqual([GROUP_A, GROUP_B])
  })

  it('gives every row the group it belongs to, whatever its kind or collapse state', () => {
    const collapsed = buildDocRows([GROUP_A, GROUP_B], { collapsedDocIds: new Set(['doc-a']) })
    const expanded = buildDocRows([GROUP_A, GROUP_B])

    for (const rows of [collapsed, expanded]) {
      for (const row of rows) {
        expect(row.group).toBe(row.groupId === 'doc-a' ? GROUP_A : GROUP_B)
      }
    }
  })
})

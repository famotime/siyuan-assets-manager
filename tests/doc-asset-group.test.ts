import { describe, expect, it } from 'vitest'
import {
  extractDocTitle,
  groupAssetsByDocument,
  type DocAssetGroup,
} from '../src/utils/asset-list'
import type { AssetInfo, BlockRef } from '../src/utils/siyuan-db'

function createRef(options: {
  id: string
  root_id: string
  box?: string
  boxName?: string
  hpath?: string
  readablePath?: string
}): BlockRef {
  return {
    id: options.id,
    root_id: options.root_id,
    box: options.box || 'box-1',
    boxName: options.boxName || '默认笔记本',
    content: 'block content',
    markdown: '![img](assets/test.png)',
    path: `/${options.root_id}.sy`,
    hpath: options.hpath || `/目录/${options.root_id}`,
    readablePath: options.readablePath || `默认笔记本/目录/${options.root_id}`,
  }
}

function createAsset(options: {
  name: string
  size: number
  updated?: number
  references?: BlockRef[]
  isReEditable?: boolean
  isOriginal?: boolean
}): AssetInfo {
  const refs = options.references || []
  const docIds = new Set(refs.map((r) => r.root_id))
  return {
    name: options.name,
    size: options.size,
    updated: options.updated || 1700000000000,
    isDir: false,
    references: refs,
    refCount: refs.length,
    docCount: docIds.size,
    isReEditable: options.isReEditable || false,
    isOriginal: options.isOriginal || false,
  }
}

describe('groupAssetsByDocument', () => {
  const doc1RefA = createRef({
    id: 'b1',
    root_id: 'doc-vue',
    boxName: '技术笔记',
    hpath: '/前端/Vue3指南',
    readablePath: '技术笔记/前端/Vue3指南',
  })
  const doc1RefB = createRef({
    id: 'b2',
    root_id: 'doc-vue',
    boxName: '技术笔记',
    hpath: '/前端/Vue3指南',
    readablePath: '技术笔记/前端/Vue3指南',
  })
  const doc2Ref = createRef({
    id: 'b3',
    root_id: 'doc-react',
    boxName: '技术笔记',
    hpath: '/前端/React实战',
    readablePath: '技术笔记/前端/React实战',
  })

  it('correctly extracts human-readable document title from BlockRef', () => {
    expect(extractDocTitle(doc1RefA)).toBe('Vue3指南')
    expect(extractDocTitle(doc2Ref)).toBe('React实战')
    expect(extractDocTitle(createRef({ id: 'b4', root_id: 'doc-empty', hpath: '', readablePath: '' }))).toBe('doc-empty')
  })

  it('groups assets by document and handles single and multi-referenced assets', () => {
    const asset1 = createAsset({
      name: 'vue-logo.png',
      size: 1000,
      references: [doc1RefA, doc1RefB], // 同一篇文档内的多处引用
    })
    const asset2 = createAsset({
      name: 'shared-architecture.png',
      size: 5000,
      references: [doc1RefA, doc2Ref], // 跨文档共享引用 (Vue & React)
    })
    const asset3 = createAsset({
      name: 'react-flow.png',
      size: 2000,
      references: [doc2Ref],
    })
    const orphanAsset = createAsset({
      name: 'orphan.jpg',
      size: 800,
      references: [],
    })

    const groups = groupAssetsByDocument([asset1, asset2, asset3, orphanAsset])

    // 应有两个常规文档分组 + 一个未引用分组
    expect(groups.length).toBe(3)

    const vueGroup = groups.find((g) => g.id === 'doc-vue')!
    expect(vueGroup).toBeDefined()
    expect(vueGroup.title).toBe('Vue3指南')
    expect(vueGroup.readablePath).toBe('技术笔记/前端/Vue3指南')
    // vue-logo 虽有两个引用块，但同属 doc-vue，应去重为 1 项；加上 shared-architecture，共 2 项
    expect(vueGroup.assetCount).toBe(2)
    expect(vueGroup.totalSize).toBe(6000)
    expect(vueGroup.assets.map((a) => a.name)).toContain('vue-logo.png')
    expect(vueGroup.assets.map((a) => a.name)).toContain('shared-architecture.png')

    const reactGroup = groups.find((g) => g.id === 'doc-react')!
    expect(reactGroup).toBeDefined()
    expect(reactGroup.title).toBe('React实战')
    expect(reactGroup.assetCount).toBe(2)
    expect(reactGroup.totalSize).toBe(7000)
    expect(reactGroup.assets.map((a) => a.name)).toContain('react-flow.png')
    expect(reactGroup.assets.map((a) => a.name)).toContain('shared-architecture.png')

    const unrefGroup = groups.find((g) => g.isUnreferenced)!
    expect(unrefGroup).toBeDefined()
    expect(unrefGroup.id).toBe('unreferenced')
    expect(unrefGroup.title).toBe('未被任何文档引用')
    expect(unrefGroup.assetCount).toBe(1)
    expect(unrefGroup.totalSize).toBe(800)
    expect(unrefGroup.assets[0].name).toBe('orphan.jpg')
  })

  it('supports dual search: matches document title/path and expands all its assets', () => {
    const asset1 = createAsset({
      name: 'vue-logo.png',
      size: 1000,
      references: [doc1RefA],
    })
    const asset2 = createAsset({
      name: 'banner.jpg', // 名字不含 vue
      size: 3000,
      references: [doc1RefA],
    })
    const asset3 = createAsset({
      name: 'react-flow.png',
      size: 2000,
      references: [doc2Ref],
    })

    // 搜索 "Vue"：应命中 doc-vue 文档名，展示该文档下的所有资源 (包含 banner.jpg)
    const groups = groupAssetsByDocument([asset1, asset2, asset3], { searchQuery: 'Vue' })
    expect(groups.length).toBe(1)
    expect(groups[0].id).toBe('doc-vue')
    expect(groups[0].matchedByDocName).toBe(true)
    expect(groups[0].assets.length).toBe(2)
    expect(groups[0].assets.map((a) => a.name)).toEqual(['banner.jpg', 'vue-logo.png'])
  })

  it('supports dual search: matches only specific asset names when document title does not match', () => {
    const asset1 = createAsset({
      name: 'common-icon.png',
      size: 1000,
      references: [doc1RefA],
    })
    const asset2 = createAsset({
      name: 'other-image.png',
      size: 3000,
      references: [doc1RefA],
    })

    // 搜索 "icon"：文档名不匹配，仅保留 common-icon.png
    const groups = groupAssetsByDocument([asset1, asset2], { searchQuery: 'icon' })
    expect(groups.length).toBe(1)
    expect(groups[0].id).toBe('doc-vue')
    expect(groups[0].matchedByDocName).toBe(false)
    expect(groups[0].assets.length).toBe(1)
    expect(groups[0].assets[0].name).toBe('common-icon.png')
  })

  it('supports sorting document cards by totalSize, assetCount, and name', () => {
    const assetSmall = createAsset({
      name: 'small.png',
      size: 100,
      references: [doc1RefA],
    })
    const assetLarge1 = createAsset({
      name: 'large1.png',
      size: 5000,
      references: [doc2Ref],
    })
    const assetLarge2 = createAsset({
      name: 'large2.png',
      size: 5000,
      references: [doc2Ref],
    })

    // doc-vue: 1 项, 100B, 标题 'Vue3指南'
    // doc-react: 2 项, 10000B, 标题 'React实战'
    const bySizeDesc = groupAssetsByDocument([assetSmall, assetLarge1, assetLarge2], {
      docSortField: 'totalSize',
      docSortOrder: 'desc',
    })
    expect(bySizeDesc[0].id).toBe('doc-react')
    expect(bySizeDesc[1].id).toBe('doc-vue')

    const bySizeAsc = groupAssetsByDocument([assetSmall, assetLarge1, assetLarge2], {
      docSortField: 'totalSize',
      docSortOrder: 'asc',
    })
    expect(bySizeAsc[0].id).toBe('doc-vue')
    expect(bySizeAsc[1].id).toBe('doc-react')

    const byCountDesc = groupAssetsByDocument([assetSmall, assetLarge1, assetLarge2], {
      docSortField: 'assetCount',
      docSortOrder: 'desc',
    })
    expect(byCountDesc[0].id).toBe('doc-react')

    const byNameAsc = groupAssetsByDocument([assetSmall, assetLarge1, assetLarge2], {
      docSortField: 'name',
      docSortOrder: 'asc',
    })
    // 'React实战' vs 'Vue3指南'
    expect(byNameAsc[0].title).toBe('React实战')
    expect(byNameAsc[1].title).toBe('Vue3指南')
  })

  it('correctly handles search on unreferenced special group', () => {
    const orphan1 = createAsset({ name: 'unref-header.png', size: 500 })
    const orphan2 = createAsset({ name: 'random-clip.mp4', size: 1500 })

    // 搜索 "未引用"：应匹配未引用专属分组并展开其名下所有资源
    const groupsByDoc = groupAssetsByDocument([orphan1, orphan2], { searchQuery: '未引用' })
    expect(groupsByDoc.length).toBe(1)
    expect(groupsByDoc[0].isUnreferenced).toBe(true)
    expect(groupsByDoc[0].assets.length).toBe(2)

    // 搜索 "clip"：仅保留 random-clip.mp4
    const groupsByFile = groupAssetsByDocument([orphan1, orphan2], { searchQuery: 'clip' })
    expect(groupsByFile.length).toBe(1)
    expect(groupsByFile[0].assets.length).toBe(1)
    expect(groupsByFile[0].assets[0].name).toBe('random-clip.mp4')
  })
})

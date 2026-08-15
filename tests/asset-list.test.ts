import { describe, expect, it } from 'vitest'
import {
  calculateUnreferencedCleanup,
  calculateOrphanCleanup,
  calculateTotalCleanup,
  filterAssets,
  formatAssetSize,
  getAssetBadgeText,
  getAssetExtension,
  sortAssets,
  splitFileName,
} from '../src/utils/asset-list'
import type { AssetInfo } from '../src/utils/siyuan-db'

function asset(name: string, size: number, docCount: number, isReEditable: boolean = false, isOriginal: boolean = false): AssetInfo {
  return {
    name,
    size,
    updated: 0,
    isDir: false,
    references: [],
    refCount: docCount,
    docCount,
    isReEditable,
    isOriginal,
  }
}

describe('asset list helpers', () => {
  const assets = [
    asset('Beta.PNG', 1024 * 1024 * 2, 2, true, false),
    asset('alpha.txt', 20, 0, false, false),
    asset('noext', 0, 1, false, false),
    asset('orig_123.png', 1024 * 500, 1, false, true),
    asset('orphan_orig.png', 1024 * 300, 0, false, true),
  ]

  it('filters assets by search text, type, reeditable flag, and original flag', () => {
    // image 仅包含普通图片，不含底图
    expect(filterAssets(assets, { searchQuery: 'beta', filterType: 'image' })).toEqual([assets[0]])
    expect(filterAssets(assets, { searchQuery: '', filterType: 'image' })).toEqual([assets[0]])
    
    // original 仅包含底图
    expect(filterAssets(assets, { searchQuery: '', filterType: 'original' })).toEqual([assets[3], assets[4]])
    
    // unreferenced 包含普通孤儿与孤立底图
    expect(filterAssets(assets, { searchQuery: '', filterType: 'unreferenced' })).toEqual([assets[1], assets[4]])
    
    // large 包含大于 1MB 的资源
    expect(filterAssets(assets, { searchQuery: '', filterType: 'large' })).toEqual([assets[0]])
    
    // reeditable 仅包含可二次编辑资源
    expect(filterAssets(assets, { searchQuery: '', filterType: 'reeditable' })).toEqual([assets[0]])
  })

  it('sorts assets by extension, size, and document count', () => {
    expect(sortAssets(assets, 'ext', 'asc').map((item) => item.name)).toEqual([
      'noext',
      'Beta.PNG',
      'orig_123.png',
      'orphan_orig.png',
      'alpha.txt',
    ])
    expect(sortAssets(assets, 'size', 'desc').map((item) => item.name)).toEqual([
      'Beta.PNG',
      'orig_123.png',
      'orphan_orig.png',
      'alpha.txt',
      'noext',
    ])
    expect(sortAssets(assets, 'docCount', 'asc').map((item) => item.name)).toEqual([
      'alpha.txt',
      'orphan_orig.png',
      'noext',
      'orig_123.png',
      'Beta.PNG',
    ])
  })

  it('formats file names and sizes consistently', () => {
    expect(splitFileName('archive.tar.gz')).toEqual({ name: 'archive.tar', ext: 'gz' })
    expect(splitFileName('.gitignore')).toEqual({ name: '.gitignore', ext: '' })
    expect(getAssetExtension('Beta.PNG')).toBe('png')
    expect(formatAssetSize(0)).toBe('0 B')
    expect(formatAssetSize(1536)).toBe('1.5 KB')
  })

  it('extracts asset badge texts for file preview icons without truncation bugs', () => {
    expect(getAssetBadgeText('sample.pdf')).toBe('PDF')
    expect(getAssetBadgeText('archive.tar.gz')).toBe('GZ')
    expect(getAssetBadgeText('noext')).toBe('FILE')
    expect(getAssetBadgeText('.gitignore')).toBe('FILE')
    expect(getAssetBadgeText('document.docx')).toBe('DOCX')
  })

  it('calculates unreferenced cleanup count and total size', () => {
    expect(calculateUnreferencedCleanup(assets)).toEqual({
      assets: [assets[1]],
      count: 1,
      totalSize: 20,
      sizeText: '20 B',
    })
  })

  it('calculates orphan cleanup statistics correctly', () => {
    const orphans = [
      { name: '1.png', path: 'storage/.../1.png', size: 1024, updated: 0 },
      { name: '2.png', path: 'storage/.../2.png', size: 2048, updated: 0 },
    ]
    const summary = calculateOrphanCleanup(orphans)
    expect(summary.count).toBe(2)
    expect(summary.totalSize).toBe(3072)
    expect(summary.sizeText).toBe('3 KB')
  })

  it('calculates unified total cleanup for both unreferenced assets and orphan originals', () => {
    const summary = calculateTotalCleanup(assets)
    expect(summary.totalCount).toBe(2) // alpha.txt (20B) + orphan_orig.png (300KB)
    expect(summary.unreferencedCount).toBe(1)
    expect(summary.orphanOriginalsCount).toBe(1)
    expect(summary.unreferencedAssets).toEqual([assets[1]])
    expect(summary.orphanOriginals).toEqual([assets[4]])
    expect(summary.totalSize).toBe(20 + 1024 * 300)
  })
})

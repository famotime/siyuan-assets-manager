import { describe, expect, it } from 'vitest'
import {
  calculateBatchDeleteSummary,
  calculateUnreferencedCleanup,
  calculateOrphanCleanup,
  calculateTotalCleanup,
  filterAssets,
  formatAssetSize,
  formatAssetTime,
  getAssetBadgeText,
  getAssetExtension,
  sortAssets,
  splitFileName,
} from '../src/utils/asset-list'
import type { AssetInfo } from '../src/utils/siyuan-db'

function asset(
  name: string,
  size: number,
  docCount: number,
  isReEditable: boolean = false,
  isOriginal: boolean = false,
  updated: number = 0
): AssetInfo {
  return {
    name,
    size,
    updated,
    isDir: false,
    references: docCount > 0 ? [{ id: 'blk1', root_id: 'doc1', box: 'box1', content: '', markdown: '', path: '' }] : [],
    refCount: docCount,
    docCount,
    isReEditable,
    isOriginal,
  }
}

describe('asset list helpers', () => {
  const assets = [
    asset('Beta.PNG', 1024 * 1024 * 2, 2, true, false, 1700000000000),
    asset('alpha.txt', 20, 0, false, false, 1600000000000),
    asset('noext', 0, 1, false, false, 1650000000000),
    asset('orig_123.png', 1024 * 500, 1, false, true, 1710000000000),
    asset('orphan_orig.png', 1024 * 300, 0, false, true, 1500000000000),
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

  it('sorts assets by extension, size, document count, and updated time', () => {
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
    expect(sortAssets(assets, 'updated', 'asc').map((item) => item.name)).toEqual([
      'orphan_orig.png',
      'alpha.txt',
      'noext',
      'Beta.PNG',
      'orig_123.png',
    ])
    expect(sortAssets(assets, 'updated', 'desc').map((item) => item.name)).toEqual([
      'orig_123.png',
      'Beta.PNG',
      'noext',
      'alpha.txt',
      'orphan_orig.png',
    ])
  })

  it('formats file names, sizes, and update times consistently', () => {
    expect(splitFileName('archive.tar.gz')).toEqual({ name: 'archive.tar', ext: 'gz' })
    expect(splitFileName('.gitignore')).toEqual({ name: '.gitignore', ext: '' })
    expect(getAssetExtension('Beta.PNG')).toBe('png')
    expect(formatAssetSize(0)).toBe('0 B')
    expect(formatAssetSize(1536)).toBe('1.5 KB')

    // formatAssetTime 测试
    expect(formatAssetTime(0)).toBe('-')
    expect(formatAssetTime(-1)).toBe('-')
    expect(formatAssetTime(NaN)).toBe('-')
    // 毫秒时间戳测试
    const timeFormatted = formatAssetTime(1700000000000)
    expect(timeFormatted).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    // 秒级时间戳自动转换测试 (1700000000 秒 -> 毫秒转换结果相同)
    expect(formatAssetTime(1700000000)).toBe(timeFormatted)
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

  it('calculates batch delete summary correctly', () => {
    const selected = new Set(['Beta.PNG', 'alpha.txt', 'orig_123.png'])
    const summary = calculateBatchDeleteSummary(assets, selected)
    expect(summary.totalCount).toBe(3)
    expect(summary.regularCount).toBe(2)
    expect(summary.originalCount).toBe(1)
    expect(summary.referencedCount).toBe(1) // Beta.PNG (docCount = 2)
    expect(summary.referencedOriginalsCount).toBe(1) // orig_123.png (docCount = 1)
    expect(summary.totalSize).toBe(1024 * 1024 * 2 + 20 + 1024 * 500)
  })
})

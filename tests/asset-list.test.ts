import { describe, expect, it } from 'vitest'
import {
  calculateUnreferencedCleanup,
  filterAssets,
  formatAssetSize,
  getAssetExtension,
  sortAssets,
  splitFileName,
} from '../src/utils/asset-list'
import type { AssetInfo } from '../src/utils/siyuan-db'

function asset(name: string, size: number, docCount: number): AssetInfo {
  return {
    name,
    size,
    updated: 0,
    isDir: false,
    references: [],
    refCount: docCount,
    docCount,
  }
}

describe('asset list helpers', () => {
  const assets = [
    asset('Beta.PNG', 1024 * 1024 * 2, 2),
    asset('alpha.txt', 20, 0),
    asset('noext', 0, 1),
  ]

  it('filters assets by search text and type', () => {
    expect(filterAssets(assets, { searchQuery: 'beta', filterType: 'image' })).toEqual([assets[0]])
    expect(filterAssets(assets, { searchQuery: '', filterType: 'unreferenced' })).toEqual([assets[1]])
    expect(filterAssets(assets, { searchQuery: '', filterType: 'large' })).toEqual([assets[0]])
  })

  it('sorts assets by extension, size, and document count', () => {
    expect(sortAssets(assets, 'ext', 'asc').map((item) => item.name)).toEqual([
      'noext',
      'Beta.PNG',
      'alpha.txt',
    ])
    expect(sortAssets(assets, 'size', 'desc').map((item) => item.name)).toEqual([
      'Beta.PNG',
      'alpha.txt',
      'noext',
    ])
    expect(sortAssets(assets, 'docCount', 'asc').map((item) => item.name)).toEqual([
      'alpha.txt',
      'noext',
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

  it('calculates unreferenced cleanup count and total size', () => {
    expect(calculateUnreferencedCleanup(assets)).toEqual({
      assets: [assets[1]],
      count: 1,
      totalSize: 20,
      sizeText: '20 B',
    })
  })
})

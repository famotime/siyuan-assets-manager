import type { AssetInfo, OrphanOriginalInfo } from './siyuan-db'

export type AssetFilterType = 'all' | 'image' | 'reeditable' | 'unreferenced' | 'large'
export type AssetSortField = 'name' | 'ext' | 'size' | 'docCount'
export type AssetSortOrder = 'asc' | 'desc'

export interface AssetFilterOptions {
  searchQuery: string
  filterType: AssetFilterType
}

export interface AssetCleanupSummary {
  assets: AssetInfo[]
  count: number
  totalSize: number
  sizeText: string
}

export function isImageAsset(name: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(name)
}

export function splitFileName(fullName: string): { name: string, ext: string } {
  const index = fullName.lastIndexOf('.')
  if (index <= 0) {
    return {
      name: fullName,
      ext: '',
    }
  }

  return {
    name: fullName.slice(0, index),
    ext: fullName.slice(index + 1),
  }
}

export function getAssetExtension(name: string): string {
  return splitFileName(name).ext.toLowerCase()
}

export function formatAssetSize(bytes: number): string {
  if (bytes === 0) return '0 B'

  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`
}

export function filterAssets(assets: AssetInfo[], options: AssetFilterOptions): AssetInfo[] {
  const searchQuery = options.searchQuery.toLowerCase()

  return assets.filter((asset) => {
    if (searchQuery && !asset.name.toLowerCase().includes(searchQuery)) {
      return false
    }
    if (options.filterType === 'image' && !isImageAsset(asset.name)) {
      return false
    }
    if (options.filterType === 'reeditable' && !asset.isReEditable) {
      return false
    }
    if (options.filterType === 'unreferenced' && asset.docCount > 0) {
      return false
    }
    if (options.filterType === 'large' && asset.size < 1024 * 1024) {
      return false
    }

    return true
  })
}

export function sortAssets(assets: AssetInfo[], sortField: AssetSortField, sortOrder: AssetSortOrder): AssetInfo[] {
  return [...assets].sort((a, b) => {
    const valA = getSortValue(a, sortField)
    const valB = getSortValue(b, sortField)

    if (typeof valA === 'string' && typeof valB === 'string') {
      const cmp = valA.localeCompare(valB)
      return sortOrder === 'asc' ? cmp : -cmp
    }

    return sortOrder === 'asc'
      ? Number(valA) - Number(valB)
      : Number(valB) - Number(valA)
  })
}

export function calculateUnreferencedCleanup(assets: AssetInfo[]): AssetCleanupSummary {
  const unreferencedAssets = assets.filter((asset) => asset.docCount === 0)
  const totalSize = unreferencedAssets.reduce((sum, asset) => sum + asset.size, 0)

  return {
    assets: unreferencedAssets,
    count: unreferencedAssets.length,
    totalSize,
    sizeText: formatAssetSize(totalSize),
  }
}

export function calculateOrphanCleanup(orphans: OrphanOriginalInfo[]): { count: number; totalSize: number; sizeText: string } {
  const totalSize = orphans.reduce((sum, item) => sum + item.size, 0)
  return {
    count: orphans.length,
    totalSize,
    sizeText: formatAssetSize(totalSize),
  }
}

function getSortValue(asset: AssetInfo, sortField: AssetSortField): string | number {
  if (sortField === 'ext') {
    return getAssetExtension(asset.name)
  }

  return asset[sortField]
}

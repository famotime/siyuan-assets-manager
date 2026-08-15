import type { AssetInfo, OrphanOriginalInfo } from './siyuan-db'

export type AssetFilterType = 'all' | 'image' | 'original' | 'reeditable' | 'unreferenced' | 'large'
export type AssetSortField = 'name' | 'ext' | 'size' | 'docCount' | 'updated'
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

export interface TotalCleanupSummary {
  unreferencedAssets: AssetInfo[]
  orphanOriginals: AssetInfo[]
  totalCount: number
  totalSize: number
  sizeText: string
  unreferencedCount: number
  unreferencedSizeText: string
  orphanOriginalsCount: number
  orphanOriginalsSizeText: string
}

export interface BatchDeleteSummary {
  selectedAssets: AssetInfo[]
  totalCount: number
  regularAssets: AssetInfo[]
  originalAssets: AssetInfo[]
  regularCount: number
  originalCount: number
  totalSize: number
  sizeText: string
  referencedCount: number
  referencedOriginalsCount: number
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

/**
 * 获取非图片文件的图标类型徽章文本（大写，最长 4 个字符，若无后缀则为 FILE）
 */
export function getAssetBadgeText(name: string): string {
  const { ext } = splitFileName(name)
  if (!ext) return 'FILE'
  return ext.toUpperCase().slice(0, 4)
}

export function formatAssetSize(bytes: number): string {
  if (bytes === 0) return '0 B'

  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`
}

/**
 * 格式化资源更新时间 (支持秒级或毫秒级时间戳)
 */
export function formatAssetTime(timestamp: number): string {
  if (!timestamp || timestamp <= 0) return '-'
  
  const ms = timestamp < 1e11 ? timestamp * 1000 : timestamp
  const date = new Date(ms)
  if (isNaN(date.getTime())) return '-'

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

export function filterAssets(assets: AssetInfo[], options: AssetFilterOptions): AssetInfo[] {
  const searchQuery = options.searchQuery.toLowerCase()

  return assets.filter((asset) => {
    if (searchQuery && !asset.name.toLowerCase().includes(searchQuery)) {
      return false
    }
    if (options.filterType === 'image' && (!isImageAsset(asset.name) || asset.isOriginal)) {
      return false
    }
    if (options.filterType === 'original' && !asset.isOriginal) {
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
  const unreferencedAssets = assets.filter((asset) => !asset.isOriginal && asset.docCount === 0)
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

export function calculateTotalCleanup(assets: AssetInfo[]): TotalCleanupSummary {
  const unreferencedAssets = assets.filter((asset) => !asset.isOriginal && asset.docCount === 0)
  const orphanOriginals = assets.filter((asset) => asset.isOriginal && asset.docCount === 0)

  const unreferencedSize = unreferencedAssets.reduce((sum, asset) => sum + asset.size, 0)
  const orphanOriginalsSize = orphanOriginals.reduce((sum, asset) => sum + asset.size, 0)
  const totalSize = unreferencedSize + orphanOriginalsSize
  const totalCount = unreferencedAssets.length + orphanOriginals.length

  return {
    unreferencedAssets,
    orphanOriginals,
    totalCount,
    totalSize,
    sizeText: formatAssetSize(totalSize),
    unreferencedCount: unreferencedAssets.length,
    unreferencedSizeText: formatAssetSize(unreferencedSize),
    orphanOriginalsCount: orphanOriginals.length,
    orphanOriginalsSizeText: formatAssetSize(orphanOriginalsSize),
  }
}

/**
 * 汇总选中的待批量删除资源信息
 */
export function calculateBatchDeleteSummary(assets: AssetInfo[], selectedNames: Set<string>): BatchDeleteSummary {
  const selectedAssets = assets.filter((asset) => selectedNames.has(asset.name))
  const regularAssets = selectedAssets.filter((asset) => !asset.isOriginal)
  const originalAssets = selectedAssets.filter((asset) => asset.isOriginal)

  const totalSize = selectedAssets.reduce((sum, asset) => sum + asset.size, 0)
  const referencedCount = regularAssets.filter((asset) => asset.docCount > 0).length
  const referencedOriginalsCount = originalAssets.filter((asset) => asset.docCount > 0).length

  return {
    selectedAssets,
    totalCount: selectedAssets.length,
    regularAssets,
    originalAssets,
    regularCount: regularAssets.length,
    originalCount: originalAssets.length,
    totalSize,
    sizeText: formatAssetSize(totalSize),
    referencedCount,
    referencedOriginalsCount,
  }
}

function getSortValue(asset: AssetInfo, sortField: AssetSortField): string | number {
  if (sortField === 'ext') {
    return getAssetExtension(asset.name)
  }
  if (sortField === 'updated') {
    return asset.updated || 0
  }

  return asset[sortField]
}

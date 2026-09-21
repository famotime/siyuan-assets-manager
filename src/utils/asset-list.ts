import type { AssetInfo, BlockRef, OrphanOriginalInfo } from './siyuan-db'

export type AssetAttributeFilter = 'all' | 'reeditable' | 'original' | 'unreferenced' | 'large'
export type AssetFilterType = AssetAttributeFilter | 'image'
export type AssetCategory = 'all' | 'image' | 'document' | 'audio' | 'video' | 'archive'

export type AssetSortField = 'name' | 'ext' | 'size' | 'docCount' | 'updated'
export type AssetSortOrder = 'asc' | 'desc'

export interface AssetFilterOptions {
  searchQuery: string
  filterType?: AssetFilterType
  category?: AssetCategory
}

export interface CategoryStatSummary {
  count: number
  totalSize: number
  sizeText: string
}

export interface DocReferenceGroup {
  rootId: string
  /** 该文档中第一个引用块，用于展示易读路径与定位 */
  first: BlockRef
  /** 该文档内的全部引用块 */
  refs: BlockRef[]
}

/**
 * 按文档聚合引用块。
 *
 * 同一篇文档里可以有多个块引用同一份资源，直接遍历 references 会把一篇文档
 * 显示成多次。分组后条数恒等于 countReferencedDocs()，保证"篇文档"与列表长度一致。
 */
export function groupReferencesByDoc(references: BlockRef[] = []): DocReferenceGroup[] {
  const groups = new Map<string, DocReferenceGroup>()

  for (const ref of references) {
    const existing = groups.get(ref.root_id)
    if (existing) {
      existing.refs.push(ref)
    } else {
      groups.set(ref.root_id, { rootId: ref.root_id, first: ref, refs: [ref] })
    }
  }

  return [...groups.values()]
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

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tif', 'tiff', 'avif', 'heic'])
const DOC_EXTS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'markdown', 'csv', 'epub', 'mobi', 'azw3', 'rtf', 'odt', 'ods', 'odp', 'wps'])
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'wma', 'opus', 'mid', 'midi'])
const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'm4v', '3gp', 'ts'])
const ARCHIVE_EXTS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', '7zip'])

/**
 * 浏览器原生可直接播放解码的常见视频格式
 */
export const PLAYABLE_VIDEO_EXTS = new Set(['mp4', 'webm', 'm4v'])

/**
 * 浏览器原生可直接播放解码的常见音频格式
 */
export const PLAYABLE_AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus'])

export function isPlayableVideoAsset(name: string): boolean {
  const ext = getAssetExtension(name)
  return PLAYABLE_VIDEO_EXTS.has(ext)
}

export function isPlayableAudioAsset(name: string): boolean {
  const ext = getAssetExtension(name)
  return PLAYABLE_AUDIO_EXTS.has(ext)
}

export function isPlayableMediaAsset(name: string): boolean {
  return isPlayableVideoAsset(name) || isPlayableAudioAsset(name)
}

export function isPreviewableAsset(name: string, isOriginal?: boolean): boolean {
  return Boolean(isOriginal) || isImageAsset(name) || isPlayableVideoAsset(name) || isPlayableAudioAsset(name)
}

export function isImageAsset(name: string): boolean {
  const ext = getAssetExtension(name)
  return IMAGE_EXTS.has(ext)
}

export function getAssetCategory(name: string, isOriginal?: boolean): AssetCategory {
  if (isOriginal) return 'image'
  const ext = getAssetExtension(name)
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (DOC_EXTS.has(ext)) return 'document'
  if (AUDIO_EXTS.has(ext)) return 'audio'
  if (VIDEO_EXTS.has(ext)) return 'video'
  if (ARCHIVE_EXTS.has(ext)) return 'archive'
  return 'all'
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

/**
 * 统计全局各分类资产数量和体积
 */
export function calculateCategoryStats(assets: AssetInfo[]): Record<AssetCategory, CategoryStatSummary> {
  const counts: Record<AssetCategory, number> = {
    all: 0,
    image: 0,
    document: 0,
    audio: 0,
    video: 0,
    archive: 0,
  }

  const sizes: Record<AssetCategory, number> = {
    all: 0,
    image: 0,
    document: 0,
    audio: 0,
    video: 0,
    archive: 0,
  }

  for (const asset of assets) {
    const size = asset.size || 0
    counts.all++
    sizes.all += size

    const cat = getAssetCategory(asset.name, asset.isOriginal)
    if (cat !== 'all') {
      counts[cat]++
      sizes[cat] += size
    }
  }

  const result = {} as Record<AssetCategory, CategoryStatSummary>
  const categories: AssetCategory[] = ['all', 'image', 'document', 'audio', 'video', 'archive']
  for (const cat of categories) {
    result[cat] = {
      count: counts[cat],
      totalSize: sizes[cat],
      sizeText: formatAssetSize(sizes[cat]),
    }
  }

  return result
}

export function filterAssets(assets: AssetInfo[], options: AssetFilterOptions): AssetInfo[] {
  const searchQuery = (options.searchQuery || '').toLowerCase()
  const category = options.category && options.category !== 'all' ? options.category : null
  const filterType = options.filterType || 'all'

  return assets.filter((asset) => {
    // 1. 关键字搜索
    if (searchQuery && !asset.name.toLowerCase().includes(searchQuery)) {
      return false
    }

    // 2. 大类过滤
    if (category) {
      const assetCat = getAssetCategory(asset.name, asset.isOriginal)
      if (assetCat !== category) {
        return false
      }
    }

    // 3. 属性状态过滤
    if (filterType === 'image' && (!isImageAsset(asset.name) || asset.isOriginal)) {
      return false
    }
    if (filterType === 'original' && !asset.isOriginal) {
      return false
    }
    if (filterType === 'reeditable' && !asset.isReEditable) {
      return false
    }
    if (filterType === 'unreferenced' && (asset.docCount > 0 || asset.isSystemProtected)) {
      return false
    }
    if (filterType === 'large' && asset.size < 1024 * 1024) {
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
  const unreferencedAssets = assets.filter((asset) => !asset.isOriginal && !asset.isSystemProtected && asset.docCount === 0)
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
  const unreferencedAssets = assets.filter((asset) => !asset.isOriginal && !asset.isSystemProtected && asset.docCount === 0)
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

export type DocSortField = 'totalSize' | 'assetCount' | 'name'
export type DocSortOrder = 'asc' | 'desc'

export interface DocAssetGroup {
  id: string
  title: string
  readablePath: string
  boxName?: string
  hpath?: string
  assets: AssetInfo[]
  totalSize: number
  assetCount: number
  isUnreferenced?: boolean
  firstBlockId?: string
  matchedByDocName?: boolean
}

export interface GroupAssetsByDocumentOptions {
  searchQuery?: string
  docSortField?: DocSortField
  docSortOrder?: DocSortOrder
  assetSortField?: AssetSortField
  assetSortOrder?: AssetSortOrder
}

export function extractDocTitle(ref: BlockRef): string {
  if (ref.hpath) {
    const parts = ref.hpath.split('/').filter(Boolean)
    if (parts.length > 0) {
      return parts[parts.length - 1]
    }
  }
  if (ref.readablePath) {
    const parts = ref.readablePath.split('/').filter(Boolean)
    if (parts.length > 0) {
      return parts[parts.length - 1]
    }
  }
  return ref.root_id || '未命名文档'
}

/**
 * 将资产列表按引用文档聚合分组，支持未引用专属分组、双重搜索与多维排序
 */
export function groupAssetsByDocument(
  assets: AssetInfo[],
  options: GroupAssetsByDocumentOptions = {}
): DocAssetGroup[] {
  const {
    searchQuery = '',
    docSortField = 'totalSize',
    docSortOrder = 'desc',
    assetSortField = 'size',
    assetSortOrder = 'desc',
  } = options

  const cleanQuery = searchQuery.trim().toLowerCase()

  // 1. 按文档 root_id 收集资产（通过 Map<root_id, { docInfo, assetMap }> 去重）
  const docGroupsMap = new Map<
    string,
    {
      id: string
      title: string
      readablePath: string
      boxName?: string
      hpath?: string
      firstBlockId?: string
      assetMap: Map<string, AssetInfo>
    }
  >()

  const unreferencedAssetMap = new Map<string, AssetInfo>()

  for (const asset of assets) {
    const refs = asset.references || []
    if (refs.length === 0 || asset.docCount === 0) {
      unreferencedAssetMap.set(asset.name, asset)
    } else {
      for (const ref of refs) {
        if (!ref.root_id) continue

        let group = docGroupsMap.get(ref.root_id)
        if (!group) {
          const title = extractDocTitle(ref)
          const readablePath = ref.readablePath || (ref.boxName ? `${ref.boxName}/${ref.hpath || ''}` : ref.hpath || title)
          group = {
            id: ref.root_id,
            title,
            readablePath,
            boxName: ref.boxName,
            hpath: ref.hpath,
            firstBlockId: ref.id,
            assetMap: new Map(),
          }
          docGroupsMap.set(ref.root_id, group)
        } else if (!group.firstBlockId && ref.id) {
          group.firstBlockId = ref.id
        }

        group.assetMap.set(asset.name, asset)
      }
    }
  }

  // 2. 处理常规文档分组：应用双重搜索
  const normalDocGroups: DocAssetGroup[] = []

  for (const group of docGroupsMap.values()) {
    const allGroupAssets = Array.from(group.assetMap.values())
    let matchedAssets: AssetInfo[] = []
    let matchedByDocName = false

    if (!cleanQuery) {
      matchedAssets = allGroupAssets
    } else {
      const docMatch =
        group.title.toLowerCase().includes(cleanQuery) ||
        group.readablePath.toLowerCase().includes(cleanQuery) ||
        (group.boxName ? group.boxName.toLowerCase().includes(cleanQuery) : false)

      if (docMatch) {
        // 文档名/路径命中：保留该文档下的所有资产
        matchedByDocName = true
        matchedAssets = allGroupAssets
      } else {
        // 仅筛选匹配文件名的资产
        matchedAssets = allGroupAssets.filter((a) => a.name.toLowerCase().includes(cleanQuery))
      }
    }

    if (matchedAssets.length > 0) {
      const sortedInnerAssets = sortAssets(matchedAssets, assetSortField, assetSortOrder)
      const totalSize = sortedInnerAssets.reduce((sum, a) => sum + (a.size || 0), 0)
      normalDocGroups.push({
        id: group.id,
        title: group.title,
        readablePath: group.readablePath,
        boxName: group.boxName,
        hpath: group.hpath,
        firstBlockId: group.firstBlockId,
        assets: sortedInnerAssets,
        totalSize,
        assetCount: sortedInnerAssets.length,
        isUnreferenced: false,
        matchedByDocName,
      })
    }
  }

  // 3. 对常规文档分组排序
  normalDocGroups.sort((a, b) => {
    let cmp = 0
    if (docSortField === 'totalSize') {
      cmp = a.totalSize - b.totalSize
    } else if (docSortField === 'assetCount') {
      cmp = a.assetCount - b.assetCount
    } else if (docSortField === 'name') {
      cmp = a.title.localeCompare(b.title, 'zh-CN')
    }

    return docSortOrder === 'desc' ? -cmp : cmp
  })

  // 4. 处理未引用资产分组
  const allUnrefAssets = Array.from(unreferencedAssetMap.values())
  let unrefGroup: DocAssetGroup | null = null

  if (allUnrefAssets.length > 0) {
    let matchedUnrefAssets: AssetInfo[] = []
    let unrefMatchedByDoc = false

    if (!cleanQuery) {
      matchedUnrefAssets = allUnrefAssets
    } else {
      const unrefNameMatch =
        '未被任何文档引用'.includes(cleanQuery) ||
        '未引用'.includes(cleanQuery) ||
        '孤立'.includes(cleanQuery) ||
        'unreferenced'.includes(cleanQuery) ||
        'orphan'.includes(cleanQuery)

      if (unrefNameMatch) {
        unrefMatchedByDoc = true
        matchedUnrefAssets = allUnrefAssets
      } else {
        matchedUnrefAssets = allUnrefAssets.filter((a) => a.name.toLowerCase().includes(cleanQuery))
      }
    }

    if (matchedUnrefAssets.length > 0) {
      const sortedUnrefAssets = sortAssets(matchedUnrefAssets, assetSortField, assetSortOrder)
      const totalSize = sortedUnrefAssets.reduce((sum, a) => sum + (a.size || 0), 0)
      unrefGroup = {
        id: 'unreferenced',
        title: '未被任何文档引用',
        readablePath: '未引用 / 孤立资源',
        assets: sortedUnrefAssets,
        totalSize,
        assetCount: sortedUnrefAssets.length,
        isUnreferenced: true,
        matchedByDocName: unrefMatchedByDoc,
      }
    }
  }

  // 5. 组合最终列表：常规文档卡片在前，未引用分组置底展示
  const result: DocAssetGroup[] = [...normalDocGroups]
  if (unrefGroup) {
    result.push(unrefGroup)
  }

  return result
}

/**
 * 按冻结的文档顺序重排分组结果，用于「删除/编辑资源后保持当前排序」：
 * 常规文档卡片依 pinnedOrder 决定位次；不在冻结列表中的文档（新增的引用文档）
 * 保持自然顺序追加到常规分组末尾；未引用分组无论是否出现在 pinnedOrder 中都恒置底。
 */
export function applyPinnedDocOrder(
  groups: DocAssetGroup[],
  pinnedOrder?: string[]
): DocAssetGroup[] {
  if (!pinnedOrder || pinnedOrder.length === 0) {
    return groups
  }

  const rank = new Map<string, number>()
  for (let i = 0; i < pinnedOrder.length; i++) {
    rank.set(pinnedOrder[i], i)
  }

  const pinnedNormals: DocAssetGroup[] = []
  const freshNormals: DocAssetGroup[] = []
  const unrefGroups: DocAssetGroup[] = []

  for (const group of groups) {
    if (group.isUnreferenced) {
      unrefGroups.push(group)
    } else if (rank.has(group.id)) {
      pinnedNormals.push(group)
    } else {
      freshNormals.push(group)
    }
  }

  pinnedNormals.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)

  return [...pinnedNormals, ...freshNormals, ...unrefGroups]
}

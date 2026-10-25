/**
 * 目录库存快照：持久化的上次全量/增量扫描结果（文件清单 + 预提取引用条目 + 水位线）。
 *
 * 分层缓存中的 L2（L1 为 90 秒内存缓存）：
 * 打开资源列表时先读快照立即渲染（秒级，含引用关系），后台再做增量校验补齐
 * 上次扫描之后的全部增删。快照损坏/缺失时静默回退全量扫描。
 */
import type { PreExtractedBlockEntry } from './siyuan-db'
import { blobToText, defaultStorage } from './storage'
import { log, warn } from './logger'

/** 快照落盘位置（工作空间内，随工作空间切换自动隔离） */
export const CATALOG_SNAPSHOT_PATH = '/data/storage/petal/siyuan-assets-manager/cache/catalog-snapshot.json'

/**
 * stat 补全进度侧缓存：只存 [name, size, updated] 三元组（约为完整快照的 1/5 体积），
 * 补全进行期间低频（约 60 秒）增量落盘。完整快照只在补全**完成**时写入——若用户在
 * 完成 前关闭界面，侧缓存保证下次打开时已补出的 size 不清零，补全从断点继续。
 * 已知取舍：同名文件被更小的文件替换时旧 size 会暂被沿用（仅影响显示，不影响清理正确性），
 * 直到下一次全量扫描重新校正。
 */
export const CATALOG_STAT_CACHE_PATH = '/data/storage/petal/siyuan-assets-manager/cache/catalog-stat-cache.json'

const SNAPSHOT_SCHEMA_VERSION = 1

/**
 * 水位线回退余量：覆盖内核 SQLite 事务批处理队列的落盘时延与秒级时间戳的取整误差。
 * 代价是每次增量会重复抓取最近约 2 分钟的变更块——重提取幂等，无正确性影响。
 */
export const WATERMARK_MARGIN_MS = 2 * 60 * 1000

export interface CatalogSnapshotFile {
  name: string
  size: number
  updated: number
  isDir: boolean
}

export interface CatalogSnapshot {
  /** 快照写入时刻（毫秒），仅用于 UI 展示"来自上次扫描的时间" */
  savedAt: number
  /** 块引用增量水位线（yyyyMMddHHmmss，已含回退余量；null 表示未知，需全量） */
  watermark: string | null
  files: CatalogSnapshotFile[]
  entries: Map<string, PreExtractedBlockEntry>
}

/** 毫秒时间戳 → 思源块 updated 同格式的本地时间串（yyyyMMddHHmmss） */
export function formatSiYuanTimestamp(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    String(d.getFullYear()) +
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    p(d.getHours()) +
    p(d.getMinutes()) +
    p(d.getSeconds())
  )
}

/**
 * 依据扫描/校验的起始时刻生成下一次增量的水位线。
 * 必须在发起任何引用查询**之前**取样，并以查询执行时刻为上界（起始时刻更早更安全），
 * 确保查询执行期间发生的变更不会落在水位线之后而被跳过。
 */
export function buildCatalogWatermark(scanStartedAtMs: number): string {
  return formatSiYuanTimestamp(scanStartedAtMs - WATERMARK_MARGIN_MS)
}

interface SerializedSnapshotV1 {
  v: number
  savedAt: number
  watermark: string | null
  /** [name, size, updated] 元组，紧凑省体积 */
  files: Array<[string, number, number]>
  /** [id, root_id, box, content, path, hpath, ...rawAssetNames] 元组 */
  entries: Array<Array<string>>
}

function serialize(snapshot: CatalogSnapshot): SerializedSnapshotV1 {
  return {
    v: SNAPSHOT_SCHEMA_VERSION,
    savedAt: snapshot.savedAt,
    watermark: snapshot.watermark,
    files: snapshot.files.map((f) => [f.name, f.size, f.updated]),
    entries: Array.from(snapshot.entries.values()).map((e) => [
      e.id,
      e.root_id,
      e.box,
      e.content || '',
      e.path || '',
      e.hpath || '',
      ...e.rawAssetNames,
    ]),
  }
}

function deserialize(data: any): CatalogSnapshot | null {
  if (!data || data.v !== SNAPSHOT_SCHEMA_VERSION || !Array.isArray(data.files) || !Array.isArray(data.entries)) {
    return null
  }
  const entries = new Map<string, PreExtractedBlockEntry>()
  for (const tuple of data.entries) {
    if (!Array.isArray(tuple) || tuple.length < 6 || !tuple[0]) continue
    entries.set(String(tuple[0]), {
      id: String(tuple[0]),
      root_id: String(tuple[1] || ''),
      box: String(tuple[2] || ''),
      content: String(tuple[3] || ''),
      path: String(tuple[4] || ''),
      hpath: tuple[5] ? String(tuple[5]) : undefined,
      rawAssetNames: tuple.slice(6).map(String).filter(Boolean),
    })
  }
  return {
    savedAt: Number(data.savedAt) || 0,
    watermark: typeof data.watermark === 'string' && data.watermark ? data.watermark : null,
    files: (data.files as Array<[string, number, number]>)
      .filter((t) => Array.isArray(t) && t[0])
      .map((t) => ({ name: String(t[0]), size: Number(t[1]) || 0, updated: Number(t[2]) || 0, isDir: false })),
    entries,
  }
}

/**
 * 用库存资产当前已知的 size/updated 覆盖文件清单元组。
 *
 * 桌面端快速枚举 readdir 不带 size（首期全 0），真实体积由后台 stat 逐步补全；
 * 若不把补全成果持久化进快照，每次重开界面都要从零重填，分类体积统计长期偏小。
 * 覆盖规则：仅用更大的 size 覆盖（避免 0 或旧值回退），updated 取非零值。
 */
export function overlaySnapshotFileStats(
  files: CatalogSnapshotFile[],
  allAssets: Array<{ name: string, size: number, updated: number }>,
): CatalogSnapshotFile[] {
  const statsByName = new Map<string, { size: number, updated: number }>()
  for (const asset of allAssets) {
    if (!asset || !asset.name) continue
    const prev = statsByName.get(asset.name)
    if (!prev) {
      statsByName.set(asset.name, { size: asset.size || 0, updated: asset.updated || 0 })
    } else {
      if ((asset.size || 0) > prev.size) prev.size = asset.size || 0
      if (!prev.updated && asset.updated) prev.updated = asset.updated
    }
  }
  return files.map((f) => {
    const stats = statsByName.get(f.name)
    if (!stats) return f
    return {
      ...f,
      size: stats.size > 0 ? stats.size : f.size,
      updated: stats.updated || f.updated,
    }
  })
}

/**
 * 读取快照；缺失、损坏或版本不符一律返回 null（调用方回退全量扫描）。
 * 解析在主线程 JSON.parse 内完成，20MB 量级约 0.5~1.5 秒，仅在冷启动读一次。
 * 读取成功后用 stat 侧缓存覆盖文件元组的 size/updated（上次补全的断点成果）。
 */
export async function loadCatalogSnapshot(): Promise<CatalogSnapshot | null> {
  try {
    const blob = await defaultStorage.read(CATALOG_SNAPSHOT_PATH).catch(() => null)
    if (!blob) return null
    const text = await blobToText(blob)
    if (!text) return null
    const snapshot = deserialize(JSON.parse(text))
    if (snapshot && snapshot.entries.size === 0 && snapshot.files.length === 0) {
      // 空快照没有秒开价值，直接回退全量
      return null
    }
    if (snapshot) {
      const statCache = await loadCatalogStatCache()
      if (statCache && statCache.size > 0) {
        const stats = Array.from(statCache, ([name, s]) => ({ name, size: s.size, updated: s.updated }))
        snapshot.files = overlaySnapshotFileStats(snapshot.files, stats)
      }
    }
    return snapshot
  } catch (err) {
    warn('[catalog-snapshot] 快照读取或解析失败，回退全量扫描:', err)
    return null
  }
}

/**
 * 写入快照（后台调用；写失败不影响主流程，下次扫描会重写）。
 * 部分写入导致的损坏由读取侧的解析失败兜底。
 */
export async function saveCatalogSnapshot(snapshot: CatalogSnapshot): Promise<boolean> {
  try {
    const json = JSON.stringify(serialize(snapshot))
    await defaultStorage.write(CATALOG_SNAPSHOT_PATH, new Blob([json], { type: 'application/json' }))
    return true
  } catch (err) {
    warn('[catalog-snapshot] 快照写入失败（不影响本次扫描结果）:', err)
    return false
  }
}

/** 删除快照（校验发现结构性不一致时的自愈手段） */
export async function removeCatalogSnapshot(): Promise<void> {
  try {
    await defaultStorage.delete(CATALOG_SNAPSHOT_PATH).catch(() => {})
  } catch (e) {
    log('[catalog-snapshot] 删除快照失败（可忽略）')
  }
}

// **************************************** stat 补全侧缓存 ****************************************

interface SerializedStatCacheV1 {
  v: 1
  /** [name, size, updated] 三元组，只保留 size > 0 的条目 */
  stats: Array<[string, number, number]>
}

/** 读取 stat 侧缓存；缺失/损坏返回 null（无侧缓存是常态，静默降级） */
export async function loadCatalogStatCache(): Promise<Map<string, { size: number, updated: number }> | null> {
  try {
    const blob = await defaultStorage.read(CATALOG_STAT_CACHE_PATH).catch(() => null)
    if (!blob) return null
    const text = await blobToText(blob)
    if (!text) return null
    const data = JSON.parse(text)
    if (!data || data.v !== 1 || !Array.isArray(data.stats)) return null
    const map = new Map<string, { size: number, updated: number }>()
    for (const tuple of data.stats as Array<[string, number, number]>) {
      if (!Array.isArray(tuple) || !tuple[0] || !(Number(tuple[1]) > 0)) continue
      map.set(String(tuple[0]), { size: Number(tuple[1]), updated: Number(tuple[2]) || 0 })
    }
    return map.size > 0 ? map : null
  } catch {
    return null
  }
}

/** 写入 stat 侧缓存（补全进行期间每约 60 秒调用一次；写失败静默，下次再试） */
export async function saveCatalogStatCache(
  allAssets: Array<{ name: string, size: number, updated: number }>,
): Promise<boolean> {
  try {
    const stats: Array<[string, number, number]> = []
    for (const a of allAssets) {
      if (a && a.name && (a.size || 0) > 0) stats.push([a.name, a.size, a.updated || 0])
    }
    const json = JSON.stringify({ v: 1, stats })
    await defaultStorage.write(CATALOG_STAT_CACHE_PATH, new Blob([json], { type: 'application/json' }))
    return true
  } catch (err) {
    warn('[catalog-snapshot] stat 侧缓存写入失败（不影响主流程）:', err)
    return false
  }
}

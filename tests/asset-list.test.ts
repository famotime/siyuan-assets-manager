import { describe, expect, it } from 'vitest'
import {
  calculateBatchDeleteSummary,
  calculateCategoryStats,
  calculateOrphanCleanup,
  calculateTotalCleanup,
  calculateUnreferencedCleanup,
  filterAssets,
  formatAssetSize,
  formatAssetTime,
  getAssetBadgeText,
  getAssetCategory,
  getAssetExtension,
  isPlayableAudioAsset,
  isPlayableMediaAsset,
  isPlayableVideoAsset,
  isPreviewableAsset,
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

  const allCategoryAssets = [
    ...assets,
    asset('sound.mp3', 1024 * 100, 1, false, false, 1720000000000),
    asset('movie.mp4', 1024 * 1024 * 10, 1, false, false, 1730000000000),
    asset('archive.zip', 1024 * 50, 0, false, false, 1740000000000),
  ]

  it('categorizes assets correctly by extensions and original flag', () => {
    expect(getAssetCategory('photo.JPG')).toBe('image')
    expect(getAssetCategory('vector.svg')).toBe('image')
    expect(getAssetCategory('orig_hidden', true)).toBe('image')
    expect(getAssetCategory('document.pdf')).toBe('document')
    expect(getAssetCategory('notes.md')).toBe('document')
    expect(getAssetCategory('music.flac')).toBe('audio')
    expect(getAssetCategory('clip.mkv')).toBe('video')
    expect(getAssetCategory('data.tar.gz')).toBe('archive')
    expect(getAssetCategory('package.7z')).toBe('archive')
    expect(getAssetCategory('unknown.xyz')).toBe('all')
    expect(getAssetCategory('noext')).toBe('all')
  })

  it('calculates global category statistics correctly', () => {
    const stats = calculateCategoryStats(allCategoryAssets)
    expect(stats.all.count).toBe(8)
    expect(stats.all.totalSize).toBe(
      1024 * 1024 * 2 + 20 + 0 + 1024 * 500 + 1024 * 300 + 1024 * 100 + 1024 * 1024 * 10 + 1024 * 50
    )
    expect(stats.image.count).toBe(3) // Beta.PNG, orig_123.png, orphan_orig.png
    expect(stats.document.count).toBe(1) // alpha.txt
    expect(stats.audio.count).toBe(1) // sound.mp3
    expect(stats.video.count).toBe(1) // movie.mp4
    expect(stats.archive.count).toBe(1) // archive.zip
  })

  it('filters assets by category, search text, type, reeditable flag, and original flag', () => {
    // 按大类过滤
    expect(filterAssets(allCategoryAssets, { searchQuery: '', category: 'image' })).toEqual([allCategoryAssets[0], allCategoryAssets[3], allCategoryAssets[4]])
    expect(filterAssets(allCategoryAssets, { searchQuery: '', category: 'audio' })).toEqual([allCategoryAssets[5]])
    expect(filterAssets(allCategoryAssets, { searchQuery: '', category: 'video' })).toEqual([allCategoryAssets[6]])
    expect(filterAssets(allCategoryAssets, { searchQuery: '', category: 'archive' })).toEqual([allCategoryAssets[7]])
    expect(filterAssets(allCategoryAssets, { searchQuery: '', category: 'document' })).toEqual([allCategoryAssets[1]])

    // 正交组合：图片类别 + 未引用
    expect(filterAssets(allCategoryAssets, { searchQuery: '', category: 'image', filterType: 'unreferenced' })).toEqual([allCategoryAssets[4]])

    // 正交组合：全部类别 + 大文件
    expect(filterAssets(allCategoryAssets, { searchQuery: '', category: 'all', filterType: 'large' })).toEqual([allCategoryAssets[0], allCategoryAssets[6]])

    // 正交组合：搜索 + 类别
    expect(filterAssets(allCategoryAssets, { searchQuery: 'beta', category: 'image' })).toEqual([allCategoryAssets[0]])
    expect(filterAssets(allCategoryAssets, { searchQuery: 'beta', category: 'video' })).toEqual([])

    // 兼容原有 filterType 测试 (基于 base assets)
    expect(filterAssets(assets, { searchQuery: 'beta', filterType: 'image' })).toEqual([assets[0]])
    expect(filterAssets(assets, { searchQuery: '', filterType: 'image' })).toEqual([assets[0]])
    expect(filterAssets(assets, { searchQuery: '', filterType: 'original' })).toEqual([assets[3], assets[4]])
    expect(filterAssets(assets, { searchQuery: '', filterType: 'unreferenced' })).toEqual([assets[1], assets[4]])
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

  it('identifies playable video and audio assets correctly for preview', () => {
    // 视频原生播放格式
    expect(isPlayableVideoAsset('video.mp4')).toBe(true)
    expect(isPlayableVideoAsset('clip.WEBM')).toBe(true)
    expect(isPlayableVideoAsset('movie.m4v')).toBe(true)
    expect(isPlayableVideoAsset('video.avi')).toBe(false)
    expect(isPlayableVideoAsset('video.mkv')).toBe(false)
    expect(isPlayableVideoAsset('video.flv')).toBe(false)

    // 音频原生播放格式
    expect(isPlayableAudioAsset('song.mp3')).toBe(true)
    expect(isPlayableAudioAsset('voice.WAV')).toBe(true)
    expect(isPlayableAudioAsset('track.ogg')).toBe(true)
    expect(isPlayableAudioAsset('podcast.m4a')).toBe(true)
    expect(isPlayableAudioAsset('lossless.flac')).toBe(true)
    expect(isPlayableAudioAsset('record.aac')).toBe(true)
    expect(isPlayableAudioAsset('voice.opus')).toBe(true)
    expect(isPlayableAudioAsset('midi.mid')).toBe(false)
    expect(isPlayableAudioAsset('song.wma')).toBe(false)

    // 多媒体通用判断
    expect(isPlayableMediaAsset('video.mp4')).toBe(true)
    expect(isPlayableMediaAsset('song.mp3')).toBe(true)
    expect(isPlayableMediaAsset('doc.pdf')).toBe(false)

    // 综合可预览判断 (包含图片、原始底图、音视频)
    expect(isPreviewableAsset('pic.png')).toBe(true)
    expect(isPreviewableAsset('hidden_name', true)).toBe(true)
    expect(isPreviewableAsset('sample.mp4')).toBe(true)
    expect(isPreviewableAsset('sample.mp3')).toBe(true)
    expect(isPreviewableAsset('notes.md')).toBe(false)
  })

  it('ensures asset preview element in VirtualAssetList has hover preview event handlers', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const vueContent = fs.readFileSync(path.resolve(__dirname, '../src/components/VirtualAssetList.vue'), 'utf-8')
    expect(vueContent).toContain('class="asset-preview"')
    expect(vueContent).toMatch(/class="asset-preview"[\s\S]*?@mouseenter="\$emit\('show-preview'/)
    expect(vueContent).toMatch(/class="asset-preview"[\s\S]*?@mousemove="\$emit\('update-preview'/)
    expect(vueContent).toMatch(/class="asset-preview"[\s\S]*?@mouseleave="\$emit\('hide-preview'/)
  })
})

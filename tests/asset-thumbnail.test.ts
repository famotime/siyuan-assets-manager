import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetInfo } from '../src/utils/asset-model';
import { createThumbnailCache } from '../src/utils/asset-thumbnail';

function makeAsset(overrides: Partial<AssetInfo> = {}): AssetInfo {
  return {
    name: 'demo.png',
    size: 100,
    updated: 1234,
    isDir: false,
    references: [],
    refCount: 0,
    docCount: 0,
    ...overrides,
  }
}

let urlSeq = 0
let createdUrls: string[] = []

beforeEach(() => {
  urlSeq = 0
  createdUrls = []
  ;(globalThis.URL as any).createObjectURL = vi.fn(() => {
    urlSeq += 1
    const url = `blob:mock-${urlSeq}`
    createdUrls.push(url)
    return url
  })
  ;(globalThis.URL as any).revokeObjectURL = vi.fn()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createThumbnailCache · 普通资产', () => {
  it('返回内核直链并带版本参数，不触发 Blob 加载', () => {
    const readOriginal = vi.fn()
    const cache = createThumbnailCache({ readOriginalImage: readOriginal })

    expect(cache.getThumbnailSrc(makeAsset())).toBe('/assets/demo.png?t=1234')
    expect(cache.getThumbnailSrc(makeAsset({ updated: 0 }))).toBe('/assets/demo.png')
    expect(readOriginal).not.toHaveBeenCalled()
  })
})

describe('createThumbnailCache · 原始底图', () => {
  it('加载完成前返回空串，完成后返回 ObjectURL', async () => {
    const blob = new Blob(['x'])
    let resolveRead!: (b: Blob | null) => void
    const readOriginal = vi.fn(() => new Promise<Blob | null>((resolve) => { resolveRead = resolve }))
    const cache = createThumbnailCache({ readOriginalImage: readOriginal })
    const asset = makeAsset({ isOriginal: true, originalStoragePath: 'orig-store/orig.png' })

    expect(cache.getThumbnailSrc(asset)).toBe('')
    expect(readOriginal).toHaveBeenCalledWith('orig-store/orig.png')

    resolveRead(blob)
    await Promise.resolve()
    await Promise.resolve()

    expect(cache.getThumbnailSrc(asset)).toBe('blob:mock-1')
  })

  it('originalStoragePath 缺省时回退使用资产名', async () => {
    const readOriginal = vi.fn(async () => new Blob(['x']))
    const cache = createThumbnailCache({ readOriginalImage: readOriginal })

    cache.getThumbnailSrc(makeAsset({ isOriginal: true }))
    await Promise.resolve()
    expect(readOriginal).toHaveBeenCalledWith('demo.png')
  })

  it('并发去重：加载进行中不重复发起读取', async () => {
    let resolveRead!: (b: Blob | null) => void
    const readOriginal = vi.fn(() => new Promise<Blob | null>((resolve) => { resolveRead = resolve }))
    const cache = createThumbnailCache({ readOriginalImage: readOriginal })
    const asset = makeAsset({ isOriginal: true })

    cache.getThumbnailSrc(asset)
    cache.getThumbnailSrc(asset)
    cache.getThumbnailSrc(asset)
    expect(readOriginal).toHaveBeenCalledTimes(1)

    resolveRead(new Blob(['x']))
    await Promise.resolve()
    await Promise.resolve()
  })

  it('读取失败静默降级，不抛错且允许后续重试', async () => {
    const readOriginal = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(new Blob(['x']))
    const cache = createThumbnailCache({ readOriginalImage: readOriginal })
    const asset = makeAsset({ isOriginal: true })

    expect(cache.getThumbnailSrc(asset)).toBe('')
    await Promise.resolve()
    expect(cache.getThumbnailSrc(asset)).toBe('')
    await Promise.resolve()
    await Promise.resolve()
    expect(cache.getThumbnailSrc(asset)).toBe('blob:mock-1')
  })

  it('读取返回 null 时不生成 ObjectURL', async () => {
    const readOriginal = vi.fn(async () => null)
    const cache = createThumbnailCache({ readOriginalImage: readOriginal })
    const asset = makeAsset({ isOriginal: true })

    cache.getThumbnailSrc(asset)
    await Promise.resolve()
    await Promise.resolve()
    expect(createdUrls).toHaveLength(0)
  })

  it('非原始底图资产不触发底图读取', () => {
    const readOriginal = vi.fn()
    const cache = createThumbnailCache({ readOriginalImage: readOriginal })

    cache.getThumbnailSrc(makeAsset())
    expect(readOriginal).not.toHaveBeenCalled()
  })
})

describe('createThumbnailCache · 画布专属资产', () => {
  it('使用画布存储路径读取并生成 ObjectURL', async () => {
    const readCanvas = vi.fn(async () => new Blob(['c']))
    const cache = createThumbnailCache({ readCanvasAsset: readCanvas })
    const asset = makeAsset({
      isCanvasAsset: true,
      canvasAssetStoragePath: '/data/storage/petal/siyuan-canvas/x.assets/1.png',
    })

    expect(cache.getThumbnailSrc(asset)).toBe('')
    await Promise.resolve()
    await Promise.resolve()
    expect(readCanvas).toHaveBeenCalledWith('/data/storage/petal/siyuan-canvas/x.assets/1.png')
    expect(cache.getThumbnailSrc(asset)).toBe('blob:mock-1')
  })

  it('canvasAssetStoragePath 缺省时回退资产名', async () => {
    const readCanvas = vi.fn(async () => new Blob(['c']))
    const cache = createThumbnailCache({ readCanvasAsset: readCanvas })

    cache.getThumbnailSrc(makeAsset({ isCanvasAsset: true }))
    await Promise.resolve()
    expect(readCanvas).toHaveBeenCalledWith('demo.png')
  })
})

describe('createThumbnailCache · 释放', () => {
  it('invalidate 释放并移除单个资产，未知名称无操作', async () => {
    const readOriginal = vi.fn(async () => new Blob(['x']))
    const cache = createThumbnailCache({ readOriginalImage: readOriginal })
    const asset = makeAsset({ isOriginal: true, name: 'a.png' })

    cache.getThumbnailSrc(asset)
    await Promise.resolve()
    await Promise.resolve()
    expect(cache.getThumbnailSrc(asset)).toBe('blob:mock-1')

    cache.invalidate('a.png')
    expect(vi.mocked(globalThis.URL.revokeObjectURL)).toHaveBeenCalledWith('blob:mock-1')
    expect(cache.getThumbnailSrc(asset)).toBe('')

    cache.invalidate('not-exists.png')
    await Promise.resolve()
  })

  it('dispose 释放全部 ObjectURL 并清空缓存', async () => {
    const readOriginal = vi.fn(async () => new Blob(['x']))
    const cache = createThumbnailCache({ readOriginalImage: readOriginal })

    cache.getThumbnailSrc(makeAsset({ isOriginal: true, name: 'a.png' }))
    cache.getThumbnailSrc(makeAsset({ isOriginal: true, name: 'b.png' }))
    await Promise.resolve()
    await Promise.resolve()

    cache.dispose()
    expect(vi.mocked(globalThis.URL.revokeObjectURL)).toHaveBeenCalledTimes(2)
    expect(cache.getThumbnailSrc(makeAsset({ isOriginal: true, name: 'a.png' }))).toBe('')
  })
})

import type { AssetInfo } from '../src/utils/siyuan-db'
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import * as api from '../src/api'
import { resolveCatalogPipeline } from '../src/utils/asset-catalog'
import {
  calculateTotalCleanup,
  filterAssets,
} from '../src/utils/asset-list'
import {
  cleanupEmptyCanvasAssetDirs,
  deleteCanvasAssetFile,
  extractReferencesFromCanvasData,
  getCanvasAssetDirectory,
  getCanvasPathFromAssetDir,
  normalizeCanvasWorkspacePath,
  openCanvasInTab,
  resolveCanvasAssetTimestamp,
  scanCanvasAssetsInventory,
} from '../src/utils/canvas-asset'
import { defaultStorage } from '../src/utils/storage'

vi.mock('../src/api', () => ({
  readDir: vi.fn(),
  sql: vi.fn(),
  removeFile: vi.fn(),
}))

describe('canvas-asset module', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('path normalizations and directory mappings', () => {
    it('normalizes canvas workspace paths', () => {
      expect(normalizeCanvasWorkspacePath('data\\storage\\petal\\siyuan-canvas\\test.canvas'))
        .toBe('/data/storage/petal/siyuan-canvas/test.canvas')
      expect(normalizeCanvasWorkspacePath('/data//storage/petal///siyuan-canvas/sub/test.canvas'))
        .toBe('/data/storage/petal/siyuan-canvas/sub/test.canvas')
    })

    it('maps between canvas file path and dedicated asset directory path', () => {
      const canvasPath = '/data/storage/petal/siyuan-canvas/my-mindmap.canvas'
      const assetDir = getCanvasAssetDirectory(canvasPath)
      expect(assetDir).toBe('/data/storage/petal/siyuan-canvas/my-mindmap.assets')
      expect(getCanvasPathFromAssetDir(assetDir)).toBe(canvasPath)
    })
  })

  describe('extractReferencesFromCanvasData', () => {
    it('extracts global /data/assets references and dedicated *.assets references from file, text, and collapsed group nodes', () => {
      const canvasJson = {
        nodes: [
          // 1. File node pointing to global asset
          {
            id: 'node-file-global',
            type: 'file',
            file: 'assets/global-diagram-2024.png',
          },
          // 2. File node pointing to dedicated canvas asset
          {
            id: 'node-file-canvas',
            type: 'file',
            file: '/data/storage/petal/siyuan-canvas/my-mindmap.assets/1715000000001.png',
          },
          // 3. Text node with Markdown and HTML images
          {
            id: 'node-text-markdown',
            type: 'text',
            text: 'Here is a note with ![chart](assets/global-chart.svg) and <img src="/data/storage/petal/siyuan-canvas/my-mindmap.assets/inline.png" />',
          },
          // 4. Group node with collapsed nodes
          {
            id: 'node-group-1',
            type: 'group',
            label: 'Nested Tasks',
            collapsed: true,
            collapsedNodes: [
              {
                id: 'node-sub-file',
                type: 'file',
                file: 'my-mindmap.assets/nested-pasted.jpg',
              },
            ],
          },
        ],
      }

      const canvasPath = '/data/storage/petal/siyuan-canvas/my-mindmap.canvas'
      const result = extractReferencesFromCanvasData(canvasJson, canvasPath)

      // Verify global assets
      expect(result.globalAssetRefs.has('global-diagram-2024.png')).toBe(true)
      expect(result.globalAssetRefs.has('global-chart.svg')).toBe(true)
      expect(result.globalAssetRefs.get('global-diagram-2024.png')?.[0].readablePath)
        .toBe('画布: my-mindmap.canvas')

      // Verify dedicated canvas assets
      expect(result.canvasAssetRefs.has('1715000000001.png')).toBe(true)
      expect(result.canvasAssetRefs.has('inline.png')).toBe(true)
      expect(result.canvasAssetRefs.has('nested-pasted.jpg')).toBe(true)
    })
  })

  describe('resolveCatalogPipeline with Canvas integration', () => {
    it('protects global /data/assets file from orphan deletion when referenced by canvas', () => {
      // Physical asset in /data/assets
      const files = [
        {
          name: 'canvas-protected.png',
          size: 1024,
          updated: 100,
          isDir: false,
        },
        {
          name: 'real-orphan.png',
          size: 2048,
          updated: 100,
          isDir: false,
        },
      ]

      // No document blocks reference either asset
      const blocks: any[] = []
      const notebookMap = new Map()

      // Canvas global reference
      const canvasGlobalRefs = new Map([
        [
          'canvas-protected.png',
          [
            {
              id: 'canvas:/data/canvas/test.canvas:node-1',
              root_id: '/data/canvas/test.canvas',
              box: '',
              content: '无界画布节点引用',
              markdown: '',
              path: '/data/canvas/test.canvas',
              readablePath: '画布: test.canvas',
            },
          ],
        ],
      ])

      // Dedicated canvas assets (one referenced, one orphan)
      const canvasAssets: AssetInfo[] = [
        {
          name: 'test.assets/referenced.png',
          size: 4096,
          updated: 200,
          isDir: false,
          references: [
            {
              id: 'canvas:/data/canvas/test.canvas:node-2',
              root_id: '/data/canvas/test.canvas',
              box: '',
              content: '无界画布节点引用',
              markdown: '',
              path: '/data/canvas/test.canvas',
              readablePath: '画布: test.canvas',
            },
          ],
          refCount: 1,
          docCount: 1,
          isCanvasAsset: true,
          canvasPath: '/data/canvas/test.canvas',
          canvasAssetStoragePath: '/data/storage/petal/siyuan-canvas/test.assets/referenced.png',
        },
        {
          name: 'test.assets/orphan.png',
          size: 8192,
          updated: 200,
          isDir: false,
          references: [],
          refCount: 0,
          docCount: 0,
          isCanvasAsset: true,
          canvasPath: '/data/canvas/test.canvas',
          canvasAssetStoragePath: '/data/storage/petal/siyuan-canvas/test.assets/orphan.png',
        },
      ]

      const inventory = resolveCatalogPipeline(
        files,
        blocks,
        [],
        [],
        notebookMap,
        [],
        new Map(),
        new Set(),
        [],
        canvasGlobalRefs,
        canvasAssets,
      )

      // 1. canvas-protected.png is protected and has docCount === 1
      const protectedAsset = inventory.assetsMap.get('canvas-protected.png')
      expect(protectedAsset).toBeDefined()
      expect(protectedAsset?.docCount).toBe(1)
      expect(protectedAsset?.references[0].readablePath).toBe('画布: test.canvas')

      // 2. real-orphan.png has docCount === 0
      const orphanAsset = inventory.assetsMap.get('real-orphan.png')
      expect(orphanAsset?.docCount).toBe(0)

      // 3. Dedicated canvas assets are present in assetsMap
      const canvasReferenced = inventory.assetsMap.get('test.assets/referenced.png')
      expect(canvasReferenced).toBeDefined()
      expect(canvasReferenced?.isCanvasAsset).toBe(true)
      expect(canvasReferenced?.docCount).toBe(1)

      const canvasOrphan = inventory.assetsMap.get('test.assets/orphan.png')
      expect(canvasOrphan).toBeDefined()
      expect(canvasOrphan?.isCanvasAsset).toBe(true)
      expect(canvasOrphan?.docCount).toBe(0)

      // 4. calculateTotalCleanup properly identifies the unreferenced canvas asset alongside regular orphans
      const cleanupSummary = calculateTotalCleanup(inventory.allAssets)
      const unrefNames = cleanupSummary.unreferencedAssets.map((a) => a.name)
      expect(unrefNames).toContain('real-orphan.png')
      expect(unrefNames).toContain('test.assets/orphan.png')
      expect(unrefNames).not.toContain('canvas-protected.png')
      expect(unrefNames).not.toContain('test.assets/referenced.png')

      // 5. filterAssets with 'canvas' filter returns only canvas assets
      const filteredCanvas = filterAssets(inventory.allAssets, {
        searchQuery: '',
        filterType: 'canvas',
      })
      expect(filteredCanvas.length).toBe(2)
      expect(filteredCanvas.every((a) => a.isCanvasAsset)).toBe(true)
    })
  })

  describe('deleteCanvasAssetFile and cleanupEmptyCanvasAssetDirs', () => {
    it('deletes canvas asset and cleans up empty parent directory', async () => {
      const asset: AssetInfo = {
        name: 'demo.assets/unused.png',
        size: 1024,
        updated: 100,
        isDir: false,
        references: [],
        refCount: 0,
        docCount: 0,
        isCanvasAsset: true,
        canvasPath: '/data/storage/petal/siyuan-canvas/demo.canvas',
        canvasAssetStoragePath: '/data/storage/petal/siyuan-canvas/demo.assets/unused.png',
      }

      vi.spyOn(defaultStorage, 'isTrashSupported').mockReturnValue(false)
      vi.mocked(api.removeFile).mockResolvedValueOnce({ code: 0 }) // file deletion
      vi.mocked(api.readDir).mockResolvedValueOnce([]) // parent dir check: empty
      vi.mocked(api.removeFile).mockResolvedValueOnce({ code: 0 }) // parent dir deletion

      const success = await deleteCanvasAssetFile(asset, false)
      expect(success).toBe(true)
      expect(api.removeFile).toHaveBeenCalledWith('/data/storage/petal/siyuan-canvas/demo.assets/unused.png')
      expect(api.removeFile).toHaveBeenCalledWith('/data/storage/petal/siyuan-canvas/demo.assets')
    })

    it('cleans up list of empty orphan canvas directories', async () => {
      vi.mocked(api.readDir).mockResolvedValueOnce([]) // empty dir
      vi.mocked(api.removeFile).mockResolvedValueOnce({ code: 0 })

      const cleaned = await cleanupEmptyCanvasAssetDirs(['/data/storage/petal/siyuan-canvas/orphan.assets'])
      expect(cleaned).toBe(1)
      expect(api.removeFile).toHaveBeenCalledWith('/data/storage/petal/siyuan-canvas/orphan.assets')
    })
  })

  describe('resolveCanvasAssetTimestamp', () => {
    it('extracts real creation timestamp from 13-digit millisecond timestamp filename', () => {
      // 1781831598964 对应 2026 年
      const ts = resolveCanvasAssetTimestamp('1781831598964.png', 1781831)
      expect(ts).toBe(1781831598964)
    })

    it('recovers timestamp corrupted by putFile 1970 kernel second-as-millisecond issue', () => {
      // 当原秒级时间戳 1781831598 被内核当成毫秒，stUpdated 变成 1781831（1970年）
      const corruptedSeconds = 1781831
      const recovered = resolveCanvasAssetTimestamp('custom-image.png', corruptedSeconds)
      // 1781831 * 1000 * 1000 = 1781831000000 (落在 2026 年)
      expect(recovered).toBe(1781831000000)
    })

    it('preserves valid modern timestamps', () => {
      const validMs = 1781831598000
      expect(resolveCanvasAssetTimestamp('image.png', validMs)).toBe(validMs)
    })
  })

  describe('scanCanvasAssetsInventory cross-canvas references and stat retrieval', () => {
    it('correctly matches references across different canvases and populates file size and timestamp', async () => {
      // 模拟探测候选目录
      vi.mocked(api.readDir).mockImplementation(async (path: string) => {
        if (path === '/data/storage/petal/siyuan-canvas') {
          return [
            { name: 'video.canvas', isDir: false, updated: 1780000 },
            { name: 'untitled.assets', isDir: true, updated: 1781831 },
          ] as any
        }
        if (path === '/data/storage/petal/siyuan-canvas/untitled.assets') {
          return [
            { name: '1781833642050.webp', isDir: false, updated: 1781833 },
            { name: 'orphan-unreferenced.png', isDir: false, updated: 1781834 },
          ] as any
        }
        return []
      })

      // 模拟读取 video.canvas，其内部引用了 untitled.assets/1781833642050.webp
      const videoCanvasJson = {
        nodes: [
          {
            id: 'node-cross-ref',
            type: 'file',
            file: '/data/storage/petal/siyuan-canvas/untitled.assets/1781833642050.webp',
          },
        ],
      }
      vi.spyOn(defaultStorage, 'read').mockImplementation(async (filePath: string) => {
        if (filePath === '/data/storage/petal/siyuan-canvas/video.canvas') {
          return new Blob([JSON.stringify(videoCanvasJson)], { type: 'application/json' })
        }
        return null
      })

      // 模拟 defaultStorage.stat 返回精确物理尺寸和修改时间
      vi.spyOn(defaultStorage, 'stat').mockImplementation(async (filePath: string) => {
        if (filePath.includes('1781833642050.webp')) {
          return { size: 524288, updated: 1781833, isDir: false }
        }
        if (filePath.includes('orphan-unreferenced.png')) {
          return { size: 1048576, updated: 1781834, isDir: false }
        }
        return null
      })

      const inventory = await scanCanvasAssetsInventory()

      // 验证资源列表提取
      expect(inventory.canvasAssets.length).toBe(2)

      // 1. 被跨画布引用的资源 1781833642050.webp
      const referencedAsset = inventory.canvasAssets.find((a) => a.name.includes('1781833642050.webp'))
      expect(referencedAsset).toBeDefined()
      expect(referencedAsset?.size).toBe(524288) // 物理文件真实大小
      expect(referencedAsset?.updated).toBe(1781833642050) // 从文件名自动纠偏的时间戳
      expect(referencedAsset?.docCount).toBe(1) // 跨画布引用成功命中，不为 0！
      expect(referencedAsset?.refCount).toBe(1)

      // 2. 真正未引用的资源 orphan-unreferenced.png
      const unrefAsset = inventory.canvasAssets.find((a) => a.name.includes('orphan-unreferenced.png'))
      expect(unrefAsset).toBeDefined()
      expect(unrefAsset?.size).toBe(1048576)
      expect(unrefAsset?.docCount).toBe(0) // 未引用资源 docCount 为 0

      // 3. 孤立目录判定：因为 untitled.assets 仍包含被引用的资源，绝不能被当作 orphanAssetDirs 误删！
      expect(inventory.orphanAssetDirs).not.toContain('/data/storage/petal/siyuan-canvas/untitled.assets')
    })
  })

  describe('openCanvasInTab', () => {
    it('returns false when siyuan-canvas plugin is not running in workspace', async () => {
      // 模拟 window.siyuan.ws.app.plugins 中没有 siyuan-canvas
      const origWindowSiyuan = (globalThis as any).window?.siyuan
      ;(globalThis as any).window = {
        siyuan: {
          ws: {
            app: {
              plugins: [],
            },
          },
        },
      }

      const result = await openCanvasInTab('/data/storage/petal/siyuan-canvas/test.canvas')
      expect(result).toBe(false)

      ;(globalThis as any).window.siyuan = origWindowSiyuan
    })

    it('opens canvas editor tab with keepCursor=true when siyuan-canvas plugin is active', async () => {
      const mockRemember = vi.fn()
      ;(globalThis as any).window = {
        siyuan: {
          ws: {
            app: {
              plugins: [
                {
                  name: 'siyuan-canvas',
                  rememberRecentCanvas: mockRemember,
                },
              ],
            },
          },
        },
      }

      const result = await openCanvasInTab('/data/storage/petal/siyuan-canvas/test.canvas', '测试画布')
      expect(result).toBe(true)
      expect(mockRemember).toHaveBeenCalledWith('/data/storage/petal/siyuan-canvas/test.canvas', '测试画布')
    })

    it('calls canvasPlugin.openCanvasTab directly when available', async () => {
      const mockOpenCanvasTab = vi.fn().mockResolvedValue(undefined)
      ;(globalThis as any).window = {
        siyuan: {
          ws: {
            app: {
              plugins: [
                {
                  name: 'siyuan-canvas',
                  openCanvasTab: mockOpenCanvasTab,
                },
              ],
            },
          },
        },
      }

      const result = await openCanvasInTab('/data/storage/petal/siyuan-canvas/test.canvas', '测试画布')
      expect(result).toBe(true)
      expect(mockOpenCanvasTab).toHaveBeenCalledWith({
        path: '/data/storage/petal/siyuan-canvas/test.canvas',
        title: '测试画布',
      })
    })
  })
})

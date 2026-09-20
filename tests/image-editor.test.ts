import { describe, expect, it } from 'vitest'
import {
  calculateAnnotationShapeSize,
  calculateDialogSize,
  calculateAnnotationTextTop,
  calculateTargetResolution,
  calculateCanvasExportBounds,
  getNonTransparentBoundingBox,
  exportEditorCanvasDataUrl,
  getEditorShortcutAction,
  resetCanvasObjects,
  resetHostViewport,
  lockHostScroll,
  unlockHostScroll,
  cleanTuiSvgArtifacts,
  removeTuiSvgArtifacts,
  captureAssetThumbnail,
} from '../src/utils/image-editor'
import { resolveImageEditorConstructor } from '../src/utils/tui-image-editor-bridge'

describe('image editor helpers', () => {
  it('calculates dialog size within viewport bounds', () => {
    expect(calculateDialogSize(200, 100, 1200, 900)).toEqual({
      width: 700,
      height: 500,
    })
    expect(calculateDialogSize(2000, 1600, 1200, 900)).toEqual({
      width: 1080,
      height: 810,
    })
  })

  it('calculates annotation shape sizes by shape and font size', () => {
    expect(calculateAnnotationShapeSize('circle', 20)).toBe(32)
    expect(calculateAnnotationShapeSize('rect', 30)).toBe(48)
    expect(calculateAnnotationShapeSize('triangle', 20)).toBe(36)
  })

  it('applies triangle text center compensation and font baseline compensation', () => {
    expect(calculateAnnotationTextTop('circle', 100, 32, 20)).toBe(101.6)
    expect(calculateAnnotationTextTop('triangle', 100, 36, 20)).toBe(107.6)
  })

  it('resolves image editor constructor from default interop shapes', () => {
    class ImageEditorMock {}

    expect(resolveImageEditorConstructor(ImageEditorMock)).toBe(ImageEditorMock)
    expect(resolveImageEditorConstructor({ default: ImageEditorMock })).toBe(ImageEditorMock)
    expect(resolveImageEditorConstructor({ default: { default: ImageEditorMock } })).toBe(ImageEditorMock)
  })

  describe('getEditorShortcutAction', () => {
    it('identifies Ctrl+Z or Cmd+Z as Undo', () => {
      expect(getEditorShortcutAction({ ctrlKey: true, key: 'z' })).toEqual({ isUndo: true, isRedo: false })
      expect(getEditorShortcutAction({ metaKey: true, key: 'Z' })).toEqual({ isUndo: true, isRedo: false })
    })

    it('identifies Ctrl+Shift+Z / Cmd+Shift+Z or Ctrl+Y / Cmd+Y as Redo', () => {
      expect(getEditorShortcutAction({ ctrlKey: true, shiftKey: true, key: 'z' })).toEqual({ isUndo: false, isRedo: true })
      expect(getEditorShortcutAction({ metaKey: true, key: 'y' })).toEqual({ isUndo: false, isRedo: true })
    })

    it('returns null for unrelated keys or non-modifier shortcuts', () => {
      expect(getEditorShortcutAction({ key: 'z' })).toBeNull()
      expect(getEditorShortcutAction({ ctrlKey: true, key: 'a' })).toBeNull()
      expect(getEditorShortcutAction({})).toBeNull()
    })
  })

  describe('calculateTargetResolution', () => {
    it('restores original resolution when image is enlarged without cropping', () => {
      const res = calculateTargetResolution(
        { width: 3000, height: 2000 },
        { width: 1500, height: 1000 },
        { width: 3000, height: 2000 }
      )
      expect(res).toEqual({ width: 1500, height: 1000 })
    })

    it('restores original resolution when image is shrunk without cropping', () => {
      const res = calculateTargetResolution(
        { width: 500, height: 500 },
        { width: 2000, height: 2000 },
        { width: 500, height: 500 }
      )
      expect(res).toEqual({ width: 2000, height: 2000 })
    })

    it('keeps original resolution when exported size matches original size', () => {
      const res = calculateTargetResolution(
        { width: 800, height: 600 },
        { width: 800, height: 600 }
      )
      expect(res).toEqual({ width: 800, height: 600 })
    })

    it('calculates physical resolution correctly when cropped while enlarged', () => {
      const res = calculateTargetResolution(
        { width: 800, height: 600 }, // 裁剪区域
        { width: 1000, height: 1000 }, // 原图大小
        { width: 2000, height: 2000 } // 放大 2 倍后的画布整体图片大小
      )
      expect(res).toEqual({ width: 400, height: 300 })
    })

    it('calculates physical resolution correctly when cropped while shrunk', () => {
      const res = calculateTargetResolution(
        { width: 200, height: 200 }, // 裁剪区域
        { width: 1000, height: 1000 }, // 原图大小
        { width: 500, height: 500 } // 缩小 0.5 倍后的画布整体图片大小
      )
      expect(res).toEqual({ width: 400, height: 400 })
    })
  })

  describe('calculateCanvasExportBounds', () => {
    it('returns exact bg rect and correct multiplier when annotations are within image bounds', () => {
      const bgRect = { left: 100, top: 100, width: 500, height: 400 }
      const objectBounds = [
        { left: 150, top: 150, width: 50, height: 50 },
        { left: 200, top: 200, width: 100, height: 100 },
      ]
      const originalSize = { width: 1000, height: 800 }

      const bounds = calculateCanvasExportBounds(bgRect, objectBounds, originalSize)
      expect(bounds).toEqual({
        left: 100,
        top: 100,
        width: 500,
        height: 400,
        multiplier: 2, // 1 / 0.5 = 2
      })
    })

    it('expands export bounds when drawing lines extend outside original image', () => {
      const bgRect = { left: 100, top: 100, width: 500, height: 400 }
      const objectBounds = [
        { left: 50, top: 80, width: 100, height: 100 }, // 超出左侧 50，上方 20
      ]
      const originalSize = { width: 1000, height: 800 }

      const bounds = calculateCanvasExportBounds(bgRect, objectBounds, originalSize)
      expect(bounds).toEqual({
        left: 50,
        top: 80,
        width: 550, // (100+500) - 50 = 550
        height: 420, // (100+400) - 80 = 420
        multiplier: 2,
      })
    })
  })

  describe('getNonTransparentBoundingBox', () => {
    it('detects precise bounding box from canvas ImageData', () => {
      const mockCtx = {
        getImageData: (_x: number, _y: number, w: number, h: number) => {
          const data = new Uint8ClampedArray(w * h * 4)
          // 设置 (10, 10) 到 (19, 19) 为非透明像素
          for (let y = 10; y <= 19; y++) {
            for (let x = 10; x <= 19; x++) {
              const idx = (y * w + x) * 4
              data[idx + 3] = 255
            }
          }
          return { data }
        },
      } as any

      const box = getNonTransparentBoundingBox(mockCtx, 100, 100)
      expect(box).toEqual({
        left: 10,
        top: 10,
        width: 10,
        height: 10,
      })
    })
  })

  describe('exportEditorCanvasDataUrl', () => {
    it('filters out unapplied cropzone objects when exporting canvas', () => {
      const bgImage = { left: 0, top: 0, width: 800, height: 600, scaleX: 1, scaleY: 1 }
      const cropzoneObj = {
        type: 'cropzone',
        left: 50,
        top: 50,
        width: 200,
        height: 200,
        getBoundingRect: () => ({ left: 50, top: 50, width: 200, height: 200 }),
      }
      let passedOptions: any = null

      const mockEditorInstance = {
        _graphics: {
          getCanvas: () => ({
            backgroundImage: bgImage,
            getObjects: () => [bgImage, cropzoneObj],
            toDataURL: (opts: any) => {
              passedOptions = opts
              return 'data:image/png;base64,mock'
            },
          }),
        },
      }

      const res = exportEditorCanvasDataUrl(mockEditorInstance, { width: 800, height: 600 })
      expect(res).toBe('data:image/png;base64,mock')
      expect(passedOptions).toEqual({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        multiplier: 1,
        format: 'png',
        quality: 1,
      })
    })
  })

  describe('resetCanvasObjects', () => {
    it('removes all vector objects while keeping background image and cropzone', () => {
      const bgImage = { type: 'image' }
      const cropzone = { type: 'cropzone' }
      const rectObj = { type: 'rect' }
      const textObj = { type: 'i-text' }

      let activeDiscarded = false
      let rendered = false
      const objects = [bgImage, cropzone, rectObj, textObj]
      const removed: any[] = []

      const mockCanvas = {
        backgroundImage: bgImage,
        getObjects: () => objects.slice(),
        remove: (obj: any) => {
          removed.push(obj)
          const idx = objects.indexOf(obj)
          if (idx !== -1) objects.splice(idx, 1)
        },
        discardActiveObject: () => {
          activeDiscarded = true
        },
        renderAll: () => {
          rendered = true
        },
      }

      const count = resetCanvasObjects(mockCanvas)
      expect(count).toBe(2)
      expect(removed).toEqual([rectObj, textObj])
      expect(objects).toEqual([bgImage, cropzone])
      expect(activeDiscarded).toBe(true)
      expect(rendered).toBe(true)
    })
  })

  describe('resetHostViewport', () => {
    it('resets document.body and document.documentElement scrollTop and scrollLeft', () => {
      document.body.scrollTop = 180
      document.body.scrollLeft = 50
      document.documentElement.scrollTop = 120
      document.documentElement.scrollLeft = 30
      let scrolledTo: [number, number] | null = null
      const originalScrollTo = window.scrollTo
      window.scrollTo = (x: number, y: number) => {
        scrolledTo = [x, y]
      }

      try {
        resetHostViewport()
        expect(document.body.scrollTop).toBe(0)
        expect(document.body.scrollLeft).toBe(0)
        expect(document.documentElement.scrollTop).toBe(0)
        expect(document.documentElement.scrollLeft).toBe(0)
        expect(scrolledTo).toEqual([0, 0])
      } finally {
        window.scrollTo = originalScrollTo
      }
    })

    it('handles environments safely when scroll properties are zero', () => {
      document.body.scrollTop = 0
      document.documentElement.scrollTop = 0
      expect(() => resetHostViewport()).not.toThrow()
    })
  })

  describe('lockHostScroll and unlockHostScroll', () => {
    it('locks body and html overflow to hidden and restores original overflow upon unlock', () => {
      document.body.style.overflow = 'auto'
      document.documentElement.style.overflow = 'visible'

      lockHostScroll()
      expect(document.body.style.overflow).toBe('hidden')
      expect(document.documentElement.style.overflow).toBe('hidden')

      unlockHostScroll()
      expect(document.body.style.overflow).toBe('auto')
      expect(document.documentElement.style.overflow).toBe('visible')
    })

    it('supports nested lock and unlock calls safely', () => {
      document.body.style.overflow = 'scroll'

      lockHostScroll()
      lockHostScroll()
      expect(document.body.style.overflow).toBe('hidden')

      unlockHostScroll()
      // 仍然有一次 lock 未释放
      expect(document.body.style.overflow).toBe('hidden')

      unlockHostScroll()
      // 全部释放，恢复原样
      expect(document.body.style.overflow).toBe('scroll')
    })
  })

  describe('cleanTuiSvgArtifacts and removeTuiSvgArtifacts', () => {
    it('isolates injected TUI SVG to out-of-flow zero dimensions', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('display', 'none')
      const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
      defs.id = 'tui-image-editor-svg-default-icons'
      svg.appendChild(defs)
      document.body.appendChild(svg)

      try {
        cleanTuiSvgArtifacts()
        expect(svg.style.position).toBe('absolute')
        expect(svg.style.width).toBe('0px')
        expect(svg.style.height).toBe('0px')
      } finally {
        removeTuiSvgArtifacts()
        expect(document.getElementById('tui-image-editor-svg-default-icons')).toBeNull()
      }
    })
  })

  describe('captureAssetThumbnail', () => {
    it('returns undefined for empty input gracefully', async () => {
      const res = await captureAssetThumbnail('')
      expect(res).toBeUndefined()
    })

    it('returns undefined when image load fails gracefully without throwing', async () => {
      const res = await captureAssetThumbnail('http://invalid-url-that-does-not-exist.local/img.png')
      expect(res).toBeUndefined()
    })
  })
})




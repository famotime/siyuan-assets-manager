export type AnnotationShape = 'circle' | 'rect' | 'triangle'

export function calculateDialogSize(
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): { width: number, height: number } {
  const targetW = imageWidth + 60
  const targetH = imageHeight + 250

  return {
    width: Math.max(700, Math.min(targetW, viewportWidth * 0.9)),
    height: Math.max(500, Math.min(targetH, viewportHeight * 0.9)),
  }
}

export function calculateAnnotationShapeSize(shape: AnnotationShape, fontSize: number): number {
  const baseSize = shape === 'triangle' ? 36 : 32
  return baseSize * (fontSize / 20)
}

export function calculateAnnotationTextTop(
  shape: AnnotationShape,
  y: number,
  shapeSize: number,
  fontSize: number,
): number {
  const shapeAdjustedY = shape === 'triangle'
    ? y + shapeSize / 6
    : y

  return shapeAdjustedY + fontSize * 0.08
}

import { warn } from './logger'

export interface ImageSize {
  width: number
  height: number
}

export function calculateTargetResolution(
  exportSize: ImageSize,
  originalSize: ImageSize,
  currentImageSize?: ImageSize | null,
): ImageSize {
  const { width: exportWidth, height: exportHeight } = exportSize
  const { width: originalWidth, height: originalHeight } = originalSize

  if (originalWidth <= 0 || originalHeight <= 0 || exportWidth <= 0 || exportHeight <= 0) {
    return { width: exportWidth, height: exportHeight }
  }

  // 1. 如果导出尺寸与原始尺寸完全一致
  if (exportWidth === originalWidth && exportHeight === originalHeight) {
    return { width: originalWidth, height: originalHeight }
  }

  // 2. 如果存在 currentImageSize，优先判断是否发生了 Crop 裁剪
  if (currentImageSize && currentImageSize.width > 0 && currentImageSize.height > 0) {
    const isFullImage =
      Math.abs(exportWidth - currentImageSize.width) < 2 &&
      Math.abs(exportHeight - currentImageSize.height) < 2

    if (isFullImage) {
      // 未被裁剪（或全图裁剪）：不管在编辑器里被 Resize 放大还是缩小，始终还原为原始分辨率
      return { width: originalWidth, height: originalHeight }
    }

    // 已被裁剪：根据当前主图的缩放比例推算原始物理刻度的分辨率
    const scale = currentImageSize.width / originalWidth
    if (scale > 0) {
      const targetWidth = Math.max(1, Math.round(exportWidth / scale))
      const targetHeight = Math.max(1, Math.round(exportHeight / scale))
      return { width: targetWidth, height: targetHeight }
    }
  }

  // 3. 保底判断（无 currentImageSize 时）：检查宽高比是否一致
  const exportAspect = exportWidth / exportHeight
  const originalAspect = originalWidth / originalHeight
  const isSameAspectRatio = Math.abs(exportAspect - originalAspect) < 0.01

  if (isSameAspectRatio) {
    return { width: originalWidth, height: originalHeight }
  }

  // 4. 保底情况
  return { width: exportWidth, height: exportHeight }
}

export async function adjustDataUrlResolution(
  dataUrl: string,
  originalSize: ImageSize,
  currentImageSize?: ImageSize | null,
): Promise<string> {
  if (!dataUrl || !originalSize || originalSize.width <= 0 || originalSize.height <= 0) {
    return dataUrl
  }

  return new Promise((resolve) => {
    let resolved = false
    const done = (result: string) => {
      if (!resolved) {
        resolved = true
        resolve(result)
      }
    }

    // 设置 2 秒保底超时，防止 HTMLImageElement onload 卡住阻断保存
    const timer = setTimeout(() => {
      warn("adjustDataUrlResolution timed out, fallback to raw dataUrl")
      done(dataUrl)
    }, 2000)

    const img = new Image()
    img.onload = () => {
      clearTimeout(timer)
      try {
        const exportSize = { width: img.width, height: img.height }
        const targetSize = calculateTargetResolution(exportSize, originalSize, currentImageSize)

        if (targetSize.width === exportSize.width && targetSize.height === exportSize.height) {
          done(dataUrl)
          return
        }

        const canvas = document.createElement('canvas')
        canvas.width = targetSize.width
        canvas.height = targetSize.height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          done(dataUrl)
          return
        }
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, 0, 0, targetSize.width, targetSize.height)

        const mimeMatch = dataUrl.match(/^data:(image\/[a-zA-Z+-]+);/)
        const mimeType = mimeMatch ? mimeMatch[1] : 'image/png'
        const resDataUrl = canvas.toDataURL(mimeType, 0.92)
        done(resDataUrl)
      } catch (e) {
        done(dataUrl)
      }
    }
    img.onerror = () => {
      clearTimeout(timer)
      done(dataUrl)
    }
    img.src = dataUrl
  })
}

export interface CanvasExportBounds {
  left: number
  top: number
  width: number
  height: number
  multiplier: number
}

export interface BoundingBox {
  left: number
  top: number
  width: number
  height: number
}

/**
 * 根据背景图矩形、标注对象矩形列表及原图物理尺寸，计算精准 100% 原始比例导出的包围盒与倍率
 */
export function calculateCanvasExportBounds(
  bgRect: BoundingBox,
  objectBounds: BoundingBox[],
  originalSize: ImageSize,
): CanvasExportBounds {
  let minLeft = bgRect.left
  let minTop = bgRect.top
  let maxRight = bgRect.left + bgRect.width
  let maxBottom = bgRect.top + bgRect.height

  for (const obj of objectBounds) {
    if (obj.width <= 0 || obj.height <= 0) continue
    minLeft = Math.min(minLeft, obj.left)
    minTop = Math.min(minTop, obj.top)
    maxRight = Math.max(maxRight, obj.left + obj.width)
    maxBottom = Math.max(maxBottom, obj.top + obj.height)
  }

  const exportLeft = minLeft
  const exportTop = minTop
  const exportWidth = maxRight - minLeft
  const exportHeight = maxBottom - minTop

  const scale = originalSize.width > 0 ? bgRect.width / originalSize.width : 1
  const multiplier = scale > 0 ? 1 / scale : 1

  return {
    left: exportLeft,
    top: exportTop,
    width: exportWidth,
    height: exportHeight,
    multiplier,
  }
}

/**
 * 直接从 TUI Image Editor / Fabric Canvas 按 100% 原始比例且无空白背景导出 DataURL
 */
export function exportEditorCanvasDataUrl(
  editorInstance: any,
  originalSize: ImageSize,
): string | null {
  if (!editorInstance) return null

  try {
    const graphics = editorInstance._graphics
    const fabricCanvas = graphics?.getCanvas ? graphics.getCanvas() : null

    if (fabricCanvas && typeof fabricCanvas.toDataURL === 'function') {
      const bgImage =
        fabricCanvas.backgroundImage ||
        (fabricCanvas.getObjects ? fabricCanvas.getObjects().find((obj: any) => obj.type === 'image') : null)

      let bgRect: BoundingBox
      if (bgImage) {
        const scaleX = bgImage.scaleX || 1
        const scaleY = bgImage.scaleY || 1
        bgRect = {
          left: bgImage.left || 0,
          top: bgImage.top || 0,
          width: (bgImage.width || 0) * scaleX,
          height: (bgImage.height || 0) * scaleY,
        }
      } else {
        bgRect = {
          left: 0,
          top: 0,
          width: fabricCanvas.getWidth ? fabricCanvas.getWidth() : 0,
          height: fabricCanvas.getHeight ? fabricCanvas.getHeight() : 0,
        }
      }

      const allObjects = fabricCanvas.getObjects ? fabricCanvas.getObjects() : []
      const annotationObjects = allObjects.filter((obj: any) => obj !== bgImage && obj?.type !== 'cropzone')
      const objectBounds: BoundingBox[] = annotationObjects.map((obj: any) => {
        if (typeof obj.getBoundingRect === 'function') {
          return obj.getBoundingRect(true, true)
        }
        return {
          left: obj.left || 0,
          top: obj.top || 0,
          width: obj.width || 0,
          height: obj.height || 0,
        }
      })

      const bounds = calculateCanvasExportBounds(bgRect, objectBounds, originalSize)

      return fabricCanvas.toDataURL({
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
        multiplier: bounds.multiplier,
        format: 'png',
        quality: 1,
      })
    }
  } catch (e) {
    warn('exportEditorCanvasDataUrl via Fabric failed, fallback to raw toDataURL', e)
  }

  return null
}

export interface PixelBoundingBox {
  left: number
  top: number
  width: number
  height: number
}

/**
 * 通过 ImageData 扫描透明像素（Alpha <= alphaThreshold），精准切除多余空白背景
 */
export function getNonTransparentBoundingBox(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  alphaThreshold: number = 10,
): PixelBoundingBox | null {
  const imgData = ctx.getImageData(0, 0, width, height)
  const data = imgData.data

  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3]
      if (alpha > alphaThreshold) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return null
  }

  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  }
}

/**
 * 像素级裁剪多余透明像素，并按 100% 原始比例还原重采样
 */
export async function trimAndScaleDataUrl(
  dataUrl: string,
  originalSize: ImageSize,
): Promise<string> {
  if (!dataUrl || !originalSize || originalSize.width <= 0 || originalSize.height <= 0) {
    return dataUrl
  }

  return new Promise((resolve) => {
    let resolved = false
    const done = (result: string) => {
      if (!resolved) {
        resolved = true
        resolve(result)
      }
    }

    const timer = setTimeout(() => {
      warn('trimAndScaleDataUrl timed out, fallback to raw dataUrl')
      done(dataUrl)
    }, 3000)

    const img = new Image()
    img.onload = () => {
      clearTimeout(timer)
      try {
        const srcW = img.width
        const srcH = img.height

        const tempCanvas = document.createElement('canvas')
        tempCanvas.width = srcW
        tempCanvas.height = srcH
        const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true })
        if (!tempCtx) {
          done(dataUrl)
          return
        }

        tempCtx.drawImage(img, 0, 0)
        const contentBox = getNonTransparentBoundingBox(tempCtx, srcW, srcH)

        // 如果全透明或者无法找到有效边界，直接返回原始 dataUrl
        if (!contentBox || contentBox.width <= 0 || contentBox.height <= 0) {
          done(dataUrl)
          return
        }

        // 计算目标保存物理尺寸
        const { width: origW, height: origH } = originalSize
        const contentAspect = contentBox.width / contentBox.height
        const origAspect = origW / origH

        let targetW: number
        let targetH: number

        // 检查长宽比是否与原图一致（允许微小误差）
        if (Math.abs(contentAspect - origAspect) < 0.02) {
          // 未改变长宽比（未裁剪且未超出）：直接还原为 100% 原始分辨率
          targetW = origW
          targetH = origH
        } else {
          // 发生了裁剪或线条向外延伸：计算在原图刻度下的放缩倍率
          const scale = contentBox.width / origW
          if (scale > 0) {
            targetW = Math.max(1, Math.round(contentBox.width / scale))
            targetH = Math.max(1, Math.round(contentBox.height / scale))
          } else {
            targetW = contentBox.width
            targetH = contentBox.height
          }
        }

        // 创建最终精细裁剪并重采样放缩的离屏 Canvas
        const outCanvas = document.createElement('canvas')
        outCanvas.width = targetW
        outCanvas.height = targetH
        const outCtx = outCanvas.getContext('2d')
        if (!outCtx) {
          done(dataUrl)
          return
        }

        outCtx.imageSmoothingEnabled = true
        outCtx.imageSmoothingQuality = 'high'

        // 核心：精准切除外围透明像素，只绘制 contentBox 内容，放缩至 targetW x targetH
        outCtx.drawImage(
          img,
          contentBox.left,
          contentBox.top,
          contentBox.width,
          contentBox.height,
          0,
          0,
          targetW,
          targetH,
        )

        const mimeMatch = dataUrl.match(/^data:(image\/[a-zA-Z+-]+);/)
        const mimeType = mimeMatch ? mimeMatch[1] : 'image/png'
        const resDataUrl = outCanvas.toDataURL(mimeType, 0.92)
        done(resDataUrl)
      } catch (e) {
        warn('trimAndScaleDataUrl failed, fallback to raw dataUrl', e)
        done(dataUrl)
      }
    }

    img.onerror = () => {
      clearTimeout(timer)
      done(dataUrl)
    }

    img.src = dataUrl
  })
}


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

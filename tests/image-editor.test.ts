import { describe, expect, it } from 'vitest'
import {
  calculateAnnotationShapeSize,
  calculateDialogSize,
  calculateAnnotationTextTop,
} from '../src/utils/image-editor'

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
})

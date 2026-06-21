import { describe, expect, it } from 'vitest'
import {
  extractAssetNamesFromMarkdown,
  removeAssetFromMarkdown,
  replaceAssetInMarkdown,
} from '../src/utils/asset-markdown'

describe('asset markdown helpers', () => {
  it('extracts unique asset names from markdown references', () => {
    const markdown = [
      '![one](assets/a.png)',
      '[download](assets/docs/report.pdf)',
      'plain assets/a.png',
      '![query](assets/photo.jpg?x=1)',
      '![special](assets/a+b(1).png)',
    ].join('\n')

    expect(extractAssetNamesFromMarkdown(markdown)).toEqual([
      'a.png',
      'docs/report.pdf',
      'photo.jpg',
      'a+b(1).png',
    ])
  })

  it('replaces asset names that contain regexp special characters', () => {
    const markdown = '![img](assets/a+b(1).png) and assets/a+b(1).png'

    expect(replaceAssetInMarkdown(markdown, 'a+b(1).png', 'renamed.png')).toBe(
      '![img](assets/renamed.png) and assets/renamed.png',
    )
  })

  it('removes image, link, and plain path references for an asset', () => {
    const markdown = [
      'before ![alt](assets/a+b(1).png){width="10"} after',
      '[file](assets/a+b(1).png)',
      'plain assets/a+b(1).png',
    ].join('\n')

    expect(removeAssetFromMarkdown(markdown, 'a+b(1).png')).toBe([
      'before  after',
      '',
      'plain ',
    ].join('\n'))
  })
})

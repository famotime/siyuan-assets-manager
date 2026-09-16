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
      '![with-title](assets/titled.png "image title")',
      '![with-single-title](assets/single.png \'single title\')',
      '![encoded](assets/%E6%B5%8B%E8%AF%95%E5%9B%BE%E7%89%87.png)',
    ].join('\n')

    expect(extractAssetNamesFromMarkdown(markdown)).toEqual([
      'a.png',
      'docs/report.pdf',
      'photo.jpg',
      'a+b(1).png',
      'titled.png',
      'single.png',
      '%E6%B5%8B%E8%AF%95%E5%9B%BE%E7%89%87.png',
      '测试图片.png',
    ])
  })

  it('extracts references whose closing paren is not followed by whitespace', () => {
    expect(extractAssetNamesFromMarkdown('这是![截图](assets/inline.png)说明文字')).toEqual(['inline.png'])
    expect(extractAssetNamesFromMarkdown('![img](assets/period.png)。')).toEqual(['period.png'])
    expect(extractAssetNamesFromMarkdown('![img](assets/bold.png)**加粗**')).toEqual(['bold.png'])
    expect(extractAssetNamesFromMarkdown('![img](assets/comma.png),接着是文字')).toEqual(['comma.png'])
  })

  it('extracts every reference when images are adjacent without a separator', () => {
    expect(extractAssetNamesFromMarkdown('![a](assets/first.png)![b](assets/second.png)')).toEqual([
      'first.png',
      'second.png',
    ])
  })

  it('extracts the image that is wrapped in a link', () => {
    expect(extractAssetNamesFromMarkdown('[![a](assets/wrapped.png)](https://example.com)')).toEqual([
      'wrapped.png',
    ])
  })

  it('keeps bracketed file names that are followed by text', () => {
    expect(extractAssetNamesFromMarkdown('![img](assets/%E5%B1%8F%E5%B9%95(1).png)后面')).toEqual([
      '%E5%B1%8F%E5%B9%95(1).png',
      '屏幕(1).png',
    ])
  })

  it('replaces encoded and decoded asset names gracefully', () => {
    const markdown = '![img](assets/%E6%B5%8B%E8%AF%95.png) and ![plain](assets/测试.png)'
    expect(replaceAssetInMarkdown(markdown, '测试.png', 'new.png')).toBe(
      '![img](assets/new.png) and ![plain](assets/new.png)',
    )
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

import { describe, expect, it } from 'vitest'
import {
  countAssetOccurrences,
  extractAssetNamesFromMarkdown,
  removeAssetFromMarkdown,
  replaceAssetInMarkdown,
  replaceAssetInMarkdownLimited,
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

  it('extracts quoted attribute paths whose names contain apostrophes or brackets', () => {
    expect(extractAssetNamesFromMarkdown('<img src="assets/it\'s.png" />')).toEqual(["it's.png"])
    expect(extractAssetNamesFromMarkdown('<video src="assets/take[1].mp4"></video>')).toEqual([
      'take[1].mp4',
    ])
    expect(extractAssetNamesFromMarkdown("<audio src='assets/clip.mp3'></audio>")).toEqual([
      'clip.mp3',
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

  it('removes the whole HTML element that embeds the asset via src', () => {
    expect(
      removeAssetFromMarkdown('<video controls="controls" src="assets/movie.mp4"></video>', 'movie.mp4'),
    ).toBe('')
    expect(
      removeAssetFromMarkdown('<audio controls="controls" src="assets/song.mp3"></audio>', 'song.mp3'),
    ).toBe('')
    expect(removeAssetFromMarkdown('<img src="assets/pic.png" />', 'pic.png')).toBe('')
  })

  it('keeps the element when only data-src points at the removed asset', () => {
    // data-src 只是思源记录的原始文件名，删掉它不应该连整个播放器一起移除
    const markdown = '<video src="assets/movie.mp4" data-src="assets/orig.mp4"></video>'
    expect(removeAssetFromMarkdown(markdown, 'orig.mp4')).toBe(
      '<video src="assets/movie.mp4" data-src=""></video>',
    )
  })

  it('does not replace assets whose names merely start with the target as a prefix', () => {
    const markdown = '![img](assets/pic.png) and ![bak](assets/pic.png.bak) and assets/pic.png_thumb.jpg'
    expect(replaceAssetInMarkdown(markdown, 'pic.png', 'new_pic.png')).toBe(
      '![img](assets/new_pic.png) and ![bak](assets/pic.png.bak) and assets/pic.png_thumb.jpg',
    )
  })

  it('removes paired HTML elements even when they contain fallback text or multiline content', () => {
    const markdown = [
      '<video controls="controls" src="assets/movie.mp4">您的浏览器不支持播放该视频</video>',
      '<video controls src="assets/movie.mp4">',
      '  <span>不支持视频</span>',
      '</video>',
    ].join('\n')

    expect(removeAssetFromMarkdown(markdown, 'movie.mp4').trim()).toBe('')
  })

  it('extracts parent PDF asset name from PDF annotation references', () => {
    const markdown = [
      '<span data-type="file-annotation-ref" data-id="assets/my-guide.pdf/20240101000000-abcdefg">标注文本</span>',
      '<<assets/manual.pdf/20240101000001-bcdefgh "annotation">>',
      '<span data-type="file-annotation-ref" data-id="assets/with_params.pdf/20240101000002-cdefghi?box=2021">锚点</span>',
    ].join('\n')

    expect(extractAssetNamesFromMarkdown(markdown)).toEqual([
      'my-guide.pdf',
      'with_params.pdf',
      'manual.pdf',
    ])
  })

  it('extracts title image and CSS url references with or without quotes and with HTML entities', () => {
    const markdown = [
      'title-img="background-image: url(&quot;assets/cover_img.png&quot;)"',
      'style="background-image: url(assets/cover_noquote.jpg)"',
      'style="background-image: url(\'/data/assets/cover_data.png\')"',
    ].join('\n')

    expect(extractAssetNamesFromMarkdown(markdown)).toEqual([
      'cover_img.png',
      'cover_noquote.jpg',
      'cover_data.png',
    ])
  })

  it('replaces PDF asset name in annotation references while keeping the annotation id subpath', () => {
    const markdown = '<span data-type="file-annotation-ref" data-id="assets/old_book.pdf/20240101-123456">批注</span>'
    expect(replaceAssetInMarkdown(markdown, 'old_book.pdf', 'new_book.pdf')).toBe(
      '<span data-type="file-annotation-ref" data-id="assets/new_book.pdf/20240101-123456">批注</span>',
    )
  })

  it('counts occurrences with the same reference semantics as replacement', () => {
    const markdown = '![a](assets/keep.png) 文字 ![b](assets/keep.png)'
    expect(countAssetOccurrences(markdown, 'keep.png')).toBe(2)
    // 前缀相同但不同文件不计入
    expect(countAssetOccurrences('![c](assets/keep.png.bak)', 'keep.png')).toBe(0)
    expect(countAssetOccurrences('', 'keep.png')).toBe(0)
  })

  it('counts URI encoded occurrences for non-ascii asset names', () => {
    const name = '图片 一.png'
    const markdown = `![a](assets/${encodeURIComponent(name)}) ![b](assets/${name})`
    expect(countAssetOccurrences(markdown, name)).toBe(2)
  })

  it('replaces at most the requested number of occurrences', () => {
    const markdown = '![a](assets/keep.png) ![b](assets/keep.png) ![c](assets/keep.png)'
    expect(replaceAssetInMarkdownLimited(markdown, 'keep.png', 'dup.png', 2)).toBe(
      '![a](assets/dup.png) ![b](assets/dup.png) ![c](assets/keep.png)',
    )
    // limit 为 0 或负数时不改动
    expect(replaceAssetInMarkdownLimited(markdown, 'keep.png', 'dup.png', 0)).toBe(markdown)
    // limit 超过实际出现次数时全部替换
    expect(replaceAssetInMarkdownLimited(markdown, 'keep.png', 'dup.png', 99)).toBe(
      '![a](assets/dup.png) ![b](assets/dup.png) ![c](assets/dup.png)',
    )
  })

  it('limits replacement across both raw and URI encoded forms', () => {
    const name = '图片 一.png'
    const markdown = `![a](assets/${encodeURIComponent(name)}) ![b](assets/${name})`
    // 与正向替换一致：先处理 URI 编码形态，再处理原始名形态，总量受 limit 约束
    expect(replaceAssetInMarkdownLimited(markdown, name, 'dup.png', 1)).toBe(
      `![a](assets/dup.png) ![b](assets/${name})`,
    )
  })
})

import { describe, expect, it } from 'vitest';
import { markdownExcerpt } from '../src/utils/asset-markdown';

describe('markdownExcerpt 引用块展示摘要', () => {
  it('提取链接文字并丢弃图片语法', () => {
    expect(markdownExcerpt('![截图](assets/a.png) 以及 [手册](assets/b.pdf) 的说明')).toBe(
      '以及 手册 的说明',
    );
  });

  it('剥离 HTML 标签与多余空白', () => {
    expect(markdownExcerpt('<div data-type="NodeAttributeView" data-av-id="x"></div>')).toBe('');
    expect(markdownExcerpt('<b>加粗</b>   文本')).toBe('加粗 文本');
  });

  it('超长文本截断并加省略号', () => {
    const text = 'x'.repeat(100);
    const excerpt = markdownExcerpt(text, 80);
    expect(excerpt.length).toBe(81);
    expect(excerpt.endsWith('…')).toBe(true);
  });

  it('空输入返回空串', () => {
    expect(markdownExcerpt('')).toBe('');
  });
});

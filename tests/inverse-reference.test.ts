import { describe, expect, it } from 'vitest';
import { restoreAssetReference } from '../src/utils/inverse-reference';

const restore = (params: {
  current: string;
  original?: string;
  redundantName?: string;
  canonicalName?: string;
}) =>
  restoreAssetReference({
    current: params.current,
    original: params.original,
    redundantName: params.redundantName ?? 'dup.png',
    canonicalName: params.canonicalName ?? 'keep.png',
  });

describe('inverse-reference unit tests', () => {
  it('合并后未被编辑的值按原始快照整段精确还原（零误伤块内同名引用）', () => {
    // 合并前：本块既有主图引用，又有冗余图引用
    const original = '![a](assets/keep.png) ![b](assets/dup.png)';
    // 合并后：两处都变成 keep.png
    const current = '![a](assets/keep.png) ![b](assets/keep.png)';

    const result = restore({ current, original });

    expect(result.mode).toBe('exact');
    // 精确还原：原有的 keep 引用保持不变，只把冗余图那处改回来
    expect(result.text).toBe(original);
  });

  it('值被改动过时按快照中的出现处数限量替换并标记近似', () => {
    const original = '![b](assets/dup.png)';
    // 用户合并后又加了一张主图
    const current = '![b](assets/keep.png) 用户新增 ![a](assets/keep.png)';

    const result = restore({ current, original });

    expect(result.mode).toBe('approximate');
    // 只改回 1 处（快照中 dup.png 出现 1 次），不误伤用户新增的那处
    expect(result.text).toBe('![b](assets/dup.png) 用户新增 ![a](assets/keep.png)');
  });

  it('同组多个冗余图按任意顺序回退都能得到正确终态', () => {
    // 合并前：dup1 + dup2
    const dup1Original = '![1](assets/dup1.png) ![2](assets/dup2.png)';
    // dup1 合并后（都变成 keep.png），这也是 dup2 回退时看到的快照
    const afterDup1 = '![1](assets/keep.png) ![2](assets/keep.png)';
    const dup2Snapshot = '![1](assets/keep.png) ![2](assets/dup2.png)';

    // 先回退 dup1
    const step1 = restoreAssetReference({
      current: afterDup1,
      original: dup1Original,
      redundantName: 'dup1.png',
      canonicalName: 'keep.png',
    });
    expect(step1.mode).toBe('approximate');
    expect(step1.text).toBe('![1](assets/dup1.png) ![2](assets/keep.png)');

    // 再回退 dup2
    const step2 = restoreAssetReference({
      current: step1.text,
      original: dup2Snapshot,
      redundantName: 'dup2.png',
      canonicalName: 'keep.png',
    });
    expect(step2.mode).toBe('approximate');
    expect(step2.text).toBe(dup1Original);
  });

  it('当前值已不含主图引用时安全跳过', () => {
    const result = restore({ current: '用户已换成 ![x](assets/other.png)', original: '![b](assets/dup.png)' });
    expect(result.mode).toBe('skip');
    expect(result.text).toBe('用户已换成 ![x](assets/other.png)');
  });

  it('原始快照中没有该冗余图时不改动（避免把别的引用改错）', () => {
    const result = restore({ current: '![a](assets/keep.png)', original: '![a](assets/keep.png)' });
    expect(result.mode).toBe('skip');
    expect(result.text).toBe('![a](assets/keep.png)');
  });

  it('旧日志缺少快照时退回按名全局替换并如实标记近似', () => {
    const current = '![a](assets/keep.png)';
    const result = restore({ current });
    expect(result.mode).toBe('approximate');
    expect(result.text).toBe('![a](assets/dup.png)');
  });

  it('支持 URI 编码形态的还原（原始快照为编码形态，合并后为主图原始形态）', () => {
    const redundant = '图片 一.png';
    const canonical = 'keep 图.png';
    const original = `![a](assets/${encodeURIComponent(redundant)})`;
    // 正向合并后的形态：主图以原始名写入
    const current = `![a](assets/${canonical})`;

    const result = restoreAssetReference({ current, original, redundantName: redundant, canonicalName: canonical });

    expect(result.mode).toBe('exact');
    expect(result.text).toBe(original);
  });
});

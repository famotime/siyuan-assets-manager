import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../src/api', () => {
  const sql = vi.fn(async () => []);
  return {
    sql,
    sqlGuarded: sql,
    readDir: vi.fn(async () => []),
    readDirGuarded: vi.fn(async () => []),
    pushMsg: vi.fn(),
  };
});

import { sqlGuarded } from '../src/api';
import { batchQueryAssetsReferenceCounts, BATCH_VERIFY_CHUNK } from '../src/utils/siyuan-block';

const sqlMock = vi.mocked(sqlGuarded);

describe('batchQueryAssetsReferenceCounts 清理前批量核查', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('精确匹配候选名，LIKE 子串误匹配被提取过滤', async () => {
    // 候选 a.png；查询粗匹配到 a.png.backup 的块，但提取出的名字不含 a.png
    sqlMock.mockResolvedValue([
      {
        id: 'blk-1',
        markdown: '![b](assets/a.png.backup)',
        ial: '',
      },
      {
        id: 'blk-2',
        markdown: '![a](assets/a.png)',
        ial: '',
      },
    ] as any)

    const counts = await batchQueryAssetsReferenceCounts(['a.png'])
    expect(counts.get('a.png')).toBe(1)

    const stmt = String(sqlMock.mock.calls[0][0])
    expect(stmt).toContain("markdown LIKE '%assets/a.png%'")
    expect(stmt).toContain("ial LIKE '%assets/a.png%'")
  })

  it('URI 编码形态的引用计入原始名', async () => {
    sqlMock.mockResolvedValue([
      { id: 'blk-1', markdown: '![x](assets/%E4%B8%AD%E6%96%87.png)', ial: '' },
    ] as any)

    const counts = await batchQueryAssetsReferenceCounts(['中文.png'])
    expect(counts.get('中文.png')).toBe(1)
  })

  it('候选超过单批数量时分批查询', async () => {
    sqlMock.mockResolvedValue([] as any)
    const names = Array.from({ length: BATCH_VERIFY_CHUNK * 2 + 3 }, (_, i) => `f${i}.png`)
    await batchQueryAssetsReferenceCounts(names)
    expect(sqlMock).toHaveBeenCalledTimes(3)
  })

  it('查询失败直接上抛（清理前置核查不容许静默放行）', async () => {
    sqlMock.mockRejectedValue(new Error('kernel timeout'))
    await expect(batchQueryAssetsReferenceCounts(['a.png'])).rejects.toThrow('kernel timeout')
  })
})

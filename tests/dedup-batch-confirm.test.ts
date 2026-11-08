import { describe, expect, it } from 'vitest';
import type { AssetInfo } from '../src/utils/asset-model';
import { buildBatchMergeConfirmMessage, type IDuplicateGroup } from '../src/utils/deduplicate';

function makeAsset(name: string, refs: Array<{ root_id: string }>): AssetInfo {
  return {
    name,
    size: 100,
    updated: 1,
    isDir: false,
    references: refs.map((r, i) => ({
      id: `blk-${name}-${i}`,
      root_id: r.root_id,
      box: 'box',
      content: 'c',
      markdown: 'm',
      path: '/p.md',
    })),
    refCount: refs.length,
    docCount: 0,
  } as AssetInfo
}

function makeGroup(canonical: string, redundant: AssetInfo[]): IDuplicateGroup {
  return {
    id: `grp-${canonical}`,
    mode: 'exact',
    similarity: 1,
    canonicalAssetName: canonical,
    items: [
      { asset: makeAsset(canonical, [{ root_id: 'root-canonical' }]) } as any,
      ...redundant.map((asset) => ({ asset })) as any[],
    ],
    redundantCount: redundant.length,
    redundantSize: 100,
  }
}

describe('buildBatchMergeConfirmMessage', () => {
  it('统计口径：仅非主资源条目的引用计入影响面（跨组文档去重）', () => {
    const msg = buildBatchMergeConfirmMessage({
      groups: [
        makeGroup('main-a.png', [makeAsset('dup-a1.png', [{ root_id: 'doc-1' }, { root_id: 'doc-2' }])]),
        makeGroup('main-b.png', [makeAsset('dup-b1.png', [{ root_id: 'doc-2' }])]),
      ],
      totalRedundantCount: 2,
      totalReclaimableSizeText: '200 B',
      isSimilarMode: false,
    })

    // 主资源引用（root-canonical）不计入；dup-a1 2 处 + dup-b1 1 处 = 3 处引用、2 篇文档
    expect(msg).toContain('• 处理重复组数: 2 组')
    expect(msg).toContain('• 涉及影响文档: 2 篇')
    expect(msg).toContain('• 自动调整引用: 3 处')
    expect(msg).toContain('• 删除冗余文件: 2 个')
    expect(msg).toContain('• 预计释放空间: 200 B')
    expect(msg).toContain('【完全相同资源 归一化预检明细】')
    expect(msg).not.toContain('视觉相似')
    expect(msg).toContain('是否确认执行一键批量归一化？')
  })

  it('相似模式切换标题与高风险提醒，空引用归零', () => {
    const msg = buildBatchMergeConfirmMessage({
      groups: [makeGroup('s.png', [makeAsset('s-dup.png', [])])],
      totalRedundantCount: 1,
      totalReclaimableSizeText: '0 B',
      isSimilarMode: true,
    })

    expect(msg).toContain('【视觉相似图片 归一化预检明细】')
    expect(msg).toContain('[风险提醒]')
    expect(msg).toContain('• 涉及影响文档: 0 篇')
    expect(msg).toContain('• 自动调整引用: 0 处')
  })
})

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
import {
  applyCatalogBlockDelta,
  fetchCatalogBlockDelta,
  resolveCatalogInventoryFromSources,
  resolveCatalogPipeline,
  resolveCatalogPipelineFromEntries,
  type CatalogSupportData,
} from '../src/utils/asset-catalog';
import { extractBlockEntryNames, type PreExtractedBlockEntry } from '../src/utils/siyuan-db';

const sqlMock = vi.mocked(sqlGuarded);

function entry(id: string, names: string[]): PreExtractedBlockEntry {
  return {
    id,
    root_id: `doc-${id}`,
    box: 'box-1',
    content: '',
    path: `/d-${id}.sy`,
    hpath: `/文档${id}`,
    rawAssetNames: names,
  };
}

describe('增量块引用校验 fetchCatalogBlockDelta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('三路查询：近期变更 + ial 全量 + 存在性分片核查', async () => {
    sqlMock.mockImplementation(async (stmt: string) => {
      if (stmt.includes("updated >= '20261001120000'")) {
        return [
          // 新增引用的块
          { id: 'blk-new', root_id: 'doc-n', box: 'box-1', markdown: '![x](assets/new.png)', path: '/n.sy', hpath: '/N', ial: '' },
          // 引用被删除的块（markdown 不再含 assets/）
          { id: 'blk-cleared', root_id: 'doc-c', box: 'box-1', markdown: '纯文本', path: '/c.sy', hpath: '/C', ial: '' },
        ]
      }
      if (stmt.includes("ial LIKE '%assets/%'")) {
        return [
          // 题头图：仅 ial 携带引用、updated 不变（内核 setBlockAttrs 不更新 updated）
          { id: 'blk-doc', root_id: 'doc-d', box: 'box-1', markdown: '', path: '/d.sy', hpath: '/D', ial: '{: title-img="assets/cover.png"}' },
        ]
      }
      if (stmt.includes('id IN')) {
        // blk-deleted 已不存在
        return [{ id: 'blk-keep' }]
      }
      return []
    })

    const snapshotEntries = new Map<string, PreExtractedBlockEntry>([
      ['blk-keep', entry('keep', ['keep.png'])],
      ['blk-deleted', entry('deleted', ['gone.png'])],
      ['blk-cleared', entry('cleared', ['old.png'])],
    ])

    const delta = await fetchCatalogBlockDelta(snapshotEntries, '20261001120000')

    // SQL 语句形态断言
    const stmts = sqlMock.mock.calls.map((c) => String(c[0]))
    expect(stmts.some((s) => s.includes("updated >= '20261001120000'"))).toBe(true)
    expect(stmts.some((s) => s.includes("ial LIKE '%assets/%'"))).toBe(true)
    expect(stmts.some((s) => s.includes('id IN'))).toBe(true)

    // 新增/ial 变更进入 upserted
    const upsertedIds = delta.upserted.map((e) => e.id).sort()
    expect(upsertedIds).toEqual(['blk-doc', 'blk-new'])
    expect(delta.upserted.find((e) => e.id === 'blk-new')!.rawAssetNames).toEqual(['new.png'])
    expect(delta.upserted.find((e) => e.id === 'blk-doc')!.rawAssetNames).toEqual(['cover.png'])

    // 块删除 + 引用清空进入 removedIds
    expect(delta.removedIds.sort()).toEqual(['blk-cleared', 'blk-deleted'])
  })

  it('applyCatalogBlockDelta 就地替换与删除', () => {
    const entries = new Map([
      ['a', entry('a', ['x.png'])],
      ['b', entry('b', ['y.png'])],
    ])
    applyCatalogBlockDelta(entries, {
      upserted: [entry('a', ['z.png'])],
      removedIds: ['b'],
    })
    expect(entries.size).toBe(1)
    expect(entries.get('a')!.rawAssetNames).toEqual(['z.png'])
    expect(entries.has('b')).toBe(false)
  })
})

describe('条目化装配与原始块装配的一致性', () => {
  it('同一批原始块，经 resolveCatalogPipeline 与预提取条目装配结果一致', () => {
    const files = [{ name: 'a.png', size: 1, updated: 1, isDir: false }]
    const blocks = [
      {
        id: 'blk-1',
        root_id: 'doc-1',
        box: 'box-1',
        content: '',
        markdown: '![a](assets/a.png)',
        path: '/doc1.sy',
        hpath: '/H',
        ial: '',
      },
    ]
    const notebookMap = new Map([['box-1', '笔记本']])

    const viaRaw = resolveCatalogPipeline(files, blocks, [], [], notebookMap)
    const entries: PreExtractedBlockEntry[] = blocks.map((b) => ({
      id: b.id,
      root_id: b.root_id,
      box: b.box,
      content: b.content,
      path: b.path,
      hpath: b.hpath,
      rawAssetNames: extractBlockEntryNames(b),
    }))
    const viaPre = resolveCatalogPipelineFromEntries(files, entries, [], [], notebookMap)

    expect(viaRaw.assetsMap.get('a.png')!.refCount).toBe(1)
    expect(viaPre.assetsMap.get('a.png')!.refCount).toBe(1)
    expect(viaPre.assetsMap.get('a.png')!.references[0].readablePath).toBe(
      viaRaw.assetsMap.get('a.png')!.references[0].readablePath,
    )
  })
})

describe('resolveCatalogInventoryFromSources', () => {
  it('合并主条目与 PDF 标注条目', () => {
    const files = [
      { name: 'a.png', size: 1, updated: 1, isDir: false },
      { name: 'b.pdf', size: 2, updated: 1, isDir: false },
    ]
    const entries = [entry('e1', ['a.png'])]
    const support: CatalogSupportData & { annotationEntries: any[] } = {
      reEditBlocks: [],
      originalFiles: [],
      sidecarMetadataList: [],
      avReferencesMap: new Map(),
      agentAssets: new Set(),
      canvasInventory: null,
      notebookMap: new Map([['box-1', '本']]),
      degraded: false,
      annotationEntries: [entry('anno-1', ['b.pdf'])],
    }
    const inv = resolveCatalogInventoryFromSources(files, entries, support)
    expect(inv.assetsMap.get('a.png')!.refCount).toBe(1)
    expect(inv.assetsMap.get('b.pdf')!.refCount).toBe(1)
  })
})

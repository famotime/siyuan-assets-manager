import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/api', () => ({
  sql: vi.fn(),
}));

import { sql } from '../src/api';
import {
  extractAvIdFromBlock,
  extractAssetsFromAttributeViewJson,
  resolveAttributeViewReferences,
  replaceAssetInAttributeViews,
  captureAttributeViewAssetCells,
  restoreAttributeViewAssetCells,
  ATTRIBUTE_VIEW_STORAGE_DIR,
} from '../src/utils/attribute-view';
import { defaultStorage, blobToText } from '../src/utils/storage';

const sqlMock = vi.mocked(sql);

describe('attribute-view helper module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('extractAvIdFromBlock', () => {
    it('extracts avID from markdown placeholder element', () => {
      const block = {
        markdown: '<div data-type="NodeAttributeView" data-av-id="20240315120000-avid1" data-av-type="table"></div>',
        ial: '{: id="20240315120000-block1"}',
      };
      expect(extractAvIdFromBlock(block)).toBe('20240315120000-avid1');
    });

    it('extracts avID from ial attribute when markdown has no data-av-id', () => {
      const block = {
        markdown: '',
        ial: '{: id="20240315120000-block1" custom-av-id="20240315120000-avid2"}',
      };
      expect(extractAvIdFromBlock(block)).toBe('20240315120000-avid2');

      const blockWithDataAvId = {
        markdown: '',
        ial: '{: id="20240315120000-block1" data-av-id="20240315120000-avid3"}',
      };
      expect(extractAvIdFromBlock(blockWithDataAvId)).toBe('20240315120000-avid3');
    });

    it('returns null if no avID is found', () => {
      const block = {
        markdown: '普通段落文本',
        ial: '{: id="20240315120000-block1"}',
      };
      expect(extractAvIdFromBlock(block)).toBeNull();
    });
  });

  describe('extractAssetsFromAttributeViewJson', () => {
    it('extracts assets from mAsset columns and rich text columns with structural details', () => {
      const json = JSON.stringify({
        id: 'av-movie-db',
        name: '经典电影',
        keyValues: [
          {
            key: {
              id: 'col-poster',
              name: '海报封面',
              type: 'mAsset',
            },
            values: [
              {
                id: 'val-1',
                blockID: 'item-1',
                type: 'mAsset',
                mAsset: [
                  {
                    type: 'image',
                    name: 'shawshank.png',
                    content: 'assets/shawshank-20240101.png',
                  },
                ],
              },
            ],
          },
          {
            key: {
              id: 'col-desc',
              name: '影评笔记',
              type: 'text',
            },
            values: [
              {
                id: 'val-2',
                blockID: 'item-2',
                type: 'text',
                content: '经典截图：![截图](assets/scene-20240102.jpg) 还有一张 <img src="assets/director-20240103.png" />',
              },
            ],
          },
        ],
      });

      const res = extractAssetsFromAttributeViewJson(json);
      expect(res.avId).toBe('av-movie-db');
      expect(res.avName).toBe('经典电影');
      expect(res.assetNames).toContain('shawshank-20240101.png');
      expect(res.assetNames).toContain('scene-20240102.jpg');
      expect(res.assetNames).toContain('director-20240103.png');

      const posterRef = res.detailedRefs.find((r) => r.assetName === 'shawshank-20240101.png');
      expect(posterRef?.keyName).toBe('海报封面');
      expect(posterRef?.blockId).toBe('item-1');
    });

    it('fallbacks to full-text scan for unrecognized JSON formats', () => {
      const json = JSON.stringify({
        id: 'av-custom',
        someCustomProperties: {
          items: ['assets/custom_image.png', 'assets/custom_icon.svg'],
        },
      });

      const res = extractAssetsFromAttributeViewJson(json);
      expect(res.assetNames).toContain('custom_image.png');
      expect(res.assetNames).toContain('custom_icon.svg');
    });
  });

  describe('resolveAttributeViewReferences', () => {
    it('associates database assets with host blocks in documents and resolves readable paths', async () => {
      const mockAvJson = JSON.stringify({
        id: 'av-books',
        name: '读书清单',
        keyValues: [
          {
            key: { id: 'col-1', name: '封面', type: 'mAsset' },
            values: [
              {
                blockID: 'item-101',
                mAsset: [{ content: 'assets/book_cover.png' }],
              },
            ],
          },
        ],
      });

      vi.spyOn(defaultStorage, 'list').mockResolvedValue([
        { name: 'av-books.json', isDir: false, size: 100, updated: 100 },
      ]);
      vi.spyOn(defaultStorage, 'read').mockImplementation(async (path: string) => {
        if (path === `${ATTRIBUTE_VIEW_STORAGE_DIR}/av-books.json`) {
          return new Blob([mockAvJson], { type: 'application/json' });
        }
        return null;
      });

      sqlMock.mockResolvedValue([
        {
          id: 'av-block-1',
          root_id: 'doc-reading',
          box: 'notebook-1',
          markdown: '<div data-type="NodeAttributeView" data-av-id="av-books"></div>',
          path: '/reading.sy',
          hpath: '/知识库/我的书架',
        },
      ]);

      const notebookMap = new Map([['notebook-1', '生活手记']]);
      const refsMap = await resolveAttributeViewReferences(notebookMap);

      expect(refsMap.has('book_cover.png')).toBe(true);
      const refs = refsMap.get('book_cover.png')!;
      expect(refs.length).toBe(1);
      expect(refs[0].id).toBe('av-block-1');
      expect(refs[0].root_id).toBe('doc-reading');
      expect(refs[0].boxName).toBe('生活手记');
      expect(refs[0].readablePath).toBe('生活手记/知识库/我的书架');
      expect(refs[0].content).toBe('[数据库] 读书清单 (封面)');
    });

    it('creates dedicated standalone references for detached/unmounted database files', async () => {
      const mockAvJson = JSON.stringify({
        id: 'av-standalone',
        name: '独立素材库',
        keyValues: [
          {
            key: { id: 'col-1', name: '素材', type: 'mAsset' },
            values: [
              {
                blockID: 'item-999',
                mAsset: [{ content: 'assets/detached_art.png' }],
              },
            ],
          },
        ],
      });

      vi.spyOn(defaultStorage, 'list').mockResolvedValue([
        { name: 'av-standalone.json', isDir: false, size: 100, updated: 100 },
      ]);
      vi.spyOn(defaultStorage, 'read').mockImplementation(async (path: string) => {
        if (path === `${ATTRIBUTE_VIEW_STORAGE_DIR}/av-standalone.json`) {
          return new Blob([mockAvJson], { type: 'application/json' });
        }
        return null;
      });

      // 没有查询到任何 type = 'av' 嵌入块
      sqlMock.mockResolvedValue([]);

      const refsMap = await resolveAttributeViewReferences(new Map());
      expect(refsMap.has('detached_art.png')).toBe(true);
      const refs = refsMap.get('detached_art.png')!;
      expect(refs.length).toBe(1);
      expect(refs[0].id).toBe('av-av-standalone');
      expect(refs[0].readablePath).toBe('数据库 / 独立素材库');
      expect(refs[0].content).toBe('[独立数据库] 独立素材库 (素材)');
    });
  });

  describe('replaceAssetInAttributeViews', () => {
    it('accurately replaces asset path in database JSON files and saves back to storage', async () => {
      const initialJson = JSON.stringify({
        id: 'av-test',
        keyValues: [
          {
            values: [
              {
                content: 'assets/old_name.png',
              },
            ],
          },
        ],
      });

      vi.spyOn(defaultStorage, 'list').mockResolvedValue([
        { name: 'av-test.json', isDir: false, size: 100, updated: 100 },
      ]);
      vi.spyOn(defaultStorage, 'read').mockResolvedValue(
        new Blob([initialJson], { type: 'application/json' })
      );
      const writeSpy = vi.spyOn(defaultStorage, 'write').mockResolvedValue(undefined);

      const count = await replaceAssetInAttributeViews('old_name.png', 'new_name.png');
      expect(count).toBe(1);
      expect(writeSpy).toHaveBeenCalledTimes(1);

      const writtenBlob = writeSpy.mock.calls[0][1];
      const writtenText = await blobToText(writtenBlob);
      expect(writtenText).toContain('assets/new_name.png');
      expect(writtenText).not.toContain('assets/old_name.png');
    });
  });

  describe('attribute view cell snapshot & precise rollback', () => {
    const buildAvJson = (values: any[]) =>
      JSON.stringify({
        spec: 1,
        id: 'av-dup-db',
        name: '素材库',
        keyValues: [
          {
            key: { id: 'key-cover', name: '封面', type: 'mAsset' },
            values,
          },
        ],
      });

    const mockAvFile = (json: string) => {
      vi.spyOn(defaultStorage, 'list').mockResolvedValue([
        { name: 'av-dup-db.json', isDir: false, size: 100, updated: 100 },
      ]);
      vi.spyOn(defaultStorage, 'read').mockResolvedValue(new Blob([json], { type: 'application/json' }));
      return vi.spyOn(defaultStorage, 'write').mockResolvedValue(undefined);
    };

    it('captures only the cells that reference the asset, with content snapshots', async () => {
      const json = buildAvJson([
        { id: 'v1', blockID: 'row-1', mAsset: [{ content: 'assets/dup.png' }] },
        { id: 'v2', blockID: 'row-2', mAsset: [{ content: 'assets/other.png' }] },
      ]);
      mockAvFile(json);

      const captured = await captureAttributeViewAssetCells(['dup.png']);

      const cells = captured.get('dup.png') || [];
      expect(cells).toHaveLength(1);
      expect(cells[0]).toMatchObject({ viewId: 'av-dup-db', keyId: 'key-cover', rowId: 'row-1' });
      expect(cells[0].originalAssetContents).toEqual(['assets/dup.png']);
    });

    it('restores only the recorded cell, leaving other cells and other assets untouched', async () => {
      const json = buildAvJson([
        { id: 'v1', blockID: 'row-1', mAsset: [{ content: 'assets/keep.png' }] },
        { id: 'v2', blockID: 'row-2', mAsset: [{ content: 'assets/keep.png' }] },
      ]);
      const writeSpy = mockAvFile(json);

      const stats = await restoreAttributeViewAssetCells(
        [
          {
            viewId: 'av-dup-db',
            keyId: 'key-cover',
            rowId: 'row-1',
            originalAssetContents: ['assets/dup.png'],
          },
        ],
        'keep.png',
        'dup.png'
      );

      expect(stats.restoredCount).toBe(1);
      expect(writeSpy).toHaveBeenCalledTimes(1);

      const writtenText = await blobToText(writeSpy.mock.calls[0][1]);
      const parsed = JSON.parse(writtenText);
      // 只有被记录的单元格改回冗余图；同值的另一行（可能来自其它冗余图或本就是主图）保持不动
      expect(parsed.keyValues[0].values[0].mAsset[0].content).toBe('assets/dup.png');
      expect(parsed.keyValues[0].values[1].mAsset[0].content).toBe('assets/keep.png');
    });

    it('keeps the original JSON formatting style (pretty tabs vs compact)', async () => {
      const prettyJson = '{\n\t"spec": 1,\n\t"id": "av-dup-db",\n\t"keyValues": [\n\t\t{\n\t\t\t"key": {\n\t\t\t\t"id": "key-cover"\n\t\t\t},\n\t\t\t"values": [\n\t\t\t\t{\n\t\t\t\t\t"blockID": "row-1",\n\t\t\t\t\t"content": "assets/keep.png"\n\t\t\t\t}\n\t\t\t]\n\t\t}\n\t]\n}';
      const writeSpy = mockAvFile(prettyJson);

      await restoreAttributeViewAssetCells(
        [{ viewId: 'av-dup-db', keyId: 'key-cover', rowId: 'row-1', originalContent: 'assets/dup.png' }],
        'keep.png',
        'dup.png'
      );

      const writtenText = await blobToText(writeSpy.mock.calls[0][1]);
      expect(writtenText.startsWith('{\n\t"spec"')).toBe(true);
      expect(writtenText).not.toContain('assets/keep.png');
    });

    it('skips cells whose value no longer references the canonical asset and reports it', async () => {
      const json = buildAvJson([{ id: 'v1', blockID: 'row-1', content: '用户已改成 assets/other.png' }]);
      const writeSpy = mockAvFile(json);

      const stats = await restoreAttributeViewAssetCells(
        [{ viewId: 'av-dup-db', keyId: 'key-cover', rowId: 'row-1', originalContent: 'assets/dup.png' }],
        'keep.png',
        'dup.png'
      );

      expect(stats.restoredCount).toBe(0);
      expect(stats.skippedCount).toBe(1);
      expect(writeSpy).not.toHaveBeenCalled();
    });

    it('counts a vanished cell as skipped instead of failing', async () => {
      mockAvFile(buildAvJson([{ id: 'v1', blockID: 'row-other', content: 'assets/keep.png' }]));

      const stats = await restoreAttributeViewAssetCells(
        [{ viewId: 'av-dup-db', keyId: 'key-cover', rowId: 'row-1', originalContent: 'assets/dup.png' }],
        'keep.png',
        'dup.png'
      );

      expect(stats.skippedCount).toBe(1);
      expect(stats.restoredCount).toBe(0);
    });

    it('returns empty capture when the file is not valid JSON', async () => {
      mockAvFile('{ not json');

      const captured = await captureAttributeViewAssetCells(['dup.png']);

      expect(captured.size).toBe(0);
    });
  });
});

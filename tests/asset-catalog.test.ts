import { describe, expect, it } from 'vitest';
import { resolveCatalogPipeline } from '../src/utils/asset-catalog';
import type { IAssetReEditMetadata } from '../src/types/reedit';

describe('AssetCatalog Resolution Pipeline', () => {
  it('correctly maps physical files, block references, re-edit metadata, and originals', () => {
    const files = [
      { name: 'rendered.png', size: 5000, updated: 100, isDir: false },
      { name: 'standalone.png', size: 2000, updated: 100, isDir: false },
    ];

    const blocks = [
      {
        id: 'block-1',
        root_id: 'doc-1',
        box: 'box-1',
        content: '',
        markdown: '![pic](assets/rendered.png)',
        path: '/doc1.sy',
        hpath: '/知识库/设计',
      },
    ];

    const reEditBlocks: Array<{ blockId: string; rootId: string; metadata: IAssetReEditMetadata }> = [
      {
        blockId: 'block-1',
        rootId: 'doc-1',
        metadata: {
          version: 1,
          originalStoragePath: 'storage/petal/siyuan-assets-manager/originals/orig_rendered.png',
          renderedAssetName: 'rendered.png',
          canvasSize: { width: 800, height: 600 },
          compressed: false,
          vectorData: { objects: [] },
          updatedAt: 100,
        },
      },
    ];

    const originalFiles = [
      {
        name: 'orig_rendered.png',
        path: 'storage/petal/siyuan-assets-manager/originals/orig_rendered.png',
        size: 8000,
        updated: 90,
      },
      {
        name: 'orig_orphan.png',
        path: 'storage/petal/siyuan-assets-manager/originals/orig_orphan.png',
        size: 3000,
        updated: 80,
      },
    ];

    const notebookMap = new Map([['box-1', '工作笔记本']]);

    const result = resolveCatalogPipeline(files, blocks, reEditBlocks, originalFiles, notebookMap);

    // 1. Regular assets
    const rendered = result.assetsMap.get('rendered.png');
    expect(rendered).toBeDefined();
    expect(rendered?.refCount).toBe(1);
    expect(rendered?.docCount).toBe(1);
    expect(rendered?.isReEditable).toBe(true);
    expect(rendered?.references[0].readablePath).toBe('工作笔记本/知识库/设计');

    // 2. Original active asset inherits references from rendered.png
    const activeOrig = result.originalAssets.find((o) => o.name === 'orig_rendered.png');
    expect(activeOrig).toBeDefined();
    expect(activeOrig?.refCount).toBe(1);
    expect(activeOrig?.docCount).toBe(1);
    expect(activeOrig?.isOriginal).toBe(true);

    // 3. Orphan original has 0 references
    const orphanOrig = result.originalAssets.find((o) => o.name === 'orig_orphan.png');
    expect(orphanOrig?.refCount).toBe(0);
    expect(orphanOrig?.docCount).toBe(0);

    // 4. Orphan list & total size
    expect(result.orphanOriginals.length).toBe(1);
    expect(result.orphanOriginals[0].name).toBe('orig_orphan.png');
    expect(result.totalOrphanSize).toBe(3000);
  });

  it('protects original image from orphan deletion when original block is deleted but sidecar metadata exists and other documents reference the asset', () => {
    const files = [
      { name: 'shared_image.png', size: 6000, updated: 200, isDir: false },
    ];

    // Document 2 has copied the image via Markdown syntax, but has NO re-edit block attribute (reEditBlocks is empty!)
    const blocks = [
      {
        id: 'block-in-doc-2',
        root_id: 'doc-2',
        box: 'box-1',
        content: '',
        markdown: '![pic](assets/shared_image.png)',
        path: '/doc2.sy',
        hpath: '/知识库/另一篇文档',
      },
    ];

    // The original block with custom-asset-reedit in doc-1 was completely DELETED by user!
    const reEditBlocks: Array<{ blockId: string; rootId: string; metadata: IAssetReEditMetadata }> = [];

    // But the asset-centric Sidecar metadata exists in plugin storage!
    const sidecarMetadataList = [
      {
        assetName: 'shared_image.png',
        metadata: {
          version: 1,
          originalStoragePath: 'storage/petal/siyuan-assets-manager/originals/orig_shared.png',
          renderedAssetName: 'shared_image.png',
          canvasSize: { width: 800, height: 600 },
          compressed: false,
          vectorData: { objects: [{ type: 'rect' }] },
          updatedAt: 200,
        },
      },
    ];

    const originalFiles = [
      {
        name: 'orig_shared.png',
        path: 'storage/petal/siyuan-assets-manager/originals/orig_shared.png',
        size: 9000,
        updated: 150,
      },
    ];

    const notebookMap = new Map([['box-1', '工作笔记本']]);

    const result = resolveCatalogPipeline(
      files,
      blocks,
      reEditBlocks,
      originalFiles,
      notebookMap,
      sidecarMetadataList
    );

    // 1. The asset is still marked as re-editable and points to originalStoragePath
    const asset = result.assetsMap.get('shared_image.png');
    expect(asset).toBeDefined();
    expect(asset?.isReEditable).toBe(true);
    expect(asset?.originalStoragePath).toBe('storage/petal/siyuan-assets-manager/originals/orig_shared.png');
    expect(asset?.refCount).toBe(1);

    // 2. The original image is NOT treated as an orphan because of sidecar linkage to doc-2!
    expect(result.orphanOriginals.length).toBe(0);
    expect(result.totalOrphanSize).toBe(0);

    const activeOrig = result.originalAssets.find((o) => o.name === 'orig_shared.png');
    expect(activeOrig?.refCount).toBe(1);
    expect(activeOrig?.references[0].id).toBe('block-in-doc-2');
  });
});

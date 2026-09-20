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

  it('protects database associated assets from being treated as orphans and binds database references', () => {
    const files = [
      { name: 'db_only_photo.png', size: 12000, updated: 300, isDir: false },
      { name: 'real_orphan.png', size: 4000, updated: 300, isDir: false },
    ];

    // 普通文档块中没有任何对 db_only_photo.png 的引用
    const blocks: any[] = [];
    const reEditBlocks: any[] = [];
    const originalFiles: any[] = [];
    const notebookMap = new Map([['box-1', '测试笔记']]);

    // 属性视图中关联了 db_only_photo.png
    const avReferencesMap = new Map([
      [
        'db_only_photo.png',
        [
          {
            id: 'av-block-101',
            root_id: 'doc-movie',
            box: 'box-1',
            content: '[数据库] 影视清单 (海报)',
            markdown: '<div data-type="NodeAttributeView" data-av-id="av-1"></div>',
            path: '/movie.sy',
            hpath: '/影视/清单',
            boxName: '测试笔记',
            readablePath: '测试笔记/影视/清单',
          },
        ],
      ],
    ]);

    const result = resolveCatalogPipeline(
      files,
      blocks,
      reEditBlocks,
      originalFiles,
      notebookMap,
      [],
      avReferencesMap
    );

    // 1. 数据库图片拥有正确引用计数和文档计数
    const dbAsset = result.assetsMap.get('db_only_photo.png');
    expect(dbAsset).toBeDefined();
    expect(dbAsset?.refCount).toBe(1);
    expect(dbAsset?.docCount).toBe(1);
    expect(dbAsset?.references[0].content).toBe('[数据库] 影视清单 (海报)');
    expect(dbAsset?.references[0].readablePath).toBe('测试笔记/影视/清单');

    // 2. 真正的孤儿资源仍然是 0 引用
    const realOrphan = result.assetsMap.get('real_orphan.png');
    expect(realOrphan).toBeDefined();
    expect(realOrphan?.refCount).toBe(0);
    expect(realOrphan?.docCount).toBe(0);
  });

  it('protects companion PDF annotation file (.pdf.sya) when parent PDF is referenced and leaves orphan .sya when parent is orphan', () => {
    const files = [
      { name: 'active.pdf', size: 50000, updated: 100, isDir: false },
      { name: 'active.pdf.sya', size: 5000, updated: 100, isDir: false },
      { name: 'orphan.pdf', size: 30000, updated: 100, isDir: false },
      { name: 'orphan.pdf.sya', size: 3000, updated: 100, isDir: false },
    ];

    const blocks = [
      {
        id: 'block-pdf-1',
        root_id: 'doc-pdf',
        box: 'box-1',
        content: '',
        markdown: '[查看手册](assets/active.pdf)',
        path: '/manual.sy',
        hpath: '/手册',
      },
    ];

    const result = resolveCatalogPipeline(files, blocks, [], [], new Map([['box-1', '文档库']]));

    // 1. active.pdf 有引用
    const activePdf = result.assetsMap.get('active.pdf');
    expect(activePdf?.docCount).toBe(1);

    // 2. active.pdf.sya 伴生文件自动保活并继承母体引用
    const activeSya = result.assetsMap.get('active.pdf.sya');
    expect(activeSya).toBeDefined();
    expect(activeSya?.isCompanion).toBe(true);
    expect(activeSya?.docCount).toBe(1);
    expect(activeSya?.references.length).toBe(1);
    expect(activeSya?.references[0].id).toBe('block-pdf-1');

    // 3. orphan.pdf 与 orphan.pdf.sya 均为孤儿
    const orphanPdf = result.assetsMap.get('orphan.pdf');
    expect(orphanPdf?.docCount).toBe(0);
    const orphanSya = result.assetsMap.get('orphan.pdf.sya');
    expect(orphanSya?.docCount).toBe(0);
  });

  it('marks system protected assets (like ocr-texts.json) so they never become cleanup targets', () => {
    const files = [
      { name: 'ocr-texts.json', size: 8000, updated: 100, isDir: false },
      { name: 'android-notification-texts.txt', size: 2000, updated: 100, isDir: false },
      { name: 'regular_orphan.png', size: 3000, updated: 100, isDir: false },
    ];

    const result = resolveCatalogPipeline(files, [], [], [], new Map());

    const ocrAsset = result.assetsMap.get('ocr-texts.json');
    expect(ocrAsset?.isSystemProtected).toBe(true);

    const notificationAsset = result.assetsMap.get('android-notification-texts.txt');
    expect(notificationAsset?.isSystemProtected).toBe(true);

    const orphanAsset = result.assetsMap.get('regular_orphan.png');
    expect(orphanAsset?.isSystemProtected).toBeFalsy();
  });

  it('keeps AI agent session image assets active when referenced in chat context', () => {
    const files = [
      { name: 'ai_chat_upload.png', size: 15000, updated: 100, isDir: false },
    ];

    const agentAssets = new Set(['ai_chat_upload.png']);
    const result = resolveCatalogPipeline(files, [], [], [], new Map(), [], new Map(), agentAssets);

    const aiAsset = result.assetsMap.get('ai_chat_upload.png');
    expect(aiAsset).toBeDefined();
    expect(aiAsset?.docCount).toBe(1);
    expect(aiAsset?.references[0].content).toContain('AI Agent');
  });
});

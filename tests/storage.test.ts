import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  StorageClient,
  MemoryStorageAdapter,
  ElectronStorageAdapter,
  HttpStorageAdapter,
  setStorageAdapter,
  defaultStorage,
  blobToText,
} from '../src/utils/storage';

describe('Storage Module & Seam', () => {
  beforeEach(() => {
    setStorageAdapter(null);
    vi.clearAllMocks();
  });

  describe('MemoryStorageAdapter', () => {
    it('supports in-memory CRUD and directory listing', async () => {
      const adapter = new MemoryStorageAdapter();
      const testBlob = new Blob(['hello world'], { type: 'text/plain' });

      // 1. Write
      await adapter.write('/data/assets/test.txt', testBlob);

      // 2. Stat
      const stat = await adapter.stat('/data/assets/test.txt');
      expect(stat).not.toBeNull();
      expect(stat?.size).toBe(testBlob.size);
      expect(stat?.isDir).toBe(false);

      // 3. Read
      const readBlob = await adapter.read('/data/assets/test.txt');
      expect(readBlob).not.toBeNull();
      expect(await blobToText(readBlob!)).toBe('hello world');

      // 4. List
      const list = await adapter.list('/data/assets');
      expect(list.length).toBe(1);
      expect(list[0].name).toBe('test.txt');

      // 5. Delete
      const deleted = await adapter.delete('/data/assets/test.txt');
      expect(deleted).toBe(true);
      expect(await adapter.stat('/data/assets/test.txt')).toBeNull();
    });
  });

  describe('StorageClient Facade with MemoryStorageAdapter', () => {
    it('operates on assets and originals domain paths seamlessly', async () => {
      const memoryAdapter = new MemoryStorageAdapter();
      setStorageAdapter(memoryAdapter);

      const client = new StorageClient(() => memoryAdapter);

      const blob = new Blob(['sample-image'], { type: 'image/png' });
      await client.saveAsset('foo.png', blob);

      const stat = await client.statAsset('foo.png');
      expect(stat?.size).toBe(blob.size);

      const readBlob = await client.readAsset('foo.png');
      expect(await blobToText(readBlob!)).toBe('sample-image');

      // Originals
      const origPath = await client.saveOriginal('foo.png', blob);
      expect(origPath).toContain('storage/petal/siyuan-assets-manager/originals/');

      const readOrig = await client.readOriginal(origPath);
      expect(await blobToText(readOrig!)).toBe('sample-image');

      const originalsList = await client.listOriginals();
      expect(originalsList.length).toBe(1);
      expect(originalsList[0].name).toContain('foo.png');

      await client.deleteOriginal(origPath);
      const afterDel = await client.listOriginals();
      expect(afterDel.length).toBe(0);

      // Metadata Sidecar
      const mockMeta = {
        version: 1,
        originalStoragePath: origPath,
        renderedAssetName: 'foo.png',
        canvasSize: { width: 800, height: 600 },
        compressed: false,
        vectorData: { objects: [{ type: 'rect' }] },
        updatedAt: 12345678,
      };
      await client.saveAssetMetadata('foo.png', mockMeta);

      const readMeta = await client.readAssetMetadata('foo.png');
      expect(readMeta).toEqual(mockMeta);

      const metaList = await client.listAssetMetadata();
      expect(metaList.length).toBe(1);
      expect(metaList[0].assetName).toBe('foo.png');
      expect(metaList[0].metadata.renderedAssetName).toBe('foo.png');

      await client.deleteAssetMetadata('foo.png');
      const afterMetaDel = await client.listAssetMetadata();
      expect(afterMetaDel.length).toBe(0);
    });
  });

  describe('ElectronStorageAdapter', () => {
    it('calls fs methods with correct resolved paths', async () => {
      const mockFs = {
        existsSync: vi.fn().mockReturnValue(true),
        statSync: vi.fn().mockReturnValue({ size: 1234, mtimeMs: 1600000000, isDirectory: () => false }),
        readFileSync: vi.fn().mockReturnValue(Buffer.from('binary-data')),
        writeFileSync: vi.fn(),
        mkdirSync: vi.fn(),
        unlinkSync: vi.fn(),
        readdirSync: vi.fn().mockReturnValue([{ name: 'file1.png', isDirectory: () => false }]),
      };
      const mockPath = {
        join: (...parts: string[]) => parts.join('/'),
        dirname: (p: string) => p.split('/').slice(0, -1).join('/'),
      };

      const adapter = new ElectronStorageAdapter(mockFs, mockPath, '/workspace/data');

      const stat = await adapter.stat('/data/assets/file1.png');
      expect(stat?.size).toBe(1234);
      expect(mockFs.statSync).toHaveBeenCalledWith('/workspace/data/assets/file1.png');

      const blob = await adapter.read('/data/assets/file1.png');
      expect(blob).not.toBeNull();

      await adapter.write('/data/assets/new.png', new Blob(['new']));
      expect(mockFs.writeFileSync).toHaveBeenCalled();

      await adapter.delete('/data/assets/file1.png');
      expect(mockFs.unlinkSync).toHaveBeenCalledWith('/workspace/data/assets/file1.png');

      const list = await adapter.list('/data/assets');
      expect(list.length).toBe(1);
      expect(list[0].name).toBe('file1.png');
    });
  });
});

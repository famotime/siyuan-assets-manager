import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
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

      const isWin = process.platform === 'win32';
      const expectedFile1 = isWin ? '\\workspace\\data\\assets\\file1.png' : '/workspace/data/assets/file1.png';

      const stat = await adapter.stat('/data/assets/file1.png');
      expect(stat?.size).toBe(1234);
      expect(mockFs.statSync).toHaveBeenCalledWith(expectedFile1);

      const blob = await adapter.read('/data/assets/file1.png');
      expect(blob).not.toBeNull();

      await adapter.write('/data/assets/new.png', new Blob(['new']));
      expect(mockFs.writeFileSync).toHaveBeenCalled();

      await adapter.delete('/data/assets/file1.png');
      expect(mockFs.unlinkSync).toHaveBeenCalledWith(expectedFile1);

      const list = await adapter.list('/data/assets');
      expect(list.length).toBe(1);
      expect(list[0].name).toBe('file1.png');
    });

    it('delegates deleteToTrash to electron shell.trashItem when available', async () => {
      const mockFs = {
        existsSync: vi.fn().mockReturnValue(true),
        unlinkSync: vi.fn(),
      };
      const mockPath = {
        join: (...parts: string[]) => parts.join('/'),
      };
      const mockTrashItem = vi.fn().mockResolvedValue(undefined);
      (window as any).require = vi.fn((mod: string) => {
        if (mod === 'electron') {
          return { shell: { trashItem: mockTrashItem } };
        }
        return {};
      });

      const adapter = new ElectronStorageAdapter(mockFs, mockPath, '/workspace/data');
      expect(adapter.isTrashSupported()).toBe(true);

      const ok = await adapter.deleteToTrash('/data/assets/trashme.png');
      expect(ok).toBe(true);
      const isWin = process.platform === 'win32';
      const expectedPath = isWin ? '\\workspace\\data\\assets\\trashme.png' : '/workspace/data/assets/trashme.png';
      expect(mockTrashItem).toHaveBeenCalledWith(expectedPath);
      expect(mockFs.unlinkSync).not.toHaveBeenCalled();

      // 清理全局 mock
      delete (window as any).require;
    });

    it('falls back to PowerShell DeleteFile on Windows when shell.trashItem throws', async () => {
      if (process.platform !== 'win32') return;

      const mockFs = {
        existsSync: vi.fn().mockReturnValue(true),
        unlinkSync: vi.fn(),
      };
      const mockPath = {
        join: (...parts: string[]) => parts.join('/'),
      };
      const mockExec = vi.fn((cmd, cb) => cb(null));
      (window as any).require = vi.fn((mod: string) => {
        if (mod === 'electron') {
          return {
            shell: {
              trashItem: vi.fn().mockRejectedValue(new Error('Failed to create FileOperation instance')),
            },
          };
        }
        if (mod === 'child_process') {
          return { exec: mockExec };
        }
        return {};
      });

      const adapter = new ElectronStorageAdapter(mockFs, mockPath, '/workspace/data');
      const ok = await adapter.deleteToTrash('/data/assets/fallback.png');
      expect(ok).toBe(true);
      expect(mockExec).toHaveBeenCalled();
      expect(mockExec.mock.calls[0][0]).toContain('Microsoft.VisualBasic.FileIO.FileSystem');

      delete (window as any).require;
    });
  });

  describe('HttpStorageAdapter trash support', () => {
    it('reports isTrashSupported as false', () => {
      const adapter = new HttpStorageAdapter();
      expect(adapter.isTrashSupported()).toBe(false);
    });
  });

  describe('openOSRecycleBin', () => {
    // 实现按 process.platform / navigator.platform 分支，测试必须显式指定平台，
    // 否则断言结果会随宿主机操作系统漂移（此前只在 Windows 上恰好通过）。
    function stubPlatform(platform: NodeJS.Platform, navigatorPlatform: string) {
      vi.spyOn(process, 'platform', 'get').mockReturnValue(platform);
      vi.spyOn(navigator, 'platform', 'get').mockReturnValue(navigatorPlatform);
    }

    afterEach(() => {
      delete (window as any).require;
    });

    const SHELL_CASES = [
      { platform: 'win32' as NodeJS.Platform, nav: 'Win32', expected: 'shell:RecycleBinFolder' },
      { platform: 'darwin' as NodeJS.Platform, nav: 'MacIntel', expected: '~/.Trash' },
      { platform: 'linux' as NodeJS.Platform, nav: 'Linux x86_64', expected: 'trash:///' },
    ];

    it.each(SHELL_CASES)(
      'invokes electron.shell.openPath with the $platform recycle bin target',
      async ({ platform, nav, expected }) => {
        stubPlatform(platform, nav);
        const { openOSRecycleBin } = await import('../src/utils/storage');
        const mockOpenPath = vi.fn().mockResolvedValue('');
        (window as any).require = vi.fn((mod: string) => {
          if (mod === 'electron') {
            return { shell: { openPath: mockOpenPath } };
          }
          return {};
        });

        const ok = await openOSRecycleBin();
        expect(ok).toBe(true);
        expect(mockOpenPath).toHaveBeenCalledWith(expected);
      }
    );

    const FALLBACK_CASES = [
      { platform: 'win32' as NodeJS.Platform, nav: 'Win32', expected: 'start shell:RecycleBinFolder' },
      { platform: 'darwin' as NodeJS.Platform, nav: 'MacIntel', expected: 'open ~/.Trash' },
      { platform: 'linux' as NodeJS.Platform, nav: 'Linux x86_64', expected: 'xdg-open trash:///' },
    ];

    it.each(FALLBACK_CASES)(
      'falls back to the $platform shell command when electron.shell is unavailable',
      async ({ platform, nav, expected }) => {
        stubPlatform(platform, nav);
        const { openOSRecycleBin } = await import('../src/utils/storage');
        const mockExec = vi.fn();
        (window as any).require = vi.fn((mod: string) => {
          if (mod === 'child_process') {
            return { exec: mockExec };
          }
          return {};
        });

        const ok = await openOSRecycleBin();
        expect(ok).toBe(true);
        expect(mockExec).toHaveBeenCalledWith(expected);
      }
    );
  });
});


import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/api', () => ({
  putFile: vi.fn(),
  removeFile: vi.fn(),
  readDir: vi.fn(),
}));

import {
  normalizeOriginalStoragePath,
  getOriginalAbsoluteDataPath,
  dataURLToBlob,
  ORIGINALS_STORAGE_RELATIVE,
  METADATA_STORAGE_DIR,
  normalizeMetadataFileName,
  getMetadataAbsoluteDataPath,
  saveAssetMetadataFile,
  readAssetMetadataFile,
  deleteAssetMetadataFile,
  listAllAssetMetadataFiles,
} from '../src/utils/file-system';
import { MemoryStorageAdapter, setStorageAdapter } from '../src/utils/storage';

describe('file-system utility tests', () => {
  it('normalizes original storage paths properly', () => {
    expect(normalizeOriginalStoragePath('foo.png')).toBe(
      `${ORIGINALS_STORAGE_RELATIVE}/foo.png`
    );
    expect(
      normalizeOriginalStoragePath('/data/storage/petal/siyuan-assets-manager/originals/foo.png')
    ).toBe(`${ORIGINALS_STORAGE_RELATIVE}/foo.png`);
    expect(
      normalizeOriginalStoragePath('storage/petal/siyuan-assets-manager/originals/foo.png')
    ).toBe(`${ORIGINALS_STORAGE_RELATIVE}/foo.png`);
    expect(normalizeOriginalStoragePath('')).toBe('');
  });

  it('gets original absolute data path correctly', () => {
    expect(getOriginalAbsoluteDataPath('foo.png')).toBe(
      `/data/${ORIGINALS_STORAGE_RELATIVE}/foo.png`
    );
  });

  it('normalizes metadata file names and absolute paths properly', () => {
    expect(normalizeMetadataFileName('image.png')).toBe('image.png.json');
    expect(normalizeMetadataFileName('image.png.json')).toBe('image.png.json');
    expect(normalizeMetadataFileName('/path/to/image.png')).toBe('image.png.json');
    expect(normalizeMetadataFileName('')).toBe('');

    expect(getMetadataAbsoluteDataPath('image.png')).toBe(
      `${METADATA_STORAGE_DIR}/image.png.json`
    );
  });

  it('performs sidecar metadata CRUD via MemoryStorageAdapter', async () => {
    const memory = new MemoryStorageAdapter();
    setStorageAdapter(memory);

    const sampleMeta: any = {
      version: 1,
      originalStoragePath: 'storage/petal/siyuan-assets-manager/originals/orig.png',
      renderedAssetName: 'my_render.png',
      canvasSize: { width: 100, height: 100 },
      compressed: false,
      vectorData: { objects: [] },
      updatedAt: 1000,
    };

    await saveAssetMetadataFile('my_render.png', sampleMeta);

    const read = await readAssetMetadataFile('my_render.png');
    expect(read).toEqual(sampleMeta);

    const list = await listAllAssetMetadataFiles();
    expect(list.length).toBe(1);
    expect(list[0].assetName).toBe('my_render.png');

    const deleted = await deleteAssetMetadataFile('my_render.png');
    expect(deleted).toBe(true);

    const afterDel = await readAssetMetadataFile('my_render.png');
    expect(afterDel).toBeNull();
  });
});

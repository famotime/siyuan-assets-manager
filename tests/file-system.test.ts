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
} from '../src/utils/file-system';

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

  it('converts dataURL to blob correctly', () => {
    const sampleDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const blob = dataURLToBlob(sampleDataUrl);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBeGreaterThan(0);
  });
});

import { describe, it, expect } from 'vitest';
import {
  serializeReEditMetadata,
  deserializeReEditMetadata,
  decodeHtmlEntities,
  isValidReEditMetadata,
  calculateSimpleHash,
  COMPRESSION_THRESHOLD_BYTES,
} from '../src/utils/reedit-data';
import type { IAssetReEditMetadata } from '../src/types/reedit';

describe('reedit-data utility tests', () => {
  it('should validate metadata structure correctly', () => {
    expect(isValidReEditMetadata(null)).toBe(false);
    expect(isValidReEditMetadata({})).toBe(false);
    expect(isValidReEditMetadata({
      version: 1,
      originalStoragePath: 'originals/foo.png',
      renderedAssetName: 'foo-edited.png',
      canvasSize: { width: 800, height: 600 },
    })).toBe(true);
  });

  it('should decode HTML entities correctly', () => {
    const raw = '&#123;&quot;version&quot;:1,&#34;name&#34;:&#34;test&#34;&#125;';
    expect(decodeHtmlEntities(raw)).toBe('{"version":1,"name":"test"}');
  });

  it('should deserialize HTML entity encoded metadata from SiYuan IAL', () => {
    const rawEncoded = '&#123;&quot;version&quot;:1,&quot;originalStoragePath&quot;:&quot;storage/originals/1.png&quot;,&quot;renderedAssetName&quot;:&quot;1_edited.png&quot;,&quot;canvasSize&quot;:&#123;&quot;width&quot;:800,&quot;height&quot;:600&#125;,&quot;compressed&quot;:false,&quot;vectorData&quot;:&#123;&quot;objects&quot;:[&#123;&quot;type&quot;:&quot;rect&quot;,&quot;left&quot;:10,&quot;top&quot;:20&#125;]&#125;,&quot;updatedAt&quot;:123456&#125;';
    const restored = deserializeReEditMetadata(rawEncoded);

    expect(restored).not.toBeNull();
    expect(restored?.originalStoragePath).toBe('storage/originals/1.png');
    expect(restored?.renderedAssetName).toBe('1_edited.png');
    expect(restored?.canvasSize).toEqual({ width: 800, height: 600 });
    expect(restored?.vectorData.objects.length).toBe(1);
  });

  it('should serialize and deserialize small vector data (< 2KB) without compression', () => {
    const rawMeta: IAssetReEditMetadata = {
      version: 1,
      originalStoragePath: 'originals/image-001.png',
      renderedAssetName: 'image-001-edited.png',
      canvasSize: { width: 800, height: 600 },
      compressed: false,
      vectorData: {
        objects: [
          { type: 'rect', left: 10, top: 20, width: 100, height: 50, fill: '#ff0000' },
          { type: 'text', left: 30, top: 40, text: 'Hello Siyuan', fontSize: 16 },
        ],
        version: '4.6.0',
      },
      updatedAt: 1720000000000,
    };

    const serialized = serializeReEditMetadata(rawMeta);
    expect(serialized).toBeTypeOf('string');

    const parsedJson = JSON.parse(serialized);
    expect(parsedJson.compressed).toBe(false);
    expect(parsedJson.vectorData).toBeTypeOf('object');
    expect(parsedJson.vectorData.objects.length).toBe(2);

    const restored = deserializeReEditMetadata(serialized);
    expect(restored).not.toBeNull();
    expect(restored?.originalStoragePath).toBe('originals/image-001.png');
    expect(restored?.canvasSize).toEqual({ width: 800, height: 600 });
    expect(restored?.vectorData.objects.length).toBe(2);
    expect(restored?.vectorData.objects[0].type).toBe('rect');
    expect(restored?.vectorData.objects[1].text).toBe('Hello Siyuan');
  });

  it('should serialize and deserialize large vector data (>= 2KB) with LZString compression', () => {
    // 创建一个超过 2KB 的矢量图层数据
    const largeObjects = Array.from({ length: 40 }).map((_, index) => ({
      type: 'path',
      path: `M ${index * 10} 0 L ${index * 10 + 50} 50 L ${index * 10 + 100} 0 Z`,
      stroke: '#007aff',
      strokeWidth: 3,
      fill: 'rgba(0, 122, 255, 0.2)',
      left: index * 20,
      top: index * 15,
      width: 120,
      height: 60,
      id: `vector_path_${index}`,
    }));

    const rawMeta: IAssetReEditMetadata = {
      version: 1,
      originalStoragePath: 'originals/complex-canvas.png',
      renderedAssetName: 'complex-canvas-edited.png',
      canvasSize: { width: 1920, height: 1080 },
      compressed: false,
      vectorData: {
        objects: largeObjects,
        version: '4.6.0',
      },
      updatedAt: 1720000000000,
    };

    const serialized = serializeReEditMetadata(rawMeta);
    const parsedJson = JSON.parse(serialized);

    expect(parsedJson.compressed).toBe(true);
    expect(parsedJson.vectorData).toBeTypeOf('string');

    // 验证反序列化能完美恢复
    const restored = deserializeReEditMetadata(serialized);
    expect(restored).not.toBeNull();
    expect(restored?.compressed).toBe(true);
    expect(restored?.vectorData.objects.length).toBe(40);
    expect(restored?.vectorData.objects[0].id).toBe('vector_path_0');
    expect(restored?.vectorData.objects[39].id).toBe('vector_path_39');
  });

  it('should handle invalid or corrupted input gracefully', () => {
    expect(deserializeReEditMetadata('')).toBeNull();
    expect(deserializeReEditMetadata('   ')).toBeNull();
    expect(deserializeReEditMetadata(null)).toBeNull();
    expect(deserializeReEditMetadata(undefined)).toBeNull();
    expect(deserializeReEditMetadata('not a json')).toBeNull();
    expect(deserializeReEditMetadata(JSON.stringify({ someKey: 'invalid' }))).toBeNull();
  });

  it('should calculate hash consistently', () => {
    const hash1 = calculateSimpleHash('test-content-string');
    const hash2 = calculateSimpleHash('test-content-string');
    const hash3 = calculateSimpleHash('different-string');

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash1.length).toBeGreaterThan(0);
  });
});

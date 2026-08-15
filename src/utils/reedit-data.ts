import LZString from 'lz-string';
import type { IAssetReEditMetadata, IVectorLayerData } from '../types/reedit';
import { warn, error } from './logger';

/** 自适应压缩阈值（字节）：大于等于 2KB 时进行 lz-string 压缩 */
export const COMPRESSION_THRESHOLD_BYTES = 2048;

/**
 * 解码 HTML 实体（支持命名实体、十进制数值实体 &#123; 与十六进制实体 &#x7B;）
 */
export function decodeHtmlEntities(text: string): string {
  if (!text || typeof text !== 'string') return '';
  if (!text.includes('&')) return text;

  let decoded = text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#123;/g, '{')
    .replace(/&#125;/g, '}')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#58;/g, ':')
    .replace(/&#44;/g, ',')
    .replace(/&#92;/g, '\\')
    .replace(/&#91;/g, '[')
    .replace(/&#93;/g, ']')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/g, '&');

  return decoded;
}

/**
 * 校验数据是否符合二次编辑元数据基本结构
 */
export function isValidReEditMetadata(data: any): data is IAssetReEditMetadata {
  if (!data || typeof data !== 'object') return false;
  if (typeof data.version !== 'number') return false;
  if (typeof data.originalStoragePath !== 'string' || !data.originalStoragePath) return false;
  if (typeof data.renderedAssetName !== 'string' || !data.renderedAssetName) return false;
  if (!data.canvasSize || typeof data.canvasSize.width !== 'number' || typeof data.canvasSize.height !== 'number') {
    return false;
  }
  return true;
}

/**
 * 序列化二次编辑元数据为写入思源块属性的紧凑字符串
 * 自动根据 vectorData 体积大小进行自适应 lz-string 压缩
 */
export function serializeReEditMetadata(metadata: IAssetReEditMetadata): string {
  try {
    let vectorJsonString: string;
    let vectorObj: IVectorLayerData = { objects: [] };

    if (typeof metadata.vectorData === 'string') {
      vectorJsonString = metadata.vectorData;
      try {
        vectorObj = JSON.parse(metadata.vectorData);
      } catch (e) {
        vectorObj = { objects: [] };
      }
    } else if (metadata.vectorData && typeof metadata.vectorData === 'object') {
      vectorObj = metadata.vectorData;
      vectorJsonString = JSON.stringify(metadata.vectorData);
    } else {
      vectorJsonString = JSON.stringify({ objects: [] });
    }

    const byteLength = new Blob([vectorJsonString]).size;
    const shouldCompress = byteLength >= COMPRESSION_THRESHOLD_BYTES;

    const payload: IAssetReEditMetadata = {
      version: metadata.version || 1,
      originalStoragePath: metadata.originalStoragePath,
      originalHash: metadata.originalHash,
      renderedAssetName: metadata.renderedAssetName,
      canvasSize: {
        width: Math.round(metadata.canvasSize.width),
        height: Math.round(metadata.canvasSize.height),
      },
      compressed: shouldCompress,
      vectorData: shouldCompress
        ? LZString.compressToEncodedURIComponent(vectorJsonString)
        : vectorObj,
      updatedAt: metadata.updatedAt || Date.now(),
    };

    return JSON.stringify(payload);
  } catch (err) {
    error('[reedit-data] 序列化二次编辑元数据失败:', err);
    throw err;
  }
}

/**
 * 反序列化从思源块属性读取的元数据字符串
 * 自动处理 HTML 实体解码与 lz-string 解压缩并还原矢量图层对象
 */
export function deserializeReEditMetadata(rawString: string | null | undefined): IAssetReEditMetadata | null {
  if (!rawString || typeof rawString !== 'string' || rawString.trim() === '') {
    return null;
  }

  let cleaned = rawString.trim();
  if (cleaned.includes('&')) {
    cleaned = decodeHtmlEntities(cleaned);
  }

  try {
    const parsed = JSON.parse(cleaned);
    if (!isValidReEditMetadata(parsed)) {
      warn('[reedit-data] 解析到的元数据结构不合法:', parsed);
      return null;
    }

    // 处理矢量数据解压
    if (parsed.compressed && typeof parsed.vectorData === 'string') {
      let decompressed = LZString.decompressFromEncodedURIComponent(parsed.vectorData);
      if (!decompressed && parsed.vectorData.includes('&')) {
        decompressed = LZString.decompressFromEncodedURIComponent(decodeHtmlEntities(parsed.vectorData));
      }
      if (decompressed) {
        parsed.vectorData = JSON.parse(decompressed);
      } else {
        warn('[reedit-data] LZString 解压失败，回退为空矢量数据');
        parsed.vectorData = { objects: [] };
      }
    } else if (typeof parsed.vectorData === 'string') {
      try {
        parsed.vectorData = JSON.parse(decodeHtmlEntities(parsed.vectorData));
      } catch (e) {
        parsed.vectorData = { objects: [] };
      }
    } else if (!parsed.vectorData || typeof parsed.vectorData !== 'object') {
      parsed.vectorData = { objects: [] };
    }

    return parsed;
  } catch (err) {
    warn('[reedit-data] 反序列化二次编辑元数据失败:', err);
    return null;
  }
}

/**
 * 计算简易校验 Hash (用于快速对比原始底图或矢量数据是否发生变更)
 */
export function calculateSimpleHash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

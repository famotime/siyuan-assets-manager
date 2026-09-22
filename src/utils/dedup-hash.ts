import { warn } from './logger';

export const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'svg', 'ico', 'avif', 'tiff'
]);

/**
 * 判断是否为图片资源
 */
export function isImageFile(fileName: string): boolean {
  if (!fileName) return false;
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  return IMAGE_EXTENSIONS.has(ext);
}

/**
 * 安全地将 Blob 转换为 ArrayBuffer (兼容各类环境)
 */
export async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof (blob as any).arrayBuffer === 'function') {
    return await (blob as any).arrayBuffer();
  }
  if (typeof (blob as any).bytes === 'function') {
    const bytes = await (blob as any).bytes();
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  if (typeof (blob as any).text === 'function') {
    try {
      const text = await (blob as any).text();
      const encoder = new TextEncoder();
      const u8 = encoder.encode(text);
      return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    } catch (e) {}
  }
  return new Promise((resolve) => {
    if (typeof FileReader === 'undefined') {
      resolve(new ArrayBuffer(0));
      return;
    }
    const reader = new FileReader();
    reader.onload = (event: any) => {
      const res = event?.target?.result || reader.result;
      resolve(res as ArrayBuffer);
    };
    reader.onerror = () => {
      resolve(new ArrayBuffer(0));
    };
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * 计算 Blob 数据的 SHA-256 哈希值
 */
export async function computeFileHash(blob: Blob): Promise<string> {
  const arrayBuffer = await blobToArrayBuffer(blob);
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // 简易保底哈希算法（极端无 crypto.subtle 环境）
  const u8 = new Uint8Array(arrayBuffer);
  let h1 = 0xdeadbeef, h2 = 0x41c64e6d;
  for (let i = 0; i < u8.length; i++) {
    const ch = u8[i];
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(16, '0');
}

/**
 * 基于 9x8 灰度矩阵生成 64-bit dHash（差异哈希）
 * 比较水平相邻像素亮度差，每行 8 次比较，共 64 位
 */
export function computeDHashFromGrayscale(grayMatrix: number[][]): string {
  let bits = '';
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const left = grayMatrix[row]?.[col] ?? 0;
      const right = grayMatrix[row]?.[col + 1] ?? 0;
      bits += left > right ? '1' : '0';
    }
  }
  return bits.padEnd(64, '0');
}

/**
 * 从图片 Blob 计算 dHash 感知哈希与分辨率
 */
export async function computeImageDHash(blob: Blob): Promise<{ dHash: string; width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || typeof Image === 'undefined') {
      resolve(null);
      return;
    }

    const img = new Image();
    let url = '';
    try {
      url = typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(blob) : '';
    } catch (e) {
      resolve(null);
      return;
    }

    let isDone = false;
    const timer = setTimeout(() => {
      if (!isDone) {
        isDone = true;
        if (url) {
          try { URL.revokeObjectURL(url); } catch (e) {}
        }
        resolve(null);
      }
    }, 1500);

    const cleanup = () => {
      isDone = true;
      clearTimeout(timer);
      if (url) {
        try { URL.revokeObjectURL(url); } catch (e) {}
      }
    };

    img.crossOrigin = 'anonymous';

    img.onload = () => {
      if (isDone) return;
      try {
        const width = img.naturalWidth || img.width || 0;
        const height = img.naturalHeight || img.height || 0;

        const canvas = document.createElement('canvas');
        canvas.width = 9;
        canvas.height = 8;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          cleanup();
          resolve(null);
          return;
        }

        ctx.drawImage(img, 0, 0, 9, 8);
        const imgData = ctx.getImageData(0, 0, 9, 8);
        const data = imgData.data;

        const grayMatrix: number[][] = [];
        for (let row = 0; row < 8; row++) {
          const rowData: number[] = [];
          for (let col = 0; col < 9; col++) {
            const idx = (row * 9 + col) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            // 标准灰度加权公式
            const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
            rowData.push(gray);
          }
          grayMatrix.push(rowData);
        }

        const dHash = computeDHashFromGrayscale(grayMatrix);
        cleanup();
        resolve({ dHash, width, height });
      } catch (err) {
        warn('[deduplicate] computeImageDHash error:', err);
        cleanup();
        resolve(null);
      }
    };

    img.onerror = () => {
      if (isDone) return;
      cleanup();
      resolve(null);
    };

    img.src = url;
  });
}

/**
 * 计算两个 64-bit 哈希的汉明距离（不同位的数量，0~64）
 */
export function calculateHammingDistance(hashA: string, hashB: string): number {
  if (!hashA || !hashB || hashA.length !== hashB.length) return 64;
  let dist = 0;
  for (let i = 0; i < hashA.length; i++) {
    if (hashA[i] !== hashB[i]) {
      dist++;
    }
  }
  return dist;
}

/**
 * 将汉明距离转换为 0.0 ~ 1.0 的相似度百分比
 */
export function calculateDHashSimilarity(hashA: string, hashB: string): number {
  const dist = calculateHammingDistance(hashA, hashB);
  return Math.max(0, 1 - dist / 64);
}

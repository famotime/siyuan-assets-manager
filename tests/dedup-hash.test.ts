import { describe, expect, it } from 'vitest';
import {
  isImageFile,
  computeFileHash,
  computeDHashFromGrayscale,
  calculateHammingDistance,
  calculateDHashSimilarity,
} from '../src/utils/dedup-hash';

describe('dedup-hash algorithms', () => {
  describe('isImageFile', () => {
    it('identifies image file extensions correctly', () => {
      expect(isImageFile('pic.png')).toBe(true);
      expect(isImageFile('photo.JPG')).toBe(true);
      expect(isImageFile('banner.webp')).toBe(true);
      expect(isImageFile('doc.pdf')).toBe(false);
      expect(isImageFile('archive.tar.gz')).toBe(false);
      expect(isImageFile('')).toBe(false);
    });
  });

  describe('computeFileHash', () => {
    it('computes sha256 hash for blob data', async () => {
      const blob = new Blob(['hello world']);
      const hash = await computeFileHash(blob);
      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(64);
      // 'hello world' sha256 is b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9
      expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
    });

    it('returns consistent hash for identical blob contents', async () => {
      const b1 = new Blob(['test content 123']);
      const b2 = new Blob(['test content 123']);
      const h1 = await computeFileHash(b1);
      const h2 = await computeFileHash(b2);
      expect(h1).toBe(h2);
    });
  });

  describe('computeDHashFromGrayscale', () => {
    it('generates 64-bit binary string from 8x9 grayscale matrix', () => {
      // 构造全 0 矩阵 -> 左右相等 -> '0'
      const zeros = Array(8).fill(0).map(() => Array(9).fill(100));
      const hashZeros = computeDHashFromGrayscale(zeros);
      expect(hashZeros.length).toBe(64);
      expect(hashZeros).toBe('0'.repeat(64));

      // 构造左侧比右侧大的矩阵 -> left > right -> '1'
      const gradient = Array(8).fill(0).map(() => [9, 8, 7, 6, 5, 4, 3, 2, 1]);
      const hashGradient = computeDHashFromGrayscale(gradient);
      expect(hashGradient.length).toBe(64);
      expect(hashGradient).toBe('1'.repeat(64));
    });
  });

  describe('calculateHammingDistance & calculateDHashSimilarity', () => {
    it('calculates hamming distance and similarity accurately', () => {
      const hA = '1'.repeat(64);
      const hB = '1'.repeat(64);
      expect(calculateHammingDistance(hA, hB)).toBe(0);
      expect(calculateDHashSimilarity(hA, hB)).toBe(1.0);

      const hC = '0'.repeat(64);
      expect(calculateHammingDistance(hA, hC)).toBe(64);
      expect(calculateDHashSimilarity(hA, hC)).toBe(0.0);

      // 差异 16 位 -> distance 16, similarity = 1 - 16/64 = 0.75
      const hD = '0'.repeat(16) + '1'.repeat(48);
      expect(calculateHammingDistance(hA, hD)).toBe(16);
      expect(calculateDHashSimilarity(hA, hD)).toBe(0.75);
    });

    it('handles invalid inputs gracefully', () => {
      expect(calculateHammingDistance('', '123')).toBe(64);
      expect(calculateDHashSimilarity('', '')).toBe(0);
    });
  });
});

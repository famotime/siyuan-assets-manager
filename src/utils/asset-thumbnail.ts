import { ref } from 'vue'
import type { AssetInfo } from './asset-model'
import { readOriginalImage } from './file-system'
import { defaultStorage } from './storage'

/**
 * 资源缩略图 Blob URL 缓存（从 VirtualAssetList.vue / DocumentAssetGroupList.vue
 * 逐行等价的重复实现收敛而来）。
 *
 * 行为契约：
 * - 普通资产直接返回 `/assets/<name>?t=<updated>` 内核直链；
 * - 隔离存储的原始底图（isOriginal）与画布专属资产（isCanvasAsset）按需异步加载
 *   Blob 并生成 ObjectURL，加载完成前返回 ''（模板渲染占位）；
 * - 同一资产并发去重（loading 集合），失败静默降级并允许下次重试；
 * - invalidate 释放并移除单个资产的 ObjectURL；dispose 释放全部；
 * - ObjectURL 的创建/释放由调用方通过组件 onUnmounted 调 dispose 兜底。
 */

export interface ThumbnailCacheDeps {
  /** 读取隔离存储的原始底图 Blob（默认 readOriginalImage） */
  readOriginalImage?: (name: string) => Promise<Blob | null>
  /** 读取画布专属资产 Blob（默认 defaultStorage.read） */
  readCanvasAsset?: (path: string) => Promise<Blob | null>
}

export interface ThumbnailCache {
  getThumbnailSrc: (asset: AssetInfo) => string
  invalidate: (assetName: string) => void
  dispose: () => void
}

export function createThumbnailCache(deps: ThumbnailCacheDeps = {}): ThumbnailCache {
  const readOriginal = deps.readOriginalImage ?? readOriginalImage
  const readCanvas = deps.readCanvasAsset ?? ((path: string) => defaultStorage.read(path))

  const blobUrlMap = ref<Record<string, string>>({})
  const loading = new Set<string>()

  async function loadOriginalBlobUrl(asset: AssetInfo) {
    if (!asset.isOriginal || blobUrlMap.value[asset.name] || loading.has(asset.name)) {
      return;
    }
    loading.add(asset.name);
    try {
      const blob = await readOriginal(asset.originalStoragePath || asset.name);
      if (blob) {
        blobUrlMap.value[asset.name] = URL.createObjectURL(blob);
      }
    } catch (e) {
      // 降级处理
    } finally {
      loading.delete(asset.name);
    }
  }

  async function loadCanvasAssetBlobUrl(asset: AssetInfo) {
    if (!asset.isCanvasAsset || blobUrlMap.value[asset.name] || loading.has(asset.name)) {
      return;
    }
    loading.add(asset.name);
    try {
      const blob = await readCanvas(asset.canvasAssetStoragePath || asset.name);
      if (blob) {
        blobUrlMap.value[asset.name] = URL.createObjectURL(blob);
      }
    } catch (e) {
    } finally {
      loading.delete(asset.name);
    }
  }

  function getThumbnailSrc(asset: AssetInfo): string {
    if (asset.isOriginal) {
      if (blobUrlMap.value[asset.name]) {
        return blobUrlMap.value[asset.name];
      }
      loadOriginalBlobUrl(asset);
      return '';
    }
    if (asset.isCanvasAsset) {
      if (blobUrlMap.value[asset.name]) {
        return blobUrlMap.value[asset.name];
      }
      loadCanvasAssetBlobUrl(asset);
      return '';
    }
    const versionQuery = asset.updated ? `?t=${asset.updated}` : '';
    return `/assets/${asset.name}${versionQuery}`;
  }

  function invalidate(assetName: string) {
    if (blobUrlMap.value[assetName]) {
      try {
        URL.revokeObjectURL(blobUrlMap.value[assetName]);
      } catch (e) {}
      delete blobUrlMap.value[assetName];
    }
  }

  function dispose() {
    for (const url of Object.values(blobUrlMap.value)) {
      try {
        URL.revokeObjectURL(url);
      } catch (e) {}
    }
    blobUrlMap.value = {};
    loading.clear();
  }

  return {
    getThumbnailSrc,
    invalidate,
    dispose,
  };
}

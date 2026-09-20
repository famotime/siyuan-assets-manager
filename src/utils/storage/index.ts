import type { IStorageAdapter, FileStat, StorageEntry } from './types';
import { blobToText } from './types';
import type { IAssetReEditMetadata } from '../../types/reedit';
import { ElectronStorageAdapter } from './electron-adapter';
import { HttpStorageAdapter } from './http-adapter';

export * from './types';
export * from './electron-adapter';
export * from './http-adapter';
export * from './memory-adapter';

/** 原始底图在思源中的存储根目录（绝对路径） */
export const ORIGINALS_STORAGE_DIR = '/data/storage/petal/siyuan-assets-manager/originals';

/** 原始底图相对路径前缀 */
export const ORIGINALS_STORAGE_RELATIVE = 'storage/petal/siyuan-assets-manager/originals';

/** 二次编辑元数据在思源中的存储根目录（绝对路径） */
export const METADATA_STORAGE_DIR = '/data/storage/petal/siyuan-assets-manager/metadata';

/** 二次编辑元数据相对路径前缀 */
export const METADATA_STORAGE_RELATIVE = 'storage/petal/siyuan-assets-manager/metadata';

/**
 * 规范化元数据文件名（例如 foo.png -> foo.png.json，如果已经带 .json 则保持）
 */
export function normalizeMetadataFileName(assetName: string): string {
  if (!assetName) return '';
  const clean = assetName.split('/').pop() || assetName;
  if (clean.endsWith('.json')) {
    return clean;
  }
  return `${clean}.json`;
}

/**
 * 获取元数据的绝对访问路径 (如 "/data/storage/petal/siyuan-assets-manager/metadata/foo.png.json")
 */
export function getMetadataAbsoluteDataPath(assetName: string): string {
  const file = normalizeMetadataFileName(assetName);
  return `${METADATA_STORAGE_DIR}/${file}`;
}

/**
 * 规范化原始底图路径为相对路径 (如 "storage/petal/siyuan-assets-manager/originals/foo.png")
 */
export function normalizeOriginalStoragePath(pathOrName: string): string {
  if (!pathOrName) return '';
  let clean = pathOrName.replace(/^\/+/, '').replace(/^data\//, '');
  if (!clean.startsWith(ORIGINALS_STORAGE_RELATIVE)) {
    const baseName = clean.split('/').pop() || clean;
    clean = `${ORIGINALS_STORAGE_RELATIVE}/${baseName}`;
  }
  return clean;
}

/**
 * 获取原始底图的绝对访问路径 (如 "/data/storage/petal/siyuan-assets-manager/originals/foo.png")
 */
export function getOriginalAbsoluteDataPath(storagePath: string): string {
  const relative = normalizeOriginalStoragePath(storagePath);
  return `/data/${relative}`;
}

let customAdapter: IStorageAdapter | null = null;

export function setStorageAdapter(adapter: IStorageAdapter | null): void {
  customAdapter = adapter;
}

export function detectStorageAdapter(): IStorageAdapter {
  if (customAdapter) {
    return customAdapter;
  }

  let fs: any;
  let pathLib: any;
  let dataDir = '';
  try {
    const req =
      (typeof window !== 'undefined' && (window as any).require) ||
      (typeof require !== 'undefined' ? require : null);
    if (req) {
      fs = req('fs');
      pathLib = req('path');
    }
    dataDir = (window as any).siyuan?.config?.system?.dataDir;
    if (!dataDir && (window as any).siyuan?.workspaceDir && pathLib) {
      dataDir = pathLib.join((window as any).siyuan.workspaceDir, 'data');
    }
  } catch (e) {}

  if (fs && pathLib && dataDir) {
    return new ElectronStorageAdapter(fs, pathLib, dataDir);
  }

  return new HttpStorageAdapter();
}

/**
 * 深度门面：封装底层文件系统与思源 Kernel I/O 缝隙 (Seam)
 */
export class StorageClient {
  constructor(private adapterProvider: () => IStorageAdapter = detectStorageAdapter) {}

  get adapter(): IStorageAdapter {
    return this.adapterProvider();
  }

  async stat(absolutePath: string): Promise<FileStat | null> {
    return this.adapter.stat(absolutePath);
  }

  async read(absolutePath: string): Promise<Blob | null> {
    return this.adapter.read(absolutePath);
  }

  async write(absolutePath: string, content: Blob): Promise<void> {
    return this.adapter.write(absolutePath, content);
  }

  async delete(absolutePath: string): Promise<boolean> {
    return this.adapter.delete(absolutePath);
  }

  async list(dirPath: string): Promise<StorageEntry[]> {
    return this.adapter.list(dirPath);
  }

  // --- 资产目录领域方法 ---

  async saveAsset(fileName: string, blob: Blob): Promise<void> {
    return this.write(`/data/assets/${fileName}`, blob);
  }

  async readAsset(fileName: string): Promise<Blob | null> {
    return this.read(`/data/assets/${fileName}`);
  }

  async deleteAsset(fileName: string): Promise<boolean> {
    return this.delete(`/data/assets/${fileName}`);
  }

  isTrashSupported(): boolean {
    return typeof (this.adapter as any).isTrashSupported === 'function'
      ? (this.adapter as any).isTrashSupported()
      : false;
  }

  async deleteAssetToTrash(fileName: string): Promise<boolean> {
    const absolutePath = `/data/assets/${fileName}`;
    if (typeof (this.adapter as any).deleteToTrash === 'function') {
      return (this.adapter as any).deleteToTrash(absolutePath);
    }
    return this.delete(absolutePath);
  }

  async statAsset(fileName: string): Promise<FileStat | null> {
    return this.stat(`/data/assets/${fileName}`);
  }

  // --- 原始底图领域方法 ---

  async saveOriginal(baseName: string, blob: Blob): Promise<string> {
    const cleanBase = baseName.split('/').pop() || 'original.png';
    const uniqueName = `${Date.now()}_${cleanBase}`;
    const relativePath = `${ORIGINALS_STORAGE_RELATIVE}/${uniqueName}`;
    const absolutePath = `/data/${relativePath}`;
    await this.write(absolutePath, blob);
    return relativePath;
  }

  async readOriginal(storagePathOrName: string): Promise<Blob | null> {
    const absolutePath = getOriginalAbsoluteDataPath(storagePathOrName);
    return this.read(absolutePath);
  }

  async deleteOriginal(storagePathOrName: string): Promise<boolean> {
    const absolutePath = getOriginalAbsoluteDataPath(storagePathOrName);
    return this.delete(absolutePath);
  }

  async deleteOriginalToTrash(storagePathOrName: string): Promise<boolean> {
    const absolutePath = getOriginalAbsoluteDataPath(storagePathOrName);
    if (typeof (this.adapter as any).deleteToTrash === 'function') {
      return (this.adapter as any).deleteToTrash(absolutePath);
    }
    return this.delete(absolutePath);
  }

  async listOriginals(): Promise<Array<{ name: string; path: string; size: number; updated: number }>> {
    const entries = await this.list(ORIGINALS_STORAGE_DIR);
    return entries
      .filter((e) => !e.isDir)
      .map((e) => ({
        name: e.name,
        path: `${ORIGINALS_STORAGE_RELATIVE}/${e.name}`,
        size: e.size || 0,
        updated: e.updated || 0,
      }));
  }

  // --- 资产二次编辑 Sidecar 元数据领域方法 ---

  async saveAssetMetadata(assetName: string, metadata: IAssetReEditMetadata): Promise<void> {
    const absolutePath = getMetadataAbsoluteDataPath(assetName);
    const jsonStr = JSON.stringify(metadata, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    await this.write(absolutePath, blob);
  }

  async readAssetMetadata(assetName: string): Promise<IAssetReEditMetadata | null> {
    const absolutePath = getMetadataAbsoluteDataPath(assetName);
    const blob = await this.read(absolutePath);
    if (!blob) return null;
    try {
      const text = await blobToText(blob);
      if (!text) return null;
      const data = JSON.parse(text);
      return data as IAssetReEditMetadata;
    } catch (e) {
      return null;
    }
  }

  async deleteAssetMetadata(assetName: string): Promise<boolean> {
    const absolutePath = getMetadataAbsoluteDataPath(assetName);
    return this.delete(absolutePath);
  }

  async listAssetMetadata(): Promise<Array<{ assetName: string; metadata: IAssetReEditMetadata }>> {
    const entries = await this.list(METADATA_STORAGE_DIR);
    const results: Array<{ assetName: string; metadata: IAssetReEditMetadata }> = [];
    for (const entry of entries) {
      if (entry.isDir || !entry.name.endsWith('.json')) continue;
      const meta = await this.readAssetMetadata(entry.name);
      if (meta) {
        const assetName = meta.renderedAssetName || entry.name.replace(/\.json$/, '');
        results.push({ assetName, metadata: meta });
      }
    }
    return results;
  }
}

export const defaultStorage = new StorageClient();

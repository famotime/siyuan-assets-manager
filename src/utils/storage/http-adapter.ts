import type { IStorageAdapter, FileStat, StorageEntry } from './types';
import { putFile, removeFile, readDir } from '../../api';
import { log, error } from '../logger';

export class HttpStorageAdapter implements IStorageAdapter {
  async stat(absolutePath: string): Promise<FileStat | null> {
    let url = absolutePath;
    if (url.startsWith('/data/assets/')) {
      url = url.replace('/data/assets/', '/assets/');
    }
    try {
      const response = await fetch(url, { method: 'HEAD' });
      if (!response.ok) return null;
      const contentLength = response.headers.get('content-length');
      const lastModified = response.headers.get('last-modified');
      return {
        size: contentLength ? parseInt(contentLength, 10) : 0,
        updated: lastModified ? Date.parse(lastModified) || Date.now() : Date.now(),
        isDir: false,
      };
    } catch (e) {
      return null;
    }
  }

  async read(absolutePath: string): Promise<Blob | null> {
    try {
      if (absolutePath.startsWith('/data/assets/')) {
        const assetName = absolutePath.replace('/data/assets/', '');
        const response = await fetch(`/assets/${assetName}`);
        if (response.ok) return await response.blob();
      }
      const response = await fetch('/api/file/getFile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: absolutePath }),
      });
      if (response.ok) {
        return await response.blob();
      }
    } catch (e) {
      error(`[HttpStorageAdapter] read failed for ${absolutePath}:`, e);
    }
    return null;
  }

  async write(absolutePath: string, content: Blob): Promise<void> {
    const fileName = absolutePath.split('/').pop() || 'file';
    const file = new File([content], fileName, { type: content.type || 'application/octet-stream' });
    const form = new FormData();
    form.append('path', absolutePath);
    form.append('isDir', 'false');
    form.append('modTime', Math.floor(Date.now() / 1000).toString());
    form.append('file', file);

    try {
      const res = await fetch('/api/file/putFile', {
        method: 'POST',
        body: form,
      });
      const json = await res.json();
      if (json.code !== 0) {
        throw new Error(json.msg || `putFile returned code ${json.code}`);
      }
      log(`[HttpStorageAdapter] fetch putFile succeeded for ${absolutePath}`);
    } catch (apiErr) {
      error(`[HttpStorageAdapter] fetch putFile failed, fallback to putFile helper:`, apiErr);
      await putFile(absolutePath, false, file);
    }
  }

  async delete(absolutePath: string): Promise<boolean> {
    try {
      await removeFile(absolutePath);
      return true;
    } catch (e) {
      error(`[HttpStorageAdapter] delete failed for ${absolutePath}:`, e);
      return false;
    }
  }

  async list(dirPath: string): Promise<StorageEntry[]> {
    try {
      const files: any[] = await readDir(dirPath);
      if (!files || !Array.isArray(files)) return [];
      return files.map((f) => ({
        name: f.name,
        isDir: Boolean(f.isDir),
        size: f.size || 0,
        updated: f.updated || 0,
      }));
    } catch (e) {
      error(`[HttpStorageAdapter] list failed for ${dirPath}:`, e);
      return [];
    }
  }
}

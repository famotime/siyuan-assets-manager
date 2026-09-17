import type { IStorageAdapter, FileStat, StorageEntry } from './types';

export class MemoryStorageAdapter implements IStorageAdapter {
  private files = new Map<string, { blob: Blob; stat: FileStat }>();

  async stat(absolutePath: string): Promise<FileStat | null> {
    return this.files.get(absolutePath)?.stat || null;
  }

  async read(absolutePath: string): Promise<Blob | null> {
    return this.files.get(absolutePath)?.blob || null;
  }

  async write(absolutePath: string, content: Blob): Promise<void> {
    this.files.set(absolutePath, {
      blob: content,
      stat: {
        size: content.size,
        updated: Date.now(),
        isDir: false,
      },
    });
  }

  async delete(absolutePath: string): Promise<boolean> {
    return this.files.delete(absolutePath);
  }

  async list(dirPath: string): Promise<StorageEntry[]> {
    const cleanDir = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
    const entries: StorageEntry[] = [];
    for (const [path, item] of this.files.entries()) {
      if (path.startsWith(cleanDir)) {
        const sub = path.slice(cleanDir.length);
        if (!sub.includes('/')) {
          entries.push({
            name: sub,
            isDir: false,
            size: item.stat.size,
            updated: item.stat.updated,
          });
        }
      }
    }
    return entries;
  }
}

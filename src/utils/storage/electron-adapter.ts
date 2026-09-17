import { type IStorageAdapter, type FileStat, type StorageEntry, blobToArrayBuffer } from './types';
import { log, error } from '../logger';

export class ElectronStorageAdapter implements IStorageAdapter {
  constructor(private fs: any, private pathLib: any, private dataDir: string) {}

  private resolveRealPath(absPath: string): string {
    const rel = absPath.replace(/^\/?data\//, '').replace(/^\/+/, '');
    return this.pathLib.join(this.dataDir, rel);
  }

  async stat(absolutePath: string): Promise<FileStat | null> {
    try {
      const realPath = this.resolveRealPath(absolutePath);
      let targetPath = realPath;
      if (!this.fs.existsSync(targetPath)) {
        try {
          const decoded = decodeURIComponent(targetPath);
          if (this.fs.existsSync(decoded)) {
            targetPath = decoded;
          } else {
            return null;
          }
        } catch (e) {
          return null;
        }
      }
      const st = this.fs.statSync(targetPath);
      return {
        size: st.size,
        updated: st.mtimeMs || Date.now(),
        isDir: typeof st.isDirectory === 'function' ? st.isDirectory() : false,
      };
    } catch (e) {
      return null;
    }
  }

  async read(absolutePath: string): Promise<Blob | null> {
    try {
      const realPath = this.resolveRealPath(absolutePath);
      if (this.fs.existsSync(realPath)) {
        const buffer = this.fs.readFileSync(realPath);
        return new Blob([buffer]);
      }
    } catch (e) {
      error(`[ElectronStorageAdapter] read failed for ${absolutePath}:`, e);
    }
    return null;
  }

  async write(absolutePath: string, content: Blob): Promise<void> {
    const realPath = this.resolveRealPath(absolutePath);
    const dir = this.pathLib.dirname(realPath);
    if (!this.fs.existsSync(dir)) {
      this.fs.mkdirSync(dir, { recursive: true });
    }
    const arrayBuffer = await blobToArrayBuffer(content);
    const buffer = Buffer.from(arrayBuffer);
    this.fs.writeFileSync(realPath, buffer);
    log(`[ElectronStorageAdapter] writeFileSync succeeded for ${absolutePath}`);
  }

  async delete(absolutePath: string): Promise<boolean> {
    try {
      const realPath = this.resolveRealPath(absolutePath);
      if (this.fs.existsSync(realPath)) {
        this.fs.unlinkSync(realPath);
        return true;
      }
    } catch (e) {
      error(`[ElectronStorageAdapter] unlinkSync failed for ${absolutePath}:`, e);
    }
    return false;
  }

  async list(dirPath: string): Promise<StorageEntry[]> {
    try {
      const realPath = this.resolveRealPath(dirPath);
      if (!this.fs.existsSync(realPath)) return [];
      const entries = this.fs.readdirSync(realPath, { withFileTypes: true });
      return entries.map((entry: any) => {
        const isDir = typeof entry.isDirectory === 'function' ? entry.isDirectory() : Boolean(entry.isDir);
        const fullPath = this.pathLib.join(realPath, entry.name);
        let size = 0;
        let updated = 0;
        try {
          const st = this.fs.statSync(fullPath);
          size = st.size;
          updated = st.mtimeMs || 0;
        } catch (e) {}
        return {
          name: entry.name,
          isDir,
          size,
          updated,
        };
      });
    } catch (e) {
      error(`[ElectronStorageAdapter] list failed for ${dirPath}:`, e);
      return [];
    }
  }
}

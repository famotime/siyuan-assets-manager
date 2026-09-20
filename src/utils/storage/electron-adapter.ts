import { type IStorageAdapter, type FileStat, type StorageEntry, blobToArrayBuffer } from './types';
import { log, error } from '../logger';
export function getElectron(): any {
  try {
    const req =
      (typeof window !== 'undefined' && (window as any).require) ||
      (typeof require !== 'undefined' ? require : null);
    if (!req) return null;
    try {
      const electron = req('electron');
      if (electron?.shell) {
        return electron;
      }
    } catch (e) {}
    try {
      const remote = req('@electron/remote');
      if (remote?.shell) {
        return remote;
      }
    } catch (e) {}
  } catch (e) {}
  return null;
}

/**
 * 跨平台打开操作系统的回收站文件夹窗口
 */
export async function openOSRecycleBin(): Promise<boolean> {
  const electron = getElectron();
  const isWin =
    (typeof process !== 'undefined' && process.platform === 'win32') ||
    (typeof navigator !== 'undefined' && /Win/i.test(navigator.platform));
  const isMac =
    (typeof process !== 'undefined' && process.platform === 'darwin') ||
    (typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform));

  try {
    // 1. 尝试通过 electron.shell 打开
    if (electron?.shell) {
      if (isWin) {
        if (typeof electron.shell.openPath === 'function') {
          const res = await electron.shell.openPath('shell:RecycleBinFolder');
          if (!res) {
            log('[storage] electron.shell.openPath 成功打开回收站');
            return true;
          }
        }
        if (typeof electron.shell.openExternal === 'function') {
          await electron.shell.openExternal('shell:RecycleBinFolder');
          log('[storage] electron.shell.openExternal 成功打开回收站');
          return true;
        }
      } else if (isMac) {
        const homeDir = (typeof window !== 'undefined' && (window as any).siyuan?.config?.system?.homeDir) || '';
        const trashPath = homeDir ? `${homeDir}/.Trash` : '~/.Trash';
        if (typeof electron.shell.openPath === 'function') {
          const res = await electron.shell.openPath(trashPath);
          if (!res) return true;
        }
      } else {
        // Linux
        if (typeof electron.shell.openPath === 'function') {
          const res = await electron.shell.openPath('trash:///');
          if (!res) return true;
        }
      }
    }

    // 2. 尝试通过 Node.js child_process 呼出原生窗口
    const req =
      (typeof window !== 'undefined' && (window as any).require) ||
      (typeof require !== 'undefined' ? require : null);
    if (req) {
      try {
        const cp = req('child_process');
        if (cp && typeof cp.exec === 'function') {
          if (isWin) {
            cp.exec('start shell:RecycleBinFolder');
            log('[storage] child_process.exec(start shell:RecycleBinFolder) 成功打开回收站');
            return true;
          } else if (isMac) {
            cp.exec('open ~/.Trash');
            return true;
          } else {
            cp.exec('xdg-open trash:///');
            return true;
          }
        }
      } catch (cpErr) {}
    }

    // 3. 尝试通过 SiYuan IPC siyuan-cmd 派发
    try {
      const ipc = electron?.ipcRenderer || (req ? req('electron')?.ipcRenderer : null);
      if (ipc && typeof ipc.send === 'function') {
        if (isWin) {
          ipc.send('siyuan-cmd', { cmd: 'openPath', filePath: 'shell:RecycleBinFolder' });
          log('[storage] siyuan-cmd openPath 成功打开回收站');
          return true;
        }
      }
    } catch (ipcErr) {}
  } catch (e) {
    error('[storage] 打开系统回收站失败:', e);
  }

  return false;
}

export class ElectronStorageAdapter implements IStorageAdapter {
  constructor(private fs: any, private pathLib: any, private dataDir: string) {}

  private resolveRealPath(absPath: string): string {
    const rel = absPath.replace(/^\/?data\//, '').replace(/^\/+/, '');
    const isWin =
      (typeof process !== 'undefined' && process.platform === 'win32') ||
      (typeof navigator !== 'undefined' && /Win/i.test(navigator.platform));
    let fullPath = this.pathLib.join(this.dataDir, rel);
    if (this.pathLib?.resolve) {
      try {
        fullPath = this.pathLib.resolve(fullPath);
      } catch (e) {}
    }
    if (isWin) {
      fullPath = fullPath.replace(/\//g, '\\');
    }
    return fullPath;
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

  isTrashSupported(): boolean {
    try {
      const electron = getElectron();
      return Boolean(electron?.shell?.trashItem);
    } catch (e) {
      return false;
    }
  }

  async deleteToTrash(absolutePath: string): Promise<boolean> {
    const isWin =
      (typeof process !== 'undefined' && process.platform === 'win32') ||
      (typeof navigator !== 'undefined' && /Win/i.test(navigator.platform));

    try {
      const realPath = this.resolveRealPath(absolutePath);
      let targetPath = realPath;
      if (isWin) {
        targetPath = targetPath.replace(/\//g, '\\');
      }
      if (!this.fs.existsSync(targetPath)) {
        try {
          const decoded = decodeURIComponent(targetPath);
          const decodedNative = isWin ? decoded.replace(/\//g, '\\') : decoded;
          if (this.fs.existsSync(decodedNative)) {
            targetPath = decodedNative;
          } else {
            return false;
          }
        } catch (e) {
          return false;
        }
      }

      // 1. 优先调用 Electron 原生 shell.trashItem
      const electron = getElectron();
      if (electron?.shell?.trashItem) {
        try {
          await electron.shell.trashItem(targetPath);
          log(`[ElectronStorageAdapter] shell.trashItem succeeded for ${targetPath}`);
          return true;
        } catch (trashErr) {
          error(`[ElectronStorageAdapter] shell.trashItem failed for ${targetPath}:`, trashErr);
          // 若在 Windows 抛出 FileOperation 异常，尝试 Windows 原生 DeleteFile 降级
          if (isWin) {
            const ok = await this.deleteViaWindowsRecycleBin(targetPath);
            if (ok) {
              log(`[ElectronStorageAdapter] Windows PowerShell DeleteFile fallback succeeded for ${targetPath}`);
              return true;
            }
          }
          throw trashErr;
        }
      }

      // 2. Windows 无 shell.trashItem 时的降级方案
      if (isWin) {
        const ok = await this.deleteViaWindowsRecycleBin(targetPath);
        if (ok) {
          log(`[ElectronStorageAdapter] Windows PowerShell DeleteFile fallback succeeded for ${targetPath}`);
          return true;
        }
      }
    } catch (e) {
      error(`[ElectronStorageAdapter] deleteToTrash failed for ${absolutePath}:`, e);
      throw e;
    }
    return this.delete(absolutePath);
  }

  private async deleteViaWindowsRecycleBin(filePath: string): Promise<boolean> {
    try {
      const req =
        (typeof window !== 'undefined' && (window as any).require) ||
        (typeof require !== 'undefined' ? require : null);
      if (!req) return false;
      const cp = req('child_process');
      if (!cp || typeof cp.exec !== 'function') return false;

      const nativePath = filePath.replace(/\//g, '\\');
      const escaped = nativePath.replace(/'/g, "''");
      const cmd = `powershell -NoProfile -NonInteractive -Command "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${escaped}', 'OnlyErrorDialogs', 'SendToRecycleBin')"`;
      await new Promise<void>((resolve, reject) => {
        cp.exec(cmd, (err: any) => {
          if (err) reject(err);
          else resolve();
        });
      });
      return true;
    } catch (err) {
      error('[ElectronStorageAdapter] deleteViaWindowsRecycleBin failed:', err);
      return false;
    }
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

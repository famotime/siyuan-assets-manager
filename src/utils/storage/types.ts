export interface FileStat {
  size: number;
  updated: number;
  isDir: boolean;
}

export interface StorageEntry {
  name: string;
  isDir: boolean;
  size?: number;
  updated?: number;
}

export interface IStorageAdapter {
  stat(absolutePath: string): Promise<FileStat | null>;
  read(absolutePath: string): Promise<Blob | null>;
  write(absolutePath: string, content: Blob): Promise<void>;
  delete(absolutePath: string): Promise<boolean>;
  list(dirPath: string): Promise<StorageEntry[]>;
  isTrashSupported?(): boolean;
  deleteToTrash?(absolutePath: string): Promise<boolean>;
  /**
   * 异步 stat：不阻塞渲染主线程（Electron 下走 fs.promises）。
   * 大工作空间上有数万资源需要补全 size/updated，同步 statSync 会冻结整个界面。
   */
  statAsync?(absolutePath: string): Promise<FileStat | null>;
  /**
   * 快速列目录：仅返回 name/isDir（不逐条 stat）。
   * Electron 下一次 readdir(withFileTypes) 即完成，绕过内核 /api/file/readDir
   * 的按路径互斥串行；HTTP 适配器不支持时调用方回退内核接口。
   */
  listDirEntries?(dirPath: string): Promise<StorageEntry[]>;
}

export async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof (blob as any).arrayBuffer === 'function') {
    return await (blob as any).arrayBuffer();
  }
  if (typeof (blob as any).bytes === 'function') {
    const bytes = await (blob as any).bytes();
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
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
    reader.onerror = () => resolve(new ArrayBuffer(0));
    reader.readAsArrayBuffer(blob);
  });
}

export async function blobToText(blob: Blob): Promise<string> {
  if (typeof (blob as any).text === 'function') {
    return await (blob as any).text();
  }
  return new Promise((resolve) => {
    if (typeof FileReader === 'undefined') {
      resolve('');
      return;
    }
    const reader = new FileReader();
    reader.onload = (event: any) => {
      resolve((event?.target?.result || reader.result || '') as string);
    };
    reader.onerror = () => resolve('');
    reader.readAsText(blob);
  });
}


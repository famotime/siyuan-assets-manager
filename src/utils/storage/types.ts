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


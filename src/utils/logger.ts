import { usePlugin } from '../main';

function isLoggingEnabled(): boolean {
  try {
    const plugin = usePlugin() as any;
    return Boolean(plugin?.settings?.enableLogging);
  } catch {
    return false;
  }
}

export function log(...args: any[]): void {
  if (isLoggingEnabled()) {
    console.log('[AssetsManager]', ...args);
  }
}

export function warn(...args: any[]): void {
  if (isLoggingEnabled()) {
    console.warn('[AssetsManager]', ...args);
  }
}

export function error(...args: any[]): void {
  if (isLoggingEnabled()) {
    console.error('[AssetsManager]', ...args);
  }
}


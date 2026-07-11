import { usePlugin } from '../main';

export function log(...args: any[]): void {
  try {
    const plugin = usePlugin() as any;
    if (plugin?.settings?.enableLogging) {
      console.log('[AssetsManager]', ...args);
    }
  } catch (e) {
    // Fallback if plugin is not initialized yet
    console.log('[AssetsManager]', ...args);
  }
}

export function warn(...args: any[]): void {
  try {
    const plugin = usePlugin() as any;
    if (plugin?.settings?.enableLogging) {
      console.warn('[AssetsManager]', ...args);
    }
  } catch (e) {
    console.warn('[AssetsManager]', ...args);
  }
}

export function error(...args: any[]): void {
  console.error('[AssetsManager]', ...args);
}

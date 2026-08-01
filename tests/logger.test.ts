import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { log, warn, error } from '../src/utils/logger';
import { usePlugin } from '../src/main';

describe('logger module', () => {
  let consoleLogSpy: any;
  let consoleWarnSpy: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('remains completely silent when enableLogging is false', () => {
    const fakePlugin = { settings: { enableLogging: false } } as any;
    usePlugin(fakePlugin);

    log('test log');
    warn('test warn');
    error('test error');

    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('remains silent when plugin is uninitialized or null', () => {
    usePlugin(null as any);

    log('uninitialized log');
    warn('uninitialized warn');
    error('uninitialized error');

    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('prints console logs when enableLogging is true', () => {
    const fakePlugin = { settings: { enableLogging: true } } as any;
    usePlugin(fakePlugin);

    log('enabled log message');
    warn('enabled warn message');
    error('enabled error message');

    expect(consoleLogSpy).toHaveBeenCalledWith('[AssetsManager]', 'enabled log message');
    expect(consoleWarnSpy).toHaveBeenCalledWith('[AssetsManager]', 'enabled warn message');
    expect(consoleErrorSpy).toHaveBeenCalledWith('[AssetsManager]', 'enabled error message');
  });
});

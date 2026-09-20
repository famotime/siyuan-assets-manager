import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  sanitizeHistoryLimit,
  getDeletionHistoryLimit,
  setDeletionHistoryLimit,
  getDeletionHistory,
  recordDeletionBatch,
  clearDeletionHistory,
  updateBatchStatus,
  DELETION_HISTORY_FILE,
  DELETION_HISTORY_STORAGE_KEY,
  DELETION_LIMIT_STORAGE_KEY,
} from '../src/utils/deletion-logger';
import { usePlugin } from '../src/utils/plugin-context';

describe('deletion-logger unit tests', () => {
  let mockStorage: Record<string, any> = {};
  let mockPluginSettings: any = {};

  beforeEach(() => {
    mockStorage = {};
    mockPluginSettings = { deletionHistoryLimit: 10 };
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }

    const mockPlugin: any = {
      settings: mockPluginSettings,
      loadData: vi.fn(async (file: string) => mockStorage[file] || null),
      saveData: vi.fn(async (file: string, data: any) => {
        mockStorage[file] = data;
      }),
      removeData: vi.fn(async (file: string) => {
        delete mockStorage[file];
      }),
    };

    usePlugin(mockPlugin);
  });

  it('sanitizes limit within 0 to 100 bounds', () => {
    expect(sanitizeHistoryLimit(5)).toBe(5);
    expect(sanitizeHistoryLimit('25')).toBe(25);
    expect(sanitizeHistoryLimit(-10)).toBe(0);
    expect(sanitizeHistoryLimit(150)).toBe(100);
    expect(sanitizeHistoryLimit('invalid')).toBe(10);
  });

  it('gets and sets history limit properly', async () => {
    const defaultLimit = await getDeletionHistoryLimit();
    expect(defaultLimit).toBe(10);

    const updated = await setDeletionHistoryLimit(20);
    expect(updated).toBe(20);
    expect(await getDeletionHistoryLimit()).toBe(20);
  });

  it('records batches and maintains FIFO with specified limit', async () => {
    await setDeletionHistoryLimit(3);

    const b1 = await recordDeletionBatch({
      actionType: 'single-delete',
      destination: 'os-trash',
      items: [{ fileName: 'f1.png', originalRelativePath: 'data/assets/f1.png', size: 100 }],
      freedBytes: 100,
      canRollback: false,
    });
    expect(b1).not.toBeNull();

    const b2 = await recordDeletionBatch({
      actionType: 'single-delete',
      destination: 'os-trash',
      items: [{ fileName: 'f2.png', originalRelativePath: 'data/assets/f2.png', size: 200 }],
      freedBytes: 200,
      canRollback: false,
    });

    const b3 = await recordDeletionBatch({
      actionType: 'single-delete',
      destination: 'os-trash',
      items: [{ fileName: 'f3.png', originalRelativePath: 'data/assets/f3.png', size: 300 }],
      freedBytes: 300,
      canRollback: false,
    });

    let history = await getDeletionHistory();
    expect(history.length).toBe(3);
    // 最新批次在最前
    expect(history[0].id).toBe(b3!.id);
    expect(history[2].id).toBe(b1!.id);

    // 录入第 4 个批次，验证 FIFO 淘汰最早的 b1
    const b4 = await recordDeletionBatch({
      actionType: 'orphan-cleanup',
      destination: 'os-trash',
      items: [{ fileName: 'f4.png', originalRelativePath: 'data/assets/f4.png', size: 400 }],
      freedBytes: 400,
      canRollback: false,
    });

    history = await getDeletionHistory();
    expect(history.length).toBe(3);
    expect(history[0].id).toBe(b4!.id);
    expect(history[1].id).toBe(b3!.id);
    expect(history[2].id).toBe(b2!.id);
    expect(history.find((b) => b.id === b1!.id)).toBeUndefined();
  });

  it('skips recording when history limit is set to 0', async () => {
    await setDeletionHistoryLimit(0);

    const batch = await recordDeletionBatch({
      actionType: 'batch-delete',
      destination: 'permanent',
      items: [{ fileName: 'f1.png', originalRelativePath: 'data/assets/f1.png', size: 100 }],
      freedBytes: 100,
      canRollback: false,
    });

    expect(batch).toBeNull();
    const history = await getDeletionHistory();
    expect(history.length).toBe(0);
  });

  it('updates batch status and clears history', async () => {
    await setDeletionHistoryLimit(5);

    const batch = await recordDeletionBatch({
      actionType: 'deduplicate',
      destination: 'os-trash',
      items: [{ fileName: 'f1.png', originalRelativePath: 'data/assets/f1.png', size: 100, canonicalName: 'f2.png' }],
      freedBytes: 100,
      canRollback: true,
    });

    expect(batch).not.toBeNull();
    expect(batch!.isRolledBack).toBe(false);

    await updateBatchStatus(batch!.id, {
      isRolledBack: true,
      rolledBackAt: 12345678,
    });

    const history = await getDeletionHistory();
    expect(history[0].isRolledBack).toBe(true);
    expect(history[0].rolledBackAt).toBe(12345678);

    await clearDeletionHistory();
    const emptyHistory = await getDeletionHistory();
    expect(emptyHistory.length).toBe(0);
  });
});

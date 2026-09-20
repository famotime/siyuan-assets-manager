import { usePlugin } from './plugin-context';
import { log, warn } from './logger';

export type DeletionActionType =
  | 'deduplicate'
  | 'orphan-cleanup'
  | 'orphan-original-cleanup'
  | 'single-delete'
  | 'batch-delete';

export type DeleteDestination = 'os-trash' | 'permanent';

export interface IDeletedItemRecord {
  fileName: string;
  originalRelativePath: string;
  size: number;
  canonicalName?: string;
  affectedBlocks?: Array<{
    id: string;
    root_id?: string;
    parent_id?: string;
    previous_id?: string;
    next_id?: string;
  }>;
  affectedViews?: Array<{
    viewId: string;
    keyId: string;
    rowId: string;
  }>;
  /** 轻量 WebP 缩略图 DataURL（供被删后悬浮预览） */
  thumbnail?: string;
  /** 受影响块在删除前的原始 Markdown 片段快照，按 blockId 映射 */
  originalMarkdownSnippets?: Record<string, string>;
}

export interface IRollbackReport {
  restoredBlocksCount: number;
  skippedBlocksCount: number;
  failedBlocksCount: number;
}

export interface IDeletionBatch {
  id: string;
  timestamp: number;
  actionType: DeletionActionType;
  destination: DeleteDestination;
  items: IDeletedItemRecord[];
  freedBytes: number;
  canRollback: boolean;
  isRolledBack: boolean;
  rolledBackAt?: number;
  rollbackReport?: IRollbackReport;
}

export const DELETION_HISTORY_FILE = 'deletion-history.json';
export const DELETION_HISTORY_STORAGE_KEY = 'siyuan_assets_deletion_history';
export const DELETION_LIMIT_STORAGE_KEY = 'siyuan_assets_deletion_history_limit';
export const DEFAULT_HISTORY_LIMIT = 10;
export const MAX_HISTORY_LIMIT = 100;
export const MIN_HISTORY_LIMIT = 0;

/**
 * 校验并约束历史保留上限在 [0, 100] 范围内
 */
export function sanitizeHistoryLimit(limit: any): number {
  const num = parseInt(limit, 10);
  if (isNaN(num)) return DEFAULT_HISTORY_LIMIT;
  if (num < MIN_HISTORY_LIMIT) return MIN_HISTORY_LIMIT;
  if (num > MAX_HISTORY_LIMIT) return MAX_HISTORY_LIMIT;
  return num;
}

/**
 * 获取历史保留上限 N（0~100，默认 10）
 */
export async function getDeletionHistoryLimit(): Promise<number> {
  try {
    const plugin = usePlugin();
    if (plugin?.settings?.deletionHistoryLimit !== undefined) {
      return sanitizeHistoryLimit(plugin.settings.deletionHistoryLimit);
    }
    if (plugin && typeof plugin.loadData === 'function') {
      const savedConfig = await plugin.loadData('config.json');
      if (savedConfig) {
        const parsed = typeof savedConfig === 'string' ? JSON.parse(savedConfig) : savedConfig;
        if (parsed && parsed.deletionHistoryLimit !== undefined) {
          return sanitizeHistoryLimit(parsed.deletionHistoryLimit);
        }
      }
    }
  } catch (e) {
    warn('[deletion-logger] 读取插件配置 deletionHistoryLimit 失败:', e);
  }

  if (typeof localStorage !== 'undefined') {
    const local = localStorage.getItem(DELETION_LIMIT_STORAGE_KEY);
    if (local !== null) {
      return sanitizeHistoryLimit(local);
    }
  }

  return DEFAULT_HISTORY_LIMIT;
}

/**
 * 设置历史保留上限 N
 */
export async function setDeletionHistoryLimit(limit: number): Promise<number> {
  const safeLimit = sanitizeHistoryLimit(limit);
  try {
    const plugin = usePlugin();
    if (plugin) {
      if (!plugin.settings) {
        plugin.settings = {} as any;
      }
      plugin.settings.deletionHistoryLimit = safeLimit;
      if (typeof plugin.saveData === 'function') {
        await plugin.saveData('config.json', plugin.settings);
      }
    }
  } catch (e) {
    warn('[deletion-logger] 保存插件配置 deletionHistoryLimit 失败:', e);
  }

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(DELETION_LIMIT_STORAGE_KEY, safeLimit.toString());
    } catch (e) {}
  }

  // 立即根据新上限裁剪现有历史记录
  const history = await getDeletionHistory();
  if (safeLimit === 0) {
    if (history.length > 0) {
      await saveHistoryList([]);
    }
  } else if (history.length > safeLimit) {
    await saveHistoryList(history.slice(0, safeLimit));
  }

  return safeLimit;
}

/**
 * 从持久化存储中读取完整删除历史列表
 */
export async function getDeletionHistory(): Promise<IDeletionBatch[]> {
  try {
    const plugin = usePlugin();
    if (plugin && typeof plugin.loadData === 'function') {
      const data = await plugin.loadData(DELETION_HISTORY_FILE);
      if (data) {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        if (Array.isArray(parsed)) {
          return parsed as IDeletionBatch[];
        }
      }
    }
  } catch (e) {
    warn('[deletion-logger] plugin.loadData 读取历史失败:', e);
  }

  if (typeof localStorage !== 'undefined') {
    try {
      const item = localStorage.getItem(DELETION_HISTORY_STORAGE_KEY);
      if (item) {
        const parsed = JSON.parse(item);
        if (Array.isArray(parsed)) {
          return parsed as IDeletionBatch[];
        }
      }
    } catch (e) {}
  }

  return [];
}

/**
 * 保存删除历史记录到持久化存储
 */
async function saveHistoryList(history: IDeletionBatch[]): Promise<boolean> {
  try {
    const plugin = usePlugin();
    if (plugin && typeof plugin.saveData === 'function') {
      await plugin.saveData(DELETION_HISTORY_FILE, history);
      return true;
    }
  } catch (e) {
    warn('[deletion-logger] plugin.saveData 保存历史失败:', e);
  }

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(DELETION_HISTORY_STORAGE_KEY, JSON.stringify(history));
      return true;
    } catch (e) {}
  }

  return false;
}

/**
 * 清空所有删除历史记录
 */
export async function clearDeletionHistory(): Promise<boolean> {
  try {
    const plugin = usePlugin();
    if (plugin && typeof plugin.removeData === 'function') {
      await plugin.removeData(DELETION_HISTORY_FILE);
    }
  } catch (e) {}

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(DELETION_HISTORY_STORAGE_KEY);
    } catch (e) {}
  }

  return true;
}

/**
 * 记录新的删除操作批次（自动维护 FIFO 与 0~100 限制）
 * @returns 若 limit=0 则返回 null；否则返回新建的批次对象
 */
export async function recordDeletionBatch(
  batchData: Omit<IDeletionBatch, 'id' | 'timestamp' | 'isRolledBack'>
): Promise<IDeletionBatch | null> {
  const limit = await getDeletionHistoryLimit();
  if (limit <= 0) {
    log('[deletion-logger] 历史保留容量为 0，跳过记录历史日志');
    return null;
  }

  const newBatch: IDeletionBatch = {
    ...batchData,
    id: `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    isRolledBack: false,
  };

  const history = await getDeletionHistory();
  // 最新批次置于列表顶端
  const updatedHistory = [newBatch, ...history];

  // 严格裁剪至上限
  if (updatedHistory.length > limit) {
    updatedHistory.length = limit;
  }

  await saveHistoryList(updatedHistory);
  log(`[deletion-logger] 成功记录批次 ${newBatch.id} (${newBatch.actionType})，当前保留条数: ${updatedHistory.length}/${limit}`);
  return newBatch;
}

/**
 * 更新指定批次的状态信息（如标记已回退）
 */
export async function updateBatchStatus(
  batchId: string,
  updates: Partial<IDeletionBatch>
): Promise<boolean> {
  const history = await getDeletionHistory();
  const index = history.findIndex((b) => b.id === batchId);
  if (index === -1) {
    warn(`[deletion-logger] 找不到待更新的批次: ${batchId}`);
    return false;
  }

  history[index] = {
    ...history[index],
    ...updates,
  };

  return saveHistoryList(history);
}

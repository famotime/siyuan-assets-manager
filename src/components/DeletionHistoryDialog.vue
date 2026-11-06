<template>
  <div v-if="visible" class="am-modal-mask" @click.self="handleClose">
    <div class="am-modal-dialog deletion-history-dialog">
      <!-- 弹窗顶栏 -->
      <div class="dialog-header">
        <div class="dialog-title">
          <History :size="18" class="title-icon" />
          <span>{{ t('history.title') }}</span>
          <span class="batch-count-badge">{{ t('history.recordCount', { count: filteredHistory.length, n: filteredHistory.length }) }}</span>
        </div>
        <div class="header-actions">
          <button class="am-icon-btn b3-tooltips b3-tooltips__sw" @click="handleClose" :aria-label="t('history.closeWindowAria')">
            <X :size="16" style="fill: none !important;" />
          </button>
        </div>
      </div>

      <!-- 控制工具栏：容量配置与快捷操作 -->
      <div class="dialog-toolbar">
        <div class="toolbar-left">
          <div class="filter-chips">
            <button
              class="filter-chip"
              :class="{ 'is-active': activeFilter === 'all' }"
              @click="activeFilter = 'all'"
            >
              {{ t('history.filterAll', { count: historyList.length }) }}
            </button>
            <button
              class="filter-chip"
              :class="{ 'is-active': activeFilter === 'deduplicate' }"
              @click="activeFilter = 'deduplicate'"
            >
              {{ t('history.filterDedup', { count: dedupCount }) }}
            </button>
            <button
              class="filter-chip"
              :class="{ 'is-active': activeFilter === 'cleanup' }"
              @click="activeFilter = 'cleanup'"
            >
              {{ t('history.filterCleanup', { count: cleanupCount }) }}
            </button>
            <button
              class="filter-chip"
              :class="{ 'is-active': activeFilter === 'manual' }"
              @click="activeFilter = 'manual'"
            >
              {{ t('history.filterManual', { count: manualCount }) }}
            </button>
          </div>
        </div>

        <div class="toolbar-right">
          <!-- 历史容量上限配置 (0~100) -->
          <div class="limit-config" :title="t('history.limitTitle')">
            <span class="limit-label">{{ t('history.limitLabel') }}</span>
            <input
              type="number"
              class="limit-input b3-text-field"
              v-model.number="historyLimit"
              min="0"
              max="100"
              @change="handleLimitChange"
            />
            <span class="limit-unit">{{ t('history.limitUnit') }}</span>
          </div>

          <button
            class="am-action-btn am-action-btn--recycle am-action-btn--with-text b3-tooltips b3-tooltips__sw"
            @click="handleOpenRecycleBin"
            :aria-label="t('history.recycleBinAria')"
          >
            <ExternalLink :size="14" style="fill: none !important;" />
            <span>{{ t('history.recycleBinBtn') }}</span>
          </button>

          <button
            v-if="historyList.length > 0"
            class="am-action-btn am-action-btn--clear am-action-btn--with-text b3-tooltips b3-tooltips__sw"
            @click="handleClearAll"
            :aria-label="t('history.clearAllAria')"
          >
            <Trash2 :size="14" style="fill: none !important;" />
            <span>{{ t('history.clearAllBtn') }}</span>
          </button>
        </div>
      </div>

      <!-- 批次列表主体 -->
      <div class="dialog-body" v-if="filteredHistory.length > 0">
        <DeletionHistoryCard
          v-for="batch in filteredHistory"
          :key="batch.id"
          :batch="batch"
          :is-expanded="expandedBatchIds.has(batch.id)"
          :doc-info-map="docInfoMap"
          @toggle-expand="toggleExpand(batch.id)"
          @rollback="openRollbackConfirm(batch)"
          @jump-item-doc="handleJumpToItemDoc"
          @show-preview="handleShowPreview"
          @update-preview="handleUpdatePreview"
          @hide-preview="handleHidePreview"
        />
      </div>

      <!-- 空状态 -->
      <div v-else class="dialog-empty">
        <History :size="48" class="empty-icon" />
        <div class="empty-text">
          <span v-if="historyLimit === 0">{{ t('history.emptyDisabled') }}</span>
          <span v-else-if="historyList.length === 0">{{ t('history.emptyNoRecords') }}</span>
          <span v-else>{{ t('history.emptyNoCategory') }}</span>
        </div>
        <div class="empty-subtext">
          {{ t('history.emptySubtext') }}
        </div>
      </div>

      <!-- 回退确认前置弹窗 -->
      <div v-if="rollbackConfirmBatch" class="am-modal-mask am-inner-modal" @click.self="rollbackConfirmBatch = null">
        <div class="am-modal-dialog rollback-confirm-dialog">
          <div class="confirm-header">
            <RotateCcw :size="18" class="confirm-icon" />
            <span v-if="rollbackConfirmBatch.actionType === 'deduplicate'">{{ t('history.confirmDedupTitle') }}</span>
            <span v-else>{{ t('history.confirmDeletedTitle') }}</span>
          </div>

          <div class="confirm-body">
            <div class="confirm-notice">
              <AlertCircle :size="16" class="notice-icon" />
              <div class="notice-text">
                <p v-if="rollbackConfirmBatch.actionType === 'deduplicate'">
                  <strong>{{ t('history.noticeImportant') }}</strong>{{ t('history.noticeDedupBody') }}
                </p>
                <p v-else>
                  <strong>{{ t('history.noticeImportant') }}</strong>{{ t('history.noticeCleanupBody') }}
                </p>
                <p><strong>{{ t('history.restoreNoticePrefix') }}<span class="text-danger-emphasis">{{ t('history.restoreNoticeAction') }}</span>{{ t('history.restoreNoticeBack') }}<code>data/assets/</code>{{ t('history.restoreNoticeDir') }}</strong></p>
              </div>
            </div>

            <div class="checklist-box">
              <div class="checklist-header">
                <span>{{ t('history.checklistHeader', { count: rollbackChecklist.length }) }}</span>
                <div class="checklist-header-actions">
                  <button
                    class="am-action-btn am-action-btn--copy b3-tooltips b3-tooltips__w"
                    @click="copyChecklist"
                    :aria-label="t('history.copyChecklistAria')"
                    :title="t('history.copyChecklistTitle')"
                  >
                    <Copy :size="14" style="fill: none !important;" />
                  </button>
                </div>
              </div>
              <ul class="checklist-items">
                <li v-for="name in rollbackChecklist" :key="name">
                  <code>{{ name }}</code>
                  <span
                    v-if="isRollbackFileMissing(name)"
                    class="badge badge-status is-missing-file"
                    :title="t('history.missingFileBadgeTitle')"
                  >
                    {{ t('history.notRestoredBadge') }}
                  </span>
                </li>
              </ul>
            </div>

            <!-- 物理文件预检：文件未就位时回退只会产生坏引用，永久删除环境更是不可恢复 -->
            <div v-if="isRollbackBlocked" class="presence-warning is-blocked">
              <AlertCircle :size="14" class="presence-icon" />
              <div>
                <strong>{{ t('history.blockedTitle') }}</strong>{{ t('history.blockedBefore') }}<strong>{{ missingRollbackFiles.length }}</strong>{{ t('history.blockedAfter') }}
              </div>
            </div>
            <div v-else-if="missingRollbackFiles.length > 0" class="presence-warning">
              <AlertCircle :size="14" class="presence-icon" />
              <div>
                <strong>{{ t('history.missingHintTitle') }}</strong>{{ t('history.missingHintBefore') }}<strong>{{ missingRollbackFiles.length }}</strong>{{ t('history.missingHintMid') }}<code>data/assets/</code>{{ t('history.missingHintAfter') }}
              </div>
            </div>

            <div class="drift-defense-tip">
              <strong>{{ t('history.driftDefenseTitle') }}</strong>{{ t('history.driftDefenseBody') }}
            </div>
          </div>

          <div class="confirm-footer">
            <button class="am-btn am-btn--secondary" @click="rollbackConfirmBatch = null" :disabled="isRollingBack">
              {{ t('common.cancel') }}
            </button>
            <button
              class="am-btn am-btn--primary"
              @click="executeRollback"
              :disabled="isRollingBack || isRollbackBlocked"
            >
              <span v-if="isRollingBack">{{ t('history.rollingBackBtn') }}</span>
              <span v-else-if="isRollbackBlocked">{{ t('history.rollbackBlockedBtn') }}</span>
              <span v-else>{{ t('history.rollbackConfirmBtn') }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 被删图片鼠标悬浮预览浮窗 -->
      <div
        v-if="hoverPreviewItem && hoverPreviewItem.thumbnail"
        class="deletion-hover-preview"
        :style="hoverPreviewStyle"
      >
        <div class="hover-preview-img-box">
          <img :src="hoverPreviewItem.thumbnail" :alt="t('history.previewAlt')" />
        </div>
        <div class="hover-preview-meta">
          <div class="hover-preview-title" :title="hoverPreviewItem.fileName">
            {{ hoverPreviewItem.fileName }}
          </div>
          <div class="hover-preview-sub">
            <span>{{ t('history.previewSize', { size: formatSize(hoverPreviewItem.size) }) }}</span>
            <span class="hover-preview-tag">{{ t('history.inRecycleBinTag') }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import {
  History,
  X,
  Trash2,
  AlertTriangle,
  RotateCcw,
  Copy,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from 'lucide-vue-next';
import DeletionHistoryCard from './DeletionHistoryCard.vue';
import {
  getDeletionHistory,
  getDeletionHistoryLimit,
  setDeletionHistoryLimit,
  clearDeletionHistory,
  type IDeletionBatch,
  type IDeletedItemRecord,
  type DeletionActionType,
} from '../utils/deletion-logger';
import {
  rollbackBatch,
  getRollbackChecklist,
  checkRollbackFilePresence,
} from '../utils/rollback-engine';
import { formatAssetSize } from '../utils/asset-list';
import { showConfirm } from '../utils/confirm';
import { t } from '@/i18n';
import { showMessage, openTab } from 'siyuan';
import { openOSRecycleBin } from '../utils/file-system';
import { usePlugin } from '../utils/plugin-context';
import { sql } from '../api';
import { warn } from '../utils/logger';

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void;
  (e: 'refresh'): void;
}>();

const historyList = ref<IDeletionBatch[]>([]);
const historyLimit = ref<number>(10);
const activeFilter = ref<'all' | 'deduplicate' | 'cleanup' | 'manual'>('all');
const expandedBatchIds = ref<Set<string>>(new Set());

// 鼠标悬浮预览相关响应式状态
const hoverPreviewItem = ref<IDeletedItemRecord | null>(null);
const hoverPreviewStyle = ref<{ left: string; top: string }>({ left: '0px', top: '0px' });
let hoverPreviewTimeout: number | null = null;

const rollbackConfirmBatch = ref<IDeletionBatch | null>(null);
const isRollingBack = ref<boolean>(false);

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.visible) {
    e.preventDefault();
    e.stopPropagation();
    if (rollbackConfirmBatch.value) {
      rollbackConfirmBatch.value = null;
    } else {
      handleClose();
    }
  }
}

onMounted(async () => {
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', handleKeydown, true);
  }
  await loadData();
});

onUnmounted(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', handleKeydown, true);
  }
});

watch(
  () => props.visible,
  async (val) => {
    if (val) {
      await loadData();
    }
  }
);

const docInfoMap = ref<Map<string, { title: string; hpath: string }>>(new Map());

async function loadData() {
  historyLimit.value = await getDeletionHistoryLimit();
  historyList.value = await getDeletionHistory();
  await loadDocTitles();
}

/**
 * 批量拉取所有被删文件关联文档的标题与可读路径
 */
async function loadDocTitles() {
  const docIdsToFetch = new Set<string>();
  for (const batch of historyList.value) {
    for (const item of batch.items) {
      if (item.affectedBlocks && item.affectedBlocks.length > 0) {
        for (const ref of item.affectedBlocks) {
          const docId = ref.root_id || ref.id;
          if (docId && !docInfoMap.value.has(docId)) {
            docIdsToFetch.add(docId);
          }
        }
      }
    }
  }

  if (docIdsToFetch.size === 0) return;

  const idList = Array.from(docIdsToFetch);
  const batchSize = 80;
  for (let i = 0; i < idList.length; i += batchSize) {
    const chunk = idList.slice(i, i + batchSize);
    const sqlIds = chunk.map((id) => `'${id.replace(/'/g, "''")}'`).join(',');
    try {
      const rows = await sql(
        `SELECT id, root_id, hpath, content FROM blocks WHERE id IN (${sqlIds}) OR root_id IN (${sqlIds})`
      );
      if (rows && Array.isArray(rows)) {
        for (const row of rows) {
          const docId = row.root_id || row.id;
          let title = (row.content || '').trim();
          if (!title && row.hpath) {
            const segs = row.hpath.split('/').filter(Boolean);
            title = segs.length > 0 ? segs[segs.length - 1] : row.hpath;
          }
          if (!title) {
            title = docId;
          }
          const info = {
            title,
            hpath: row.hpath || '',
          };
          docInfoMap.value.set(docId, info);
          if (row.id && !docInfoMap.value.has(row.id)) {
            docInfoMap.value.set(row.id, info);
          }
        }
      }
    } catch (e) {
      warn('[DeletionHistory] 查询文档标题出错:', e);
    }
  }
}

function handleClose() {
  emit('update:visible', false);
}

const dedupCount = computed(() => historyList.value.filter((b) => b.actionType === 'deduplicate').length);
const cleanupCount = computed(() => historyList.value.filter((b) => b.actionType === 'orphan-cleanup' || b.actionType === 'orphan-original-cleanup').length);
const manualCount = computed(() => historyList.value.filter((b) => b.actionType === 'single-delete' || b.actionType === 'batch-delete').length);

const filteredHistory = computed(() => {
  if (activeFilter.value === 'all') return historyList.value;
  if (activeFilter.value === 'deduplicate') {
    return historyList.value.filter((b) => b.actionType === 'deduplicate');
  }
  if (activeFilter.value === 'cleanup') {
    return historyList.value.filter((b) => b.actionType === 'orphan-cleanup' || b.actionType === 'orphan-original-cleanup');
  }
  if (activeFilter.value === 'manual') {
    return historyList.value.filter((b) => b.actionType === 'single-delete' || b.actionType === 'batch-delete');
  }
  return historyList.value;
});

const rollbackChecklist = computed(() => {
  if (!rollbackConfirmBatch.value) return [];
  return getRollbackChecklist(rollbackConfirmBatch.value);
});

async function handleLimitChange() {
  const updated = await setDeletionHistoryLimit(historyLimit.value);
  historyLimit.value = updated;
  historyList.value = await getDeletionHistory();
  showMessage(t('history.limitSetMsg', { count: updated, n: updated }));
}

async function handleClearAll() {
  const confirmed = await showConfirm({
    title: t('history.clearConfirmTitle'),
    message: t('history.clearConfirmMsg'),
    confirmText: t('history.clearConfirmBtn'),
    danger: true,
  });
  if (!confirmed) return;

  await clearDeletionHistory();
  historyList.value = [];
  showMessage(t('history.clearDoneMsg'));
}

function toggleExpand(batchId: string) {
  if (expandedBatchIds.value.has(batchId)) {
    expandedBatchIds.value.delete(batchId);
  } else {
    expandedBatchIds.value.add(batchId);
  }
}

function formatTime(timestamp: number): string {
  if (!timestamp) return '-';
  const d = new Date(timestamp);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatSize(bytes: number): string {
  return formatAssetSize(bytes);
}

async function handleOpenRecycleBin() {
  const ok = await openOSRecycleBin();
  if (ok) {
    showMessage(t('history.recycleOpenedMsg'));
  } else {
    showMessage(t('history.recycleOpenFailMsg'), 5000, 'info');
  }
}

function copyChecklist() {
  const text = rollbackChecklist.value.join('\n');
  navigator.clipboard.writeText(text).then(() => {
    showMessage(t('history.checklistCopiedMsg', { count: rollbackChecklist.value.length, n: rollbackChecklist.value.length }));
  });
}

function handleShowPreview(event: MouseEvent, item: IDeletedItemRecord) {
  if (!item.thumbnail) return;
  if (hoverPreviewTimeout) {
    clearTimeout(hoverPreviewTimeout);
    hoverPreviewTimeout = null;
  }
  hoverPreviewTimeout = window.setTimeout(() => {
    hoverPreviewItem.value = item;
    positionHoverPreview(event.clientX, event.clientY);
  }, 120);
}

function handleUpdatePreview(event: MouseEvent) {
  if (hoverPreviewItem.value) {
    positionHoverPreview(event.clientX, event.clientY);
  }
}

function handleHidePreview() {
  if (hoverPreviewTimeout) {
    clearTimeout(hoverPreviewTimeout);
    hoverPreviewTimeout = null;
  }
  hoverPreviewItem.value = null;
}

function positionHoverPreview(clientX: number, clientY: number) {
  const offsetX = 16;
  const offsetY = 16;
  let x = clientX + offsetX;
  let y = clientY + offsetY;

  const previewWidth = 240;
  const previewHeight = 240;

  if (x + previewWidth > window.innerWidth) {
    x = clientX - previewWidth - offsetX;
  }
  if (y + previewHeight > window.innerHeight) {
    y = clientY - previewHeight - offsetY;
  }

  hoverPreviewStyle.value = {
    left: `${Math.max(8, x)}px`,
    top: `${Math.max(8, y)}px`,
  };
}

const rollbackFilePresence = ref<Array<{ fileName: string; present: boolean }>>([]);
const isLoadingPresence = ref(false);

/** 尚未放回 data/assets/ 的文件（回退后会成为坏引用） */
const missingRollbackFiles = computed(() =>
  rollbackFilePresence.value.filter((entry) => !entry.present).map((entry) => entry.fileName)
);
/** 永久删除（无系统回收站）且文件已不可找回时，回退只会破坏文档，直接禁用 */
const isRollbackBlocked = computed(
  () => rollbackConfirmBatch.value?.destination === 'permanent' && missingRollbackFiles.value.length > 0
);

function isRollbackFileMissing(fileName: string): boolean {
  const entry = rollbackFilePresence.value.find((it) => it.fileName === fileName);
  return Boolean(entry && !entry.present);
}

async function openRollbackConfirm(batch: IDeletionBatch) {
  rollbackConfirmBatch.value = batch;
  rollbackFilePresence.value = [];
  isLoadingPresence.value = true;

  try {
    rollbackFilePresence.value = await checkRollbackFilePresence(batch);
  } catch (presenceErr) {
    warn('[DeletionHistoryDialog] 回退文件预检失败:', presenceErr);
  } finally {
    isLoadingPresence.value = false;
  }
}

async function executeRollback() {
  if (!rollbackConfirmBatch.value) return;
  if (isRollbackBlocked.value) {
    showMessage(t('history.rollbackBlockedMsg'), 5000, 'error');
    return;
  }
  const batchId = rollbackConfirmBatch.value.id;
  isRollingBack.value = true;

  try {
    const result = await rollbackBatch(batchId);
    const extraParts: string[] = [];
    if ((result.report.approximateRestoredCount || 0) > 0) {
      extraParts.push(t('history.extraApprox', { count: result.report.approximateRestoredCount, n: result.report.approximateRestoredCount }));
    }
    if ((result.report.restoredViewCellsCount || 0) > 0) {
      extraParts.push(t('history.extraViewCells', { count: result.report.restoredViewCellsCount, n: result.report.restoredViewCellsCount }));
    }
    if (result.report.skippedBlocksCount > 0) {
      extraParts.push(t('history.extraSkipped', { count: result.report.skippedBlocksCount, n: result.report.skippedBlocksCount }));
    }
    const extraSuffix =
      extraParts.length > 0
        ? t('history.rollbackDoneExtra', { parts: extraParts.join(t('history.extraSeparator')) })
        : '';
    showMessage(
      t('history.rollbackDoneMsg', { count: result.report.restoredBlocksCount, n: result.report.restoredBlocksCount }) + extraSuffix
    );
    rollbackConfirmBatch.value = null;
    await loadData();
    emit('refresh');
  } catch (err: any) {
    showMessage(t('history.rollbackFailed', { error: err.message || err }), 5000, 'error');
  } finally {
    isRollingBack.value = false;
  }
}

/**
 * 提取批次关联的文档根块 ID 列表（去重）
 */
function getBatchAffectedDocIds(batch: IDeletionBatch): string[] {
  const docIdSet = new Set<string>();
  for (const item of batch.items) {
    if (item.affectedBlocks && item.affectedBlocks.length > 0) {
      for (const ref of item.affectedBlocks) {
        if (ref.root_id) {
          docIdSet.add(ref.root_id);
        } else if (ref.id) {
          docIdSet.add(ref.id);
        }
      }
    }
  }
  return Array.from(docIdSet);
}

/**
 * 获取条目关联的所有有效文档 ID
 */
function getItemDocIds(item: IDeletedItemRecord): string[] {
  if (!item.affectedBlocks || item.affectedBlocks.length === 0) return [];
  const docIds = new Set<string>();
  for (const ref of item.affectedBlocks) {
    const docId = ref.root_id || ref.id;
    if (docId) docIds.add(docId);
  }
  return Array.from(docIds);
}

/**
 * 打开文档的核心通用方法
 */
async function openDocumentByIds(docIds: string[]) {
  if (docIds.length === 0) {
    showMessage(t('history.noRelatedDocsMsg'), 4000, 'info');
    return;
  }

  const plugin = usePlugin();
  if (!plugin || !plugin.app) {
    showMessage(t('history.pluginNotReadyMsg'), 4000, 'error');
    return;
  }

  const openedTitles: string[] = [];
  try {
    for (const docId of docIds) {
      let targetId = docId;
      let docTitle = docId;

      try {
        const rows = await sql(
          `SELECT id, root_id, hpath, content FROM blocks WHERE id = '${docId}' OR root_id = '${docId}' LIMIT 1`
        );
        if (rows && rows.length > 0) {
          const row = rows[0];
          targetId = row.root_id || row.id || docId;
          docTitle = row.hpath || row.content || targetId;
        }
      } catch {}

      await openTab({
        app: plugin.app,
        doc: {
          id: targetId,
          action: ['cb-get-hl', 'cb-get-focus', 'cb-get-context'],
        },
        keepCursor: true,
      });

      openedTitles.push(docTitle);
    }

    if (openedTitles.length === 1) {
      showMessage(t('history.docOpenedMsg', { title: openedTitles[0] }));
    } else {
      showMessage(t('history.docsOpenedMsg', { count: openedTitles.length, n: openedTitles.length }));
    }
  } catch (err: any) {
    warn('[DeletionHistory] 跳转文档失败:', err);
    showMessage(t('history.jumpFailedMsg', { error: err.message || err }), 5000, 'error');
  }
}

/**
 * 点击明细表格中的单个文件“跳转文档”
 */
async function handleJumpToItemDoc(item: IDeletedItemRecord) {
  if (!item.affectedBlocks || item.affectedBlocks.length === 0) {
    showMessage(t('history.itemNoDocMsg'), 4000, 'info');
    return;
  }

  const docIds = Array.from(
    new Set(
      item.affectedBlocks
        .map((r) => r.root_id || r.id)
        .filter(Boolean) as string[]
    )
  );

  if (docIds.length === 0) {
    showMessage(t('history.itemNoDocMsg'), 4000, 'info');
    return;
  }

  await openDocumentByIds(docIds);
}
</script>

<style scoped lang="scss">
.am-modal-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(2px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.am-modal-dialog {
  background: var(--b3-theme-background);
  color: var(--b3-theme-on-background);
  border-radius: 8px;
  box-shadow: var(--b3-dialog-shadow, 0 8px 24px rgba(0, 0, 0, 0.28));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
}

.deletion-history-dialog {
  width: 860px;
  max-width: 95vw;
  height: 680px;
  max-height: 90vh;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid var(--b3-border-color);
  background: var(--b3-theme-surface, var(--b3-theme-background));
}

.dialog-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
}

.title-icon {
  color: var(--b3-theme-primary);
}

.batch-count-badge {
  font-size: 12px;
  font-weight: normal;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--b3-theme-surface-lighter, rgba(128, 128, 128, 0.15));
  color: var(--b3-theme-on-surface);
}

.dialog-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px;
  border-bottom: 1px solid var(--b3-border-color);
  background: var(--b3-theme-background);
  gap: 12px;
  flex-wrap: wrap;
}

.filter-chips {
  display: flex;
  gap: 6px;
}

.filter-chip {
  padding: 4px 10px;
  font-size: 12px;
  border-radius: 4px;
  border: 1px solid var(--b3-border-color);
  background: transparent;
  color: var(--b3-theme-on-background);
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: var(--b3-theme-surface-lighter, rgba(128, 128, 128, 0.1));
  }

  &.is-active {
    background: var(--b3-theme-primary);
    color: var(--b3-theme-on-primary, #fff);
    border-color: var(--b3-theme-primary);
  }
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.limit-config {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--b3-theme-on-surface);
}

.limit-input {
  width: 50px;
  padding: 2px 6px;
  font-size: 12px;
  text-align: center;
  border: 1px solid var(--b3-border-color);
  border-radius: 4px;
  background: var(--b3-theme-background);
  color: var(--b3-theme-on-background);
}

.dialog-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.history-card {
  flex-shrink: 0;
  border: 1px solid var(--b3-border-color);
  border-radius: 6px;
  background: var(--b3-theme-surface, var(--b3-theme-background));
  overflow: visible;
  transition: border-color 0.15s ease;

  &:hover {
    border-color: var(--b3-theme-primary-light, #999);
  }

  &.is-rolled-back {
    opacity: 0.85;
    background: var(--b3-theme-background);
  }
}

.card-header {
  padding: 12px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  user-select: none;
  gap: 10px;
}

.card-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.card-header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.chevron-icon {
  display: inline-flex;
  transition: transform 0.2s ease;
  color: var(--b3-theme-on-surface);

  &.is-rotated {
    transform: rotate(90deg);
  }
}

.card-time {
  font-size: 12px;
  color: var(--b3-theme-on-surface);
  opacity: 0.8;
}

.card-stat {
  font-size: 12px;
  color: var(--b3-theme-on-surface);
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 4px;
  font-weight: 500;
}

.badge-dedup {
  background: rgba(147, 51, 234, 0.12);
  color: #9333ea;
  border: 1px solid rgba(147, 51, 234, 0.25);
}

.badge-clean {
  background: rgba(245, 158, 11, 0.12);
  color: #d97706;
  border: 1px solid rgba(245, 158, 11, 0.25);
}

.badge-manual {
  background: rgba(107, 114, 128, 0.12);
  color: #6b7280;
  border: 1px solid rgba(107, 114, 128, 0.25);
}

.badge-dest {
  &.is-trash {
    background: rgba(16, 185, 129, 0.12);
    color: #059669;
    border: 1px solid rgba(16, 185, 129, 0.25);
  }

  &.is-permanent {
    background: rgba(239, 68, 68, 0.12);
    color: #dc2626;
    border: 1px solid rgba(239, 68, 68, 0.25);
  }
}

.badge-status {
  &.is-rolled {
    background: rgba(16, 185, 129, 0.15);
    color: #059669;
  }

  &.is-can-rollback {
    background: rgba(59, 130, 246, 0.12);
    color: #2563eb;
    border: 1px solid rgba(59, 130, 246, 0.25);
  }

  &.is-partial-failure {
    margin-left: 6px;
    background: rgba(245, 158, 11, 0.15);
    color: #b45309;
    border: 1px solid rgba(245, 158, 11, 0.3);
  }

  &.is-missing-file {
    margin-left: 6px;
    background: rgba(245, 158, 11, 0.15);
    color: #b45309;
    border: 1px solid rgba(245, 158, 11, 0.3);
  }
}

/* 回退前的物理文件预检提示 */
.presence-warning {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.6;
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.28);
  color: var(--b3-theme-on-surface);

  .presence-icon {
    flex-shrink: 0;
    margin-top: 2px;
    color: #b45309;
  }

  code {
    padding: 0 3px;
    border-radius: 3px;
    background: var(--b3-theme-surface);
  }

  &.is-blocked {
    background: rgba(239, 68, 68, 0.1);
    border-color: rgba(239, 68, 68, 0.3);

    .presence-icon {
      color: #dc2626;
    }
  }
}

.card-body {
  padding: 0 14px 14px 14px;
  border-top: 1px dashed var(--b3-border-color);
  background: var(--b3-theme-background);
}

.card-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0 6px 0;
  font-size: 12px;
  color: var(--b3-theme-on-surface);
  gap: 10px;
  flex-wrap: wrap;
}

.card-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  position: relative;
  z-index: 3;
}

.files-table-container {
  max-height: 220px;
  overflow-y: auto;
  overflow-x: hidden;
  border: 1px solid var(--b3-border-color);
  border-radius: 4px;
}

.files-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;

  th {
    background: var(--b3-theme-surface, #fafafa);
    padding: 6px 10px;
    text-align: left;
    font-weight: 600;
    border-bottom: 1px solid var(--b3-border-color);
  }

  td {
    padding: 6px 10px;
    border-bottom: 1px solid var(--b3-border-color);
  }

  tr:last-child td {
    border-bottom: none;
  }
}

.file-name-cell {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-name-text {
  font-family: var(--b3-font-family-code, monospace);
}

.file-size-cell {
  color: var(--b3-theme-on-surface);
}

.canonical-cell {
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.canonical-tag {
  color: var(--b3-theme-primary);
  font-family: var(--b3-font-family-code, monospace);
}

.refs-tag {
  background: var(--b3-theme-surface-lighter, rgba(128, 128, 128, 0.12));
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
}

.rollback-report-box {
  margin-top: 10px;
  padding: 8px 12px;
  border-radius: 4px;
  background: rgba(16, 185, 129, 0.08);
  border: 1px solid rgba(16, 185, 129, 0.2);
  font-size: 12px;
}

.report-header {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #059669;
  font-weight: 500;
  margin-bottom: 4px;
}

.report-stats {
  color: var(--b3-theme-on-surface);
  display: flex;
  gap: 6px;
}

.dialog-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  color: var(--b3-theme-on-surface);
}

.empty-icon {
  color: var(--b3-border-color);
  margin-bottom: 14px;
}

.empty-text {
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 6px;
}

.empty-subtext {
  font-size: 12px;
  opacity: 0.7;
  max-width: 420px;
  text-align: center;
  line-height: 1.5;
}

/* 回退前置确认弹窗 */
.am-inner-modal {
  z-index: 1050;
}

.rollback-confirm-dialog {
  width: 520px;
  max-width: 90vw;
  padding: 20px;
}

.confirm-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
  color: var(--b3-theme-primary);
  margin-bottom: 14px;
}

.confirm-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.confirm-notice {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 6px;
  background: rgba(59, 130, 246, 0.08);
  border: 1px solid rgba(59, 130, 246, 0.2);
  font-size: 12px;
  line-height: 1.5;

  .notice-icon {
    color: #2563eb;
    flex-shrink: 0;
    margin-top: 2px;
  }
}

.checklist-box {
  border: 1px solid var(--b3-border-color);
  border-radius: 6px;
  padding: 10px 12px;
  background: var(--b3-theme-surface, #fafafa);
}

.checklist-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 8px;
  gap: 10px;
  flex-wrap: wrap;
}

.checklist-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.checklist-items {
  margin: 0;
  padding-left: 20px;
  max-height: 140px;
  overflow-y: auto;
  font-size: 12px;
  font-family: var(--b3-font-family-code, monospace);

  li {
    margin-bottom: 4px;
  }
}

.drift-defense-tip {
  font-size: 12px;
  color: var(--b3-theme-on-surface);
  opacity: 0.85;
  line-height: 1.4;
  padding: 6px 0;
}

.confirm-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}

.am-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 14px;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.15s ease;

  &--primary {
    background: var(--b3-theme-primary);
    color: var(--b3-theme-on-primary, #fff);

    &:hover {
      opacity: 0.9;
    }
  }

  &--secondary {
    background: var(--b3-theme-surface-lighter, rgba(128, 128, 128, 0.12));
    color: var(--b3-theme-on-background);
    border-color: var(--b3-border-color);

    &:hover {
      background: var(--b3-theme-surface, rgba(128, 128, 128, 0.2));
    }
  }

  &--danger-outline {
    background: transparent;
    color: var(--b3-theme-error, #ef4444);
    border-color: var(--b3-theme-error, #ef4444);

    &:hover {
      background: rgba(239, 68, 68, 0.1);
    }
  }

  &.is-disabled,
  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    pointer-events: none;
  }
}

.btn-compact {
  padding: 3px 8px;
  font-size: 12px;
}

.doc-link-cell {
  text-align: left;
}

.am-link-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--b3-theme-surface-lighter, rgba(128, 128, 128, 0.12));
  border: 1px solid transparent;
  color: var(--b3-theme-primary);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: var(--b3-theme-primary);
    color: var(--b3-theme-on-primary, #fff);
  }
}

.am-icon-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: inline-flex;
  color: var(--b3-theme-on-surface);

  &:hover {
    background: var(--b3-theme-surface-lighter, rgba(128, 128, 128, 0.15));
  }
}

.text-muted {
  color: var(--b3-theme-on-surface);
  opacity: 0.5;
}

.text-warning {
  color: #d97706;
}

.text-danger {
  color: #dc2626;
}

.text-danger-emphasis {
  color: var(--b3-theme-error, #ef4444);
  font-weight: bold;
}

.doc-jump-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 150px;
  line-height: 1.2;

  .doc-icon {
    flex-shrink: 0;
  }

  .doc-title-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

/* 显眼图标操作按钮体系（与资源浏览界面风格统一） */
.am-action-btn {
  width: 30px;
  height: 30px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  cursor: pointer;
  border: 1px solid transparent;
  background: transparent;
  transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  flex-shrink: 0;

  &:active {
    transform: translateY(0);
  }

  &--with-text {
    width: auto;
    padding: 0 10px;
    gap: 5px;
    font-size: 12px;
    font-weight: 500;
  }

  :deep(svg) {
    fill: none !important;
    stroke: currentColor !important;
    stroke-width: 2px !important;
    pointer-events: none;
  }

  // 1. 打开系统回收站按钮：翡翠绿/系统资源风
  &--recycle {
    color: #059669;
    background: color-mix(in srgb, #059669 10%, transparent);
    border-color: color-mix(in srgb, #059669 28%, transparent);

    &:hover {
      background: color-mix(in srgb, #059669 18%, transparent);
      border-color: #059669;
      transform: translateY(-1px);
      box-shadow: 0 2px 8px rgba(5, 150, 105, 0.15);
    }
  }

  // 2. 清空日志按钮：警示红 (Danger Red)
  &--clear {
    color: var(--b3-theme-error, #ef4444);
    background: color-mix(in srgb, var(--b3-theme-error, #ef4444) 10%, transparent);
    border-color: color-mix(in srgb, var(--b3-theme-error, #ef4444) 28%, transparent);

    &:hover {
      background: color-mix(in srgb, var(--b3-theme-error, #ef4444) 20%, transparent);
      border-color: var(--b3-theme-error, #ef4444);
      transform: translateY(-1px);
      box-shadow: 0 2px 8px rgba(239, 68, 68, 0.15);
    }
  }

  // 3. 跳转文档按钮：沉稳主色蓝
  &--jump-doc {
    color: var(--b3-theme-primary);
    background: color-mix(in srgb, var(--b3-theme-primary) 10%, transparent);
    border-color: color-mix(in srgb, var(--b3-theme-primary) 28%, transparent);

    &:hover {
      background: color-mix(in srgb, var(--b3-theme-primary) 18%, transparent);
      border-color: var(--b3-theme-primary);
      transform: translateY(-1px);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    }

    &.is-disabled,
    &:disabled {
      opacity: 0.35;
      cursor: not-allowed;
      pointer-events: none;
      filter: grayscale(0.6);
    }
  }

  // 4. 回退引用按钮：主色蓝色实心高光
  &--rollback {
    color: var(--b3-theme-on-primary, #fff);
    background: var(--b3-theme-primary);
    border-color: var(--b3-theme-primary);

    &:hover {
      background: color-mix(in srgb, var(--b3-theme-primary) 85%, #000);
      transform: translateY(-1px);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
    }
  }

  // 5. 复制清单按钮：紧凑工具栏图标
  &--copy {
    width: 26px;
    height: 26px;
    border-radius: 4px;
    color: var(--b3-theme-on-surface);
    background: var(--b3-theme-surface-lighter, rgba(128, 128, 128, 0.1));
    border-color: var(--b3-border-color);

    &:hover {
      color: var(--b3-theme-primary);
      border-color: var(--b3-theme-primary);
      background: color-mix(in srgb, var(--b3-theme-primary) 12%, transparent);
      transform: translateY(-1px);
    }
  }
}

.file-name-inner {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
}

.file-thumb-icon {
  color: var(--b3-theme-primary);
  flex-shrink: 0;
  opacity: 0.85;
}

.file-name-cell.has-preview {
  cursor: pointer;

  &:hover .file-name-text {
    color: var(--b3-theme-primary);
    text-decoration: underline;
  }
}

// 被删图片浮动悬浮预览框
.deletion-hover-preview {
  position: fixed;
  z-index: 10000;
  pointer-events: none;
  background: var(--b3-theme-background);
  border: 1px solid var(--b3-theme-surface-lighter, var(--b3-border-color));
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: hidden;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-sizing: border-box;
  animation: am-preview-pop-in 0.12s ease-out;

  .hover-preview-img-box {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--b3-theme-surface, rgba(0, 0, 0, 0.05));
    border-radius: 6px;
    overflow: hidden;
    max-width: 220px;
    max-height: 200px;

    img {
      display: block;
      max-width: 220px;
      max-height: 200px;
      width: auto;
      height: auto;
      object-fit: contain;
    }
  }

  .hover-preview-meta {
    display: flex;
    flex-direction: column;
    gap: 3px;
    max-width: 220px;
  }

  .hover-preview-title {
    font-size: 12px;
    font-weight: 500;
    color: var(--b3-theme-on-background);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hover-preview-sub {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11px;
    color: var(--b3-theme-on-surface);
    opacity: 0.85;
  }

  .hover-preview-tag {
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 4px;
    background: rgba(16, 185, 129, 0.12);
    color: #10b981;
    border: 1px solid rgba(16, 185, 129, 0.25);
  }
}

@keyframes am-preview-pop-in {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
</style>


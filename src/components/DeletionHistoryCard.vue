<template>
  <div
    class="history-card"
    :class="{
      'is-rolled-back': batch.isRolledBack,
      'is-expanded': isExpanded,
    }"
  >
    <!-- 卡片头部概览 -->
    <div class="card-header" @click="$emit('toggle-expand')">
      <div class="card-header-left">
        <span class="chevron-icon" :class="{ 'is-rotated': isExpanded }">
          <ChevronRight :size="16" />
        </span>

        <!-- 操作类型徽章 -->
        <span class="badge badge-action" :class="getActionBadgeClass(batch.actionType)">
          {{ getActionBadgeText(batch.actionType) }}
        </span>

        <!-- 删除去向徽章 -->
        <span class="badge badge-dest" :class="batch.destination === 'os-trash' ? 'is-trash' : 'is-permanent'">
          <Archive v-if="batch.destination === 'os-trash'" :size="11" class="badge-icon" />
          <AlertTriangle v-else :size="11" class="badge-icon" />
          {{ batch.destination === 'os-trash' ? t('card.destOsTrash') : t('card.destPermanent') }}
        </span>

        <!-- 状态徽章 -->
        <span v-if="batch.isRolledBack" class="badge badge-status is-rolled">
          <Check :size="11" class="badge-icon" /> {{ t('card.rolledBackBadge') }}
        </span>
        <span v-else-if="batch.canRollback" class="badge badge-status is-can-rollback">
          {{ t('card.canRollback') }}
        </span>

        <span class="card-time">{{ formatTime(batch.timestamp) }}</span>
      </div>

      <div class="card-header-right">
        <span class="card-stat">
          <strong>{{ batch.items.length }}</strong> {{ t('card.statFileUnit', { n: batch.items.length }) }} · {{ t('card.statFreed') }} <strong>{{ formatSize(batch.freedBytes) }}</strong>
        </span>

        <!-- 回退主按钮（显眼图标 + 文字 + Tooltips） -->
        <button
          v-if="batch.canRollback && !batch.isRolledBack"
          class="am-action-btn am-action-btn--rollback am-action-btn--with-text btn-rollback b3-tooltips b3-tooltips__sw"
          @click.stop="$emit('rollback', batch)"
          :aria-label="t('card.rollbackBtnAria')"
        >
          <RotateCcw :size="14" style="fill: none !important;" />
          <span>{{ t('card.rollback') }}</span>
        </button>
      </div>
    </div>

    <!-- 折叠展开明细详情 -->
    <div v-if="isExpanded" class="card-body">
      <!-- 快捷工具栏（复制文件名清单） -->
      <div class="card-toolbar">
        <span class="card-detail-hint">{{ t('card.detailHint', { count: batch.items.length, n: batch.items.length }) }}</span>
        <div class="card-toolbar-actions">
          <button
            class="am-action-btn am-action-btn--copy b3-tooltips b3-tooltips__w"
            @click="copyBatchFilePaths"
            :aria-label="t('card.copyFileListAria')"
            :title="t('card.copyFileListTitle')"
          >
            <Copy :size="14" style="fill: none !important;" />
          </button>
        </div>
      </div>

      <!-- 文件列表 -->
      <div class="files-table-container">
        <table class="files-table">
          <thead>
            <tr>
              <th>{{ t('card.colFileName') }}</th>
              <th style="width: 100px;">{{ t('card.colSize') }}</th>
              <th v-if="batch.actionType === 'deduplicate'">{{ t('card.colMergedInto') }}</th>
              <th v-if="batch.actionType === 'deduplicate'" style="width: 120px;">{{ t('card.colAffectedRefs') }}</th>
              <th v-else style="width: 170px;">{{ t('card.colRelatedDoc') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in batch.items" :key="item.fileName">
              <td
                class="file-name-cell"
                :class="{ 'has-preview': Boolean(item.thumbnail) }"
                :title="item.originalRelativePath"
                @mouseenter="$emit('show-preview', $event, item)"
                @mousemove="$emit('update-preview', $event)"
                @mouseleave="$emit('hide-preview')"
              >
                <span class="file-name-inner">
                  <Image v-if="item.thumbnail" :size="13" class="file-thumb-icon" :title="t('card.thumbHoverTitle')" />
                  <span class="file-name-text">{{ item.fileName }}</span>
                  <span
                    v-if="item.partialFailure"
                    class="badge badge-status is-partial-failure"
                    :title="item.failureReason || t('card.partialFailureTitle')"
                  >
                    {{ t('card.partialFailureBadge') }}
                  </span>
                </span>
              </td>
              <td class="file-size-cell">{{ formatSize(item.size) }}</td>
              <td v-if="batch.actionType === 'deduplicate'" class="canonical-cell">
                <span v-if="item.canonicalName" class="canonical-tag" :title="item.canonicalName">
                  ↳ {{ item.canonicalName }}
                </span>
                <span v-else class="text-muted">-</span>
              </td>
              <td v-if="batch.actionType === 'deduplicate'" class="refs-cell">
                <button
                  v-if="item.affectedBlocks && item.affectedBlocks.length > 0"
                  class="am-link-btn"
                  @click.stop="$emit('jump-item-doc', item)"
                  :title="getItemDocTooltip(item)"
                >
                  <FileText :size="11" />
                  <span>{{ t('card.refCount', { count: item.affectedBlocks.length, n: item.affectedBlocks.length }) }}</span>
                </button>
                <span v-else class="text-muted">{{ t('card.noRefs') }}</span>
              </td>
              <td v-else class="doc-link-cell">
                <button
                  v-if="hasItemDoc(item)"
                  class="am-link-btn doc-jump-btn"
                  :title="getItemDocTooltip(item)"
                  @click.stop="$emit('jump-item-doc', item)"
                >
                  <FileText :size="12" class="doc-icon" style="fill: none !important;" />
                  <span class="doc-title-text">{{ getItemDocDisplayTitle(item) }}</span>
                </button>
                <span v-else class="text-muted">{{ t('card.noRefs') }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 回退报告（若已执行过回退） -->
      <div v-if="batch.isRolledBack && batch.rollbackReport" class="rollback-report-box">
        <div class="report-header">
          <CheckCircle2 :size="14" class="report-icon" />
          <span>{{ t('card.rollbackReportHeader', { time: formatTime(batch.rolledBackAt || 0) }) }}</span>
        </div>
        <div class="report-stats">
          <span>{{ t('card.reportRestored') }} <strong>{{ batch.rollbackReport.restoredBlocksCount }}</strong> {{ t('card.reportBlockRefUnit', { n: batch.rollbackReport.restoredBlocksCount }) }}</span>
          <span v-if="batch.rollbackReport.skippedBlocksCount > 0" class="text-warning">
            · {{ t('card.reportSkipped') }} <strong>{{ batch.rollbackReport.skippedBlocksCount }}</strong> {{ t('card.reportSkippedUnit', { n: batch.rollbackReport.skippedBlocksCount }) }}
          </span>
          <span v-if="batch.rollbackReport.failedBlocksCount > 0" class="text-danger">
            · {{ t('card.reportFailed') }} <strong>{{ batch.rollbackReport.failedBlocksCount }}</strong> {{ t('card.reportUnit', { n: batch.rollbackReport.failedBlocksCount }) }}
          </span>
          <span v-if="(batch.rollbackReport.degradedPositionCount || 0) > 0" class="text-warning">
            · {{ t('rollback.degradedPosition') }}:
            <strong>{{ batch.rollbackReport.degradedPositionCount }}</strong>
            {{ t('card.reportDegradedUnit', { n: batch.rollbackReport.degradedPositionCount, hint: t('rollback.degradedPositionHint') }) }}
          </span>
          <span v-if="(batch.rollbackReport.exactRestoredCount || 0) > 0" class="text-muted">
            · {{ t('card.reportExactRestored') }} <strong>{{ batch.rollbackReport.exactRestoredCount }}</strong> {{ t('card.reportExactUnit', { n: batch.rollbackReport.exactRestoredCount }) }}
          </span>
          <span v-if="(batch.rollbackReport.approximateRestoredCount || 0) > 0" class="text-warning">
            · {{ t('rollback.approximate') }}
            <strong>{{ batch.rollbackReport.approximateRestoredCount }}</strong>
            {{ t('card.reportApproxUnit', { n: batch.rollbackReport.approximateRestoredCount }) }}
          </span>
          <span v-if="(batch.rollbackReport.restoredIalCount || 0) > 0" class="text-muted">
            · {{ t('card.reportIal') }}<strong>{{ batch.rollbackReport.restoredIalCount }}</strong> {{ t('card.reportUnit', { n: batch.rollbackReport.restoredIalCount }) }}
          </span>
          <span v-if="(batch.rollbackReport.restoredViewCellsCount || 0) > 0" class="text-muted">
            · {{ t('card.reportDbCells') }} <strong>{{ batch.rollbackReport.restoredViewCellsCount }}</strong> {{ t('card.reportUnit', { n: batch.rollbackReport.restoredViewCellsCount }) }}
            <template v-if="(batch.rollbackReport.skippedViewCellsCount || 0) > 0">
              {{ t('card.reportDbSkipped', { skipped: batch.rollbackReport.skippedViewCellsCount, n: batch.rollbackReport.skippedViewCellsCount }) }}
            </template>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  ChevronRight,
  Archive,
  AlertTriangle,
  RotateCcw,
  Copy,
  Check,
  CheckCircle2,
  Image,
  FileText,
} from 'lucide-vue-next';
import type { IDeletionBatch, IDeletedItemRecord, DeletionActionType } from '../utils/deletion-logger';
import { formatAssetSize } from '../utils/asset-list';
import { showMessage } from 'siyuan';
import { t } from '../i18n';

const props = defineProps<{
  batch: IDeletionBatch;
  isExpanded: boolean;
  docInfoMap: Map<string, { title: string; hpath: string }>;
}>();

defineEmits<{
  (e: 'toggle-expand'): void;
  (e: 'rollback', batch: IDeletionBatch): void;
  (e: 'jump-item-doc', item: IDeletedItemRecord): void;
  (e: 'show-preview', event: MouseEvent, item: IDeletedItemRecord): void;
  (e: 'update-preview', event: MouseEvent): void;
  (e: 'hide-preview'): void;
}>();

function formatTime(timestamp: number): string {
  if (!timestamp) return '-';
  const d = new Date(timestamp);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatSize(bytes: number): string {
  return formatAssetSize(bytes);
}

function getActionBadgeText(type: DeletionActionType): string {
  switch (type) {
    case 'deduplicate':
      return t('card.actionDeduplicate');
    case 'orphan-cleanup':
      return t('card.actionOrphanCleanup');
    case 'orphan-original-cleanup':
      return t('card.actionOrphanOriginalCleanup');
    case 'single-delete':
      return t('card.actionSingleDelete');
    case 'batch-delete':
      return t('card.actionBatchDelete');
    default:
      return t('card.actionDefault');
  }
}

function getActionBadgeClass(type: DeletionActionType): string {
  switch (type) {
    case 'deduplicate':
      return 'badge-dedup';
    case 'orphan-cleanup':
    case 'orphan-original-cleanup':
      return 'badge-clean';
    default:
      return 'badge-manual';
  }
}

function copyBatchFilePaths() {
  const text = props.batch.items.map((i) => i.fileName).join('\n');
  navigator.clipboard.writeText(text).then(() => {
    showMessage(t('card.copiedFileNames', { count: props.batch.items.length, n: props.batch.items.length }));
  });
}

function getItemDocIds(item: IDeletedItemRecord): string[] {
  if (!item.affectedBlocks || item.affectedBlocks.length === 0) return [];
  const docIds = new Set<string>();
  for (const ref of item.affectedBlocks) {
    const docId = ref.root_id || ref.id;
    if (docId) docIds.add(docId);
  }
  return Array.from(docIds);
}

function hasItemDoc(item: IDeletedItemRecord): boolean {
  return getItemDocIds(item).length > 0;
}

function getItemDocDisplayTitle(item: IDeletedItemRecord): string {
  const docIds = getItemDocIds(item);
  if (docIds.length === 0) return t('card.noRefs');
  const firstId = docIds[0];
  const info = props.docInfoMap.get(firstId);
  const firstTitle = info?.title || firstId;

  if (docIds.length === 1) {
    return firstTitle;
  }
  return t('card.docTitleMore', { title: firstTitle, count: docIds.length });
}

function getItemDocTooltip(item: IDeletedItemRecord): string {
  const docIds = getItemDocIds(item);
  if (docIds.length === 0) return t('card.itemNoDocTooltip');

  if (docIds.length === 1) {
    const info = props.docInfoMap.get(docIds[0]);
    if (info?.hpath) {
      return t('card.jumpToDoc', { target: info.hpath });
    }
    return t('card.jumpToDoc', { target: info?.title || docIds[0] });
  }

  const titles = docIds.map((id) => {
    const info = props.docInfoMap.get(id);
    return info?.hpath || info?.title || id;
  });
  return t('card.relatedDocsTooltip', { count: docIds.length, n: docIds.length, titles: titles.join('\n') });
}
</script>

<style scoped lang="scss">
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
</style>

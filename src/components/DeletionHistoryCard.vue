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
          {{ batch.destination === 'os-trash' ? '操作系统回收站' : '物理硬删' }}
        </span>

        <!-- 状态徽章 -->
        <span v-if="batch.isRolledBack" class="badge badge-status is-rolled">
          <Check :size="11" class="badge-icon" /> 已回退引用
        </span>
        <span v-else-if="batch.canRollback" class="badge badge-status is-can-rollback">
          可回退
        </span>

        <span class="card-time">{{ formatTime(batch.timestamp) }}</span>
      </div>

      <div class="card-header-right">
        <span class="card-stat">
          <strong>{{ batch.items.length }}</strong> 个文件 · 释放 <strong>{{ formatSize(batch.freedBytes) }}</strong>
        </span>

        <!-- 回退主按钮（显眼图标 + 文字 + Tooltips） -->
        <button
          v-if="batch.canRollback && !batch.isRolledBack"
          class="am-action-btn am-action-btn--rollback am-action-btn--with-text btn-rollback b3-tooltips b3-tooltips__sw"
          @click.stop="$emit('rollback', batch)"
          aria-label="逆向回退文档正文与属性视图中的图片引用"
        >
          <RotateCcw :size="14" style="fill: none !important;" />
          <span>回退</span>
        </button>
      </div>
    </div>

    <!-- 折叠展开明细详情 -->
    <div v-if="isExpanded" class="card-body">
      <!-- 快捷工具栏（复制文件名清单） -->
      <div class="card-toolbar">
        <span class="card-detail-hint">被删文件明细（共 {{ batch.items.length }} 项，支持鼠标悬浮预览图片）：</span>
        <div class="card-toolbar-actions">
          <button
            class="am-action-btn am-action-btn--copy b3-tooltips b3-tooltips__w"
            @click="copyBatchFilePaths"
            aria-label="复制文件名清单"
            title="一键复制本批次所有文件名到剪贴板，方便在操作系统回收站中检索"
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
              <th>文件名</th>
              <th style="width: 100px;">大小</th>
              <th v-if="batch.actionType === 'deduplicate'">合并替换为主保留项</th>
              <th v-if="batch.actionType === 'deduplicate'" style="width: 120px;">受影响引用</th>
              <th v-else style="width: 170px;">关联文档</th>
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
                  <Image v-if="item.thumbnail" :size="13" class="file-thumb-icon" title="悬浮查看被删图片预览" />
                  <span class="file-name-text">{{ item.fileName }}</span>
                  <span
                    v-if="item.partialFailure"
                    class="badge badge-status is-partial-failure"
                    :title="item.failureReason || '该条目归一化未完全成功，已保留回退记录'"
                  >
                    未完成
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
                  <span>{{ item.affectedBlocks.length }} 处引用</span>
                </button>
                <span v-else class="text-muted">无引用</span>
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
                <span v-else class="text-muted">无引用</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 回退报告（若已执行过回退） -->
      <div v-if="batch.isRolledBack && batch.rollbackReport" class="rollback-report-box">
        <div class="report-header">
          <CheckCircle2 :size="14" class="report-icon" />
          <span>已于 {{ formatTime(batch.rolledBackAt || 0) }} 执行逆向回退：</span>
        </div>
        <div class="report-stats">
          <span>成功还原: <strong>{{ batch.rollbackReport.restoredBlocksCount }}</strong> 处块引用</span>
          <span v-if="batch.rollbackReport.skippedBlocksCount > 0" class="text-warning">
            · 跳过漂移块: <strong>{{ batch.rollbackReport.skippedBlocksCount }}</strong> 处（块已修改或删除）
          </span>
          <span v-if="batch.rollbackReport.failedBlocksCount > 0" class="text-danger">
            · 失败: <strong>{{ batch.rollbackReport.failedBlocksCount }}</strong> 处
          </span>
          <span v-if="(batch.rollbackReport.degradedPositionCount || 0) > 0" class="text-warning">
            · {{ t('rollbackDegradedPosition', '位置降级') }}:
            <strong>{{ batch.rollbackReport.degradedPositionCount }}</strong>
            处（{{ t('rollbackDegradedPositionHint', '原相邻块已变化，已按近似位置还原') }}）
          </span>
          <span v-if="(batch.rollbackReport.exactRestoredCount || 0) > 0" class="text-muted">
            · 精确还原 <strong>{{ batch.rollbackReport.exactRestoredCount }}</strong> 块（按合并前快照整段还原）
          </span>
          <span v-if="(batch.rollbackReport.approximateRestoredCount || 0) > 0" class="text-warning">
            · {{ t('rollbackApproximate', '近似还原') }}
            <strong>{{ batch.rollbackReport.approximateRestoredCount }}</strong>
            处（值已被改动，按原引用处数限量还原）
          </span>
          <span v-if="(batch.rollbackReport.restoredIalCount || 0) > 0" class="text-muted">
            · 块属性引用（题头图等）<strong>{{ batch.rollbackReport.restoredIalCount }}</strong> 处
          </span>
          <span v-if="(batch.rollbackReport.restoredViewCellsCount || 0) > 0" class="text-muted">
            · 数据库单元格 <strong>{{ batch.rollbackReport.restoredViewCellsCount }}</strong> 处
            <template v-if="(batch.rollbackReport.skippedViewCellsCount || 0) > 0">
              （跳过 {{ batch.rollbackReport.skippedViewCellsCount }} 处已改动/已删除的单元格）
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
import { usePlugin } from '../utils/plugin-context';

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

function t(key: string, fallback: string): string {
  const i18n = (usePlugin() as any)?.i18n;
  return (i18n && i18n[key]) || fallback;
}

function getActionBadgeText(type: DeletionActionType): string {
  switch (type) {
    case 'deduplicate':
      return '图片去重合并';
    case 'orphan-cleanup':
      return '孤儿资源清理';
    case 'orphan-original-cleanup':
      return '孤立底图清理';
    case 'single-delete':
      return '单文件删除';
    case 'batch-delete':
      return '批量选中删除';
    default:
      return '删除操作';
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
    showMessage(`已复制 ${props.batch.items.length} 个文件名到剪贴板`);
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
  if (docIds.length === 0) return '无引用';
  const firstId = docIds[0];
  const info = props.docInfoMap.get(firstId);
  const firstTitle = info?.title || firstId;

  if (docIds.length === 1) {
    return firstTitle;
  }
  return `${firstTitle} 等 ${docIds.length} 篇`;
}

function getItemDocTooltip(item: IDeletedItemRecord): string {
  const docIds = getItemDocIds(item);
  if (docIds.length === 0) return '该条目未被任何文档引用';

  if (docIds.length === 1) {
    const info = props.docInfoMap.get(docIds[0]);
    if (info?.hpath) {
      return `跳转到文档：${info.hpath}`;
    }
    return `跳转到文档：${info?.title || docIds[0]}`;
  }

  const titles = docIds.map((id) => {
    const info = props.docInfoMap.get(id);
    return info?.hpath || info?.title || id;
  });
  return `关联 ${docIds.length} 篇文档，点击跳转打开：\n${titles.join('\n')}`;
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

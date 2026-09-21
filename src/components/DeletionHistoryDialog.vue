<template>
  <div v-if="visible" class="am-modal-mask" @click.self="handleClose">
    <div class="am-modal-dialog deletion-history-dialog">
      <!-- 弹窗顶栏 -->
      <div class="dialog-header">
        <div class="dialog-title">
          <History :size="18" class="title-icon" />
          <span>删除操作审计与回退历史</span>
          <span class="batch-count-badge">{{ filteredHistory.length }} 条记录</span>
        </div>
        <div class="header-actions">
          <button class="am-icon-btn b3-tooltips b3-tooltips__sw" @click="handleClose" aria-label="关闭窗口 (Esc)">
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
              全部 ({{ historyList.length }})
            </button>
            <button
              class="filter-chip"
              :class="{ 'is-active': activeFilter === 'deduplicate' }"
              @click="activeFilter = 'deduplicate'"
            >
              去重 ({{ dedupCount }})
            </button>
            <button
              class="filter-chip"
              :class="{ 'is-active': activeFilter === 'cleanup' }"
              @click="activeFilter = 'cleanup'"
            >
              清理 ({{ cleanupCount }})
            </button>
            <button
              class="filter-chip"
              :class="{ 'is-active': activeFilter === 'manual' }"
              @click="activeFilter = 'manual'"
            >
              手动删除 ({{ manualCount }})
            </button>
          </div>
        </div>

        <div class="toolbar-right">
          <!-- 历史容量上限配置 (0~100) -->
          <div class="limit-config" title="设置保留的最近删除操作批次数（0 表示关闭历史日志）">
            <span class="limit-label">保留上限:</span>
            <input
              type="number"
              class="limit-input b3-text-field"
              v-model.number="historyLimit"
              min="0"
              max="100"
              @change="handleLimitChange"
            />
            <span class="limit-unit">批次</span>
          </div>

          <button
            class="am-btn am-btn--secondary btn-compact"
            @click="handleOpenRecycleBin"
            title="直接打开操作系统回收站窗口，以便检索与还原被删文件"
          >
            <ExternalLink :size="13" />
            <span>打开系统回收站</span>
          </button>

          <button
            v-if="historyList.length > 0"
            class="am-btn am-btn--danger-outline btn-compact"
            @click="handleClearAll"
            title="清空所有历史操作记录（不影响磁盘文件）"
          >
            <Trash2 :size="13" />
            <span>清空日志</span>
          </button>
        </div>
      </div>

      <!-- 批次列表主体 -->
      <div class="dialog-body" v-if="filteredHistory.length > 0">
        <div
          v-for="batch in filteredHistory"
          :key="batch.id"
          class="history-card"
          :class="{
            'is-rolled-back': batch.isRolledBack,
            'is-expanded': expandedBatchIds.has(batch.id),
          }"
        >
          <!-- 卡片头部概览 -->
          <div class="card-header" @click="toggleExpand(batch.id)">
            <div class="card-header-left">
              <span class="chevron-icon" :class="{ 'is-rotated': expandedBatchIds.has(batch.id) }">
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

              <!-- 单文件删除且有缩略图时，在头部提供快速悬浮预览入口 -->
              <span
                v-if="batch.items.length === 1 && batch.items[0]?.thumbnail"
                class="header-thumb-trigger"
                title="悬浮查看被删图片预览"
                @mouseenter.stop="handleShowPreview($event, batch.items[0])"
                @mousemove.stop="handleUpdatePreview($event)"
                @mouseleave.stop="handleHidePreview"
              >
                <Image :size="14" class="header-thumb-icon" />
                <span class="header-thumb-tip">预览原图</span>
              </span>

              <span class="card-time">{{ formatTime(batch.timestamp) }}</span>
            </div>

            <div class="card-header-right">
              <span class="card-stat">
                <strong>{{ batch.items.length }}</strong> 个文件 · 释放 <strong>{{ formatSize(batch.freedBytes) }}</strong>
              </span>

              <!-- 跳转到文档按钮（每张卡片内提供，无论是否已回退） -->
              <button
                class="am-btn am-btn--secondary btn-compact btn-jump-doc"
                :class="{ 'is-disabled': !hasRelatedDocs(batch) }"
                :disabled="!hasRelatedDocs(batch)"
                @click.stop="handleJumpToDoc(batch)"
                :title="getJumpToDocTitle(batch)"
              >
                <FileText :size="13" />
                <span>跳转到文档</span>
              </button>

              <!-- 回退主按钮（支持去重批次与带引用的单文件/批量删除） -->
              <button
                v-if="batch.canRollback && !batch.isRolledBack"
                class="am-btn am-btn--primary btn-compact"
                @click.stop="openRollbackConfirm(batch)"
                title="逆向回退文档正文与属性视图中的图片引用"
              >
                <RotateCcw :size="13" />
                <span>回退引用</span>
              </button>
            </div>
          </div>

          <!-- 折叠展开明细详情 -->
          <div v-if="expandedBatchIds.has(batch.id)" class="card-body">
            <!-- 快捷工具栏（已精简：打开系统回收站仅在顶栏显示） -->
            <div class="card-toolbar">
              <span class="card-detail-hint">被删文件明细（共 {{ batch.items.length }} 项，支持鼠标悬浮预览图片）：</span>
              <div class="card-toolbar-actions">
                <button
                  class="am-btn am-btn--secondary btn-compact"
                  @click="copyBatchFilePaths(batch)"
                  title="一键复制所有文件路径/文件名到剪贴板，方便在操作系统回收站中检索"
                >
                  <Copy :size="12" />
                  <span>复制文件清单</span>
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
                    <th v-else style="width: 130px;">关联文档</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in batch.items" :key="item.fileName">
                    <td
                      class="file-name-cell"
                      :class="{ 'has-preview': Boolean(item.thumbnail) }"
                      :title="item.originalRelativePath"
                      @mouseenter="handleShowPreview($event, item)"
                      @mousemove="handleUpdatePreview($event)"
                      @mouseleave="handleHidePreview"
                    >
                      <span class="file-name-inner">
                        <Image v-if="item.thumbnail" :size="13" class="file-thumb-icon" title="悬浮查看被删图片预览" />
                        <span class="file-name-text">{{ item.fileName }}</span>
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
                        @click.stop="handleJumpToItemDoc(item)"
                        title="点击跳转到引用所在的文档"
                      >
                        <FileText :size="11" />
                        <span>{{ item.affectedBlocks.length }} 处引用</span>
                      </button>
                      <span v-else class="text-muted">无引用</span>
                    </td>
                    <td v-else class="doc-link-cell">
                      <button
                        v-if="item.affectedBlocks && item.affectedBlocks.length > 0"
                        class="am-link-btn"
                        @click.stop="handleJumpToItemDoc(item)"
                        title="点击跳转到该文件所在文档"
                      >
                        <FileText :size="11" />
                        <span>跳转文档 ({{ getItemDocCount(item) }})</span>
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
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 空状态 -->
      <div v-else class="dialog-empty">
        <History :size="48" class="empty-icon" />
        <div class="empty-text">
          <span v-if="historyLimit === 0">历史日志记录当前已关闭（保留上限为 0）</span>
          <span v-else-if="historyList.length === 0">暂无删除历史记录</span>
          <span v-else>当前分类下暂无历史记录</span>
        </div>
        <div class="empty-subtext">
          去重与清理操作将自动移入操作系统回收站，并记录详细批次流水与引用回退信息。
        </div>
      </div>

      <!-- 回退确认前置弹窗 -->
      <div v-if="rollbackConfirmBatch" class="am-modal-mask am-inner-modal" @click.self="rollbackConfirmBatch = null">
        <div class="am-modal-dialog rollback-confirm-dialog">
          <div class="confirm-header">
            <RotateCcw :size="18" class="confirm-icon" />
            <span v-if="rollbackConfirmBatch.actionType === 'deduplicate'">确认回退去重引用语法</span>
            <span v-else>确认回退被删图片文档引用</span>
          </div>

          <div class="confirm-body">
            <div class="confirm-notice">
              <AlertCircle :size="16" class="notice-icon" />
              <div class="notice-text">
                <p v-if="rollbackConfirmBatch.actionType === 'deduplicate'">
                  <strong>【重要提示】</strong>此操作将逆向改回文档正文及属性视图中被替换的图片引用语法。
                </p>
                <p v-else>
                  <strong>【重要提示】</strong>此操作将自动恢复文档中被清理的图片引用语法。
                </p>
                <p><strong>物理资源文件请由您在操作系统回收站中手工还原回 <code>data/assets/</code> 目录。</strong></p>
              </div>
            </div>

            <div class="checklist-box">
              <div class="checklist-header">
                <span>需从系统回收站放回的文件清单（共 {{ rollbackChecklist.length }} 个）：</span>
                <div class="checklist-header-actions">
                  <button class="am-btn am-btn--secondary btn-compact" @click="copyChecklist">
                    <Copy :size="12" /> 复制清单
                  </button>
                </div>
              </div>
              <ul class="checklist-items">
                <li v-for="name in rollbackChecklist" :key="name">
                  <code>{{ name }}</code>
                </li>
              </ul>
            </div>

            <div class="drift-defense-tip">
              <strong>智能安全防御已生效：</strong>若某些块在此前已被您再次修改（如替换为其他图或移除了内容），回退引擎将自动安全跳过，绝不破坏您的最新编辑内容。
            </div>
          </div>

          <div class="confirm-footer">
            <button class="am-btn am-btn--secondary" @click="rollbackConfirmBatch = null" :disabled="isRollingBack">
              取消
            </button>
            <button class="am-btn am-btn--primary" @click="executeRollback" :disabled="isRollingBack">
              <span v-if="isRollingBack">正在执行逆向恢复...</span>
              <span v-else>确认开始回退</span>
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
          <img :src="hoverPreviewItem.thumbnail" alt="预览缩略图" />
        </div>
        <div class="hover-preview-meta">
          <div class="hover-preview-title" :title="hoverPreviewItem.fileName">
            {{ hoverPreviewItem.fileName }}
          </div>
          <div class="hover-preview-sub">
            <span>大小: {{ formatSize(hoverPreviewItem.size) }}</span>
            <span class="hover-preview-tag">已在回收站</span>
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
  ChevronRight,
  Archive,
  AlertTriangle,
  RotateCcw,
  Copy,
  Check,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Image,
  FileText,
} from 'lucide-vue-next';
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
} from '../utils/rollback-engine';
import { formatAssetSize } from '../utils/asset-list';
import { showConfirm } from '../utils/confirm';
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

async function loadData() {
  historyLimit.value = await getDeletionHistoryLimit();
  historyList.value = await getDeletionHistory();
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
  showMessage(`历史保留上限已设置为 ${updated} 批次`);
}

async function handleClearAll() {
  const confirmed = await showConfirm({
    title: '清空操作历史',
    message: '确定要清空所有的删除与回退操作日志吗？此操作仅清除记录流水，不会影响系统回收站或本地磁盘文件。',
    confirmText: '清空记录',
    danger: true,
  });
  if (!confirmed) return;

  await clearDeletionHistory();
  historyList.value = [];
  showMessage('操作日志已清空');
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

async function handleOpenRecycleBin() {
  const ok = await openOSRecycleBin();
  if (ok) {
    showMessage('已为您打开操作系统回收站窗口');
  } else {
    showMessage('未能自动打开系统回收站，请您手动在操作系统桌面或文件管理器中打开', 5000, 'info');
  }
}

function copyBatchFilePaths(batch: IDeletionBatch) {
  const text = batch.items.map((i) => i.fileName).join('\n');
  navigator.clipboard.writeText(text).then(() => {
    showMessage(`已复制 ${batch.items.length} 个文件名到剪贴板`);
  });
}

function copyChecklist() {
  const text = rollbackChecklist.value.join('\n');
  navigator.clipboard.writeText(text).then(() => {
    showMessage(`已复制待放回文件清单 (${rollbackChecklist.value.length} 个) 到剪贴板`);
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

function openRollbackConfirm(batch: IDeletionBatch) {
  rollbackConfirmBatch.value = batch;
}

async function executeRollback() {
  if (!rollbackConfirmBatch.value) return;
  const batchId = rollbackConfirmBatch.value.id;
  isRollingBack.value = true;

  try {
    const result = await rollbackBatch(batchId);
    showMessage(`回退完成！已成功恢复 ${result.report.restoredBlocksCount} 处块引用${result.report.skippedBlocksCount > 0 ? `，跳过 ${result.report.skippedBlocksCount} 处漂移块` : ''}`);
    rollbackConfirmBatch.value = null;
    await loadData();
    emit('refresh');
  } catch (err: any) {
    showMessage(`回退失败: ${err.message || err}`, 5000, 'error');
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
 * 判断卡片是否有可跳转的关联文档
 */
function hasRelatedDocs(batch: IDeletionBatch): boolean {
  return getBatchAffectedDocIds(batch).length > 0;
}

/**
 * 按钮 hover 提示文案
 */
function getJumpToDocTitle(batch: IDeletionBatch): string {
  const docIds = getBatchAffectedDocIds(batch);
  if (docIds.length === 0) {
    return '该记录中的文件未被任何文档引用，无关联文档可跳转';
  }
  if (docIds.length === 1) {
    return '点击跳转到被删除文件所在文档';
  }
  return `点击在后台打开所有关联文档（共 ${docIds.length} 篇）`;
}

/**
 * 获取单个文件涉及的关联文档数量
 */
function getItemDocCount(item: IDeletedItemRecord): number {
  if (!item.affectedBlocks || item.affectedBlocks.length === 0) return 0;
  const docIds = new Set<string>();
  for (const ref of item.affectedBlocks) {
    if (ref.root_id) docIds.add(ref.root_id);
    else if (ref.id) docIds.add(ref.id);
  }
  return docIds.size;
}

/**
 * 打开文档的核心通用方法
 */
async function openDocumentByIds(docIds: string[]) {
  if (docIds.length === 0) {
    showMessage('未找到关联文档', 4000, 'info');
    return;
  }

  const plugin = usePlugin();
  if (!plugin || !plugin.app) {
    showMessage('插件上下文未就绪，无法跳转', 4000, 'error');
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
      showMessage(`已在后台打开文档: ${openedTitles[0]}`);
    } else {
      showMessage(`已在后台打开 ${openedTitles.length} 篇关联文档`);
    }
  } catch (err: any) {
    warn('[DeletionHistory] 跳转文档失败:', err);
    showMessage(`跳转文档失败: ${err.message || err}`, 5000, 'error');
  }
}

/**
 * 点击卡片头部的“跳转到文档”
 */
async function handleJumpToDoc(batch: IDeletionBatch) {
  let docIds = getBatchAffectedDocIds(batch);

  // 若没有记录的 affectedBlocks，尝试按文件名在思源数据库中检索潜在引用
  if (docIds.length === 0 && batch.items.length > 0) {
    try {
      for (const item of batch.items) {
        const queryFile = item.fileName.replace(/'/g, "''");
        const rows = await sql(
          `SELECT root_id FROM blocks WHERE (markdown LIKE '%assets/${queryFile}%' OR ial LIKE '%assets/${queryFile}%') AND root_id != '' LIMIT 1`
        );
        if (rows && rows.length > 0 && rows[0].root_id) {
          docIds.push(rows[0].root_id);
          break;
        }
      }
    } catch {}
  }

  if (docIds.length === 0) {
    showMessage('该记录中的文件未被任何文档引用，无关联文档可跳转', 4000, 'info');
    return;
  }

  await openDocumentByIds(docIds);
}

/**
 * 点击明细表格中的单个文件“跳转文档”
 */
async function handleJumpToItemDoc(item: IDeletedItemRecord) {
  if (!item.affectedBlocks || item.affectedBlocks.length === 0) {
    showMessage('该文件未记录关联文档', 4000, 'info');
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
    showMessage('该文件未记录关联文档', 4000, 'info');
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
  overflow: hidden;
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
}

.files-table-container {
  max-height: 220px;
  overflow-y: auto;
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

// 头部缩略图预览触发小胶囊
.header-thumb-trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 7px;
  border-radius: 12px;
  background: var(--b3-theme-surface-lighter, rgba(128, 128, 128, 0.12));
  border: 1px solid var(--b3-border-color);
  font-size: 11px;
  color: var(--b3-theme-primary);
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: var(--b3-theme-primary);
    color: var(--b3-theme-on-primary, #fff);
    border-color: var(--b3-theme-primary);
  }
}

.header-thumb-icon {
  flex-shrink: 0;
}

.header-thumb-tip {
  font-size: 11px;
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


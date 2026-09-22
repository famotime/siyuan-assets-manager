<template>
  <div ref="containerEl" class="assets-manager-container" style="position: relative;">
    <!-- 顶部综合控制区 (两段式高信噪比布局) -->
    <div class="header" :class="{ 'header--tab': isTabMode }">
      <!-- 第一层：品牌、实时指标胶囊与核心操作图标群 -->
      <div class="header__top-row">
        <div class="header__title-group">
          <h2>资源管家</h2>
          <div class="header-summary-badge" v-if="assets.length > 0">
            <span class="summary-count">{{ sortedAssets.length }} / {{ assets.length }} 项</span>
            <span class="summary-dot">·</span>
            <span class="summary-size">{{ totalAssetsSizeText }}</span>
          </div>
        </div>

        <div class="header__top-actions">
          <span class="refresh-time" title="资源列表最近一次从思源数据库重新载入的时间">
            上次刷新：{{ lastRefreshText }}
          </span>

          <div class="primary-action-icons">
            <!-- 刷新 -->
            <button
              class="am-action-btn am-action-btn--refresh am-action-btn--with-text b3-tooltips b3-tooltips__s"
              @click="handleRefreshClick"
              aria-label="刷新资源列表"
            >
              <RotateCw :size="14" :class="{ spinning: loading }" style="fill: none !important;" />
              <span>刷新</span>
            </button>

            <!-- 批量删除 / 去重 -->
            <template v-if="selectedNames.size > 0">
              <button
                class="am-action-btn am-action-btn--batch-delete am-action-btn--with-text b3-tooltips b3-tooltips__s"
                @click="handleBatchDelete"
                :aria-label="`批量删除选中的 ${selectedNames.size} 个文件`"
              >
                <Trash2 :size="14" style="fill: none !important;" />
                <span>批量删除</span>
              </button>
              <button
                class="am-action-btn am-action-btn--cancel am-action-btn--with-text b3-tooltips b3-tooltips__s"
                @click="clearSelection"
                aria-label="取消当前多选"
              >
                <XSquare :size="14" style="fill: none !important;" />
                <span>取消</span>
              </button>
            </template>
            <template v-else>
              <button
                class="am-action-btn am-action-btn--dedup am-action-btn--with-text b3-tooltips b3-tooltips__s"
                @click="handleOpenDeduplicate"
                aria-label="识别疑似重复资源与视觉相似图片，比对后一键归一化合并"
              >
                <CopyMinus :size="14" style="fill: none !important;" />
                <span>去重</span>
              </button>
              <button
                class="am-action-btn am-action-btn--clean am-action-btn--with-text b3-tooltips b3-tooltips__s"
                @click="handleUnifiedCleanup"
                aria-label="综合清理所有未引用的孤儿资源与孤立底图"
              >
                <Trash2 :size="14" style="fill: none !important;" />
                <span>清理</span>
              </button>
            </template>

            <!-- 日志 -->
            <button
              class="am-action-btn am-action-btn--history am-action-btn--with-text b3-tooltips b3-tooltips__sw"
              @click="historyDialogVisible = true"
              aria-label="查看删除操作日志与回退历史"
            >
              <History :size="14" style="fill: none !important;" />
              <span>日志</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 第二层：检索过滤与视图切换工具栏 -->
      <div class="header__toolbar-row">
        <div class="toolbar-left">
          <!-- 视图切换模式按钮组 (平铺视图 vs 文档归类) -->
          <div class="view-mode-toggle">
            <button
              type="button"
              class="am-btn am-btn--icon b3-tooltips b3-tooltips__s"
              :class="{ 'is-active': viewMode === 'flat' }"
              @click="setViewMode('flat')"
              aria-label="平铺列表视图"
            >
              <LayoutList :size="15" style="fill: none !important;" />
            </button>
            <button
              type="button"
              class="am-btn am-btn--icon b3-tooltips b3-tooltips__s"
              :class="{ 'is-active': viewMode === 'doc' }"
              @click="setViewMode('doc')"
              aria-label="按文档归类视图"
            >
              <FolderTree :size="15" style="fill: none !important;" />
            </button>
          </div>

          <!-- 搜索输入舱 -->
          <div class="search-capsule">
            <Search :size="13" class="search-icon" style="fill: none !important;" />
            <input 
              v-model="searchQuery" 
              type="text" 
              :placeholder="viewMode === 'doc' ? '搜索资源或文档名称...' : '搜索资源名称...'" 
              class="am-input search-input"
            />
            <button
              v-if="searchQuery"
              class="search-clear-btn"
              @click="searchQuery = ''"
              aria-label="清空搜索"
            >
              <X :size="12" style="fill: none !important;" />
            </button>
          </div>

          <!-- 属性过滤下拉 -->
          <select v-model="filterType" class="am-input filter-select">
            <option value="all">全部属性</option>
            <option value="reeditable">可二次编辑</option>
            <option value="original">原始底图</option>
            <option value="unreferenced">未引用 (孤儿/孤立)</option>
            <option value="large">大文件 (>1MB)</option>
          </select>
        </div>

        <!-- 文档归类模式专属控制器：文档排序与全部展开/折叠 -->
        <div class="toolbar-right" v-if="viewMode === 'doc'">
          <select v-model="docSortField" class="am-input doc-sort-select">
            <option value="totalSize">按文档总大小</option>
            <option value="assetCount">按文档资源数</option>
            <option value="name">按文档名称</option>
          </select>
          <button
            type="button"
            class="am-btn am-btn--icon b3-tooltips b3-tooltips__s"
            @click="toggleDocSortOrder"
            :aria-label="docSortOrder === 'desc' ? '文档排序：降序 (点击切换升序)' : '文档排序：升序 (点击切换降序)'"
          >
            <ArrowDownNarrowWide v-if="docSortOrder === 'desc'" :size="16" style="fill: none !important;" />
            <ArrowUpNarrowWide v-else :size="16" style="fill: none !important;" />
          </button>
          <button
            type="button"
            class="am-btn am-btn--icon b3-tooltips b3-tooltips__sw"
            @click="toggleAllDocGroups"
            :aria-label="isAllGroupsCollapsed ? '一键全部展开所有文档' : '一键全部折叠所有文档'"
          >
            <ChevronsDownUp v-if="!isAllGroupsCollapsed" :size="16" style="fill: none !important;" />
            <ChevronsUpDown v-else :size="16" style="fill: none !important;" />
          </button>
        </div>
      </div>
    </div>

    <!-- 顶部 6 大分类指标药丸导航栏 (Segmented Metric Pills) -->
    <div class="category-pills-bar">
      <button
        v-for="card in categoryCards"
        :key="card.key"
        type="button"
        class="category-pill"
        :class="{ 'is-active': activeCategory === card.key }"
        @click="handleCategoryClick(card.key)"
        :title="activeCategory === card.key && card.key !== 'all' ? `点击取消【${card.label}】筛选，查看全部` : `点击仅查看【${card.label}】资源`"
      >
        <span class="pill-icon" :style="{ color: card.color }">
          <component :is="card.icon" :size="14" style="fill: none !important;" />
        </span>
        <span class="pill-label">{{ card.label }}</span>
        <span class="pill-badge">{{ categoryStats[card.key]?.count || 0 }}</span>
        <span class="pill-size">{{ categoryStats[card.key]?.sizeText || '0 B' }}</span>
      </button>
    </div>

    <!-- 已有数据时刷新不卸载列表，否则每次刷新都会丢掉滚动位置并整表重建 -->
    <div class="main-content" v-if="assets.length > 0 || !loading">
      <VirtualAssetList 
        v-if="viewMode === 'flat'"
        ref="virtualListRef"
        :assets="sortedAssets"
        :sortField="sortField"
        :sortOrder="sortOrder"
        :selectedNames="selectedNames"
        @update:selectedNames="handleSelectionChange"
        @sort="handleSortChange"
        @open-docs="handleOpenDocs"
        @edit="handleEdit"
        @rename="handleRename"
        @delete="handleDelete"
        @show-preview="handleShowPreview"
        @update-preview="handleUpdatePreview"
        @hide-preview="handleHidePreview"
      />

      <DocumentAssetGroupList
        v-else-if="viewMode === 'doc'"
        ref="docListRef"
        :groups="groupedDocAssets"
        :sortField="sortField"
        :sortOrder="sortOrder"
        :selectedNames="selectedNames"
        :collapsedDocIds="collapsedDocIds"
        :searchQuery="searchQuery"
        @toggle-collapse="toggleDocGroup"
        @update:selectedNames="handleSelectionChange"
        @sort="handleSortChange"
        @open-docs="handleOpenDocs"
        @open-doc-id="handleOpenSingleDoc"
        @edit="handleEdit"
        @rename="handleRename"
        @delete="handleDelete"
        @show-preview="handleShowPreview"
        @update-preview="handleUpdatePreview"
        @hide-preview="handleHidePreview"
      />
    </div>
    
    <div v-else class="loading-state">
      正在扫描 Siyuan 数据库并构建资源关联表，请稍候...
    </div>

    <!-- 限制在当前界面内的悬浮资源预览弹窗 (支持图片、MP4 视频与 MP3/常见音频) -->
    <AssetMediaPreview
      :preview-url="previewUrl"
      :preview-type="previewType"
      :preview-asset="previewAsset"
      :preview-style="previewStyle"
      @mouseenter="cancelHidePreview"
      @mouseleave="scheduleHidePreview(0)"
    />


    <!-- 去重比对弹窗 -->
    <DeduplicateDialog
      v-model:visible="deduplicateVisible"
      :assets="assets"
      @completed="loadData"
    />

    <!-- 删除操作审计与回退历史弹窗 -->
    <DeletionHistoryDialog
      v-model:visible="historyDialogVisible"
      @refresh="loadData"
    />

    <!-- 底部悬浮批量操作浮岛 (就近操作，提升大屏长列表人机工效) -->
    <div v-if="selectedNames.size > 0" class="am-batch-floating-dock">
      <div class="am-batch-floating-dock__info">
        <span>已选 <strong class="am-batch-floating-dock__count">{{ selectedNames.size }}</strong> 项</span>
        <span>({{ selectedSummary.sizeText }})</span>
      </div>
      <div class="am-batch-floating-dock__divider"></div>
      <div class="am-batch-floating-dock__actions">
        <button
          type="button"
          class="am-btn am-btn--sm am-btn--ghost"
          @click="clearSelection"
          aria-label="清空当前多选"
        >
          取消选择
        </button>
        <button
          type="button"
          class="am-btn am-btn--sm am-btn--danger"
          @click="handleBatchDelete"
          :aria-label="`确认执行批量删除 (${selectedNames.size} 个文件)`"
        >
          <Trash2 :size="13" style="fill: none !important;" />
          <span>批量删除</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue';
import { openTab } from 'siyuan';
import {
  Files,
  Image,
  FileText,
  Music,
  Video,
  Archive,
  AlertCircle,
  History,
  LayoutList,
  FolderTree,
  ChevronsDownUp,
  ChevronsUpDown,
  ArrowDownNarrowWide,
  ArrowUpNarrowWide,
  RotateCw,
  CopyMinus,
  Sparkles,
  Trash2,
  XSquare,
  Search,
  X,
} from 'lucide-vue-next';
import { getAllAssetsInfo, countReferencedDocs, type AssetInfo } from '../utils/siyuan-db';
import { normalizeOriginalStoragePath, readOriginalImage } from '../utils/file-system';
import {
  buildSingleDeleteConfirmMessage,
  buildBatchDeleteConfirmMessage,
  buildUnifiedCleanupConfirmMessage,
  executeSingleAssetDeletion,
  executeBatchAssetsDeletion,
  executeUnifiedCleanup,
} from '../utils/cleanup-workflow';
import {
  calculateBatchDeleteSummary,
  calculateCategoryStats,
  calculateTotalCleanup,
  filterAssets,
  formatAssetSize,
  formatAssetTime,
  isImageAsset,
  isPlayableAudioAsset,
  isPlayableVideoAsset,
  sortAssets,
  splitFileName,
  groupReferencesByDoc,
  groupAssetsByDocument,
  applyPinnedDocOrder,
  type AssetCategory,
  type AssetFilterType,
  type AssetSortField,
  type AssetSortOrder,
  type DocAssetGroup,
  type DocSortField,
  type DocSortOrder,
} from '../utils/asset-list';
import { showConfirm } from '../utils/confirm';
import { pushMsg } from '../api';
import { usePlugin } from '../utils/plugin-context';
import { error } from '../utils/logger';
import VirtualAssetList from './VirtualAssetList.vue';
import DocumentAssetGroupList from './DocumentAssetGroupList.vue';
import DeduplicateDialog from './DeduplicateDialog.vue';
import DeletionHistoryDialog from './DeletionHistoryDialog.vue';
import AssetMediaPreview from './AssetMediaPreview.vue';

const props = withDefaults(
  defineProps<{
    isTabMode?: boolean;
  }>(),
  {
    isTabMode: false,
  }
);

const assets = ref<AssetInfo[]>([]);
const loading = ref(false);
// 最近一次成功从数据库载入资源列表的时刻，首次载入完成前显示占位符
const lastRefreshedAt = ref<number | null>(null);
const lastRefreshText = computed(() =>
  lastRefreshedAt.value ? formatAssetTime(lastRefreshedAt.value) : '—'
);
const totalAssetsSizeText = computed(() => {
  const total = assets.value.reduce((sum, a) => sum + (a.size || 0), 0);
  return formatAssetSize(total);
});
const deduplicateVisible = ref(false);
const historyDialogVisible = ref(false);
const searchQuery = ref('');
const filterType = ref<AssetFilterType>('all');
const activeCategory = ref<AssetCategory>('all');

function handleOpenDeduplicate() {
  deduplicateVisible.value = true;
}

// 6 大分类全局统计与卡片配置
const categoryStats = computed(() => calculateCategoryStats(assets.value));

const categoryCards = computed(() => [
  { key: 'all' as AssetCategory, label: '全部', icon: Files, color: 'var(--am-cat-all)' },
  { key: 'image' as AssetCategory, label: '图片', icon: Image, color: 'var(--am-cat-image)' },
  { key: 'document' as AssetCategory, label: '文档', icon: FileText, color: 'var(--am-cat-doc)' },
  { key: 'audio' as AssetCategory, label: '音频', icon: Music, color: 'var(--am-cat-audio)' },
  { key: 'video' as AssetCategory, label: '视频', icon: Video, color: 'var(--am-cat-video)' },
  { key: 'archive' as AssetCategory, label: '压缩包', icon: Archive, color: 'var(--am-cat-archive)' },
]);

function handleCategoryClick(cat: AssetCategory) {
  if (activeCategory.value === cat && cat !== 'all') {
    activeCategory.value = 'all';
  } else {
    activeCategory.value = cat;
  }
}

// 视图模式与持久化偏好
const VIEW_MODE_STORAGE_KEY = 'siyuan-assets-manager-view-mode';
const viewMode = ref<'flat' | 'doc'>((localStorage.getItem(VIEW_MODE_STORAGE_KEY) as 'flat' | 'doc') || 'flat');

function setViewMode(mode: 'flat' | 'doc') {
  viewMode.value = mode;
  try {
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
  } catch (e) {}
}

// 排序状态
const sortField = ref<AssetSortField>('size');
const sortOrder = ref<AssetSortOrder>('desc');

// 文档卡片排序与折叠状态
const docSortField = ref<DocSortField>('totalSize');
const docSortOrder = ref<DocSortOrder>('desc');

// 折叠状态由本组件持有，使切换视图与资源增删都不丢失用户操作（面板关闭时才随之重置）
const collapsedDocIds = ref<Set<string>>(new Set());
const hasInitializedCollapse = ref(false);

// 文档卡片顺序冻结：仅在显式刷新或切换排序字段时重新捕获，避免删除/编辑资源后卡片跳位
const pinnedDocOrder = ref<string[] | null>(null);

function toggleDocSortOrder() {
  docSortOrder.value = docSortOrder.value === 'desc' ? 'asc' : 'desc';
}

// 多选状态
const selectedNames = ref<Set<string>>(new Set());
const selectedSummary = computed(() => calculateBatchDeleteSummary(assets.value, selectedNames.value));

const containerEl = ref<HTMLElement | null>(null);
const virtualListRef = ref<any>(null);
const docListRef = ref<any>(null);

// 悬浮大图与音视频预览相关状态
const previewType = ref<'image' | 'video' | 'audio' | null>(null);
const previewAsset = ref<AssetInfo | null>(null);
const previewUrl = ref('');
const previewStyle = ref({
  top: '0px',
  left: '0px',
});
const mouseX = ref(0);
const mouseY = ref(0);
let previewTimeout: number | null = null;
let previewBlobUrl: string | null = null;
let hideTimeout: number | null = null;
function handleSelectionChange(nextSet: Set<string>) {
  selectedNames.value = nextSet;
}

function clearSelection() {
  selectedNames.value = new Set<string>();
}

function cleanupPreview() {
  if (previewBlobUrl) {
    URL.revokeObjectURL(previewBlobUrl);
    previewBlobUrl = null;
  }
  previewUrl.value = '';
  previewType.value = null;
  previewAsset.value = null;
}

function cancelHidePreview() {
  if (hideTimeout) {
    clearTimeout(hideTimeout);
    hideTimeout = null;
  }
}

function scheduleHidePreview(delay: number = 0) {
  if (previewTimeout) {
    clearTimeout(previewTimeout);
    previewTimeout = null;
  }
  cancelHidePreview();

  if (delay <= 0) {
    cleanupPreview();
  } else {
    hideTimeout = window.setTimeout(() => {
      cleanupPreview();
      hideTimeout = null;
    }, delay);
  }
}

async function handleShowPreview(payload: { event: MouseEvent, asset: AssetInfo, previewSrc?: string }) {
  const { event, asset, previewSrc } = payload;
  const isImg = isImageAsset(asset.name) || Boolean(asset.isOriginal);
  const isVid = isPlayableVideoAsset(asset.name);
  const isAud = isPlayableAudioAsset(asset.name);

  if (!isImg && !isVid && !isAud) return;

  // 取消任何待处理的隐藏与老定时器
  cancelHidePreview();
  if (previewTimeout) {
    clearTimeout(previewTimeout);
    previewTimeout = null;
  }

  mouseX.value = event.clientX;
  mouseY.value = event.clientY;

  previewTimeout = window.setTimeout(async () => {
    // 切换预览前彻底清理上一个媒体元素
    cleanupPreview();
    previewAsset.value = asset;

    if (isVid) {
      previewType.value = 'video';
      const versionQuery = asset.updated ? `?t=${asset.updated}` : '';
      previewUrl.value = `${encodeURI(`/assets/${asset.name}`)}${versionQuery}`;
    } else if (isAud) {
      previewType.value = 'audio';
      const versionQuery = asset.updated ? `?t=${asset.updated}` : '';
      previewUrl.value = `${encodeURI(`/assets/${asset.name}`)}${versionQuery}`;
    } else {
      previewType.value = 'image';
      if (asset.isOriginal) {
        if (previewSrc) {
          previewUrl.value = previewSrc;
        } else {
          try {
            const blob = await readOriginalImage(asset.originalStoragePath || asset.name);
            if (blob) {
              previewBlobUrl = URL.createObjectURL(blob);
              previewUrl.value = previewBlobUrl;
            }
          } catch (e) {}
        }
      } else {
        const versionQuery = asset.updated ? `?t=${asset.updated}` : '';
        previewUrl.value = `/assets/${asset.name}${versionQuery}`;
      }
    }
    positionPreview(mouseX.value, mouseY.value);
  }, 250);
}

function handleUpdatePreview(payload: { event: MouseEvent }) {
  const { event } = payload;
  mouseX.value = event.clientX;
  mouseY.value = event.clientY;
  // 当音视频卡片已展示时，固定坐标不再跟手乱晃，以便用户鼠标平滑移入卡片进行交互
  if (previewUrl.value && previewType.value !== 'audio' && previewType.value !== 'video') {
    positionPreview(mouseX.value, mouseY.value);
  }
}

function positionPreview(clientX: number, clientY: number) {
  if (!containerEl.value) return;
  const containerRect = containerEl.value.getBoundingClientRect();

  const relativeX = clientX - containerRect.left;
  const relativeY = clientY - containerRect.top;

  const offsetX = 20;
  const offsetY = 20;
  let x = relativeX + offsetX;
  let y = relativeY + offsetY;

  const safeBound = 420;

  if (x + safeBound > containerRect.width) {
    x = relativeX - safeBound - offsetX;
  }
  if (y + safeBound > containerRect.height) {
    y = relativeY - safeBound - offsetY;
  }

  if (x < 0) x = 10;
  if (y < 0) y = 10;

  previewStyle.value = {
    top: `${y}px`,
    left: `${x}px`,
  };
}

function handleHidePreview() {
  // 如果是可交互的音频或视频卡片，提供 200ms 缓冲桥接延时，方便鼠标平滑移入卡片点击控件
  if (previewType.value === 'audio' || previewType.value === 'video') {
    scheduleHidePreview(200);
  } else {
    scheduleHidePreview(0);
  }
}

function handleKeyDown(event: KeyboardEvent) {
  const activeTag = (document.activeElement?.tagName || '').toLowerCase();
  if (activeTag === 'input' || activeTag === 'textarea') {
    return;
  }

  // Ctrl+A / Cmd+A 全选当前已过滤的全部资源
  if ((event.ctrlKey || event.metaKey) && (event.key === 'a' || event.key === 'A')) {
    event.preventDefault();
    if (viewMode.value === 'doc') {
      const set = new Set<string>();
      for (const g of groupedDocAssets.value) {
        for (const a of g.assets) {
          set.add(a.name);
        }
      }
      selectedNames.value = set;
    } else {
      selectedNames.value = new Set(sortedAssets.value.map(a => a.name));
    }
    return;
  }

  // Delete / Backspace 快捷触发批量删除
  if ((event.key === 'Delete' || event.key === 'Backspace') && selectedNames.value.size > 0) {
    event.preventDefault();
    handleBatchDelete();
  }
}

onUnmounted(() => {
  handleHidePreview();
  window.removeEventListener('assets-manager-refresh', handleGlobalRefresh);
  window.removeEventListener('keydown', handleKeyDown);
});

async function loadData(options: { resort?: boolean } = {}) {
  loading.value = true;
  try {
    assets.value = await getAllAssetsInfo();
    // 载入成功才记账，失败的刷新不该让顶部显示出「刚刚刷新过」
    lastRefreshedAt.value = Date.now();
    // 过滤掉已不存在的选中项
    const existingNames = new Set(assets.value.map(a => a.name));
    selectedNames.value = new Set([...selectedNames.value].filter(name => existingNames.has(name)));
    // 默认不重排：删除、编辑、去重等写入后保持用户当前看到的卡片顺序，仅刷新按钮显式要求重排
    if (options.resort) {
      resortNow();
    }
  } catch (e) {
    error("Failed to load assets", e);
  } finally {
    loading.value = false;
  }
}

export interface AssetTargetedUpdateDetail {
  action: 'rename' | 'edit';
  oldName: string;
  newName: string;
  references?: any[];
  updated?: number;
  size?: number;
  isReEditable?: boolean;
  reEditBlockId?: string;
  originalStoragePath?: string;
  deletedOld?: boolean;
}

function applyTargetedAssetUpdate(detail: AssetTargetedUpdateDetail) {
  const {
    action,
    oldName,
    newName,
    references = [],
    updated = Date.now(),
    size,
    isReEditable,
    reEditBlockId,
    originalStoragePath,
    deletedOld = true,
  } = detail;

  // 释放并失效旧的缩略图缓存
  virtualListRef.value?.invalidateAssetThumbnail?.(oldName);
  virtualListRef.value?.invalidateAssetThumbnail?.(newName);
  docListRef.value?.invalidateAssetThumbnail?.(oldName);
  docListRef.value?.invalidateAssetThumbnail?.(newName);

  const docCount = countReferencedDocs(references);
  const list = [...assets.value];
  const oldIndex = list.findIndex(a => a.name === oldName);

  if (action === 'rename') {
    if (oldIndex !== -1) {
      const oldItem = list[oldIndex];
      const updatedItem: AssetInfo = {
        ...oldItem,
        name: newName,
        updated,
        references,
        refCount: references.length,
        docCount,
        ...(size !== undefined && size > 0 ? { size } : {}),
        ...(isReEditable !== undefined ? { isReEditable } : {}),
        ...(reEditBlockId !== undefined ? { reEditBlockId } : {}),
        ...(originalStoragePath !== undefined ? { originalStoragePath } : {}),
      };
      list[oldIndex] = updatedItem;
    } else {
      list.unshift({
        name: newName,
        size: size || 0,
        updated,
        isDir: false,
        references,
        refCount: references.length,
        docCount,
        isReEditable: Boolean(isReEditable),
        reEditBlockId,
        originalStoragePath,
        isOriginal: false,
      });
    }

    if (selectedNames.value.has(oldName)) {
      const nextSet = new Set(selectedNames.value);
      nextSet.delete(oldName);
      nextSet.add(newName);
      selectedNames.value = nextSet;
    }

    // 同步更新关联的原始底图引用状态
    const finalOrigPath = updatedItem.originalStoragePath;
    if (finalOrigPath) {
      const normOrig = normalizeOriginalStoragePath(finalOrigPath);
      const origIndex = list.findIndex(
        (a) => a.isOriginal && normalizeOriginalStoragePath(a.originalStoragePath || a.name) === normOrig
      );
      if (origIndex !== -1) {
        list[origIndex] = {
          ...list[origIndex],
          references: [...references],
          refCount: references.length,
          docCount,
        };
      }
    }

    assets.value = list;
    return;
  }

  if (action === 'edit') {
    const newItem: AssetInfo = {
      name: newName,
      size: size || (oldIndex !== -1 ? list[oldIndex].size : 0),
      updated,
      isDir: false,
      references,
      refCount: references.length,
      docCount,
      isReEditable: isReEditable !== undefined ? isReEditable : true,
      reEditBlockId,
      originalStoragePath: originalStoragePath || (oldIndex !== -1 ? list[oldIndex].originalStoragePath : undefined),
      isOriginal: false,
    };

    if (oldIndex !== -1) {
      if (deletedOld) {
        // 就地替换：在原有列表位置直接更新为新编辑图片，零跳动零闪烁
        list[oldIndex] = newItem;
      } else {
        // 未删除旧文件时：旧文件的文档引用已转移给新图片，旧文件转为未引用
        list[oldIndex] = {
          ...list[oldIndex],
          references: [],
          refCount: 0,
          docCount: 0,
        };
        list.splice(oldIndex, 0, newItem);
      }
    } else {
      list.unshift(newItem);
    }

    if (deletedOld && selectedNames.value.has(oldName)) {
      const nextSet = new Set(selectedNames.value);
      nextSet.delete(oldName);
      nextSet.add(newName);
      selectedNames.value = nextSet;
    }

    // 同步更新关联的原始底图引用状态
    const finalOrigPath = newItem.originalStoragePath;
    if (finalOrigPath) {
      const normOrig = normalizeOriginalStoragePath(finalOrigPath);
      const origIndex = list.findIndex(
        (a) => a.isOriginal && normalizeOriginalStoragePath(a.originalStoragePath || a.name) === normOrig
      );
      if (origIndex !== -1) {
        list[origIndex] = {
          ...list[origIndex],
          references: [...references],
          refCount: references.length,
          docCount,
        };
      }
    }

    assets.value = list;
  }
}

const handleGlobalRefresh = (event?: Event) => {
  const customEvt = event as CustomEvent<AssetTargetedUpdateDetail | undefined>;
  const detail = customEvt?.detail;
  if (detail && detail.oldName && detail.newName) {
    applyTargetedAssetUpdate(detail);
  } else {
    loadData();
  }
};

onMounted(() => {
  // 初次加载确立排序基准，之后除非用户点刷新或改排序字段，卡片顺序不再变动
  loadData({ resort: true });
  window.addEventListener('assets-manager-refresh', handleGlobalRefresh);
  window.addEventListener('keydown', handleKeyDown);
});

const filteredAssets = computed(() => {
  return filterAssets(assets.value, {
    searchQuery: searchQuery.value,
    filterType: filterType.value,
    category: activeCategory.value,
  });
});

const sortedAssets = computed(() => {
  return sortAssets(filteredAssets.value, sortField.value, sortOrder.value);
});

// 在文档归类视图下：上游先按分类与属性过滤，搜索与排序交由 groupAssetsByDocument 处理
const categoryAndTypeFilteredAssets = computed(() => {
  return filterAssets(assets.value, {
    searchQuery: '',
    filterType: filterType.value,
    category: activeCategory.value,
  });
});

const groupedDocAssets = computed(() => {
  const groups = groupAssetsByDocument(categoryAndTypeFilteredAssets.value, {
    searchQuery: searchQuery.value,
    docSortField: docSortField.value,
    docSortOrder: docSortOrder.value,
    assetSortField: sortField.value,
    assetSortOrder: sortOrder.value,
  });
  return applyPinnedDocOrder(groups, pinnedDocOrder.value ?? undefined);
});

// 捕获当前文档顺序作为冻结基准。刻意不带分类与搜索过滤，保证任何筛选视图下拿到的都是
// 同一份全库位次，避免「在筛选态刷新后再切回全部」时未冻结文档被挤到末尾。
function resortNow() {
  const fullGroups = groupAssetsByDocument(assets.value, {
    docSortField: docSortField.value,
    docSortOrder: docSortOrder.value,
  });
  pinnedDocOrder.value = fullGroups.filter((g) => !g.isUnreferenced).map((g) => g.id);
}

// 显式切换排序依据时才重排
watch([docSortField, docSortOrder], () => {
  resortNow();
});

// 首次进入文档归类视图时默认折叠全部文档；此后完全遵从用户操作，不再自动改写
watch(
  [viewMode, groupedDocAssets],
  ([mode, groups]) => {
    if (hasInitializedCollapse.value) return;
    if (mode !== 'doc' || groups.length === 0) return;
    hasInitializedCollapse.value = true;
    collapsedDocIds.value = new Set(groups.map((g) => g.id));
  },
  { immediate: true }
);

// 是否已全部折叠由 collapsedDocIds 推导，避免视图切换后与列表实际状态不一致
const isAllGroupsCollapsed = computed(
  () =>
    groupedDocAssets.value.length > 0
    && groupedDocAssets.value.every((g) => collapsedDocIds.value.has(g.id))
);

function toggleDocGroup(groupId: string) {
  const next = new Set(collapsedDocIds.value);
  if (next.has(groupId)) {
    next.delete(groupId);
  } else {
    next.add(groupId);
  }
  collapsedDocIds.value = next;
}

function toggleAllDocGroups() {
  if (isAllGroupsCollapsed.value) {
    collapsedDocIds.value = new Set();
  } else {
    collapsedDocIds.value = new Set(groupedDocAssets.value.map((g) => g.id));
  }
}

// 刷新按钮是唯一会按最新数据重新排序的入口
function handleRefreshClick() {
  loadData({ resort: true });
}

const docModeStats = computed(() => {
  const docCount = groupedDocAssets.value.filter((g) => !g.isUnreferenced).length;
  const assetNames = new Set<string>();
  for (const g of groupedDocAssets.value) {
    for (const a of g.assets) {
      assetNames.add(a.name);
    }
  }
  return {
    docCount,
    assetCount: assetNames.size,
  };
});

async function handleOpenSingleDoc(rootId: string, firstBlockId?: string) {
  const plugin = usePlugin();
  try {
    await openTab({
      app: plugin.app,
      doc: {
        id: firstBlockId || rootId,
        action: ["cb-get-hl", "cb-get-focus", "cb-get-context"]
      },
      keepCursor: true
    });
    pushMsg("已在后台打开文档");
  } catch (e) {
    error("Failed to open document", e);
    pushMsg("打开文档失败");
  }
}

function handleSortChange(field: AssetSortField) {
  if (sortField.value === field) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortField.value = field;
    sortOrder.value = 'desc';
  }
}

async function handleOpenDocs(asset: AssetInfo) {
  // 按文档去重：同一篇文档被多个块引用时只打开一个页签，定位到该文档的第一个引用块
  const groups = groupReferencesByDoc(asset.references);
  if (groups.length === 0) {
    pushMsg("该资源未被任何文档引用");
    return;
  }

  const plugin = usePlugin();
  try {
    for (const group of groups) {
      await openTab({
        app: plugin.app,
        doc: {
          id: group.first.id,
          action: ["cb-get-hl", "cb-get-focus", "cb-get-context"]
        },
        keepCursor: true
      });
    }
    pushMsg(`已在后台为 ${groups.length} 篇引用文档各打开一个页签`);
  } catch (e) {
    error("Failed to open documents", e);
    pushMsg("打开文档失败");
  }
}

function handleEdit(asset: AssetInfo) {
  if ((window as any)._siyuan_assets_manager_open_editor) {
    const targetBlockId = asset.reEditBlockId || (asset.references && asset.references.length > 0 ? asset.references[0].id : undefined);
    (window as any)._siyuan_assets_manager_open_editor(asset.name, targetBlockId);
  }
}

async function handleDelete(asset: AssetInfo) {
  const confirmOptions = buildSingleDeleteConfirmMessage(asset);
  const confirmDelete = await showConfirm(confirmOptions);
  if (!confirmDelete) return;

  const result = await executeSingleAssetDeletion(asset);
  if (result.success) {
    assets.value = assets.value.filter((a) => a.name !== asset.name);
    selectedNames.value.delete(asset.name);
  }
}

/**
 * 多选批量删除
 */
async function handleBatchDelete() {
  const summary = selectedSummary.value;
  if (summary.totalCount === 0) return;

  const confirmOptions = buildBatchDeleteConfirmMessage(summary);
  const confirmDelete = await showConfirm(confirmOptions);
  if (!confirmDelete) return;

  loading.value = true;
  try {
    const result = await executeBatchAssetsDeletion(summary);
    if (result.success) {
      clearSelection();
      await loadData();
    }
  } finally {
    loading.value = false;
  }
}

function handleRename(asset: AssetInfo) {
  if ((window as any)._siyuan_assets_manager_open_rename) {
    (window as any)._siyuan_assets_manager_open_rename(asset);
  }
}

/**
 * 统一综合清理：整合孤儿资源文件与孤立原始底图的一键清理
 */
async function handleUnifiedCleanup() {
  const summary = calculateTotalCleanup(assets.value);
  if (summary.totalCount === 0) {
    pushMsg("当前没有可清理的孤儿资源或孤立底图，存储空间很干净。");
    return;
  }

  const confirmOptions = buildUnifiedCleanupConfirmMessage(summary);
  const confirmCleanup = await showConfirm(confirmOptions);
  if (!confirmCleanup) return;

  loading.value = true;
  try {
    const result = await executeUnifiedCleanup(summary);
    if (result.success) {
      await loadData();
    }
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped lang="scss">
.assets-manager-container {
  padding: 16px;
  background: var(--b3-theme-background);
  color: var(--b3-theme-on-background);
  height: 100%;
  width: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.header {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 12px;
  padding-right: 40px; /* 为右上角关闭按钮预留空间，防止重叠 */
  flex-shrink: 0;

  &--tab {
    padding-right: 0;
  }

  &__top-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
  }

  &__title-group {
    display: flex;
    align-items: center;
    gap: 12px;

    h2 {
      margin: 0;
      font-size: 17px;
      font-weight: 700;
      color: var(--b3-theme-on-background);
      letter-spacing: -0.2px;
    }
  }

  &__top-actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  &__toolbar-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    background: var(--am-surface-hover);
    padding: 6px 8px;
    border-radius: 6px;
    border: 1px solid var(--am-border-subtle);
  }
}

.header-summary-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 12px;
  background: var(--am-surface-active);
  font-size: 11px;
  color: var(--b3-theme-on-surface);
  font-variant-numeric: tabular-nums;
  user-select: none;

  .summary-count {
    font-weight: 600;
  }

  .summary-dot {
    opacity: 0.5;
  }

  .summary-size {
    opacity: 0.85;
  }
}

.primary-action-icons {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 顶部核心主操作按钮体系：加大至 32px，独立语义色微底色与精致线框 */
.am-action-btn {
  width: 32px;
  height: 32px;
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
    line-height: 1;
    white-space: nowrap;

    span {
      line-height: 1;
      user-select: none;
    }
  }

  svg {
    flex-shrink: 0;
    pointer-events: none;
  }

  // 1. 刷新按钮：主色蓝 (Primary Blue)
  &--refresh {
    color: var(--b3-theme-primary);
    background: color-mix(in srgb, var(--b3-theme-primary) 10%, transparent);
    border-color: color-mix(in srgb, var(--b3-theme-primary) 28%, transparent);

    &:hover {
      background: color-mix(in srgb, var(--b3-theme-primary) 18%, transparent);
      border-color: var(--b3-theme-primary);
      transform: translateY(-1px);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    }
  }

  // 2. 去重比对按钮：智能紫/靛蓝 (Indigo / Purple)
  &--dedup {
    color: #6366f1;
    background: color-mix(in srgb, #6366f1 10%, transparent);
    border-color: color-mix(in srgb, #6366f1 28%, transparent);

    &:hover {
      background: color-mix(in srgb, #6366f1 18%, transparent);
      border-color: #6366f1;
      transform: translateY(-1px);
      box-shadow: 0 2px 8px rgba(99, 102, 241, 0.15);
    }
  }

  // 3. 综合清理按钮：警示红 (Danger Red / Trash)
  &--clean {
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

  // 4. 日志审计按钮：翠绿/青碧 (Emerald / Teal)
  &--history {
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

  // 批量删除 (多选态高亮)
  &--batch-delete {
    color: #fff;
    background: var(--b3-theme-error, #ef4444);
    border-color: var(--b3-theme-error, #ef4444);

    &:hover {
      background: color-mix(in srgb, var(--b3-theme-error, #ef4444) 85%, #000);
      border-color: color-mix(in srgb, var(--b3-theme-error, #ef4444) 85%, #000);
      transform: translateY(-1px);
      box-shadow: 0 2px 8px rgba(239, 68, 68, 0.25);
    }
  }

  // 取消多选
  &--cancel {
    color: var(--b3-theme-on-surface);
    background: var(--b3-theme-surface-lighter);
    border-color: var(--b3-border-color);

    &:hover {
      background: var(--am-surface-hover);
      border-color: var(--b3-theme-on-surface-light);
      transform: translateY(-1px);
    }
  }
}

html[data-theme-mode="dark"] {
  .am-action-btn {
    &--dedup {
      color: #818cf8;
      background: color-mix(in srgb, #818cf8 14%, transparent);
      border-color: color-mix(in srgb, #818cf8 32%, transparent);

      &:hover {
        background: color-mix(in srgb, #818cf8 22%, transparent);
        border-color: #818cf8;
      }
    }

    &--clean {
      color: #f87171;
      background: color-mix(in srgb, #f87171 14%, transparent);
      border-color: color-mix(in srgb, #f87171 32%, transparent);

      &:hover {
        background: color-mix(in srgb, #f87171 22%, transparent);
        border-color: #f87171;
      }
    }

    &--history {
      color: #34d399;
      background: color-mix(in srgb, #34d399 14%, transparent);
      border-color: color-mix(in srgb, #34d399 32%, transparent);

      &:hover {
        background: color-mix(in srgb, #34d399 22%, transparent);
        border-color: #34d399;
      }
    }
  }
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 280px;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.refresh-time {
  font-size: 11px;
  color: var(--b3-theme-on-surface-light);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  opacity: 0.85;
}

/* 复合搜索胶囊舱 */
.search-capsule {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  max-width: 280px;
  min-width: 140px;

  .search-icon {
    position: absolute;
    left: 8px;
    color: var(--b3-theme-on-surface-light);
    pointer-events: none;
  }

  .search-input {
    width: 100%;
    height: 28px;
    padding-left: 28px;
    padding-right: 24px;
    font-size: 12px;
    border-radius: 4px;
  }

  .search-clear-btn {
    position: absolute;
    right: 4px;
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--b3-theme-on-surface-light);
    padding: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;

    &:hover {
      background: var(--am-surface-hover);
      color: var(--b3-theme-on-surface);
    }
  }
}

.filter-select {
  height: 28px;
  font-size: 12px;
  padding: 0 8px;
  width: 130px;
}

.doc-sort-select {
  height: 28px;
  font-size: 12px;
  padding: 0 6px;
  width: 115px;
}

.view-mode-toggle {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--b3-theme-surface-lighter);
  border-radius: 4px;
  overflow: hidden;
  background: var(--b3-theme-surface);

  .am-btn {
    border: none;
    border-radius: 0;
    width: 28px;
    height: 28px;
    padding: 0;
    background: transparent;
    color: var(--b3-theme-on-surface-light);
    margin: 0;

    &:hover {
      background: var(--b3-theme-background-light);
      color: var(--b3-theme-primary);
    }

    &.is-active {
      background: var(--b3-theme-primary);
      color: var(--b3-theme-on-primary, #fff);
    }
  }
}

.spinning {
  animation: spin 1s linear infinite;
  stroke: currentColor;
  fill: none !important;
}
@keyframes spin { 100% { transform: rotate(360deg); } }

.main-content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--b3-theme-surface-lighter);
  border-radius: 4px;
}

.loading-state {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  color: var(--b3-theme-on-surface-light);
  font-size: 16px;
}

</style>

<template>
  <div ref="containerEl" class="assets-manager-container" style="position: relative;">
    <!-- 顶部综合控制区 (两段式高信噪比布局) -->
    <div class="header" :class="{ 'header--tab': isTabMode }">
      <!-- 第一层：品牌、实时指标胶囊与核心操作图标群 -->
      <div class="header__top-row">
        <div class="header__title-group">
          <h2>{{ t('common.appTitle') }}</h2>
          <div class="header-summary-badge" v-if="assets.length > 0">
            <span class="summary-count">{{ t('main.itemCount', { shown: sortedAssets.length, total: assets.length }) }}</span>
            <span class="summary-dot">·</span>
            <span class="summary-size">{{ statFillActive ? '≈ ' : '' }}{{ totalAssetsSizeText }}</span>
          </div>
        </div>

        <div class="header__top-actions">
          <span class="refresh-time" :title="t('main.lastRefreshTitle')">
            {{ t('main.lastRefresh', { time: lastRefreshText }) }}
          </span>

          <!-- 后台 size 补全进度：显式计数 + 进度条，替代仅凭 ≈ 前缀猜测 -->
          <span
            v-if="statFillActive"
            class="stat-fill-progress"
            :title="t('main.statFillTitle')"
          >
            <span class="stat-fill-progress-bar">
              <span class="stat-fill-progress-fill" :style="{ width: statFillPercent + '%' }"></span>
            </span>
            <span>{{ t('main.statFillProgress', { progress: statFillProgressText }) }}</span>
          </span>

          <div class="primary-action-icons">
            <!-- 刷新（引用分析中/降级态也可用，scanSession 保证旧结果被丢弃） -->
            <button
              class="am-action-btn am-action-btn--refresh am-action-btn--with-text b3-tooltips b3-tooltips__s"
              @click="handleRefreshClick"
              :aria-label="t('main.refreshListAria')"
            >
              <RotateCw :size="14" :class="{ spinning: loading }" style="fill: none !important;" />
              <span>{{ t('common.refresh') }}</span>
            </button>

            <!-- 批量删除 / 去重 -->
            <template v-if="selectedNames.size > 0">
              <button
                class="am-action-btn am-action-btn--batch-delete am-action-btn--with-text b3-tooltips b3-tooltips__s"
                @click="handleBatchDelete"
                :disabled="refsPending"
                :aria-label="refsPending ? t('main.refsPendingNoDeleteAria') : t('main.batchDeleteAria', { count: selectedNames.size })"
              >
                <Trash2 :size="14" style="fill: none !important;" />
                <span>{{ t('main.batchDeleteBtn') }}</span>
              </button>
              <button
                class="am-action-btn am-action-btn--cancel am-action-btn--with-text b3-tooltips b3-tooltips__s"
                @click="clearSelection"
                :aria-label="t('main.cancelSelectionAria')"
              >
                <XSquare :size="14" style="fill: none !important;" />
                <span>{{ t('common.cancel') }}</span>
              </button>
            </template>
            <template v-else>
              <button
                class="am-action-btn am-action-btn--dedup am-action-btn--with-text b3-tooltips b3-tooltips__s"
                @click="handleOpenDeduplicate"
                :disabled="refsPending"
                :aria-label="t('main.dedupAria')"
              >
                <CopyMinus :size="14" style="fill: none !important;" />
                <span>{{ t('main.dedupBtn') }}</span>
              </button>
              <button
                class="am-action-btn am-action-btn--clean am-action-btn--with-text b3-tooltips b3-tooltips__s"
                @click="handleUnifiedCleanup"
                :disabled="refsPending"
                :aria-label="t('main.cleanupAria')"
              >
                <Trash2 :size="14" style="fill: none !important;" />
                <span>{{ t('main.cleanupBtn') }}</span>
              </button>
            </template>

            <!-- 日志 -->
            <button
              class="am-action-btn am-action-btn--history am-action-btn--with-text b3-tooltips b3-tooltips__sw"
              @click="historyDialogVisible = true"
              :aria-label="t('main.historyAria')"
            >
              <History :size="14" style="fill: none !important;" />
              <span>{{ t('main.historyBtn') }}</span>
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
              :aria-label="t('main.viewModeFlat')"
            >
              <LayoutList :size="15" style="fill: none !important;" />
            </button>
            <button
              type="button"
              class="am-btn am-btn--icon b3-tooltips b3-tooltips__s"
              :class="{ 'is-active': viewMode === 'doc' }"
              @click="setViewMode('doc')"
              :aria-label="t('main.viewModeDoc')"
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
              :placeholder="viewMode === 'doc' ? t('main.searchPlaceholderDoc') : t('main.searchPlaceholder')"
              class="am-input search-input"
            />
            <button
              v-if="searchQuery"
              class="search-clear-btn"
              @click="searchQuery = ''"
              :aria-label="t('main.clearSearchAria')"
            >
              <X :size="12" style="fill: none !important;" />
            </button>
          </div>

          <!-- 属性过滤下拉 -->
          <select v-model="filterType" class="am-input filter-select">
            <option value="all">{{ t('main.filterAll') }}</option>
            <option value="reeditable">{{ t('main.filterReeditable') }}</option>
            <option value="original">{{ t('main.filterOriginal') }}</option>
            <option value="unreferenced">{{ t('main.filterUnreferenced') }}</option>
            <option value="missing">{{ missingAssetsCount > 0 ? t('main.filterMissingCount', { count: missingAssetsCount }) : t('main.filterMissing') }}</option>
            <option value="canvas">{{ t('main.filterCanvas') }}</option>
            <option value="large">{{ t('main.filterLarge') }}</option>
          </select>
        </div>

        <!-- 文档归类模式专属控制器：文档排序与全部展开/折叠 -->
        <div class="toolbar-right" v-if="viewMode === 'doc'">
          <select v-model="docSortField" class="am-input doc-sort-select">
            <option value="totalSize">{{ t('main.docSortBySize') }}</option>
            <option value="assetCount">{{ t('main.docSortByCount') }}</option>
            <option value="name">{{ t('main.docSortByName') }}</option>
          </select>
          <button
            type="button"
            class="am-btn am-btn--icon b3-tooltips b3-tooltips__s"
            @click="toggleDocSortOrder"
            :aria-label="docSortOrder === 'desc' ? t('main.docSortDescAria') : t('main.docSortAscAria')"
          >
            <ArrowDownNarrowWide v-if="docSortOrder === 'desc'" :size="16" style="fill: none !important;" />
            <ArrowUpNarrowWide v-else :size="16" style="fill: none !important;" />
          </button>
          <button
            type="button"
            class="am-btn am-btn--icon b3-tooltips b3-tooltips__sw"
            @click="toggleAllDocGroups"
            :aria-label="isAllGroupsCollapsed ? t('main.expandAllDocsAria') : t('main.collapseAllDocsAria')"
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
        :title="activeCategory === card.key && card.key !== 'all' ? t('main.categoryUnfilterTitle', { label: categoryLabel(card) }) : t('main.categoryFilterTitle', { label: categoryLabel(card) })"
      >
        <span class="pill-icon" :style="{ color: card.color }">
          <component :is="card.icon" :size="14" style="fill: none !important;" />
        </span>
        <span class="pill-label">{{ categoryLabel(card) }}</span>
        <span class="pill-badge">{{ categoryStats[card.key]?.count || 0 }}</span>
        <span class="pill-size">{{ statFillActive ? '≈' : '' }}{{ categoryStats[card.key]?.sizeText || '0 B' }}</span>
      </button>
    </div>

    <!-- 已有数据时刷新不卸载列表，否则每次刷新都会丢掉滚动位置并整表重建；
         空列表且扫描失败时优先显示错误与重试，而不是渲染一个空列表 -->
    <div class="main-content" v-if="assets.length > 0 || (!loading && !scanError)">
      <!-- 引用关系仍在后台分析：先渲染文件列表，但清理/删除类操作在此之前一律禁用 -->
      <div v-if="refsPending && !loading" class="refs-pending-banner">
        <RotateCw :size="13" class="spinning" style="fill: none !important;" />
        <span>{{ t('main.refsPendingStatus', { phase: scanPhaseLabel || t('main.analyzingRefs'), time: scanElapsedText }) }}</span>
        <span class="refs-pending-hint">{{ t('main.refsPendingHint') }}</span>
      </div>

      <VirtualAssetList
        v-if="effectiveViewMode === 'flat'"
        ref="virtualListRef"
        :assets="sortedAssets"
        :sortField="sortField"
        :sortOrder="sortOrder"
        :selectedNames="selectedNames"
        :refsPending="refsPending && !refsFromSnapshot"
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
        v-else-if="effectiveViewMode === 'doc'"
        ref="docListRef"
        :groups="groupedDocAssets"
        :sortField="sortField"
        :sortOrder="sortOrder"
        :selectedNames="selectedNames"
        :refsPending="refsPending && !refsFromSnapshot"
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
      <template v-if="scanError">
        <div class="loading-error">
          <AlertCircle :size="18" style="fill: none !important;" />
          <span>{{ t('main.scanFailedWith', { message: scanError }) }}</span>
          <button class="am-btn am-btn--sm" @click="handleRefreshClick">{{ t('common.retry') }}</button>
        </div>
      </template>
      <template v-else>
        <div class="loading-progress">
          <RotateCw :size="16" class="spinning" style="fill: none !important;" />
          <span>{{ scanPhaseLabel || t('main.scanningDefault') }}</span>
          <span v-if="scanElapsed > 0" class="loading-elapsed">{{ t('main.elapsedTime', { time: scanElapsedText }) }}</span>
        </div>
        <div class="loading-hint">{{ t('main.loadingHint') }}</div>
      </template>
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
      @completed="loadData({ force: true })"
    />

    <!-- 删除操作审计与回退历史弹窗 -->
    <DeletionHistoryDialog
      v-model:visible="historyDialogVisible"
      @refresh="loadData({ force: true })"
    />

    <!-- 底部悬浮批量操作浮岛 (就近操作，提升大屏长列表人机工效) -->
    <div v-if="selectedNames.size > 0" class="am-batch-floating-dock">
      <div class="am-batch-floating-dock__info">
        <span>{{ t('main.selectedCountPrefix') }} <strong class="am-batch-floating-dock__count">{{ selectedNames.size }}</strong> {{ t('main.selectedCountSuffix', { n: selectedNames.size }) }}</span>
        <span>({{ selectedSummary.sizeText }})</span>
      </div>
      <div class="am-batch-floating-dock__divider"></div>
      <div class="am-batch-floating-dock__actions">
        <button
          type="button"
          class="am-btn am-btn--sm am-btn--ghost"
          @click="clearSelection"
          :aria-label="t('main.clearSelectionAria')"
        >
          {{ t('main.cancelSelectionBtn') }}
        </button>
        <button
          type="button"
          class="am-btn am-btn--sm am-btn--danger"
          @click="handleBatchDelete"
          :disabled="refsPending"
          :aria-label="refsPending ? t('main.refsPendingNoDeleteAria') : t('main.batchDeleteConfirmAria', { count: selectedNames.size })"
        >
          <Trash2 :size="13" style="fill: none !important;" />
          <span>{{ t('main.batchDeleteBtn') }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef, triggerRef, computed, nextTick, onMounted, onUnmounted, watch } from 'vue';
import { openTab, Menu } from 'siyuan';
import { openCanvasInTab } from '../utils/canvas-asset';
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
import { countReferencedDocs, getNotebookMap, type AssetInfo } from '../utils/siyuan-db';
import {
  applyCatalogBlockDelta,
  emptyReferenceData,
  fetchCatalogBlockDelta,
  fetchCatalogFiles,
  fetchCatalogReferenceData,
  fetchCatalogSupportData,
  fillMissingAssetStats,
  getCachedCatalogInventory,
  invalidateCatalogCache,
  mergeAssetStatsInto,
  resolveCatalogInventory,
  resolveCatalogInventoryFromSources,
  resolveCatalogPipelineFromEntries,
  setCachedCatalogInventory,
  type CatalogInventory,
} from '../utils/asset-catalog';
import {
  buildCatalogWatermark,
  loadCatalogSnapshot,
  overlaySnapshotFileStats,
  saveCatalogSnapshot,
  saveCatalogStatCache,
  type CatalogSnapshot,
} from '../utils/catalog-snapshot';
import { normalizeOriginalStoragePath, readOriginalImage } from '../utils/file-system';
import { defaultStorage } from '../utils/storage';
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
import { t } from '@/i18n';
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

// 9.8 万资源必须用 shallowRef：深度响应式代理会让每次列表刷新（filter/sort/统计）
// 的属性访问都过 Proxy 拦截，单轮全量重算达数百毫秒，后台补全期间反复触发即冻结界面。
// 元素属性的就地变更由变更方显式 triggerRef 通知；数组整体替换天然触发。
const assets = shallowRef<AssetInfo[]>([]);
const loading = ref(false);
// 引用关系分析是否仍在后台进行（期间列表仅含文件信息，清理/删除类操作被禁用）
const refsPending = ref(false);
// 列表当前展示的引用关系来自持久化快照（秒开渲染）：
// 引用数可照常显示，但数据存在过期窗口，危险操作仍由 refsPending 禁用
const refsFromSnapshot = ref(false);
// 后台 size 补全是否仍在进行（期间体积统计为部分和，显示 ≈ 前缀提示）
const statFillActive = ref(false);
// 补全进度（done/total 来自 fill 的节流 onProgress），null 表示尚未开始计数
const statFillProgress = ref<{ done: number, total: number } | null>(null);
const statFillProgressText = computed(() => {
  const p = statFillProgress.value;
  if (!p || !p.total) return t('common.preparing');
  const pct = Math.min(100, Math.floor((p.done / p.total) * 100));
  return t('main.statFillCounts', { done: p.done.toLocaleString(), total: p.total.toLocaleString(), pct });
});
const statFillPercent = computed(() => {
  const p = statFillProgress.value;
  if (!p || !p.total) return 0;
  return Math.min(100, Math.floor((p.done / p.total) * 100));
});
// 扫描阶段文案与耗时（替代原先一句静态的"正在扫描"，让用户能判断是否卡死）
const scanPhaseLabel = ref('');
const scanElapsed = ref(0);
const scanError = ref<string | null>(null);
const scanElapsedText = computed(() => {
  const s = scanElapsed.value;
  if (s < 60) return t('main.durationSeconds', { n: s });
  return t('main.durationMinutes', { m: Math.floor(s / 60), s: s % 60 });
});
let scanTimer: number | null = null;
let scanSession = 0;
// 最近一次成功扫描的快照上下文：stat 补全完成后用它重写快照，
// 把补全出的 size 持久化（否则每次重开都要从零重填，体积统计长期偏小）
let snapshotContext: {
  watermark: string,
  files: Array<{ name: string, size: number, updated: number, isDir: boolean }>,
  entries: Map<string, any>,
} | null = null;

function persistCatalogSnapshot() {
  if (!snapshotContext) return;
  const ctx = snapshotContext;
  // 延后一拍：完整快照序列化 20MB+ 需 1~3 秒主线程，不能与列表大刷新同帧叠加
  window.setTimeout(() => {
    void saveCatalogSnapshot({
      savedAt: Date.now(),
      watermark: ctx.watermark,
      files: overlaySnapshotFileStats(ctx.files, assets.value),
      entries: ctx.entries,
    });
  }, 0);
}

function startScanTimer() {
  stopScanTimer();
  scanElapsed.value = 0;
  scanTimer = window.setInterval(() => {
    scanElapsed.value += 1;
  }, 1000);
}

function stopScanTimer() {
  if (scanTimer !== null) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
}
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
const missingAssetsCount = computed(() => assets.value.filter(a => a.isMissing).length);
const activeCategory = ref<AssetCategory>('all');

function handleOpenDeduplicate() {
  deduplicateVisible.value = true;
}

// 6 大分类全局统计与卡片配置
const categoryStats = computed(() => calculateCategoryStats(assets.value));

const categoryCards = computed(() => [
  { key: 'all' as AssetCategory, labelKey: 'common.all', icon: Files, color: 'var(--am-cat-all)' },
  { key: 'image' as AssetCategory, labelKey: 'main.categoryImage', icon: Image, color: 'var(--am-cat-image)' },
  { key: 'document' as AssetCategory, labelKey: 'main.categoryDocument', icon: FileText, color: 'var(--am-cat-doc)' },
  { key: 'audio' as AssetCategory, labelKey: 'main.categoryAudio', icon: Music, color: 'var(--am-cat-audio)' },
  { key: 'video' as AssetCategory, labelKey: 'main.categoryVideo', icon: Video, color: 'var(--am-cat-video)' },
  { key: 'archive' as AssetCategory, labelKey: 'main.categoryArchive', icon: Archive, color: 'var(--am-cat-archive)' },
]);

function categoryLabel(card: { labelKey: string }): string {
  return t(card.labelKey);
}

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

// 引用关系未就绪时文档归类视图没有分组依据（一切引用都是 0），临时回落平铺视图；
// 快照渲染虽有过期窗口但引用数据完整，允许文档归类视图。
const effectiveViewMode = computed<'flat' | 'doc'>(() =>
  refsPending.value && !refsFromSnapshot.value ? 'flat' : viewMode.value
);

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

  if (asset.isMissing || (!isImg && !isVid && !isAud)) return;

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
      } else if (asset.isCanvasAsset) {
        if (previewSrc) {
          previewUrl.value = previewSrc;
        } else {
          try {
            const targetPath = asset.canvasAssetStoragePath || asset.name;
            const blob = await defaultStorage.read(targetPath);
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

  // Delete / Backspace 快捷触发批量删除（引用未就绪时禁止，防误删）
  if ((event.key === 'Delete' || event.key === 'Backspace') && selectedNames.value.size > 0) {
    if (refsPending.value) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    handleBatchDelete();
  }
}

onUnmounted(() => {
  handleHidePreview();
  stopScanTimer();
  window.removeEventListener('assets-manager-refresh', handleGlobalRefresh);
  window.removeEventListener('keydown', handleKeyDown);
});

/**
 * 两阶段加载：
 * 阶段一（快）：物理文件清单 → 立即渲染列表（引用列显示待定，危险操作禁用）
 * 阶段二（慢）：SQL 引用关系 + 属性视图/画布/AI 会话 → 合并后放开全部操作
 * size/updated 由后台并发 stat 补全，不再阻塞首屏。
 */
async function loadData(options: { resort?: boolean, force?: boolean } = {}) {
  const session = ++scanSession;
  scanError.value = null;
  stopScanTimer();

  const cached = options.force ? null : getCachedCatalogInventory();
  if (cached) {
    refsPending.value = false;
    refsFromSnapshot.value = false;
    applyInventory(cached, options);
    lastRefreshedAt.value = Date.now();
    return;
  }

  // 非强制刷新且存在可用快照：先秒开渲染快照，再后台增量校验
  if (!options.force) {
    const snapshot = await loadCatalogSnapshot();
    if (session !== scanSession) return;
    if (snapshot && snapshot.watermark && snapshot.entries.size > 0) {
      const handled = await runSnapshotIncrementalLoad(session, snapshot, options);
      if (handled || session !== scanSession) return;
      // 快速渲染本身失败（快照数据异常）：回退全量扫描
    }
  }

  await runFullScan(session, options);
}

/**
 * 快照路径：立即用上次扫描结果渲染完整列表（含引用关系），
 * 后台并行做增量校验（文件清单 + 支持源 + 块引用三路增量）。
 * 返回 false 表示快速渲染阶段失败，调用方应回退全量扫描。
 */
async function runSnapshotIncrementalLoad(
  session: number,
  snapshot: CatalogSnapshot,
  options: { resort?: boolean },
): Promise<boolean> {
  try {
    // 秒开渲染：快照文件 + 快照引用条目（笔记本名一次轻量调用，保证易读路径完整）
    const notebookMap = await getNotebookMap().catch(() => new Map<string, string>());
    const quickInventory = resolveCatalogPipelineFromEntries(
      snapshot.files,
      Array.from(snapshot.entries.values()),
      [],
      [],
      notebookMap,
    );
    if (session !== scanSession) return true;
    refsPending.value = true;
    refsFromSnapshot.value = true;
    applyInventory(quickInventory, options);
    lastRefreshedAt.value = Date.now();
    loading.value = false;
    startScanTimer();
    scanPhaseLabel.value = t('main.snapshotVerifying', { time: formatAssetTime(snapshot.savedAt) });
  } catch (err) {
    error('Failed to render catalog snapshot', err);
    return false;
  }

  // 增量校验（与渲染后并行）：水位线取样必须在发起任何查询之前
  const verifyStartedAt = Date.now();
  try {
    const [filesRes, support, delta] = await Promise.all([
      fetchCatalogFiles(),
      fetchCatalogSupportData(),
      fetchCatalogBlockDelta(snapshot.entries, snapshot.watermark as string),
    ]);
    if (session !== scanSession) return true;

    if (support.degraded) {
      scanPhaseLabel.value = t('main.snapshotRefsIncomplete');
      return true;
    }

    if (!filesRes.dirAvailable) {
      assets.value = [];
      selectedNames.value = new Set<string>();
      refsPending.value = false;
      refsFromSnapshot.value = false;
      lastRefreshedAt.value = Date.now();
      return true;
    }

    scanPhaseLabel.value = t('main.mergingDelta');
    applyCatalogBlockDelta(snapshot.entries, delta);
    const inventory = resolveCatalogInventoryFromSources(
      filesRes.files,
      Array.from(snapshot.entries.values()),
      support,
    );
    mergeAssetStatsInto(inventory, assets.value);
    refsPending.value = false;
    refsFromSnapshot.value = false;
    applyInventory(inventory, options);
    lastRefreshedAt.value = Date.now();
    setCachedCatalogInventory(inventory);

    // 校验通过后推进水位线并重写快照（后台执行，不阻塞交互）；
    // files 携带上一轮持久化的 size（overlay 保底），本次补全完成后再次重写
    snapshotContext = {
      watermark: buildCatalogWatermark(verifyStartedAt),
      files: filesRes.files,
      entries: snapshot.entries,
    };
    persistCatalogSnapshot();

    runBackgroundStatFill(inventory.allAssets, session);
  } catch (err) {
    if (session !== scanSession) return true;
    // 增量校验失败：保留快照渲染（引用可能过期），维持危险操作禁用
    error('Incremental verification failed', err);
    scanPhaseLabel.value = t('main.snapshotVerifyFailed');
    return true;
  } finally {
    if (session === scanSession) {
      stopScanTimer();
    }
  }
  return true;
}

/** 全量两阶段扫描（无快照、强制刷新或快照渲染失败时） */
async function runFullScan(session: number, options: { resort?: boolean }) {
  const scanStartedAt = Date.now();
  loading.value = true;
  refsPending.value = false;
  refsFromSnapshot.value = false;
  startScanTimer();
  try {
    // 阶段二数据先行启动（与阶段一真正并行）：内核 SQL 在目录枚举的同时即开始执行
    let refsLabel = t('main.queryingRefs');
    const refDataPromise = fetchCatalogReferenceData((phase) => {
      refsLabel = phase.label;
      if (session === scanSession && loading.value) scanPhaseLabel.value = phase.label;
    }).catch((err) => {
      error('Failed to load asset references', err);
      return null;
    });

    // 阶段一：文件清单（桌面端本地枚举为秒级；浏览器端走内核 readDir，受超时守卫保护）
    scanPhaseLabel.value = t('main.readingFiles');
    const filesRes = await fetchCatalogFiles((phase) => {
      if (session === scanSession) scanPhaseLabel.value = phase.label;
    });
    if (session !== scanSession) return;

    if (!filesRes.dirAvailable) {
      assets.value = [];
      selectedNames.value = new Set<string>();
      lastRefreshedAt.value = Date.now();
      return;
    }

    // 用户先看到文件列表，引用关系随后合并
    refsPending.value = true;
    applyInventory(resolveCatalogInventory(filesRes.files, emptyReferenceData()), options);
    scanPhaseLabel.value = refsLabel;
    loading.value = false;

    const refData = await refDataPromise;
    if (session !== scanSession) return;

    if (!refData) {
      // 引用阶段失败：保留已渲染的文件列表并维持危险操作禁用；用户可点刷新整轮重试
      scanPhaseLabel.value = t('main.refsQueryFailed');
      return;
    }

    if (refData.degraded) {
      // 关键引用源（主 SQL / 属性视图 / 画布）部分失败：数据不完整，
      // 若照常放开清理按钮，被引用资源会被误判为孤儿而遭删除——必须保持禁用。
      scanPhaseLabel.value = t('main.refsIncomplete');
      return;
    }

    scanPhaseLabel.value = t('main.buildingRelations');
    const inventory = resolveCatalogInventory(filesRes.files, refData);
    // 保留首屏期间后台 stat 已补全的 size/updated
    mergeAssetStatsInto(inventory, assets.value);
    refsPending.value = false;
    applyInventory(inventory, options);
    // 「上次刷新」记账完整载入（引用关系就绪）的时刻
    lastRefreshedAt.value = Date.now();
    setCachedCatalogInventory(inventory);

    // 全量扫描成功后写快照：水位线取扫描起始时刻（早于任何查询，安全）；
    // size 用当前已知值覆盖（此刻大多为 0，后台补全完成后会再重写一次）
    snapshotContext = {
      watermark: buildCatalogWatermark(scanStartedAt),
      files: filesRes.files,
      entries: new Map(refData.entries.map((e) => [e.id, e])),
    };
    persistCatalogSnapshot();

    // 后台并发补全 size/updated（分批触发列表刷新，不阻塞交互）
    runBackgroundStatFill(inventory.allAssets, session);
  } catch (err) {
    if (session !== scanSession) return;
    error('Failed to load assets', err);
    scanError.value = err instanceof Error ? err.message : String(err);
    scanPhaseLabel.value = t('main.scanFailedWith', { message: scanError.value });
    refsPending.value = false;
  } finally {
    if (session === scanSession) {
      loading.value = false;
      stopScanTimer();
    }
  }
}

function applyInventory(inventory: CatalogInventory, options: { resort?: boolean } = {}) {
  assets.value = inventory.allAssets;
  // 过滤掉已不存在的选中项
  const existingNames = new Set(assets.value.map(a => a.name));
  selectedNames.value = new Set([...selectedNames.value].filter(name => existingNames.has(name)));
  // 默认不重排：删除、编辑、去重等写入后保持用户当前看到的卡片顺序，仅刷新按钮显式要求重排
  if (options.resort) {
    resortNow();
  }
}

async function runBackgroundStatFill(list: AssetInfo[], session: number) {
  statFillActive.value = true;
  try {
    await runBackgroundStatFillInner(list, session);
  } finally {
    if (session === scanSession) {
      statFillActive.value = false;
      statFillProgress.value = null;
      triggerRef(assets);
    }
  }
}

/** stat 侧缓存最小落盘间隔：补全中断时保住进度，又不让序列化本身成为卡顿源 */
const STAT_CACHE_SAVE_INTERVAL_MS = 60_000;
let lastStatCacheSaveAt = 0;

function maybeSaveStatCache(force = false) {
  const now = Date.now();
  if (!force && now - lastStatCacheSaveAt < STAT_CACHE_SAVE_INTERVAL_MS) return;
  lastStatCacheSaveAt = now;
  const snapshot = assets.value;
  window.setTimeout(() => {
    void saveCatalogStatCache(snapshot);
  }, 0);
}

async function runBackgroundStatFillInner(list: AssetInfo[], session: number) {
  const result = await fillMissingAssetStats(list, {
    onBatch: () => {
      // 元素属性已就地补全，用 triggerRef 分批触发重算（shallowRef 下无需复制数组）
      if (session === scanSession) {
        triggerRef(assets);
      }
    },
    onProgress: (done, total) => {
      if (session !== scanSession) return;
      statFillProgress.value = { done, total };
      maybeSaveStatCache();
    },
  });
  if (session === scanSession) {
    triggerRef(assets);
    // 补全出的 size 持久化进快照，下次打开立即呈现接近真实的体积统计
    persistCatalogSnapshot();
    maybeSaveStatCache(true);
  }
  if (result.skipped) {
    // 浏览器模式下内核 /assets/* 不支持 HEAD，size 保持未知；不视为错误
    warnScanNote(t('main.headUnsupportedNote'));
  }
}

function warnScanNote(message: string) {
  scanError.value = null;
  scanPhaseLabel.value = message;
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
  // 任何定向写入都意味着缓存库存已过期
  invalidateCatalogCache();
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
    loadData({ force: true });
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

// 刷新按钮是唯一会按最新数据重新排序的入口（显式刷新绕过缓存强制全量重扫）
function handleRefreshClick() {
  loadData({ resort: true, force: true });
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
  const isCanvas = rootId.endsWith('.canvas') || (Boolean(firstBlockId) && firstBlockId!.startsWith('canvas:'));
  if (isCanvas) {
    let canvasPath = rootId;
    if (!canvasPath.endsWith('.canvas') && firstBlockId?.startsWith('canvas:')) {
      const parts = firstBlockId.split(':');
      if (parts[1]) canvasPath = parts[1];
    }
    const ok = await openCanvasInTab(canvasPath);
    if (ok) {
      pushMsg(t('main.canvasOpened'));
    } else {
      pushMsg(t('main.canvasPluginMissing'));
    }
    return;
  }

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
    pushMsg(t('main.docOpened'));
  } catch (e) {
    error("Failed to open document", e);
    pushMsg(t('main.openDocFailed'));
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

async function handleOpenDocs(asset: AssetInfo, event?: MouseEvent) {
  const groups = groupReferencesByDoc(asset.references);
  if (groups.length === 0) {
    pushMsg(t('main.notReferenced'));
    return;
  }

  // 1. 若仅有 1 个引用目标，直接在后台打开
  if (groups.length === 1) {
    const group = groups[0];
    const isCanvas = group.first.id.startsWith('canvas:') || group.first.path.endsWith('.canvas') || group.rootId.endsWith('.canvas');
    if (isCanvas) {
      const canvasPath = group.first.path || (group.rootId.endsWith('.canvas') ? group.rootId : (group.first.id.split(':')[1] || ''));
      const canvasTitle = group.first.readablePath || group.first.hpath || asset.name;
      const ok = await openCanvasInTab(canvasPath, canvasTitle);
      if (ok) {
        pushMsg(t('main.canvasOpenedWithTitle', { title: canvasTitle }));
      } else {
        pushMsg(t('main.canvasPluginMissing'));
      }
    } else {
      await handleOpenSingleDoc(group.rootId, group.first.id);
    }
    return;
  }

  // 2. 多个引用目标（多个画布，或画布 + 普通文档），弹出轻量选择菜单供用户点击指定目标
  const menu = new Menu('asset-references-picker');
  for (const group of groups) {
    const isCanvas = group.first.id.startsWith('canvas:') || group.first.path.endsWith('.canvas') || group.rootId.endsWith('.canvas');
    const labelTitle = group.first.readablePath || group.first.hpath || group.rootId || t('main.untitled');
    const displayLabel = isCanvas ? t('main.canvasLabel', { title: labelTitle }) : t('main.docLabel', { title: labelTitle });

    menu.addItem({
      icon: isCanvas ? 'iconCanvas' : 'iconFile',
      label: displayLabel,
      click: async () => {
        if (isCanvas) {
          const canvasPath = group.first.path || (group.rootId.endsWith('.canvas') ? group.rootId : (group.first.id.split(':')[1] || ''));
          const ok = await openCanvasInTab(canvasPath, labelTitle);
          if (ok) {
            pushMsg(t('main.canvasOpenedWithTitle', { title: labelTitle }));
          } else {
            pushMsg(t('main.canvasPluginMissing'));
          }
        } else {
          await handleOpenSingleDoc(group.rootId, group.first.id);
        }
      },
    });
  }

  // 计算弹出位置（优先使用点击事件坐标，兜底屏幕居中）
  let x = event?.clientX ?? window.innerWidth / 2;
  let y = event?.clientY ?? window.innerHeight / 2;
  menu.open({ x, y });
}

function handleEdit(asset: AssetInfo) {
  if (refsPending.value) return;
  if ((window as any)._siyuan_assets_manager_open_editor) {
    const targetBlockId = asset.reEditBlockId || (asset.references && asset.references.length > 0 ? asset.references[0].id : undefined);
    (window as any)._siyuan_assets_manager_open_editor(asset.name, targetBlockId);
  }
}

async function handleDelete(asset: AssetInfo) {
  if (refsPending.value) return;
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
  if (refsPending.value) return;
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
      await loadData({ force: true });
    }
  } finally {
    loading.value = false;
  }
}

function handleRename(asset: AssetInfo) {
  if (refsPending.value) return;
  if ((window as any)._siyuan_assets_manager_open_rename) {
    (window as any)._siyuan_assets_manager_open_rename(asset);
  }
}

/**
 * 统一综合清理：整合孤儿资源文件与孤立原始底图的一键清理
 */
async function handleUnifiedCleanup() {
  if (refsPending.value) return;
  const summary = calculateTotalCleanup(assets.value);
  if (summary.totalCount === 0) {
    pushMsg(t('main.cleanNothingMsg'));
    return;
  }

  const confirmOptions = buildUnifiedCleanupConfirmMessage(summary);
  const confirmCleanup = await showConfirm(confirmOptions);
  if (!confirmCleanup) return;

  loading.value = true;
  try {
    const result = await executeUnifiedCleanup(summary);
    if (result.success) {
      await loadData({ force: true });
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

/* 后台 size 补全进度指示（计数 + 迷你进度条） */
.stat-fill-progress {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--b3-theme-primary, #3575f0);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.stat-fill-progress-bar {
  width: 72px;
  height: 4px;
  border-radius: 2px;
  background: var(--b3-border-color, rgba(128, 128, 128, 0.25));
  overflow: hidden;
  flex: none;
}

.stat-fill-progress-fill {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: var(--b3-theme-primary, #3575f0);
  transition: width 0.4s ease;
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
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 8px;
  color: var(--b3-theme-on-surface-light);
  font-size: 16px;
}

.loading-progress {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.loading-elapsed {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  opacity: 0.75;
}

.loading-hint {
  font-size: 12px;
  opacity: 0.55;
  max-width: 420px;
  text-align: center;
  line-height: 1.6;
}

.loading-error {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--b3-theme-error, #ef4444);
  font-size: 14px;

  .am-btn {
    flex-shrink: 0;
  }
}

/* 引用分析进行中横幅：先渲染文件列表，但清理/删除类操作在此之前禁用 */
.refs-pending-banner {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 6px 12px;
  margin-bottom: 8px;
  border-radius: 4px;
  border: 1px solid color-mix(in srgb, var(--b3-theme-primary) 30%, transparent);
  background: color-mix(in srgb, var(--b3-theme-primary) 8%, transparent);
  color: var(--b3-theme-on-surface);
  font-size: 12px;
  flex-shrink: 0;

  .refs-pending-hint {
    opacity: 0.7;
  }
}

/* 危险操作在引用未就绪期间的禁用态 */
.am-action-btn:disabled,
.am-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  pointer-events: none;
}

</style>

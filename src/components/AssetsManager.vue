<template>
  <div ref="containerEl" class="assets-manager-container" style="position: relative;">
    <div class="header">
      <h2>资源管家</h2>
      <div class="stats">
        <span>当前显示: {{ sortedAssets.length }} / {{ assets.length }} 个资源</span>
        <span v-if="selectedNames.size > 0" class="selected-badge">
          已选 {{ selectedNames.size }} 项 ({{ selectedSummary.sizeText }})
        </span>
      </div>
      <div class="actions">
        <input 
          v-model="searchQuery" 
          type="text" 
          placeholder="搜索资源名称..." 
          class="am-input"
        />
        <select v-model="filterType" class="am-input">
          <option value="all">全部属性</option>
          <option value="reeditable">可二次编辑</option>
          <option value="original">原始底图</option>
          <option value="unreferenced">未引用 (孤儿/孤立)</option>
          <option value="large">大文件 (>1MB)</option>
        </select>
        <template v-if="selectedNames.size > 0">
          <button
            class="am-btn am-btn--danger"
            @click="handleBatchDelete"
            :title="`批量删除选中的 ${selectedNames.size} 个文件 (支持快捷键 Delete)`"
          >
            批量删除 ({{ selectedNames.size }})
          </button>
          <button
            class="am-btn"
            @click="clearSelection"
            title="取消当前多选"
          >
            取消选择
          </button>
        </template>
        <button
          v-else
          class="am-btn am-btn--danger"
          @click="handleUnifiedCleanup"
          style="margin-right: 4px;"
          title="综合清理所有未引用的孤儿资源与孤立底图"
        >
          清理
        </button>
        <button class="am-btn" @click="loadData" title="刷新资源列表">
          <svg v-if="loading" class="icon spinning" viewBox="0 0 24 24"><path d="M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8z"/></svg>
          <span v-else>刷新</span>
        </button>
      </div>
    </div>

    <!-- 顶部 6 大分类统计卡片 -->
    <div class="category-cards-grid">
      <div
        v-for="card in categoryCards"
        :key="card.key"
        class="category-card"
        :class="{ 'is-active': activeCategory === card.key }"
        @click="handleCategoryClick(card.key)"
        :title="activeCategory === card.key && card.key !== 'all' ? `点击取消【${card.label}】筛选，查看全部` : `点击仅查看【${card.label}】资源`"
      >
        <div class="category-card__icon" :style="{ color: card.color }">
          <component :is="card.icon" :size="20" />
        </div>
        <div class="category-card__info">
          <div class="category-card__name">{{ card.label }}</div>
          <div class="category-card__meta">
            <span class="category-card__count">{{ categoryStats[card.key]?.count || 0 }} 个</span>
            <span class="category-card__dot">·</span>
            <span class="category-card__size">{{ categoryStats[card.key]?.sizeText || '0 B' }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="main-content" v-if="!loading">
      <VirtualAssetList 
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
    </div>
    
    <div v-else class="loading-state">
      正在扫描 Siyuan 数据库并构建资源关联表，请稍候...
    </div>

    <!-- 限制在当前界面内的悬浮图片预览弹窗 -->
    <div v-if="previewUrl" class="image-hover-preview" :style="previewStyle">
      <img :src="previewUrl" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { openTab } from 'siyuan';
import { Files, Image, FileText, Music, Video, Archive } from 'lucide-vue-next';
import { getAllAssetsInfo, deleteAssetFile, type AssetInfo } from '../utils/siyuan-db';
import { deleteOriginalImage, readOriginalImage } from '../utils/file-system';
import { removeAssetFromBlocks } from '../utils/siyuan-block';
import {
  calculateBatchDeleteSummary,
  calculateCategoryStats,
  calculateTotalCleanup,
  filterAssets,
  formatAssetSize,
  isImageAsset,
  sortAssets,
  type AssetCategory,
  type AssetFilterType,
  type AssetSortField,
  type AssetSortOrder,
} from '../utils/asset-list';
import { showConfirm } from '../utils/confirm';
import { pushMsg } from '../api';
import { usePlugin } from '../main';
import { error } from '../utils/logger';
import VirtualAssetList from './VirtualAssetList.vue';

const assets = ref<AssetInfo[]>([]);
const loading = ref(false);
const searchQuery = ref('');
const filterType = ref<AssetFilterType>('all');
const activeCategory = ref<AssetCategory>('all');

// 6 大分类全局统计与卡片配置
const categoryStats = computed(() => calculateCategoryStats(assets.value));

const categoryCards = computed(() => [
  { key: 'all' as AssetCategory, label: '全部', icon: Files, color: 'var(--b3-theme-primary)' },
  { key: 'image' as AssetCategory, label: '图片', icon: Image, color: '#10b981' },
  { key: 'document' as AssetCategory, label: '文档', icon: FileText, color: '#3b82f6' },
  { key: 'audio' as AssetCategory, label: '音频', icon: Music, color: '#f59e0b' },
  { key: 'video' as AssetCategory, label: '视频', icon: Video, color: '#ef4444' },
  { key: 'archive' as AssetCategory, label: '压缩包', icon: Archive, color: '#8b5cf6' },
]);

function handleCategoryClick(cat: AssetCategory) {
  if (activeCategory.value === cat && cat !== 'all') {
    activeCategory.value = 'all';
  } else {
    activeCategory.value = cat;
  }
}

// 排序状态
const sortField = ref<AssetSortField>('size');
const sortOrder = ref<AssetSortOrder>('desc');

// 多选状态
const selectedNames = ref<Set<string>>(new Set());
const selectedSummary = computed(() => calculateBatchDeleteSummary(assets.value, selectedNames.value));

const containerEl = ref<HTMLElement | null>(null);

// 悬浮大图预览相关状态
const previewUrl = ref('');
const previewStyle = ref({
  top: '0px',
  left: '0px',
});
const mouseX = ref(0);
const mouseY = ref(0);
let previewTimeout: number | null = null;
let previewBlobUrl: string | null = null;

function handleSelectionChange(nextSet: Set<string>) {
  selectedNames.value = nextSet;
}

function clearSelection() {
  selectedNames.value = new Set<string>();
}

async function handleShowPreview(payload: { event: MouseEvent, asset: AssetInfo, previewSrc?: string }) {
  const { event, asset, previewSrc } = payload;
  if (!isImageAsset(asset.name) && !asset.isOriginal) return;
  
  handleHidePreview();
  
  mouseX.value = event.clientX;
  mouseY.value = event.clientY;
  
  previewTimeout = window.setTimeout(async () => {
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
      previewUrl.value = `/assets/${asset.name}`;
    }
    positionPreview(mouseX.value, mouseY.value);
  }, 250);
}

function handleUpdatePreview(payload: { event: MouseEvent }) {
  const { event } = payload;
  mouseX.value = event.clientX;
  mouseY.value = event.clientY;
  if (previewUrl.value) {
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
  if (previewTimeout) {
    clearTimeout(previewTimeout);
    previewTimeout = null;
  }
  if (previewBlobUrl) {
    URL.revokeObjectURL(previewBlobUrl);
    previewBlobUrl = null;
  }
  previewUrl.value = '';
}

function handleKeyDown(event: KeyboardEvent) {
  const activeTag = (document.activeElement?.tagName || '').toLowerCase();
  if (activeTag === 'input' || activeTag === 'textarea') {
    return;
  }

  // Ctrl+A / Cmd+A 全选当前已过滤的全部资源
  if ((event.ctrlKey || event.metaKey) && (event.key === 'a' || event.key === 'A')) {
    event.preventDefault();
    selectedNames.value = new Set(sortedAssets.value.map(a => a.name));
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

async function loadData() {
  loading.value = true;
  try {
    assets.value = await getAllAssetsInfo();
    // 过滤掉已不存在的选中项
    const existingNames = new Set(assets.value.map(a => a.name));
    selectedNames.value = new Set([...selectedNames.value].filter(name => existingNames.has(name)));
  } catch (e) {
    error("Failed to load assets", e);
  } finally {
    loading.value = false;
  }
}

const handleGlobalRefresh = () => {
  loadData();
};

onMounted(() => {
  loadData();
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

function handleSortChange(field: AssetSortField) {
  if (sortField.value === field) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortField.value = field;
    sortOrder.value = 'desc';
  }
}

async function handleOpenDocs(asset: AssetInfo) {
  if (asset.references.length === 0) {
    pushMsg("该资源未被任何文档引用");
    return;
  }
  
  const plugin = usePlugin();
  try {
    for (const ref of asset.references) {
      await openTab({
        app: plugin.app,
        doc: {
          id: ref.id,
          action: ["cb-get-hl", "cb-get-focus", "cb-get-context"]
        },
        keepCursor: true
      });
    }
    pushMsg(`已在后台打开并定位到 ${asset.references.length} 个引用位置`);
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
  // 针对原始底图与普通资源的差异化删除确认
  if (asset.isOriginal) {
    let confirmMsg = `确定要删除原始底图 ${asset.name} 吗？\n注意：此操作将直接删除底图物理文件。`;
    if (asset.docCount > 0) {
      confirmMsg = `【高风险警告】此原始底图正被 ${asset.docCount} 个文档中的二次编辑图片关联！\n删除此底图后，未来将无法对这些图片进行图层还原与二次编辑。\n\n确定要强制删除原始底图 ${asset.name} 吗？`;
    }

    const confirmDelete = await showConfirm({
      title: '确认删除原始底图',
      message: confirmMsg,
      confirmText: '删除底图',
      danger: true,
    });
    if (!confirmDelete) return;

    try {
      await deleteOriginalImage(asset.originalStoragePath || asset.name);
      pushMsg(`原始底图 ${asset.name} 已删除`);
      assets.value = assets.value.filter(a => a.name !== asset.name);
      selectedNames.value.delete(asset.name);
    } catch (e) {
      error("Failed to delete original image:", e);
      pushMsg("删除底图失败");
    }
    return;
  }

  const confirmDelete = await showConfirm({
    title: '确认删除',
    message: `确定要删除 ${asset.name} 吗？\n注意：将自动移入回收站或被移除，且文档中的引用块也将被清理。`,
    confirmText: '删除',
    danger: true
  });
  if (!confirmDelete) return;

  try {
    // 1. 删除物理文件
    await deleteAssetFile(asset.name);
    
    // 2. 清除文档中的所有引用
    if (asset.references && asset.references.length > 0) {
      await removeAssetFromBlocks(asset.references, asset.name);
    }
    
    pushMsg(`资源 ${asset.name} 及其文档引用已删除`);
    assets.value = assets.value.filter(a => a.name !== asset.name);
    selectedNames.value.delete(asset.name);
  } catch (e) {
    error(e);
    pushMsg(`删除失败`);
  }
}

/**
 * 多选批量删除
 */
async function handleBatchDelete() {
  const summary = selectedSummary.value;
  if (summary.totalCount === 0) return;

  const messageLines = [
    `确定要批量删除选中的 ${summary.totalCount} 个文件吗？`,
    '',
    '清单概要：',
    `• 普通资源文件：${summary.regularCount} 个`,
    `• 隔离原始底图：${summary.originalCount} 个`,
    `• 预计释放总空间：${summary.sizeText}`,
  ];

  if (summary.referencedCount > 0) {
    messageLines.push('');
    messageLines.push(`【重要提示】所选资源中有 ${summary.referencedCount} 个已被文档引用，删除将自动清理文档中对应的引用块。`);
  }

  if (summary.referencedOriginalsCount > 0) {
    messageLines.push('');
    messageLines.push(`【高风险警告】所选底图中有 ${summary.referencedOriginalsCount} 个正被文档中的二次编辑图片关联，删除后将无法再次进行图层无损还原！`);
  }

  messageLines.push('');
  messageLines.push('此操作将永久删除物理文件，确定要执行批量删除吗？');

  const confirmDelete = await showConfirm({
    title: `批量删除资源 (${summary.totalCount} 个)`,
    message: messageLines.join('\n'),
    confirmText: '执行批量删除',
    danger: true,
  });

  if (!confirmDelete) return;

  loading.value = true;
  try {
    let deletedRegularCount = 0;
    let deletedOriginalCount = 0;

    // 1. 删除普通资源及其文档引用
    for (const asset of summary.regularAssets) {
      try {
        await deleteAssetFile(asset.name);
        if (asset.references && asset.references.length > 0) {
          await removeAssetFromBlocks(asset.references, asset.name);
        }
        deletedRegularCount++;
      } catch (err) {
        error(`[batch-delete] 删除普通资源失败: ${asset.name}`, err);
      }
    }

    // 2. 删除原始底图
    for (const orig of summary.originalAssets) {
      try {
        const ok = await deleteOriginalImage(orig.originalStoragePath || orig.name);
        if (ok) deletedOriginalCount++;
      } catch (err) {
        error(`[batch-delete] 删除原始底图失败: ${orig.name}`, err);
      }
    }

    clearSelection();
    pushMsg(`批量删除完成！已成功删除 ${deletedRegularCount} 个资源与 ${deletedOriginalCount} 个底图，释放 ${summary.sizeText} 空间。`);
    await loadData();
  } catch (e) {
    error("Failed to batch delete assets:", e);
    pushMsg("批量删除失败");
  } finally {
    loading.value = false;
  }
}

function handleRename(asset: AssetInfo) {
  if ((window as any)._siyuan_assets_manager_open_rename) {
    (window as any)._siyuan_assets_manager_open_rename(asset.name);
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

  const messageLines = [
    '【警告】此操作将直接永久删除所有未被文档引用的孤儿资源文件及孤立原始底图。',
    '',
    '待清理清单：',
    `• 孤儿资源文件：${summary.unreferencedCount} 个 (${summary.unreferencedSizeText})`,
    `• 孤立原始底图：${summary.orphanOriginalsCount} 个 (${summary.orphanOriginalsSizeText})`,
    `• 预计释放总空间：${summary.sizeText}`,
    '',
    '此操作直接删除物理文件，无法撤销！确定要执行清理吗？'
  ];

  const confirmCleanup = await showConfirm({
    title: '清理未引用资源与孤立底图',
    message: messageLines.join('\n'),
    confirmText: '执行清理',
    danger: true
  });

  if (!confirmCleanup) return;

  loading.value = true;
  try {
    let deletedAssetsCount = 0;
    let deletedOriginalsCount = 0;

    // 1. 清理普通孤儿资源
    for (const asset of summary.unreferencedAssets) {
      try {
        await deleteAssetFile(asset.name);
        deletedAssetsCount++;
      } catch (err) {
        error(`删除孤儿资源失败: ${asset.name}`, err);
      }
    }

    // 2. 清理孤立底图
    for (const orig of summary.orphanOriginals) {
      try {
        const ok = await deleteOriginalImage(orig.originalStoragePath || orig.name);
        if (ok) deletedOriginalsCount++;
      } catch (err) {
        error(`删除孤立底图失败: ${orig.name}`, err);
      }
    }

    pushMsg(`清理完成！已成功删除 ${deletedAssetsCount} 个孤儿资源与 ${deletedOriginalsCount} 个孤立底图，共释放 ${summary.sizeText} 空间。`);
    await loadData();
  } catch (e) {
    error("Failed to cleanup assets:", e);
    pushMsg("清理失败");
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
  display: flex;
  flex-direction: column;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 12px;
  padding-right: 40px; /* 为右上角关闭按钮预留空间，防止重叠 */
}
.header h2 {
  margin: 0;
}
.stats {
  font-size: 14px;
  color: var(--b3-theme-on-surface-light);
  display: flex;
  align-items: center;
  gap: 6px;
}
.selected-badge {
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(66, 133, 244, 0.15);
  color: var(--b3-theme-primary);
  font-weight: 600;
  font-size: 12px;
}
.actions {
  display: flex;
  gap: 12px;
  align-items: center;
}
.spinning {
  animation: spin 1s linear infinite;
  fill: currentColor;
  width: 16px;
  height: 16px;
}
@keyframes spin { 100% { transform: rotate(360deg); } }
.main-content {
  flex: 1;
  overflow: hidden;
  border: 1px solid var(--b3-theme-surface-lighter);
  border-radius: 4px;
}

/* 顶部 6 大分类统计卡片网格 */
.category-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}

.category-card {
  background: var(--b3-theme-background-light);
  border: 1px solid var(--b3-theme-surface-lighter);
  border-radius: 8px;
  padding: 8px 12px;
  cursor: pointer;
  transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  align-items: center;
  gap: 10px;
  user-select: none;
  box-sizing: border-box;

  &:hover {
    background: var(--b3-theme-surface);
    border-color: var(--b3-theme-primary);
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  }

  &.is-active {
    background: rgba(66, 133, 244, 0.12);
    border-color: var(--b3-theme-primary);
    box-shadow: 0 0 0 1px var(--b3-theme-primary);
  }

  &__icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 24px;
    height: 24px;

    :deep(svg),
    svg {
      fill: none !important;
      stroke: currentColor !important;
      stroke-width: 2px !important;
    }
  }

  &__info {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  &__name {
    font-size: 13px;
    font-weight: 600;
    color: var(--b3-theme-on-background);
    line-height: 1.2;
  }

  &__meta {
    font-size: 11px;
    color: var(--b3-theme-on-surface-light);
    display: flex;
    align-items: center;
    gap: 3px;
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__count {
    font-weight: 500;
  }

  &__dot {
    opacity: 0.5;
  }

  &__size {
    opacity: 0.85;
  }
}

.loading-state {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  color: var(--b3-theme-on-surface-light);
  font-size: 16px;
}

.image-hover-preview {
  position: absolute;
  z-index: 9999;
  pointer-events: none;
  background-color: var(--b3-theme-background-light);
  border: 1px solid var(--b3-theme-surface-lighter);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  padding: 6px;
  display: block;
  overflow: hidden;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-sizing: border-box;
}

.image-hover-preview img {
  display: block;
  max-width: 400px;
  max-height: 400px;
  width: auto;
  height: auto;
  border-radius: 4px;
}
</style>

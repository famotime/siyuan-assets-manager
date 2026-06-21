<template>
  <div ref="containerEl" class="assets-manager-container" style="position: relative;">
    <div class="header">
      <h2>资源管家</h2>
      <div class="stats">
        <span>总计: {{ sortedAssets.length }} / {{ assets.length }} 个资源</span>
      </div>
      <div class="actions">
        <input 
          v-model="searchQuery" 
          type="text" 
          placeholder="搜索资源名称..." 
          class="b3-text-field"
        />
        <select v-model="filterType" class="b3-select">
          <option value="all">全部类型</option>
          <option value="image">图片</option>
          <option value="unreferenced">未引用 (孤儿资源)</option>
          <option value="large">大文件 (>1MB)</option>
        </select>
        <button class="b3-button b3-button--error" @click="handleCleanupUnreferenced" style="margin-right: 4px;" title="清理所有未引用的资源">
          清理
        </button>
        <button class="b3-button" @click="loadData" title="刷新资源列表">
          <svg v-if="loading" class="icon spinning" viewBox="0 0 24 24"><path d="M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8z"/></svg>
          <span v-else>刷新</span>
        </button>
      </div>
    </div>

    <div class="main-content" v-if="!loading">
      <VirtualAssetList 
        :assets="sortedAssets"
        :sortField="sortField"
        :sortOrder="sortOrder"
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
import { getAllAssetsInfo, deleteAssetFile, type AssetInfo } from '../utils/siyuan-db';
import { removeAssetFromBlocks } from '../utils/siyuan-block';
import { calculateUnreferencedCleanup, filterAssets, formatAssetSize, isImageAsset, sortAssets } from '../utils/asset-list';
import { pushMsg } from '../api';
import { usePlugin } from '../main';
import VirtualAssetList from './VirtualAssetList.vue';

const assets = ref<AssetInfo[]>([]);
const loading = ref(false);
const searchQuery = ref('');
const filterType = ref('all');

// 排序状态
const sortField = ref<'name' | 'ext' | 'size' | 'docCount'>('size');
const sortOrder = ref<'asc' | 'desc'>('desc');

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

function handleShowPreview(payload: { event: MouseEvent, asset: AssetInfo }) {
  const { event, asset } = payload;
  if (!isImageAsset(asset.name)) return;
  
  handleHidePreview();
  
  mouseX.value = event.clientX;
  mouseY.value = event.clientY;
  
  previewTimeout = window.setTimeout(() => {
    previewUrl.value = `/assets/${asset.name}`;
    positionPreview(mouseX.value, mouseY.value);
  }, 250); // 250ms 防抖，提供高级的 hover 体验
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
  
  // 视口坐标转换为相对于 containerEl 的绝对定位坐标
  const relativeX = clientX - containerRect.left;
  const relativeY = clientY - containerRect.top;
  
  const offsetX = 20;
  const offsetY = 20;
  let x = relativeX + offsetX;
  let y = relativeY + offsetY;
  
  const safeBound = 420; // 包含 padding/border 的最大安全边界 (400px 大图 + 20px 缓冲)
  
  if (x + safeBound > containerRect.width) {
    x = relativeX - safeBound - offsetX;
  }
  if (y + safeBound > containerRect.height) {
    y = relativeY - safeBound - offsetY;
  }
  
  // 防溢出保护，不超出左边界和上边界
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
  previewUrl.value = '';
}

onUnmounted(() => {
  handleHidePreview();
  window.removeEventListener('assets-manager-refresh', handleGlobalRefresh);
});

async function loadData() {
  loading.value = true;
  try {
    assets.value = await getAllAssetsInfo();
  } catch (e) {
    console.error("Failed to load assets", e);
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
});

const filteredAssets = computed(() => {
  return filterAssets(assets.value, {
    searchQuery: searchQuery.value,
    filterType: filterType.value as 'all' | 'image' | 'unreferenced' | 'large',
  });
});

const sortedAssets = computed(() => {
  return sortAssets(filteredAssets.value, sortField.value, sortOrder.value);
});

function handleSortChange(field: 'name' | 'ext' | 'size' | 'docCount') {
  if (sortField.value === field) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortField.value = field;
    sortOrder.value = 'desc'; // 切换字段时默认降序
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
          action: ["cb-get-hl", "cb-get-focus"]
        },
        keepCursor: true
      });
    }
    pushMsg(`已在后台打开并定位到 ${asset.references.length} 个引用位置`);
  } catch (e) {
    console.error("Failed to open documents", e);
    pushMsg("打开文档失败");
  }
}

function handleEdit(asset: AssetInfo) {
  if ((window as any)._siyuan_assets_manager_open_editor) {
    (window as any)._siyuan_assets_manager_open_editor(asset.name);
  }
}

async function handleDelete(asset: AssetInfo) {
  const confirmDelete = window.confirm(`确定要删除 ${asset.name} 吗？\n注意：将自动移入回收站或被移除，且文档中的引用块也将被清理。`);
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
  } catch (e) {
    console.error(e);
    pushMsg(`删除失败`);
  }
}

function handleRename(asset: AssetInfo) {
  if ((window as any)._siyuan_assets_manager_open_rename) {
    (window as any)._siyuan_assets_manager_open_rename(asset.name);
  }
}

async function handleCleanupUnreferenced() {
  const cleanup = calculateUnreferencedCleanup(assets.value);
  if (cleanup.count === 0) {
    pushMsg("当前没有未引用的资源，无需清理。");
    return;
  }

  const confirmCleanup = window.confirm(
    `【警告】此操作将永久清理所有未被文档引用的资源文件（孤儿资源）。\n\n` +
    `统计信息：\n` +
    `• 待清理资源数量：${cleanup.count} 个\n` +
    `• 预计释放空间：${cleanup.sizeText}\n\n` +
    `该操作直接删除物理文件，无法撤销！确定要执行清理吗？`
  );

  if (!confirmCleanup) return;

  loading.value = true;
  try {
    let deletedCount = 0;
    for (const asset of cleanup.assets) {
      await deleteAssetFile(asset.name);
      deletedCount++;
    }
    pushMsg(`清理完成！已成功删除 ${deletedCount} 个未引用资源。`);
    await loadData();
  } catch (e) {
    console.error("Failed to cleanup unreferenced assets", e);
    pushMsg("清理失败");
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
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
}
.actions {
  display: flex;
  gap: 12px;
}
.b3-text-field, .b3-select {
  box-sizing: border-box;
  height: 32px;
  padding: 4px 8px;
  border: 1px solid var(--b3-theme-surface-lighter);
  border-radius: 4px;
  background: var(--b3-theme-background-light);
  color: var(--b3-theme-on-background);
  font-size: 14px;
}
.b3-button {
  cursor: pointer;
  box-sizing: border-box;
  height: 32px;
  padding: 0 12px;
  border-radius: 4px;
  border: 1px solid transparent;
  background-color: var(--b3-theme-primary);
  color: var(--b3-theme-on-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
}
.b3-button--error {
  background-color: var(--b3-theme-error);
  color: var(--b3-theme-on-error);
}

/* 自定义重命名弹窗样式 */
.rename-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: 1001;
  display: flex;
  justify-content: center;
  align-items: center;
}
.rename-dialog-content {
  background: var(--b3-theme-background);
  color: var(--b3-theme-on-background);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  width: 400px;
  max-width: 90vw;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.rename-dialog-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--b3-theme-surface-lighter);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.rename-dialog-header h3 {
  margin: 0;
  font-size: 16px;
}
.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: var(--b3-theme-on-surface);
  line-height: 1;
}
.rename-dialog-body {
  padding: 16px;
}
.rename-dialog-footer {
  padding: 12px 16px;
  border-top: 1px solid var(--b3-theme-surface-lighter);
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
.b3-button--cancel {
  background-color: transparent;
  border-color: var(--b3-theme-on-surface-light);
  color: var(--b3-theme-on-surface);
}
.b3-button--primary {
  background-color: var(--b3-theme-primary);
  color: var(--b3-theme-on-primary);
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

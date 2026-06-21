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
        <button class="b3-button" @click="loadData">
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
        @delete="handleDelete"
        @show-preview="handleShowPreview"
        @update-preview="handleUpdatePreview"
        @hide-preview="handleHidePreview"
      />
    </div>
    
    <div v-else class="loading-state">
      正在扫描 Siyuan 数据库并构建资源关联表，请稍候...
    </div>

    <ImageEditorDialog 
      v-model:visible="editorVisible"
      :assetName="currentEditAsset?.name || ''"
      @save-edited="handleSaveEdited"
    />

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
import { replaceAssetInBlocks, removeAssetFromBlocks } from '../utils/siyuan-block';
import { saveAssetFile } from '../utils/file-system';
import { pushMsg } from '../api';
import { usePlugin } from '../main';
import VirtualAssetList from './VirtualAssetList.vue';
import ImageEditorDialog from './ImageEditorDialog.vue';

const assets = ref<AssetInfo[]>([]);
const loading = ref(false);
const searchQuery = ref('');
const filterType = ref('all');

// 排序状态
const sortField = ref<'name' | 'ext' | 'size' | 'docCount'>('size');
const sortOrder = ref<'asc' | 'desc'>('desc');

const editorVisible = ref(false);
const currentEditAsset = ref<AssetInfo | null>(null);

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
  if (!/\.(png|jpe?g|gif|webp|svg)$/i.test(asset.name)) return;
  
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

onMounted(() => {
  loadData();
});

const filteredAssets = computed(() => {
  return assets.value.filter(asset => {
    if (searchQuery.value && !asset.name.toLowerCase().includes(searchQuery.value.toLowerCase())) {
      return false;
    }
    if (filterType.value === 'image' && !/\.(png|jpe?g|gif|webp|svg)$/i.test(asset.name)) {
      return false;
    }
    if (filterType.value === 'unreferenced' && asset.docCount > 0) {
      return false;
    }
    if (filterType.value === 'large' && asset.size < 1024 * 1024) {
      return false;
    }
    return true;
  });
});

const sortedAssets = computed(() => {
  const result = [...filteredAssets.value];
  result.sort((a, b) => {
    let valA: string | number;
    let valB: string | number;
    
    if (sortField.value === 'ext') {
      const idxA = a.name.lastIndexOf('.');
      valA = idxA <= 0 ? '' : a.name.slice(idxA + 1).toLowerCase();
      const idxB = b.name.lastIndexOf('.');
      valB = idxB <= 0 ? '' : b.name.slice(idxB + 1).toLowerCase();
    } else {
      valA = a[sortField.value];
      valB = b[sortField.value];
    }
    
    if (typeof valA === 'string' && typeof valB === 'string') {
      const cmp = valA.localeCompare(valB);
      return sortOrder.value === 'asc' ? cmp : -cmp;
    } else {
      const numA = valA as number;
      const numB = valB as number;
      return sortOrder.value === 'asc' ? numA - numB : numB - numA;
    }
  });
  return result;
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
  currentEditAsset.value = asset;
  editorVisible.value = true;
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

async function handleSaveEdited(payload: { oldName: string, dataUrl: string }) {
  const { oldName, dataUrl } = payload;
  
  const ext = oldName.split('.').pop();
  const baseName = oldName.substring(0, oldName.lastIndexOf('.'));
  const timestamp = Date.now();
  const newName = `${baseName}_edited_${timestamp}.${ext || 'png'}`;
  
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  
  await saveAssetFile(blob, newName);
  
  const assetRecord = assets.value.find(a => a.name === oldName);
  if (assetRecord && assetRecord.references.length > 0) {
    await replaceAssetInBlocks(assetRecord.references, oldName, newName);
  }
  
  const delOld = window.confirm(`图片已保存为 ${newName} 且引用已更新。\n是否将旧图片 ${oldName} 放入回收站？`);
  if (delOld) {
    await deleteAssetFile(oldName);
  }
  
  pushMsg("编辑已成功保存并同步到所有引用文档！");
  loadData();
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


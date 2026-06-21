<template>
  <div class="assets-manager-container">
    <div class="header">
      <h2>Siyuan 资源管家</h2>
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
          <span v-else>刷新数据</span>
        </button>
      </div>
    </div>

    <div class="main-content" v-if="!loading">
      <VirtualAssetList 
        :assets="sortedAssets"
        :sortField="sortField"
        :sortOrder="sortOrder"
        @sort="handleSortChange"
        @view-refs="handleViewRefs"
        @edit="handleEdit"
        @delete="handleDelete"
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
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { getAllAssetsInfo, deleteAssetFile, type AssetInfo } from '../utils/siyuan-db';
import { replaceAssetInBlocks } from '../utils/siyuan-block';
import { saveAssetFile } from '../utils/file-system';
import { pushMsg } from '../api';
import VirtualAssetList from './VirtualAssetList.vue';
import ImageEditorDialog from './ImageEditorDialog.vue';

const assets = ref<AssetInfo[]>([]);
const loading = ref(false);
const searchQuery = ref('');
const filterType = ref('all');

// 排序状态
const sortField = ref<'name' | 'size' | 'refCount'>('size');
const sortOrder = ref<'asc' | 'desc'>('desc');

const editorVisible = ref(false);
const currentEditAsset = ref<AssetInfo | null>(null);

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
    if (filterType.value === 'unreferenced' && asset.refCount > 0) {
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
    let valA = a[sortField.value];
    let valB = b[sortField.value];
    
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

function handleSortChange(field: 'name' | 'size' | 'refCount') {
  if (sortField.value === field) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortField.value = field;
    sortOrder.value = 'desc'; // 切换字段时默认降序
  }
}

function handleViewRefs(asset: AssetInfo) {
  let refsText = asset.references.map(r => r.path || r.id).join('\n');
  pushMsg(`被 ${asset.refCount} 个地方引用:\n${refsText}`, 5000);
}

function handleEdit(asset: AssetInfo) {
  currentEditAsset.value = asset;
  editorVisible.value = true;
}

async function handleDelete(asset: AssetInfo) {
  const confirmDelete = window.confirm(`确定要删除 ${asset.name} 吗？\n注意：将自动移入回收站或被移除。`);
  if (!confirmDelete) return;

  try {
    await deleteAssetFile(asset.name);
    pushMsg(`资源 ${asset.name} 已删除`);
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
  padding: 4px 8px;
  border: 1px solid var(--b3-theme-surface-lighter);
  border-radius: 4px;
  background: var(--b3-theme-background-light);
  color: var(--b3-theme-on-background);
}
.b3-button {
  cursor: pointer;
  padding: 6px 12px;
  border-radius: 4px;
  border: 1px solid transparent;
  background-color: var(--b3-theme-primary);
  color: var(--b3-theme-on-primary);
  display: flex;
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
.loading-state {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  color: var(--b3-theme-on-surface-light);
  font-size: 16px;
}
</style>


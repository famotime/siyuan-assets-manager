<template>
  <div class="virtual-list-wrapper">
    <div class="list-header">
      <div class="col-preview"></div>
      <div class="col-name sortable" :class="{ active: sortField === 'name' }" @click="handleSort('name')">
        文件名 <span v-if="sortField === 'name'" class="sort-icon">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
      </div>
      <div class="col-ext sortable" :class="{ active: sortField === 'ext' }" @click="handleSort('ext')">
        后缀名 <span v-if="sortField === 'ext'" class="sort-icon">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
      </div>
      <div class="col-size sortable" :class="{ active: sortField === 'size' }" @click="handleSort('size')">
        大小 <span v-if="sortField === 'size'" class="sort-icon">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
      </div>
      <div class="col-refs sortable" :class="{ active: sortField === 'docCount' }" @click="handleSort('docCount')">
        引用文档数 <span v-if="sortField === 'docCount'" class="sort-icon">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
      </div>
      <div class="col-actions">操作</div>
    </div>

    <div class="list-container" v-bind="containerProps">
      <div v-bind="wrapperProps" class="list-inner">
        <div
          v-for="item in list"
          :key="item.data.name"
          class="asset-item"
        >
          <div class="asset-preview">
            <img v-if="isImage(item.data.name)" :src="`/assets/${item.data.name}`" />
            <div v-else class="file-icon">{{ splitFileName(item.data.name).ext.substring(1).toUpperCase() || 'FILE' }}</div>
          </div>
          
          <div
            class="asset-name"
            @mouseenter="$emit('show-preview', { event: $event, asset: item.data })"
            @mousemove="$emit('update-preview', { event: $event })"
            @mouseleave="$emit('hide-preview')"
          >
            {{ splitFileName(item.data.name).name }}
          </div>

          <div class="col-ext asset-ext">
            {{ splitFileName(item.data.name).ext }}
          </div>

          <div class="col-size asset-size">
            {{ formatSize(item.data.size) }}
          </div>

          <div class="col-refs asset-refs">
            {{ item.data.docCount }}
          </div>

          <div class="col-actions asset-actions">
            <button v-if="item.data.docCount > 0" class="am-btn am-btn--icon" @click="$emit('open-docs', item.data)" title="在后台打开并定位到所有引用此资源的文档">
              <ExternalLink :size="16" />
            </button>
            <button v-if="isImage(item.data.name)" class="am-btn am-btn--icon am-btn--icon-primary" @click="$emit('edit', item.data)" title="编辑此图片">
              <Pencil :size="16" />
            </button>
            <button class="am-btn am-btn--icon" @click="$emit('rename', item.data)" title="重命名此资源，并自动更新所有文档引用">
              <TextCursorInput :size="16" />
            </button>
            <button class="am-btn am-btn--icon am-btn--icon-danger" @click="$emit('delete', item.data)" title="删除此资源及所有引用它的文档块">
              <Trash2 :size="16" />
            </button>
          </div>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { useVirtualList } from '@vueuse/core';
import { ExternalLink, Pencil, TextCursorInput, Trash2 } from 'lucide-vue-next';
import { toRefs } from 'vue';
import type { AssetInfo } from '../utils/siyuan-db';
import { formatAssetSize, isImageAsset, splitFileName } from '../utils/asset-list';

const props = defineProps<{
  assets: AssetInfo[];
  sortField: 'name' | 'ext' | 'size' | 'docCount';
  sortOrder: 'asc' | 'desc';
}>();

const { assets } = toRefs(props);

const { list, containerProps, wrapperProps } = useVirtualList(assets, {
  itemHeight: 61, // 60px height + 1px border
});

const emit = defineEmits(['open-docs', 'edit', 'rename', 'delete', 'sort', 'show-preview', 'update-preview', 'hide-preview']);

function handleSort(field: 'name' | 'ext' | 'size' | 'docCount') {
  emit('sort', field);
}

const formatSize = formatAssetSize;
const isImage = isImageAsset;
</script>

<style scoped lang="scss">
.virtual-list-wrapper {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.list-header {
  display: flex;
  padding: 8px 16px;
  border-bottom: 2px solid var(--b3-theme-surface-lighter);
  font-weight: bold;
  font-size: 14px;
  color: var(--b3-theme-on-background);
}

.sortable {
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 4px;
  transition: color 0.15s ease;

  &:hover {
    color: var(--b3-theme-primary);
  }

  &.active {
    color: var(--b3-theme-primary);
  }

  .sort-icon {
    font-size: 12px;
    opacity: 0.5;
  }
  
  &.active .sort-icon {
    opacity: 1;
  }
}

.list-container {
  flex: 1;
  overflow-y: auto;
}

.asset-item {
  height: 60px;
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--b3-theme-surface-lighter);
  padding: 0 16px;
  font-size: 14px;
  transition: background-color 0.15s ease;

  &:hover {
    background-color: var(--b3-theme-background-light);
    
    .asset-name {
      color: var(--b3-theme-primary);
    }
  }
}

/* 列宽分配 */
.col-preview { width: 52px; flex-shrink: 0; }
.col-name { flex: 1; }
.col-ext { width: 80px; flex-shrink: 0; }
.col-size { width: 100px; flex-shrink: 0; }
.col-refs { width: 100px; flex-shrink: 0; }
.col-actions { width: 220px; flex-shrink: 0; text-align: right; }

.asset-preview {
  width: 40px;
  height: 40px;
  margin-right: 12px;
  background: var(--b3-theme-background-light);
  display: flex;
  justify-content: center;
  align-items: center;
  border-radius: 4px;
  overflow: hidden;
  flex-shrink: 0;

  img {
    max-width: 100%;
    max-height: 100%;
    object-fit: cover;
  }
}

.file-icon {
  font-size: 10px;
  font-weight: bold;
  color: var(--b3-theme-on-surface-light);
  border: 1px solid var(--b3-theme-surface-lighter);
  padding: 2px 4px;
  border-radius: 3px;
  background: var(--b3-theme-background);
}

.asset-name {
  flex: 1;
  font-weight: bold;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding-right: 16px;
  cursor: pointer;
  transition: color 0.15s ease;
}

.asset-ext, .asset-size, .asset-refs {
  color: var(--b3-theme-on-surface-light);
}

.asset-actions {
  display: flex;
  gap: 4px;
  justify-content: flex-end;
  /* 始终显示操作按钮 */
  opacity: 1;
  pointer-events: auto;
}

/* 纯图标按钮样式 */
.am-btn--icon {
  width: 28px;
  height: 28px;
  padding: 0;
  background-color: transparent;
  color: var(--b3-theme-on-surface-light);
  border: 1px solid transparent;

  &:hover {
    background-color: var(--b3-theme-surface-lighter);
    color: var(--b3-theme-on-surface);
  }

  /* 强制使用线框样式，防止全局被填充 */
  :deep(svg) {
    fill: none !important;
    stroke: currentColor !important;
    stroke-width: 2px !important;
  }
}

.am-btn--icon-primary {
  color: var(--b3-theme-primary);
  &:hover {
    background-color: rgba(var(--b3-theme-primary-rgb, 66, 133, 244), 0.1);
    color: var(--b3-theme-primary);
  }
}

.am-btn--icon-danger {
  &:hover {
    background-color: rgba(var(--b3-theme-error-rgb, 210, 63, 49), 0.1);
    color: var(--b3-theme-error);
  }
}
</style>

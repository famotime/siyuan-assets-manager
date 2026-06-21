<template>
  <div class="virtual-list-wrapper-root" style="display: flex; flex-direction: column; height: 100%;">
    <div class="list-header" style="display: flex; padding: 8px 16px; border-bottom: 2px solid var(--b3-theme-surface-lighter); font-weight: bold; font-size: 14px;">
      <div style="width: 52px;"></div>
      <div style="flex: 1; cursor: pointer; user-select: none;" @click="handleSort('name')">
        文件名 <span v-if="sortField === 'name'">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
      </div>
      <div style="width: 80px; cursor: pointer; user-select: none;" @click="handleSort('ext')">
        后缀名 <span v-if="sortField === 'ext'">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
      </div>
      <div style="width: 100px; cursor: pointer; user-select: none;" @click="handleSort('size')">
        大小 <span v-if="sortField === 'size'">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
      </div>
      <div style="width: 100px; cursor: pointer; user-select: none;" @click="handleSort('docCount')">
        引用文档数 <span v-if="sortField === 'docCount'">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
      </div>
      <div style="width: 180px; text-align: right;">操作</div>
    </div>

    <div class="virtual-asset-list-container" v-bind="containerProps" style="flex: 1; overflow-y: auto;">
      <div v-bind="wrapperProps" class="virtual-list-inner">
        <div
          v-for="item in list"
          :key="item.data.name"
          class="asset-item"
          style="height: 60px; display: flex; align-items: center; border-bottom: 1px solid var(--b3-theme-surface-lighter); padding: 0 16px; font-size: 14px;"
        >
          <div class="asset-preview" style="width: 40px; height: 40px; margin-right: 12px; background: var(--b3-theme-background-light); display: flex; justify-content: center; align-items: center; border-radius: 4px; overflow: hidden; flex-shrink: 0;">
            <img v-if="isImage(item.data.name)" :src="`/assets/${item.data.name}`" style="max-width: 100%; max-height: 100%; object-fit: cover;" />
            <span v-else>📁</span>
          </div>
          
          <div
            class="asset-name"
            style="flex: 1; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 16px;"
            :title="item.data.name"
            @mouseenter="showPreview($event, item.data)"
            @mousemove="updatePreviewPos($event)"
            @mouseleave="hidePreview"
          >
            {{ splitFileName(item.data.name).name }}
          </div>

          <div class="asset-ext" style="width: 80px; color: var(--b3-theme-on-surface-light); flex-shrink: 0;">
            {{ splitFileName(item.data.name).ext }}
          </div>

          <div class="asset-size" style="width: 100px; color: var(--b3-theme-on-surface-light); flex-shrink: 0;">
            {{ formatSize(item.data.size) }}
          </div>

          <div class="asset-refs" style="width: 100px; color: var(--b3-theme-on-surface-light); flex-shrink: 0;">
            {{ item.data.docCount }}
          </div>

          <div class="asset-actions" style="width: 180px; display: flex; gap: 8px; justify-content: flex-end; flex-shrink: 0;">
            <button v-if="item.data.docCount > 0" class="b3-button b3-button--outline" @click="$emit('open-docs', item.data)">打开</button>
            <button v-if="isImage(item.data.name)" class="b3-button" @click="$emit('edit', item.data)">编辑</button>
            <button class="b3-button b3-button--error" @click="$emit('delete', item.data)">删除</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 悬浮图片预览弹窗 -->
    <div v-if="previewUrl" class="image-hover-preview" :style="previewStyle">
      <img :src="previewUrl" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useVirtualList } from '@vueuse/core';
import { ref, toRefs, onUnmounted } from 'vue';
import type { AssetInfo } from '../utils/siyuan-db';

const props = defineProps<{
  assets: AssetInfo[];
  sortField: 'name' | 'ext' | 'size' | 'docCount';
  sortOrder: 'asc' | 'desc';
}>();

const { assets } = toRefs(props);

const { list, containerProps, wrapperProps } = useVirtualList(assets, {
  itemHeight: 61, // 60px height + 1px border
});

const emit = defineEmits(['open-docs', 'edit', 'delete', 'sort']);

function handleSort(field: 'name' | 'ext' | 'size' | 'docCount') {
  emit('sort', field);
}

function formatSize(bytes: number) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function splitFileName(fullName: string) {
  const index = fullName.lastIndexOf('.');
  if (index <= 0) {
    return { name: fullName, ext: '' };
  }
  return {
    name: fullName.slice(0, index),
    ext: fullName.slice(index + 1)
  };
}

function isImage(name: string) {
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(name);
}

// 悬浮图片预览相关状态
const previewUrl = ref('');
const previewStyle = ref({
  top: '0px',
  left: '0px',
});
const mouseX = ref(0);
const mouseY = ref(0);
let previewTimeout: number | null = null;

function showPreview(event: MouseEvent, asset: AssetInfo) {
  if (!isImage(asset.name)) return;
  
  hidePreview();
  
  mouseX.value = event.clientX;
  mouseY.value = event.clientY;
  
  previewTimeout = window.setTimeout(() => {
    previewUrl.value = `/assets/${asset.name}`;
    positionPreview(mouseX.value, mouseY.value);
  }, 250); // 250ms 防抖，提供高级的 hover 体验
}

function updatePreviewPos(event: MouseEvent) {
  mouseX.value = event.clientX;
  mouseY.value = event.clientY;
  if (previewUrl.value) {
    positionPreview(mouseX.value, mouseY.value);
  }
}

function positionPreview(clientX: number, clientY: number) {
  const offsetX = 15;
  const offsetY = 15;
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
  
  previewStyle.value = {
    top: `${y}px`,
    left: `${x}px`,
  };
}

function hidePreview() {
  if (previewTimeout) {
    clearTimeout(previewTimeout);
    previewTimeout = null;
  }
  previewUrl.value = '';
}

onUnmounted(() => {
  hidePreview();
});
</script>

<style scoped>
.b3-button {
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid transparent;
  background-color: var(--b3-theme-primary);
  color: var(--b3-theme-on-primary);
  font-size: 12px;
}
.b3-button--outline {
  background-color: transparent;
  border-color: var(--b3-theme-primary);
  color: var(--b3-theme-primary);
}
.b3-button--error {
  background-color: var(--b3-theme-error);
  color: var(--b3-theme-on-error);
}
.list-header > div:hover {
  color: var(--b3-theme-primary);
}

.image-hover-preview {
  position: fixed;
  z-index: 9999;
  pointer-events: none;
  background-color: var(--b3-theme-background-light);
  border: 1px solid var(--b3-theme-surface-lighter);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  padding: 8px;
  max-width: 240px;
  max-height: 240px;
  display: flex;
  justify-content: center;
  align-items: center;
  overflow: hidden;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-sizing: border-box;
}

.image-hover-preview img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 4px;
}
</style>

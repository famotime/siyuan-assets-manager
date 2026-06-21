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
            style="flex: 1; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 16px; cursor: pointer;"
            @mouseenter="$emit('show-preview', { event: $event, asset: item.data })"
            @mousemove="$emit('update-preview', { event: $event })"
            @mouseleave="$emit('hide-preview')"
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

  </div>
</template>

<script setup lang="ts">
import { useVirtualList } from '@vueuse/core';
import { toRefs } from 'vue';
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

const emit = defineEmits(['open-docs', 'edit', 'delete', 'sort', 'show-preview', 'update-preview', 'hide-preview']);

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
</style>

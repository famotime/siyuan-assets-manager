<template>
  <div class="doc-group-list-wrapper">
    <div v-if="groups.length === 0" class="doc-empty-placeholder">
      暂无匹配的文档或资源
    </div>

    <div v-else class="doc-groups-scroll-container">
      <div
        v-for="group in groups"
        :key="group.id"
        class="doc-group-card"
        :class="{
          'is-unreferenced': group.isUnreferenced,
          'is-collapsed': isGroupCollapsed(group.id),
        }"
      >
        <!-- 分组卡片头部 -->
        <div
          class="doc-group-header"
          @click="toggleGroup(group.id)"
          :title="isGroupCollapsed(group.id) ? '点击展开文档资源' : '点击折叠文档资源'"
        >
          <div class="doc-header-left">
            <span class="expand-icon-wrapper" :class="{ 'is-expanded': !isGroupCollapsed(group.id) }">
              <ChevronRight :size="16" />
            </span>

            <div class="doc-checkbox-wrapper" @click.stop>
              <input
                type="checkbox"
                class="am-checkbox"
                :checked="isDocAllSelected(group)"
                :indeterminate.prop="isDocSomeSelected(group)"
                @change="handleDocCheckboxChange($event, group)"
                title="全选/取消全选此文档中的所有资源"
              />
            </div>

            <div class="doc-icon-wrapper" :class="{ 'icon-unref': group.isUnreferenced }">
              <AlertCircle v-if="group.isUnreferenced" :size="18" />
              <FileText v-else :size="18" />
            </div>

            <div class="doc-title-info">
              <div class="doc-title-row">
                <span class="doc-title-text">{{ group.title || group.readablePath || group.id }}</span>
                <span v-if="group.isUnreferenced" class="doc-unref-badge">孤立/未引用</span>
                <span v-else-if="group.matchedByDocName && searchQuery" class="doc-match-badge">文档匹配</span>
              </div>
              <div class="doc-path-row" :title="group.readablePath || group.title || group.id">
                {{ group.readablePath || group.title || group.id }}
              </div>
            </div>
          </div>

          <div class="doc-header-right" @click.stop>
            <div class="doc-stats-badges">
              <span class="stat-badge count-badge">{{ group.assetCount }} 个资源</span>
              <span class="stat-badge size-badge">{{ formatSize(group.totalSize) }}</span>
            </div>

            <button
              v-if="!group.isUnreferenced"
              class="am-btn am-btn--icon doc-open-btn"
              @click.stop="$emit('open-doc-id', group.id, group.firstBlockId)"
              title="在思源中打开此文档"
            >
              <ExternalLink :size="15" />
            </button>
          </div>
        </div>

        <!-- 分组卡片内部资源清单行（展开时展示） -->
        <div v-show="!isGroupCollapsed(group.id)" class="doc-group-body">
          <div class="doc-sublist-header">
            <div class="col-checkbox"></div>
            <div class="col-preview"></div>
            <div class="col-name sortable" :class="{ active: sortField === 'name' }" @click="handleSort('name')">
              文件名 <span v-if="sortField === 'name'" class="sort-icon">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
            </div>
            <div class="col-ext sortable" :class="{ active: sortField === 'ext' }" @click="handleSort('ext')">
              后缀 <span v-if="sortField === 'ext'" class="sort-icon">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
            </div>
            <div class="col-size sortable" :class="{ active: sortField === 'size' }" @click="handleSort('size')">
              大小 <span v-if="sortField === 'size'" class="sort-icon">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
            </div>
            <div class="col-updated sortable" :class="{ active: sortField === 'updated' }" @click="handleSort('updated')">
              更新时间 <span v-if="sortField === 'updated'" class="sort-icon">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
            </div>
            <div class="col-actions">操作</div>
          </div>

          <div class="doc-sublist-items">
            <div
              v-for="(asset, aIdx) in group.assets"
              :key="asset.name"
              class="asset-item"
              :class="{ 'is-selected': selectedNames.has(asset.name) }"
              @click="handleRowClick($event, asset, group.assets, aIdx)"
            >
              <div class="col-checkbox" @click.stop>
                <input
                  type="checkbox"
                  class="am-checkbox"
                  :checked="selectedNames.has(asset.name)"
                  @change="handleRowCheckboxChange($event, asset)"
                />
              </div>

              <div
                class="asset-preview"
                @mouseenter="$emit('show-preview', { event: $event, asset, previewSrc: getThumbnailSrc(asset) })"
                @mousemove="$emit('update-preview', { event: $event })"
                @mouseleave="$emit('hide-preview')"
              >
                <template v-if="isImage(asset.name) || asset.isOriginal">
                  <img v-if="getThumbnailSrc(asset)" :src="getThumbnailSrc(asset)" />
                  <div v-else class="preview-loading">...</div>
                  <span
                    v-if="asset.isReEditable"
                    class="preview-badge preview-badge--reedit"
                    title="包含矢量二次编辑数据"
                  >可编辑</span>
                  <span
                    v-else-if="asset.isOriginal"
                    class="preview-badge preview-badge--original"
                    title="隔离存储的干净原始底图"
                  >底图</span>
                </template>
                <div v-else class="file-icon">{{ getAssetBadgeText(asset.name) }}</div>
              </div>

              <div
                class="asset-name"
                @mouseenter="$emit('show-preview', { event: $event, asset, previewSrc: getThumbnailSrc(asset) })"
                @mousemove="$emit('update-preview', { event: $event })"
                @mouseleave="$emit('hide-preview')"
              >
                <span class="asset-title-text">{{ splitFileName(asset.name).name }}</span>

                <span
                  v-if="asset.docCount > 1"
                  class="multi-ref-badge"
                  :title="`该资源被 ${asset.docCount} 篇不同的文档共同引用`"
                >
                  多篇引用 ({{ asset.docCount }})
                </span>

                <span
                  v-if="asset.isReEditable"
                  class="asset-badge-icon-wrapper"
                  title="包含矢量二次编辑数据"
                >
                  <Palette :size="15" class="asset-badge-icon asset-badge-icon--reedit" />
                </span>
                <span
                  v-else-if="asset.isOriginal"
                  class="asset-badge-icon-wrapper"
                  title="隔离存储的干净原始底图"
                >
                  <Layers :size="15" class="asset-badge-icon asset-badge-icon--original" />
                </span>
              </div>

              <div class="col-ext asset-ext">
                {{ splitFileName(asset.name).ext }}
              </div>

              <div class="col-size asset-size">
                {{ formatSize(asset.size) }}
              </div>

              <div class="col-updated asset-updated">
                {{ formatTime(asset.updated) }}
              </div>

              <div class="col-actions asset-actions" @click.stop>
                <button
                  v-if="asset.docCount > 0"
                  class="am-btn am-btn--icon"
                  @click.stop="$emit('open-docs', asset)"
                  title="在后台打开并定位到所有引用此资源的文档"
                >
                  <ExternalLink :size="16" />
                </button>
                <button
                  v-if="isImage(asset.name) || asset.isOriginal"
                  class="am-btn am-btn--icon am-btn--icon-primary"
                  @click.stop="$emit('edit', asset)"
                  title="编辑此图片"
                >
                  <Pencil :size="16" />
                </button>
                <button
                  v-if="!asset.isOriginal"
                  class="am-btn am-btn--icon"
                  @click.stop="$emit('rename', asset)"
                  title="重命名此资源，并自动更新所有文档引用"
                >
                  <TextCursorInput :size="16" />
                </button>
                <button
                  class="am-btn am-btn--icon am-btn--icon-danger"
                  @click.stop="$emit('delete', asset)"
                  :title="asset.isOriginal ? '删除此原始底图' : '删除此资源及所有引用它的文档块'"
                >
                  <Trash2 :size="16" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, toRefs, computed, watch, onUnmounted } from 'vue';
import {
  ChevronRight,
  FileText,
  AlertCircle,
  ExternalLink,
  Pencil,
  TextCursorInput,
  Trash2,
  Layers,
  Palette,
} from 'lucide-vue-next';
import type { AssetInfo } from '../utils/siyuan-db';
import {
  formatAssetSize,
  formatAssetTime,
  getAssetBadgeText,
  isImageAsset,
  splitFileName,
  type AssetSortField,
  type AssetSortOrder,
  type DocAssetGroup,
} from '../utils/asset-list';
import { readOriginalImage } from '../utils/file-system';

const props = defineProps<{
  groups: DocAssetGroup[];
  sortField: AssetSortField;
  sortOrder: AssetSortOrder;
  selectedNames: Set<string>;
  searchQuery?: string;
}>();

const { groups, selectedNames } = toRefs(props);

const emit = defineEmits<{
  (e: 'open-docs', asset: AssetInfo): void;
  (e: 'open-doc-id', rootId: string, firstBlockId?: string): void;
  (e: 'edit', asset: AssetInfo): void;
  (e: 'rename', asset: AssetInfo): void;
  (e: 'delete', asset: AssetInfo): void;
  (e: 'sort', field: AssetSortField): void;
  (e: 'show-preview', payload: { event: MouseEvent; asset: AssetInfo; previewSrc?: string }): void;
  (e: 'update-preview', payload: { event: MouseEvent }): void;
  (e: 'hide-preview'): void;
  (e: 'update:selectedNames', nextSelected: Set<string>): void;
}>();

// 折叠状态跟踪：记录手动折叠的 docId 集合
const collapsedDocIds = ref<Set<string>>(new Set());

// 初次加载分组时，若文档较多（> 5 个），默认展开前 5 个，其余折叠，保持轻快整洁
const isInitialBatchInitialized = ref(false);
watch(
  () => props.groups,
  (newGroups) => {
    if (!isInitialBatchInitialized.value && newGroups && newGroups.length > 0) {
      isInitialBatchInitialized.value = true;
      if (newGroups.length > 5) {
        const initialCollapsed = new Set<string>();
        for (let i = 5; i < newGroups.length; i++) {
          initialCollapsed.add(newGroups[i].id);
        }
        collapsedDocIds.value = initialCollapsed;
      }
    }
  },
  { immediate: true }
);

// 搜索关键词变更时，如果有关键词，默认清空折叠状态使结果全部展开可见
watch(
  () => props.searchQuery,
  (q) => {
    if (q && q.trim()) {
      collapsedDocIds.value = new Set();
    }
  }
);

function isGroupCollapsed(groupId: string): boolean {
  return collapsedDocIds.value.has(groupId);
}

function toggleGroup(groupId: string) {
  const next = new Set(collapsedDocIds.value);
  if (next.has(groupId)) {
    next.delete(groupId);
  } else {
    next.add(groupId);
  }
  collapsedDocIds.value = next;
}

function expandAll() {
  collapsedDocIds.value = new Set();
}

function collapseAll() {
  collapsedDocIds.value = new Set(props.groups.map((g) => g.id));
}

defineExpose({
  expandAll,
  collapseAll,
  toggleGroup,
  invalidateAssetThumbnail,
});

// 文档卡片勾选状态判定
function isDocAllSelected(group: DocAssetGroup): boolean {
  if (group.assets.length === 0) return false;
  return group.assets.every((a) => selectedNames.value.has(a.name));
}

function isDocSomeSelected(group: DocAssetGroup): boolean {
  if (isDocAllSelected(group)) return false;
  return group.assets.some((a) => selectedNames.value.has(a.name));
}

function handleDocCheckboxChange(event: Event, group: DocAssetGroup) {
  const target = event.target as HTMLInputElement;
  const nextSet = new Set(selectedNames.value);

  if (target.checked) {
    for (const a of group.assets) {
      nextSet.add(a.name);
    }
  } else {
    for (const a of group.assets) {
      nextSet.delete(a.name);
    }
  }
  emit('update:selectedNames', nextSet);
}

const lastSelectedIndex = ref<number>(-1);

function handleRowClick(event: MouseEvent, asset: AssetInfo, groupAssets: AssetInfo[], index: number) {
  const nextSet = new Set(selectedNames.value);

  if (event.shiftKey) {
    const anchor = lastSelectedIndex.value >= 0 ? lastSelectedIndex.value : index;
    const start = Math.min(anchor, index);
    const end = Math.max(anchor, index);

    if (!event.ctrlKey && !event.metaKey) {
      nextSet.clear();
    }

    for (let i = start; i <= end; i++) {
      const item = groupAssets[i];
      if (item) {
        nextSet.add(item.name);
      }
    }
    emit('update:selectedNames', nextSet);
  } else if (event.ctrlKey || event.metaKey) {
    if (nextSet.has(asset.name)) {
      nextSet.delete(asset.name);
    } else {
      nextSet.add(asset.name);
    }
    lastSelectedIndex.value = index;
    emit('update:selectedNames', nextSet);
  } else {
    nextSet.clear();
    nextSet.add(asset.name);
    lastSelectedIndex.value = index;
    emit('update:selectedNames', nextSet);
  }
}

function handleRowCheckboxChange(event: Event, asset: AssetInfo) {
  const nextSet = new Set(selectedNames.value);
  if (nextSet.has(asset.name)) {
    nextSet.delete(asset.name);
  } else {
    nextSet.add(asset.name);
  }
  emit('update:selectedNames', nextSet);
}

function handleSort(field: AssetSortField) {
  emit('sort', field);
}

const formatSize = formatAssetSize;
const formatTime = formatAssetTime;
const isImage = isImageAsset;

// 原始底图 ObjectURL 缓存管理
const originalBlobUrlMap = ref<Record<string, string>>({});
const loadingOriginals = new Set<string>();

async function loadOriginalBlobUrl(asset: AssetInfo) {
  if (!asset.isOriginal || originalBlobUrlMap.value[asset.name] || loadingOriginals.has(asset.name)) {
    return;
  }
  loadingOriginals.add(asset.name);
  try {
    const blob = await readOriginalImage(asset.originalStoragePath || asset.name);
    if (blob) {
      originalBlobUrlMap.value[asset.name] = URL.createObjectURL(blob);
    }
  } catch (e) {
  } finally {
    loadingOriginals.delete(asset.name);
  }
}

function getThumbnailSrc(asset: AssetInfo): string {
  if (!asset.isOriginal) {
    const versionQuery = asset.updated ? `?t=${asset.updated}` : '';
    return `/assets/${asset.name}${versionQuery}`;
  }
  if (originalBlobUrlMap.value[asset.name]) {
    return originalBlobUrlMap.value[asset.name];
  }
  loadOriginalBlobUrl(asset);
  return '';
}

function invalidateAssetThumbnail(assetName: string) {
  if (originalBlobUrlMap.value[assetName]) {
    try {
      URL.revokeObjectURL(originalBlobUrlMap.value[assetName]);
    } catch (e) {}
    delete originalBlobUrlMap.value[assetName];
  }
}

onUnmounted(() => {
  for (const url of Object.values(originalBlobUrlMap.value)) {
    try {
      URL.revokeObjectURL(url);
    } catch (e) {}
  }
});
</script>

<style scoped lang="scss">
.doc-group-list-wrapper {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  min-height: 0;
  overflow: hidden;
}

.doc-empty-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px 16px;
  color: var(--b3-theme-on-surface-light);
  font-size: 14px;
}

.doc-groups-scroll-container {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 14px 16px 36px 16px;
  box-sizing: border-box;
}

.doc-group-card {
  margin-bottom: 14px;
  border: 1px solid var(--b3-theme-surface-lighter);
  border-radius: 8px;
  background-color: var(--b3-theme-surface);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  overflow: hidden;
  box-sizing: border-box;

  &:last-child {
    margin-bottom: 0;
  }

  &:hover {
    border-color: rgba(66, 133, 244, 0.35);
  }

  &.is-unreferenced {
    border-color: rgba(245, 158, 11, 0.35);
    background-color: rgba(245, 158, 11, 0.02);

    .doc-group-header {
      background-color: rgba(245, 158, 11, 0.05);
    }
  }
}

.doc-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 48px;
  padding: 8px 14px;
  background-color: var(--b3-theme-background-light);
  border-bottom: 1px solid var(--b3-theme-surface-lighter);
  cursor: pointer;
  user-select: none;
  transition: background-color 0.15s ease;
  box-sizing: border-box;

  &:hover {
    background-color: var(--b3-theme-surface-lighter);
  }
}

.doc-group-card.is-collapsed .doc-group-header {
  border-bottom: none;
}

.doc-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.expand-icon-wrapper {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--b3-theme-on-surface-light);
  transition: transform 0.2s ease, color 0.15s ease;

  &.is-expanded {
    transform: rotate(90deg);
    color: var(--b3-theme-primary);
  }
}

.doc-checkbox-wrapper {
  display: flex;
  align-items: center;
}

.doc-icon-wrapper {
  color: var(--b3-theme-primary);
  display: flex;
  align-items: center;
  flex-shrink: 0;

  &.icon-unref {
    color: #f59e0b;
  }
}

.doc-title-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.doc-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
  color: var(--b3-theme-on-background);
  line-height: 1.3;
}

.doc-title-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doc-unref-badge {
  font-size: 11px;
  font-weight: 500;
  color: #d97706;
  background-color: rgba(245, 158, 11, 0.15);
  padding: 1px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}

.doc-match-badge {
  font-size: 11px;
  font-weight: 500;
  color: var(--b3-theme-primary);
  background-color: rgba(66, 133, 244, 0.12);
  padding: 1px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}

.doc-path-row {
  font-size: 12px;
  color: var(--b3-theme-on-surface-light);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 1px;
}

.doc-header-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  margin-left: 12px;
}

.doc-stats-badges {
  display: flex;
  align-items: center;
  gap: 6px;
}

.stat-badge {
  font-size: 12px;
  padding: 2px 7px;
  border-radius: 4px;
  font-weight: 500;

  &.count-badge {
    background-color: var(--b3-theme-surface-lighter);
    color: var(--b3-theme-on-background);
  }

  &.size-badge {
    background-color: rgba(66, 133, 244, 0.1);
    color: var(--b3-theme-primary);
  }
}

.doc-open-btn {
  padding: 4px;
  border-radius: 4px;
  color: var(--b3-theme-on-surface-light);

  &:hover {
    color: var(--b3-theme-primary);
    background-color: var(--b3-theme-surface-lighter);
  }
}

/* 子列表样式 */
.doc-group-body {
  background-color: var(--b3-theme-surface);
}

.doc-sublist-header {
  display: flex;
  align-items: center;
  padding: 6px 14px;
  background-color: var(--b3-theme-background-light);
  border-bottom: 1px solid var(--b3-theme-surface-lighter);
  font-size: 12px;
  font-weight: 600;
  color: var(--b3-theme-on-surface-light);
  user-select: none;
}

.doc-sublist-items {
  display: flex;
  flex-direction: column;
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
    font-size: 11px;
    opacity: 0.6;
  }
}

.asset-item {
  height: 52px;
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--b3-theme-surface-lighter);
  padding: 0 14px;
  font-size: 13px;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.15s ease;

  &:last-child {
    border-bottom: none;
  }

  &:hover {
    background-color: var(--b3-theme-background-light);

    .asset-title-text {
      color: var(--b3-theme-primary);
    }
  }

  &.is-selected {
    background-color: rgba(66, 133, 244, 0.12);

    &:hover {
      background-color: rgba(66, 133, 244, 0.18);
    }

    .asset-title-text {
      color: var(--b3-theme-primary);
      font-weight: 700;
    }
  }
}

/* 列宽分配 */
.col-checkbox {
  width: 28px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.am-checkbox {
  cursor: pointer;
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--b3-theme-primary);
}

.col-preview {
  width: 42px;
  flex-shrink: 0;
}

.col-name {
  flex: 1;
  min-width: 140px;
}

.col-ext {
  width: 70px;
  flex-shrink: 0;
}

.col-size {
  width: 80px;
  flex-shrink: 0;
}

.col-updated {
  width: 145px;
  flex-shrink: 0;
  font-size: 12px;
}

.col-actions {
  width: 160px;
  flex-shrink: 0;
  text-align: right;
}

.asset-preview {
  width: 36px;
  height: 36px;
  margin-right: 10px;
  background: var(--b3-theme-background-light);
  display: flex;
  justify-content: center;
  align-items: center;
  border-radius: 4px;
  overflow: hidden;
  position: relative;
  flex-shrink: 0;

  img {
    max-width: 100%;
    max-height: 100%;
    object-fit: cover;
  }
}

.preview-loading {
  font-size: 9px;
  color: var(--b3-theme-on-surface-light);
}

.preview-badge {
  position: absolute;
  bottom: 1px;
  right: 1px;
  font-size: 8px;
  line-height: 1;
  padding: 1px 2px;
  border-radius: 2px;
  font-weight: 600;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;

  &--reedit {
    background: #0ea5e9;
  }

  &--original {
    background: #8b5cf6;
  }
}

.file-icon {
  font-size: 10px;
  font-weight: bold;
  color: var(--b3-theme-on-surface-light);
  text-transform: uppercase;
}

.asset-name {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
}

.asset-title-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.multi-ref-badge {
  font-size: 10px;
  line-height: 1.2;
  padding: 1px 5px;
  border-radius: 3px;
  font-weight: 500;
  color: #2563eb;
  background-color: rgba(37, 99, 235, 0.1);
  border: 1px solid rgba(37, 99, 235, 0.25);
  flex-shrink: 0;
}

.asset-badge-icon-wrapper {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

.asset-badge-icon--reedit {
  color: #0ea5e9;
}

.asset-badge-icon--original {
  color: #8b5cf6;
}

.asset-ext,
.asset-size,
.asset-updated {
  color: var(--b3-theme-on-surface-light);
}

.asset-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
}
</style>

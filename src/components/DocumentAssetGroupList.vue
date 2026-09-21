<template>
  <div class="doc-group-list-wrapper">
    <div v-if="groups.length === 0" class="doc-empty-placeholder">
      暂无匹配的文档或资源
    </div>

    <!--
      万级资源下列表必须只渲染视口内的行，因此这里渲染的是 buildDocRows 摊平出来的一维行序列，
      交给 useVirtualList 按滚动位置开窗。行高由 DOC_ROW_HEIGHTS 统一给出并内联绑定，
      保证虚拟滚动的测量值与 CSS 实际高度同源。
    -->
    <div v-else class="doc-groups-scroll-container" v-bind="containerProps">
      <div v-bind="wrapperProps" class="doc-rows-inner">
        <template v-for="row in list" :key="row.data.key">
          <!-- 分组卡片头部 -->
          <div
            v-if="row.data.kind === 'header'"
            class="doc-row doc-group-card"
            :class="{
              'is-unreferenced': row.data.group.isUnreferenced,
              'is-collapsed': row.data.collapsed,
            }"
            :style="{ height: `${row.data.height}px` }"
          >
            <div
              class="doc-group-header"
              @click="toggleGroup(row.data.group.id)"
              :title="row.data.collapsed ? '点击展开文档资源' : '点击折叠文档资源'"
            >
              <div class="doc-header-left">
                <span class="expand-icon-wrapper" :class="{ 'is-expanded': !row.data.collapsed }">
                  <ChevronRight :size="16" />
                </span>

                <div class="doc-checkbox-wrapper" @click.stop>
                  <input
                    type="checkbox"
                    class="am-checkbox"
                    :checked="isDocAllSelected(row.data.group)"
                    :indeterminate.prop="isDocSomeSelected(row.data.group)"
                    @change="handleDocCheckboxChange($event, row.data.group)"
                    title="全选/取消全选此文档中的所有资源"
                  />
                </div>

                <div class="doc-icon-wrapper" :class="{ 'icon-unref': row.data.group.isUnreferenced }">
                  <AlertCircle v-if="row.data.group.isUnreferenced" :size="18" />
                  <FileText v-else :size="18" />
                </div>

                <div class="doc-title-info">
                  <div class="doc-title-row">
                    <span class="doc-title-text">{{ row.data.group.title || row.data.group.readablePath || row.data.group.id }}</span>
                    <span v-if="row.data.group.isUnreferenced" class="doc-unref-badge">孤立/未引用</span>
                    <span v-else-if="row.data.group.matchedByDocName && searchQuery" class="doc-match-badge">文档匹配</span>
                  </div>
                  <div class="doc-path-row" :title="row.data.group.readablePath || row.data.group.title || row.data.group.id">
                    {{ row.data.group.readablePath || row.data.group.title || row.data.group.id }}
                  </div>
                </div>
              </div>

              <div class="doc-header-right" @click.stop>
                <div class="doc-stats-badges">
                  <span class="stat-badge count-badge">{{ row.data.group.assetCount }} 个资源</span>
                  <span class="stat-badge size-badge">{{ formatSize(row.data.group.totalSize) }}</span>
                </div>

                <button
                  v-if="!row.data.group.isUnreferenced"
                  class="am-btn am-btn--icon doc-open-btn"
                  @click.stop="$emit('open-doc-id', row.data.group.id, row.data.group.firstBlockId)"
                  title="在思源中打开此文档"
                >
                  <ExternalLink :size="15" />
                </button>
              </div>
            </div>
          </div>

          <!-- 卡片内的列名行 -->
          <div
            v-else-if="row.data.kind === 'subheader'"
            class="doc-row doc-sublist-header"
            :class="{ 'is-unreferenced': row.data.group.isUnreferenced }"
            :style="{ height: `${row.data.height}px` }"
          >
            <div class="col-checkbox"></div>
            <div class="col-preview"></div>
            <div class="col-name sortable" :class="{ active: sortField === 'name' }" @click="handleSort('name')">
              文件名
              <ArrowUp v-if="sortField === 'name' && sortOrder === 'asc'" :size="12" class="sort-icon" style="fill: none !important;" />
              <ArrowDown v-else-if="sortField === 'name' && sortOrder === 'desc'" :size="12" class="sort-icon" style="fill: none !important;" />
            </div>
            <div class="col-ext sortable" :class="{ active: sortField === 'ext' }" @click="handleSort('ext')">
              后缀名
              <ArrowUp v-if="sortField === 'ext' && sortOrder === 'asc'" :size="12" class="sort-icon" style="fill: none !important;" />
              <ArrowDown v-else-if="sortField === 'ext' && sortOrder === 'desc'" :size="12" class="sort-icon" style="fill: none !important;" />
            </div>
            <div class="col-size sortable" :class="{ active: sortField === 'size' }" @click="handleSort('size')">
              大小
              <ArrowUp v-if="sortField === 'size' && sortOrder === 'asc'" :size="12" class="sort-icon" style="fill: none !important;" />
              <ArrowDown v-else-if="sortField === 'size' && sortOrder === 'desc'" :size="12" class="sort-icon" style="fill: none !important;" />
            </div>
            <div class="col-updated sortable" :class="{ active: sortField === 'updated' }" @click="handleSort('updated')">
              更新时间
              <ArrowUp v-if="sortField === 'updated' && sortOrder === 'asc'" :size="12" class="sort-icon" style="fill: none !important;" />
              <ArrowDown v-else-if="sortField === 'updated' && sortOrder === 'desc'" :size="12" class="sort-icon" style="fill: none !important;" />
            </div>
            <div class="col-actions">操作</div>
          </div>

          <!-- 单条资源行 -->
          <div
            v-else-if="row.data.kind === 'asset'"
            class="doc-row asset-item"
            :class="{
              'is-selected': selectedNames.has(row.data.asset.name),
              'is-unreferenced': row.data.group.isUnreferenced,
              'is-last-in-group': row.data.isLastInGroup,
            }"
            :data-group-id="row.data.groupId"
            :style="{ height: `${row.data.height}px` }"
            @click="handleRowClick($event, row.data.asset, row.data.group.assets, row.data.indexInGroup)"
          >
            <div class="col-checkbox" @click.stop>
              <input
                type="checkbox"
                class="am-checkbox"
                :checked="selectedNames.has(row.data.asset.name)"
                @change="handleRowCheckboxChange($event, row.data.asset)"
              />
            </div>

            <div class="col-preview">
              <div
                class="asset-preview"
                @mouseenter="$emit('show-preview', { event: $event, asset: row.data.asset, previewSrc: getThumbnailSrc(row.data.asset) })"
                @mousemove="$emit('update-preview', { event: $event })"
                @mouseleave="$emit('hide-preview')"
              >
                <template v-if="isImage(row.data.asset.name) || row.data.asset.isOriginal">
                  <img
                    v-if="getThumbnailSrc(row.data.asset)"
                    :src="getThumbnailSrc(row.data.asset)"
                    loading="lazy"
                    decoding="async"
                  />
                  <div v-else class="preview-loading">...</div>
                  <span
                    v-if="row.data.asset.isReEditable"
                    class="preview-badge preview-badge--reedit"
                    title="包含矢量二次编辑数据"
                  >可编辑</span>
                  <span
                    v-else-if="row.data.asset.isOriginal"
                    class="preview-badge preview-badge--original"
                    title="隔离存储的干净原始底图"
                  >底图</span>
                </template>
                <div v-else class="file-icon">{{ getAssetBadgeText(row.data.asset.name) }}</div>
              </div>
            </div>

            <div
              class="col-name asset-name"
              @mouseenter="$emit('show-preview', { event: $event, asset: row.data.asset, previewSrc: getThumbnailSrc(row.data.asset) })"
              @mousemove="$emit('update-preview', { event: $event })"
              @mouseleave="$emit('hide-preview')"
            >
              <span class="asset-title-text">{{ splitFileName(row.data.asset.name).name }}</span>

              <span
                v-if="row.data.asset.docCount > 1"
                class="multi-ref-badge"
                :title="`该资源被 ${row.data.asset.docCount} 篇不同的文档共同引用`"
              >
                多篇引用 ({{ row.data.asset.docCount }})
              </span>

              <span
                v-if="row.data.asset.isReEditable"
                class="asset-badge-icon-wrapper"
                title="包含矢量二次编辑数据"
              >
                <Palette :size="15" class="asset-badge-icon asset-badge-icon--reedit" style="fill: none !important;" />
              </span>
              <span
                v-else-if="row.data.asset.isOriginal"
                class="asset-badge-icon-wrapper"
                title="隔离存储的干净原始底图"
              >
                <Layers :size="15" class="asset-badge-icon asset-badge-icon--original" style="fill: none !important;" />
              </span>
            </div>

            <div class="col-ext asset-ext">
              {{ splitFileName(row.data.asset.name).ext }}
            </div>

            <div class="col-size asset-size">
              {{ formatSize(row.data.asset.size) }}
            </div>

            <div class="col-updated asset-updated">
              {{ formatTime(row.data.asset.updated) }}
            </div>

            <div class="col-actions asset-actions" @click.stop>
              <button
                v-if="row.data.asset.docCount > 0"
                class="am-btn am-btn--icon b3-tooltips b3-tooltips__s"
                @click.stop="$emit('open-docs', row.data.asset)"
                aria-label="在后台打开并定位引用此资源的文档"
              >
                <ExternalLink :size="15" style="fill: none !important;" />
              </button>
              <button
                v-if="isImage(row.data.asset.name) || row.data.asset.isOriginal"
                class="am-btn am-btn--icon am-btn--icon-primary b3-tooltips b3-tooltips__s"
                @click.stop="$emit('edit', row.data.asset)"
                aria-label="二次编辑与矢量标注"
              >
                <Pencil :size="15" style="fill: none !important;" />
              </button>
              <button
                v-if="!row.data.asset.isOriginal"
                class="am-btn am-btn--icon b3-tooltips b3-tooltips__s"
                @click.stop="$emit('rename', row.data.asset)"
                aria-label="重命名此资源并自动更新引用"
              >
                <TextCursorInput :size="15" style="fill: none !important;" />
              </button>
              <button
                class="am-btn am-btn--icon am-btn--icon-danger b3-tooltips b3-tooltips__sw"
                @click.stop="$emit('delete', row.data.asset)"
                :aria-label="row.data.asset.isOriginal ? '删除此原始底图' : '删除此资源及文档引用'"
              >
                <Trash2 :size="15" style="fill: none !important;" />
              </button>
            </div>
          </div>

          <!-- 卡片之间的间距 -->
          <div
            v-else-if="row.data.kind === 'gap'"
            class="doc-row doc-row--gap"
            :style="{ height: `${row.data.height}px` }"
          ></div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, toRefs, computed, onUnmounted } from 'vue';
import { useVirtualList } from '@vueuse/core';
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
  ArrowUp,
  ArrowDown,
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
import { buildDocRows } from '../utils/doc-group-rows';
import { readOriginalImage } from '../utils/file-system';

const props = defineProps<{
  groups: DocAssetGroup[];
  sortField: AssetSortField;
  sortOrder: AssetSortOrder;
  selectedNames: Set<string>;
  collapsedDocIds: Set<string>;
  searchQuery?: string;
}>();

const { groups, selectedNames } = toRefs(props);

// 摊平成一维行序列后交给虚拟滚动：折叠的文档不产生资源行，
// 展开的文档也只有视口附近的行会真正进入 DOM。
const rows = computed(() =>
  buildDocRows(props.groups, {
    collapsedDocIds: props.collapsedDocIds,
    searchQuery: props.searchQuery,
  })
);

const { list, containerProps, wrapperProps } = useVirtualList(rows, {
  itemHeight: (index: number) => rows.value[index]?.height ?? 0,
  overscan: 10,
});

// 行自带所属分组，Shift 连续多选直接取 row.group.assets，
// 不必按 id 回查当前 props（回查可能与扁平化时的下标不同代）。


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
  (e: 'toggle-collapse', groupId: string): void;
}>();

// 折叠状态由父组件持有（collapsedDocIds），使视图切换与资源增删都不丢失用户操作。
// 搜索期间强制全部展开以便看到命中结果，但不改写父组件持有的集合，清空搜索后自动还原。
// 该判定已下沉到 buildDocRows，行序列本身就是折叠后的结果。
function toggleGroup(groupId: string) {
  emit('toggle-collapse', groupId);
}

defineExpose({
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

.doc-rows-inner {
  display: flex;
  flex-direction: column;
}

/*
 * 虚拟滚动按行渲染，卡片描边因此拆到每一行上：头部行负责顶边与左右边，
 * 资源行负责左右边，末行补上底边与圆角，合起来与原先整张卡片外观一致。
 */
.doc-row {
  box-sizing: border-box;
  overflow: hidden;
  flex-shrink: 0;
}

/* 孤立/未引用分组的暖色描边（放在资源行自身状态之前，保证选中/悬浮态能覆盖） */
.doc-row.is-unreferenced {
  border-left-color: rgba(245, 158, 11, 0.35);
  border-right-color: rgba(245, 158, 11, 0.35);
}

.doc-group-card {
  border: 1px solid var(--b3-theme-surface-lighter);
  border-radius: 8px 8px 0 0;
  background-color: var(--b3-theme-surface);

  /* 折叠时这一行就是整张卡片，四角都收圆 */
  &.is-collapsed {
    border-radius: 8px;
  }

  /*
   * 孤立/未引用卡片：顶边与左右边转暖色；展开时下边框是与列名行的分隔线，
   * 仍保持中性灰（原实现由 .doc-group-header 自己钉住灰色），卡片真正的底边
   * 由末行资源补上（见 .doc-row.is-unreferenced.is-last-in-group）。
   */
  &.is-unreferenced {
    border-top-color: rgba(245, 158, 11, 0.35);
    border-left-color: rgba(245, 158, 11, 0.35);
    border-right-color: rgba(245, 158, 11, 0.35);
    background-color: rgba(245, 158, 11, 0.02);

    &.is-collapsed {
      border-bottom-color: rgba(245, 158, 11, 0.35);
    }

    .doc-group-header {
      background-color: rgba(245, 158, 11, 0.05);
    }
  }
}

.doc-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 100%;
  padding: 8px 14px;
  background-color: var(--b3-theme-background-light);
  cursor: pointer;
  user-select: none;
  transition: background-color 0.15s ease;
  box-sizing: border-box;

  &:hover {
    background-color: var(--b3-theme-surface-lighter);
  }
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

/* 行高写死：虚拟滚动依赖行高恒定，标题两行合计必须稳定落在头部行的内容盒内 */
.doc-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
  color: var(--b3-theme-on-background);
  line-height: 19px;
}

.doc-title-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/*
 * 徽章是标题行里的 flex 子项，会撑高该行。显式钉住 line-height，
 * 使「有徽章」与「无徽章」的标题行同为 17+2=19px，头部行的内容高度才有确定上界。
 */
.doc-unref-badge {
  font-size: 11px;
  font-weight: 500;
  line-height: 17px;
  color: #d97706;
  background-color: rgba(245, 158, 11, 0.15);
  padding: 1px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}

.doc-match-badge {
  font-size: 11px;
  font-weight: 500;
  line-height: 17px;
  color: var(--b3-theme-primary);
  background-color: rgba(66, 133, 244, 0.12);
  padding: 1px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}

.doc-path-row {
  font-size: 12px;
  line-height: 17px;
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
  line-height: 16px;
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

/* 卡片内的列名行 */
.doc-sublist-header {
  display: flex;
  align-items: center;
  padding: 6px 14px;
  background-color: var(--b3-theme-background-light);
  border-bottom: 1px solid var(--b3-theme-surface-lighter);
  border-left: 1px solid var(--b3-theme-surface-lighter);
  border-right: 1px solid var(--b3-theme-surface-lighter);
  font-size: 12px;
  font-weight: 600;
  line-height: 18px;
  color: var(--b3-theme-on-surface-light);
  user-select: none;
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
  display: flex;
  align-items: center;
  /* 行背景接替原卡片底色，否则整行会露出容器背景 */
  background-color: var(--b3-theme-surface);
  border-bottom: 1px solid var(--b3-theme-surface-lighter);
  border-left: 1px solid var(--b3-theme-surface-lighter);
  border-right: 1px solid var(--b3-theme-surface-lighter);
  padding: 0 14px;
  font-size: 13px;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.15s ease;

  /* 末行补上卡片底边与圆角 */
  &.is-last-in-group {
    border-radius: 0 0 8px 8px;
  }

  /* 孤立/未引用卡片的底边同样转暖色，否则四边里只有底边是灰的 */
  &.is-unreferenced.is-last-in-group {
    border-bottom-color: rgba(245, 158, 11, 0.35);
  }

  /* 孤立/未引用卡片的淡琥珀底色（放在悬浮与选中态之前） */
  &.is-unreferenced {
    background-color: rgba(245, 158, 11, 0.02);
  }

  &:hover {
    background-color: var(--b3-theme-background-light);

    .asset-title-text {
      color: var(--b3-theme-primary);
    }
  }

  &.is-selected {
    background-color: var(--am-primary-subtle);

    &:hover {
      background-color: var(--am-primary-hover);
    }

    .asset-title-text {
      color: var(--b3-theme-primary);
      font-weight: 700;
    }
  }
}

/* 列宽分配与严格表头对齐 */
.col-checkbox {
  width: 32px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  box-sizing: border-box;
}

.am-checkbox {
  cursor: pointer;
  width: 15px;
  height: 15px;
  margin: 0;
  accent-color: var(--b3-theme-primary);
}

.col-preview {
  width: 48px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  box-sizing: border-box;
}

.col-name {
  flex: 1;
  min-width: 0;
  padding-right: 14px;
  box-sizing: border-box;
}

.col-ext {
  width: 75px;
  flex-shrink: 0;
  box-sizing: border-box;
}

.col-size {
  width: 85px;
  flex-shrink: 0;
  box-sizing: border-box;
}

.col-updated {
  width: 155px;
  flex-shrink: 0;
  font-size: 12px;
}

.col-actions {
  width: 165px;
  flex-shrink: 0;
  text-align: right;
  box-sizing: border-box;
}

.asset-preview {
  width: 38px;
  height: 38px;
  border-radius: 4px;
  overflow: hidden;
  background-color: var(--b3-theme-surface);
  border: 1px solid var(--b3-theme-surface-lighter);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  flex-shrink: 0;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

.preview-loading {
  font-size: 11px;
  color: var(--b3-theme-on-surface-light);
}

.preview-badge {
  position: absolute;
  bottom: 2px;
  right: 2px;
  font-size: 9px;
  line-height: 1;
  padding: 1px 3px;
  border-radius: 2px;
  font-weight: 600;
  letter-spacing: 0.2px;
  user-select: none;
  background: transparent !important;
  cursor: help;
  z-index: 2;

  &--reedit {
    color: var(--b3-theme-primary);
    border: 1px solid var(--b3-theme-primary);
  }

  &--original {
    color: var(--am-badge-original-color, #d97706);
    border: 1px solid var(--am-badge-original-color, #d97706);
  }
}

.file-icon {
  font-size: 10px;
  font-weight: 700;
  color: var(--b3-theme-on-surface-light);
}

.asset-name {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.asset-title-text {
  font-size: 13px;
  color: var(--b3-theme-on-background);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 600;
  min-width: 0;
  transition: color 0.15s ease;
}

.multi-ref-badge {
  font-size: 10px;
  line-height: 1.2;
  padding: 1px 5px;
  border-radius: 3px;
  font-weight: 500;
  color: var(--am-cat-doc, #2563eb);
  background-color: color-mix(in srgb, var(--am-cat-doc, #2563eb) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--am-cat-doc, #2563eb) 30%, transparent);
  flex-shrink: 0;
}

.asset-badge-icon-wrapper {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

.asset-badge-icon--reedit {
  color: var(--b3-theme-primary);
}

.asset-badge-icon--original {
  color: var(--am-badge-original-color, #d97706);
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
  gap: 4px;
  /* 渐进式呈现：未悬停时淡化 */
  opacity: 0.25;
  transition: opacity 0.15s ease;
}

.asset-item:hover .asset-actions,
.asset-item.is-selected .asset-actions {
  opacity: 1;
}

/* 操作图标按钮统一样式 */
.am-btn--icon {
  width: 28px;
  height: 28px;
  padding: 0;
  background-color: transparent;
  color: var(--b3-theme-on-surface-light);
  border: 1px solid transparent;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background-color: var(--am-surface-hover);
    color: var(--b3-theme-on-surface);
  }

  :deep(svg),
  svg {
    fill: none !important;
    stroke: currentColor !important;
  }
}

.am-btn--icon-primary {
  &:hover {
    color: var(--b3-theme-primary);
    background-color: var(--am-primary-subtle);
  }
}

.am-btn--icon-danger {
  &:hover {
    color: var(--b3-theme-error);
    background-color: var(--am-error-subtle);
  }
}
</style>

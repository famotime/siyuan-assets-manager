<template>
  <div ref="containerEl" class="assets-manager-container" style="position: relative;">
    <div class="header" :class="{ 'header--tab': isTabMode }">
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
        <template v-else>
          <button
            class="am-btn am-btn--outline"
            @click="handleOpenDeduplicate"
            style="margin-right: 4px;"
            title="识别疑似重复资源与视觉相似图片，比对后一键归一化合并"
          >
            去重
          </button>
          <button
            class="am-btn am-btn--danger"
            @click="handleUnifiedCleanup"
            style="margin-right: 4px;"
            title="综合清理所有未引用的孤儿资源与孤立底图"
          >
            清理
          </button>
        </template>
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
        ref="virtualListRef"
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

    <!-- 限制在当前界面内的悬浮资源预览弹窗 (支持图片、MP4 视频与 MP3/常见音频) -->
    <div
      v-if="previewUrl"
      class="asset-hover-preview image-hover-preview"
      :class="{
        'is-interactive': previewType === 'audio',
        'is-video': previewType === 'video',
        'is-audio': previewType === 'audio'
      }"
      :style="previewStyle"
      @mouseenter="cancelHidePreview"
      @mouseleave="scheduleHidePreview(0)"
    >
      <!-- 图片预览 -->
      <img v-if="previewType === 'image'" :src="previewUrl" alt="预览图" />

      <!-- 视频预览 (静音循环自动播放) -->
      <video
        v-else-if="previewType === 'video'"
        ref="videoPreviewEl"
        :src="previewUrl"
        autoplay
        loop
        muted
        playsinline
      ></video>

      <!-- 音频预览卡片 -->
      <div v-else-if="previewType === 'audio'" class="audio-preview-card">
        <div class="audio-card-header">
          <!-- 播放/暂停控制大按钮 -->
          <button
            class="audio-play-btn"
            :class="{ 'is-playing': isAudioPlaying }"
            @click.stop="toggleAudioPlay"
            :title="isAudioPlaying ? '暂停试听' : '点击试听'"
          >
            <Pause v-if="isAudioPlaying" :size="16" />
            <Play v-else :size="16" class="play-icon-offset" />
          </button>

          <div class="audio-info">
            <div class="audio-title" :title="previewAsset?.name">
              {{ previewAsset ? splitFileName(previewAsset.name).name : '' }}
            </div>
            <div class="audio-meta">
              <span class="audio-timer">{{ formatMediaTime(audioCurrentTime) }} / {{ formatMediaTime(audioDuration) }}</span>
              <span v-if="audioMuted" class="audio-muted-badge">已静音</span>
              <span
                v-else-if="audioBlocked && !isAudioPlaying"
                class="audio-hint-badge"
                @click.stop="toggleAudioPlay"
                title="受浏览器策略限制需点击一次后播放"
              >点击播放</span>
              <span v-else-if="audioLoadError" class="audio-error-badge">加载失败</span>
            </div>
          </div>

          <button
            class="audio-mute-btn"
            :class="{ 'is-muted': audioMuted }"
            @click.stop="toggleAudioMute"
            :title="audioMuted ? '取消静音 (恢复声音)' : '静音'"
          >
            <VolumeX v-if="audioMuted" :size="16" />
            <Volume2 v-else :size="16" />
          </button>
        </div>

        <!-- 动态声波效果条 (仅在实际播放且未静音时律动) -->
        <div
          class="audio-waveform-bars"
          :class="{ 'is-playing': isAudioPlaying, 'is-muted': audioMuted }"
          @click.stop="toggleAudioPlay"
          :title="isAudioPlaying ? '点击暂停' : '点击播放试听'"
        >
          <span class="bar bar-1"></span>
          <span class="bar bar-2"></span>
          <span class="bar bar-3"></span>
          <span class="bar bar-4"></span>
          <span class="bar bar-5"></span>
          <span class="bar bar-6"></span>
          <span class="bar bar-7"></span>
          <span class="bar bar-8"></span>
        </div>

        <audio
          ref="audioPreviewEl"
          :src="previewUrl"
          preload="auto"
          :muted="audioMuted"
          @loadedmetadata="handleAudioLoadedMetadata"
          @canplay="handleAudioCanPlay"
          @timeupdate="handleAudioTimeUpdate"
          @play="isAudioPlaying = true"
          @pause="isAudioPlaying = false"
          @ended="isAudioPlaying = false"
          @error="handleAudioError"
        ></audio>
      </div>
    </div>

    <!-- 去重比对弹窗 -->
    <DeduplicateDialog
      v-model:visible="deduplicateVisible"
      :assets="assets"
      @completed="loadData"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue';
import { openTab } from 'siyuan';
import { Files, Image, FileText, Music, Video, Archive, Volume2, VolumeX, Play, Pause, AlertCircle } from 'lucide-vue-next';
import { getAllAssetsInfo, deleteAssetFile, countReferencedDocs, type AssetInfo } from '../utils/siyuan-db';
import { deleteOriginalImage, readOriginalImage, normalizeOriginalStoragePath } from '../utils/file-system';
import { removeAssetFromBlocks } from '../utils/siyuan-block';
import {
  calculateBatchDeleteSummary,
  calculateCategoryStats,
  calculateTotalCleanup,
  filterAssets,
  formatAssetSize,
  isImageAsset,
  isPlayableAudioAsset,
  isPlayableVideoAsset,
  sortAssets,
  splitFileName,
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
import DeduplicateDialog from './DeduplicateDialog.vue';

const props = withDefaults(
  defineProps<{
    isTabMode?: boolean;
  }>(),
  {
    isTabMode: false,
  }
);

const assets = ref<AssetInfo[]>([]);
const loading = ref(false);
const deduplicateVisible = ref(false);
const searchQuery = ref('');
const filterType = ref<AssetFilterType>('all');
const activeCategory = ref<AssetCategory>('all');

function handleOpenDeduplicate() {
  deduplicateVisible.value = true;
}

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
const virtualListRef = ref<any>(null);

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

const videoPreviewEl = ref<HTMLVideoElement | null>(null);
const audioPreviewEl = ref<HTMLAudioElement | null>(null);

// 音频试听静音状态 (全局记忆持久化)
const AUDIO_MUTED_STORAGE_KEY = 'siyuan-assets-manager-audio-preview-muted';
const audioMuted = ref(localStorage.getItem(AUDIO_MUTED_STORAGE_KEY) === 'true');

function toggleAudioMute() {
  audioMuted.value = !audioMuted.value;
  try {
    localStorage.setItem(AUDIO_MUTED_STORAGE_KEY, String(audioMuted.value));
  } catch (e) {}
  if (audioPreviewEl.value) {
    audioPreviewEl.value.muted = audioMuted.value;
  }
}

const audioCurrentTime = ref(0);
const audioDuration = ref(0);
const isAudioPlaying = ref(false);
const audioBlocked = ref(false);
const audioLoadError = ref(false);

async function startAudioPlayback() {
  if (!audioPreviewEl.value) return;
  const el = audioPreviewEl.value;
  el.volume = 0.6;
  el.muted = audioMuted.value;
  try {
    await el.play();
    isAudioPlaying.value = true;
    audioBlocked.value = false;
    audioLoadError.value = false;
  } catch (err) {
    console.warn('[AssetsManager] Audio play failed or blocked:', err);
    isAudioPlaying.value = false;
    audioBlocked.value = true;
  }
}

function toggleAudioPlay() {
  if (!audioPreviewEl.value) return;
  if (isAudioPlaying.value) {
    audioPreviewEl.value.pause();
    isAudioPlaying.value = false;
  } else {
    startAudioPlayback();
  }
}

function handleAudioLoadedMetadata() {
  if (audioPreviewEl.value) {
    audioDuration.value = audioPreviewEl.value.duration || 0;
    audioPreviewEl.value.volume = 0.6;
    audioPreviewEl.value.muted = audioMuted.value;
    startAudioPlayback();
  }
}

function handleAudioCanPlay() {
  if (!isAudioPlaying.value && !audioBlocked.value) {
    startAudioPlayback();
  }
}

function handleAudioError(e: Event) {
  console.warn('[AssetsManager] Audio loading error:', e);
  audioLoadError.value = true;
  isAudioPlaying.value = false;
}

function handleAudioTimeUpdate() {
  if (audioPreviewEl.value) {
    audioCurrentTime.value = audioPreviewEl.value.currentTime;
    if (!audioDuration.value && audioPreviewEl.value.duration) {
      audioDuration.value = audioPreviewEl.value.duration;
    }
  }
}

function formatMediaTime(seconds: number): string {
  if (!seconds || isNaN(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function handleSelectionChange(nextSet: Set<string>) {
  selectedNames.value = nextSet;
}

function clearSelection() {
  selectedNames.value = new Set<string>();
}

function cleanupPreview() {
  if (videoPreviewEl.value) {
    try {
      videoPreviewEl.value.pause();
      videoPreviewEl.value.removeAttribute('src');
      videoPreviewEl.value.load();
    } catch (e) {}
  }
  if (audioPreviewEl.value) {
    try {
      audioPreviewEl.value.pause();
      audioPreviewEl.value.removeAttribute('src');
      audioPreviewEl.value.load();
    } catch (e) {}
  }
  if (previewBlobUrl) {
    URL.revokeObjectURL(previewBlobUrl);
    previewBlobUrl = null;
  }
  previewUrl.value = '';
  previewType.value = null;
  previewAsset.value = null;
  audioCurrentTime.value = 0;
  audioDuration.value = 0;
  isAudioPlaying.value = false;
  audioBlocked.value = false;
  audioLoadError.value = false;
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

  if (!isImg && !isVid && !isAud) return;

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
      audioBlocked.value = false;
      audioLoadError.value = false;
      isAudioPlaying.value = false;
      nextTick(() => {
        startAudioPlayback();
      });
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
  // 当音频卡片已展示时，固定坐标不再跟手乱晃，以便用户鼠标平滑移入卡片进行交互
  if (previewUrl.value && previewType.value !== 'audio') {
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
  // 如果是可交互的音频卡片，提供 200ms 缓冲桥接延时，方便鼠标平滑移入卡片点击静音
  if (previewType.value === 'audio') {
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
    loadData();
  }
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
    (window as any)._siyuan_assets_manager_open_rename(asset);
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
  width: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 12px;
  padding-right: 40px; /* 为右上角关闭按钮预留空间，防止重叠 */

  &--tab {
    padding-right: 0;
  }
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

.asset-hover-preview,
.image-hover-preview {
  position: absolute;
  z-index: 9999;
  pointer-events: none;
  background-color: var(--b3-theme-background-light);
  border: 1px solid var(--b3-theme-surface-lighter);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
  padding: 6px;
  display: block;
  overflow: hidden;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-sizing: border-box;
  animation: am-preview-fade-in 0.15s ease-out;

  &.is-interactive {
    pointer-events: auto;
  }

  img {
    display: block;
    max-width: 400px;
    max-height: 400px;
    width: auto;
    height: auto;
    border-radius: 4px;
  }

  video {
    display: block;
    max-width: 420px;
    max-height: 380px;
    width: auto;
    height: auto;
    border-radius: 4px;
    background-color: #000;
  }

  /* 音频试听精致卡片 */
  .audio-preview-card {
    width: 310px;
    padding: 10px 12px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .audio-card-header {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .audio-play-btn {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background-color: var(--b3-theme-primary);
    color: var(--b3-theme-on-primary);
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s;
    flex-shrink: 0;
    box-shadow: 0 2px 8px rgba(66, 133, 244, 0.35);

    &:hover {
      transform: scale(1.06);
      filter: brightness(1.1);
    }

    &:active {
      transform: scale(0.96);
    }

    .play-icon-offset {
      margin-left: 2px;
    }

    &.is-playing {
      background-color: var(--b3-theme-primary);
      animation: audioPulse 2s infinite;
    }
  }

  .audio-info {
    flex: 1;
    min-width: 0;
  }

  .audio-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--b3-theme-on-background);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.4;
  }

  .audio-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 2px;
    font-size: 11px;
    color: var(--b3-theme-on-surface-light);
  }

  .audio-timer {
    font-variant-numeric: tabular-nums;
  }

  .audio-muted-badge {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
    border-radius: 3px;
    padding: 1px 4px;
    font-size: 10px;
    line-height: 1.4;
  }

  .audio-hint-badge {
    background: rgba(66, 133, 244, 0.15);
    color: var(--b3-theme-primary);
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 10px;
    line-height: 1.4;
    cursor: pointer;
    font-weight: 500;
    transition: background-color 0.15s;

    &:hover {
      background: rgba(66, 133, 244, 0.28);
    }
  }

  .audio-error-badge {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 10px;
    line-height: 1.4;
  }

  .audio-mute-btn {
    background: transparent;
    border: 1px solid var(--b3-theme-surface-lighter);
    color: var(--b3-theme-on-surface);
    border-radius: 6px;
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s;
    flex-shrink: 0;

    &:hover {
      background-color: var(--b3-theme-surface-lighter);
      color: var(--b3-theme-primary);
    }

    &.is-muted {
      color: #ef4444;
      border-color: rgba(239, 68, 68, 0.4);
      background-color: rgba(239, 68, 68, 0.08);
    }
  }

  /* 律动音波动画条 (仅在实际播放且未静音时律动) */
  .audio-waveform-bars {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    height: 20px;
    padding: 0 4px;
    gap: 3px;
    cursor: pointer;
    border-radius: 4px;
    transition: background-color 0.2s;

    &:hover {
      background-color: rgba(66, 133, 244, 0.06);
    }

    .bar {
      flex: 1;
      background-color: var(--b3-theme-primary);
      border-radius: 2px;
      height: 4px;
      min-height: 3px;
      opacity: 0.4;
      transition: height 0.2s ease, opacity 0.2s ease;
    }

    &.is-playing:not(.is-muted) {
      .bar {
        opacity: 1;
        animation: soundWave 1.1s ease-in-out infinite alternate;
      }
      .bar-1 { height: 35%; animation-delay: 0.1s; }
      .bar-2 { height: 80%; animation-delay: 0.35s; }
      .bar-3 { height: 45%; animation-delay: 0.5s; }
      .bar-4 { height: 95%; animation-delay: 0.2s; }
      .bar-5 { height: 60%; animation-delay: 0.65s; }
      .bar-6 { height: 85%; animation-delay: 0.4s; }
      .bar-7 { height: 40%; animation-delay: 0.75s; }
      .bar-8 { height: 70%; animation-delay: 0.25s; }
    }

    &.is-muted .bar {
      animation: none !important;
      height: 3px !important;
      opacity: 0.35;
      background-color: var(--b3-theme-on-surface-light);
    }
  }
}

@keyframes soundWave {
  0% {
    height: 15%;
  }
  100% {
    height: 100%;
  }
}

@keyframes am-preview-fade-in {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
</style>

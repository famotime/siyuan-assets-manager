<template>
  <div v-if="visible" class="am-dialog-overlay" style="z-index: 1050;">
    <div class="am-dialog deduplicate-dialog-content">
      <!-- 弹窗头部 -->
      <div class="am-dialog__header">
        <div class="dedup-header-title">
          <svg class="dedup-title-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="fill: none !important;">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          <h3>去重比对</h3>
          <div class="dedup-tab-group">
            <button
              class="dedup-tab-btn"
              :class="{ 'is-active': activeTab === 'exact' }"
              @click="activeTab = 'exact'"
            >
              精确相同
              <span class="dedup-tab-badge">{{ pendingExactGroups.length }}</span>
            </button>
            <button
              class="dedup-tab-btn"
              :class="{ 'is-active': activeTab === 'similar' }"
              @click="activeTab = 'similar'"
            >
              视觉相似
              <span class="dedup-tab-badge">{{ pendingSimilarGroups.length }}</span>
            </button>
          </div>
        </div>

        <div class="dedup-header-actions">
          <span v-if="lastScanTimeText" class="last-scan-badge" :title="`上次分析完成时间: ${lastScanTimeText}`">
            上次分析: {{ lastScanTimeText }}
          </span>

          <!-- 大图最大化模式切换开关 -->
          <button
            class="am-btn am-btn--sm"
            :class="maximizeImages ? 'am-btn--primary' : 'am-btn--outline'"
            @click="maximizeImages = !maximizeImages"
            :title="maximizeImages ? '点击切换回标准视图（显示详细属性与引用文档）' : '点击开启大图模式（去除说明信息，最大化图片比对显示）'"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" style="fill: none !important;">
              <path v-if="!maximizeImages" d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
              <path v-else d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7"/>
            </svg>
            <span>大图</span>
          </button>

          <button
            class="am-btn am-btn--outline am-btn--sm"
            @click="handleManualRefresh"
            :disabled="isScanning || isMerging"
            title="增量扫描：仅重算新增或已变更的文件"
          >
            <svg class="icon" :class="{ spinning: isScanning }" width="14" height="14" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" style="fill: none !important;">
              <path d="M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8z"/>
            </svg>
            <span>扫描</span>
          </button>

          <!-- 相似度阈值滑块 (仅在视觉相似 Tab 显示) -->
          <div v-if="activeTab === 'similar'" class="similarity-slider-box" title="调节视觉相似度判定阈值">
            <span class="slider-label">相似度:</span>
            <input
              type="range"
              min="80"
              max="100"
              step="1"
              v-model.number="similarityThreshold"
              @change="handleThresholdChange"
              class="slider-input"
            />
            <span class="slider-val">{{ similarityThreshold }}%</span>
          </div>

          <button class="am-dialog__close" @click="handleClose" aria-label="关闭">
            <svg width="20" height="20" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" style="fill: none !important;">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- 扫描进度条 (扫描中展示) -->
      <div v-if="isScanning" class="dedup-scan-banner">
        <div class="scan-info">
          <svg class="icon spinning" width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" style="fill: none !important;">
            <path d="M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8z"/>
          </svg>
          <span>{{ scanProgress.message || '正在扫描重复资源...' }}</span>
          <span class="scan-percent">({{ Math.round(scanProgressPercent) }}%)</span>
        </div>
        <div class="scan-progress-bar-wrap">
          <div class="scan-progress-bar-fill" :style="{ width: `${scanProgressPercent}%` }"></div>
        </div>
        <button class="am-btn am-btn--ghost am-btn--sm" @click="handleCancelScan">取消扫描</button>
      </div>

      <!-- 弹窗主体 -->
      <div class="am-dialog__body dedup-dialog-body" v-if="!isScanning">
        <!-- 无重复状态 -->
        <div v-if="displayGroups.length === 0" class="dedup-empty-state">
          <div class="empty-icon">
            <Sparkles :size="36" style="fill: none !important; color: var(--b3-theme-primary);" />
          </div>
          <h4>未发现{{ activeTab === 'exact' ? '精确相同' : '视觉相似' }}的重复资源</h4>
          <p>当前没有多余冗余文件需要归一化，您的资源库非常整洁。</p>
          <button class="am-btn am-btn--primary" @click="handleRebuildIndex">重建指纹索引</button>
        </div>

        <!-- 左右分栏视图 -->
        <div v-else class="dedup-split-layout">
          <!-- 左侧：重复分组列表 -->
          <div class="dedup-sidebar">
            <div class="dedup-sidebar-header">
              <input
                v-model="groupSearchQuery"
                type="text"
                placeholder="搜索重复文件名..."
                class="am-input dedup-search-input"
              />
            </div>
            <div class="dedup-group-list">
              <div
                v-for="group in filteredDisplayGroups"
                :key="group.id"
                class="dedup-group-item"
                :class="{
                  'is-active': selectedGroupId === group.id,
                  'is-processed': group.isProcessed,
                  'is-ignored': group.isIgnored,
                }"
                @click="selectedGroupId = group.id"
              >
                <div class="group-item-thumb">
                  <img
                    v-if="isImageFile(group.canonicalAssetName)"
                    :src="`/assets/${group.canonicalAssetName}`"
                    alt="thumb"
                    loading="lazy"
                  />
                  <div v-else class="thumb-badge-placeholder">
                    {{ getAssetBadgeText(group.canonicalAssetName) }}
                  </div>
                </div>
                <div class="group-item-info">
                  <div class="group-item-title-row">
                    <span class="group-item-title">{{ group.canonicalAssetName }}</span>
                  </div>
                  <div class="group-item-meta">
                    <span class="group-tag count-tag">{{ group.items.length }} 个文件</span>
                    <span
                      class="group-tag sim-tag"
                      :class="group.mode === 'exact' ? 'exact-sim' : 'similar-sim'"
                    >
                      {{ group.mode === 'exact' ? '100% 相同' : `${Math.round(group.similarity * 100)}% 相似` }}
                    </span>
                  </div>
                  <div class="group-item-saving">
                    可释放: <strong>{{ formatAssetSize(group.redundantSize) }}</strong>
                    <span v-if="group.isProcessed" class="status-badge status-processed">已合并</span>
                    <span v-else-if="group.isIgnored" class="status-badge status-ignored">已忽略</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 右侧：当前组比对与确认详情区 -->
          <div class="dedup-detail-area" v-if="currentSelectedGroup">
            <!-- 组顶部操作栏 -->
            <div class="detail-action-bar">
              <div class="detail-action-left">
                <span class="detail-group-badge">
                  {{ currentSelectedGroup.mode === 'exact' ? '精确重复组' : '疑似相似组' }}
                </span>
                <span class="detail-group-sim">
                  相似度: <strong>{{ currentSelectedGroup.mode === 'exact' ? '100%' : `${Math.round(currentSelectedGroup.similarity * 100)}%` }}</strong>
                </span>
                <span class="detail-group-count">
                  共 {{ currentSelectedGroup.items.length }} 个文件，归一化可释放 {{ formatAssetSize(currentSelectedGroup.redundantSize) }}
                </span>
              </div>
              <div class="detail-action-right">
                <button
                  v-if="!currentSelectedGroup.isProcessed && !currentSelectedGroup.isIgnored"
                  class="am-btn am-btn--ghost am-btn--sm"
                  @click="handleIgnoreGroup(currentSelectedGroup)"
                  title="跳过并忽略此组去重"
                >
                  忽略此组
                </button>
                <button
                  v-if="currentSelectedGroup.isIgnored"
                  class="am-btn am-btn--ghost am-btn--sm"
                  @click="handleUnignoreGroup(currentSelectedGroup)"
                  title="恢复此组为待处理状态"
                >
                  取消忽略
                </button>
                <button
                  v-if="!currentSelectedGroup.isProcessed"
                  class="am-btn am-btn--primary am-btn--sm"
                  @click="handleMergeSingleGroup(currentSelectedGroup)"
                  title="将本组多余文件引用替换为主文件并删除冗余"
                >
                  合并当前组
                </button>
                <span v-else class="processed-text">
                  <CheckCircle2 :size="14" style="fill: none !important; margin-right: 4px; display: inline-block; vertical-align: middle;" />
                  <span>该组已成功归一化合并</span>
                </span>
              </div>
            </div>

            <!-- 多文件并排比对画廊 -->
            <div class="detail-compare-gallery" :class="{ 'is-maximized-gallery': maximizeImages }">
              <div
                v-for="item in currentSelectedGroup.items"
                :key="item.asset.name"
                class="compare-card"
                :class="{
                  'is-canonical': item.isCanonical,
                  'is-maximized-card': maximizeImages
                }"
              >
                <!-- 卡片顶部：单选主资源标记 -->
                <div class="compare-card-header" @click="handleSetCanonical(currentSelectedGroup, item.asset.name)">
                  <label class="radio-label">
                    <input
                      type="radio"
                      :name="`canonical_${currentSelectedGroup.id}`"
                      :checked="item.isCanonical"
                      @change="handleSetCanonical(currentSelectedGroup, item.asset.name)"
                    />
                    <span class="radio-custom"></span>
                    <strong class="canonical-text">{{ item.isCanonical ? '保留为主文件' : '设为主文件' }}</strong>
                  </label>
                  <div class="header-right-badges">
                    <span
                      v-if="maximizeImages"
                      class="compact-meta-badge"
                      :title="`${item.asset.name} (${item.width && item.height ? `${item.width}×${item.height}, ` : ''}${formatAssetSize(item.asset.size)})`"
                    >
                      {{ formatAssetSize(item.asset.size) }}
                    </span>
                    <span
                      v-if="isItemTopRecommendation(currentSelectedGroup, item)"
                      class="recom-badge"
                      title="根据引用量、是否可二次编辑和分辨率等综合算法推荐"
                    >
                      推荐保留
                    </span>
                  </div>
                </div>

                <!-- 图片 / 文件预览区 -->
                <div class="compare-card-preview" :class="{ 'is-maximized-preview': maximizeImages }">
                  <img
                    v-if="isImageFile(item.asset.name)"
                    :src="`/assets/${item.asset.name}`"
                    :alt="item.asset.name"
                    class="preview-img"
                    loading="lazy"
                  />
                  <div v-else class="preview-non-image">
                    <div class="non-image-badge">{{ getAssetBadgeText(item.asset.name) }}</div>
                  </div>

                  <!-- 大图模式下的底部紧凑半透明文件名提示条 -->
                  <div v-if="maximizeImages" class="maximized-floating-bar" :title="item.asset.name">
                    <span class="maximized-filename">{{ item.asset.name }}</span>
                    <span class="maximized-res" v-if="item.width && item.height">{{ item.width }} × {{ item.height }}</span>
                  </div>
                </div>

                <!-- 属性元数据表格 (非大图模式显示) -->
                <div class="compare-card-meta" v-if="!maximizeImages">
                  <div class="meta-row">
                    <span class="meta-key">文件名:</span>
                    <span class="meta-val filename-val" :title="item.asset.name">{{ item.asset.name }}</span>
                  </div>
                  <div class="meta-row" v-if="item.width && item.height">
                    <span class="meta-key">分辨率:</span>
                    <span class="meta-val highlight-val">{{ item.width }} × {{ item.height }}</span>
                  </div>
                  <div class="meta-row">
                    <span class="meta-key">文件体积:</span>
                    <span class="meta-val">{{ formatAssetSize(item.asset.size) }}</span>
                  </div>
                  <div class="meta-row">
                    <span class="meta-key">引用统计:</span>
                    <span class="meta-val">
                      <strong>{{ item.asset.refCount || 0 }}</strong> 处引用 ({{ item.asset.docCount || 0 }} 篇文档)
                    </span>
                  </div>
                  <div class="meta-row" v-if="item.asset.isReEditable">
                    <span class="meta-key">二次编辑:</span>
                    <span class="meta-val"><span class="reedit-tag">可二次编辑</span></span>
                  </div>
                  <div class="meta-row">
                    <span class="meta-key">更新时间:</span>
                    <span class="meta-val time-val">{{ formatAssetTime(item.asset.updated) }}</span>
                  </div>
                </div>

                <!-- 文档引用列表折叠 (非大图模式显示) -->
                <div class="compare-card-refs" v-if="!maximizeImages && docGroups(item.asset).length > 0">
                  <div class="refs-header">被以下文档引用 ({{ docGroups(item.asset).length }}):</div>
                  <div class="refs-list">
                    <div
                      v-for="group in docGroups(item.asset).slice(0, 3)"
                      :key="group.rootId"
                      class="ref-item"
                      :title="`点击在后台打开文档: ${group.first.readablePath || group.first.hpath || group.first.path || group.first.id}`"
                      @click="handleOpenDocRef(group.first)"
                    >
                      <span class="ref-path">
                        <FileText :size="12" style="fill: none !important; margin-right: 4px; display: inline-block; vertical-align: middle;" />
                        <span>{{ group.first.readablePath || group.first.hpath || group.first.path || group.first.id }}</span>
                      </span>
                      <span v-if="group.refs.length > 1" class="ref-count">（{{ group.refs.length }} 处）</span>
                    </div>
                    <div v-if="docGroups(item.asset).length > 3" class="ref-more">
                      ...等共 {{ docGroups(item.asset).length }} 篇文档
                    </div>
                  </div>
                </div>
                <div v-else-if="!maximizeImages" class="compare-card-refs is-empty">
                  <span class="orphan-tag">孤儿文件 (无任何文档引用)</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 弹窗底部汇总与批量操作栏 -->
      <div class="am-dialog__footer dedup-footer">
        <div class="footer-stats" v-if="!isScanning && displayGroups.length > 0">
          <span>
            共发现 <strong>{{ pendingGroups.length }}</strong> 组待处理重复，包含 <strong>{{ totalRedundantCount }}</strong> 个冗余文件，预计可释放 <strong>{{ totalReclaimableSizeText }}</strong> 存储空间。
          </span>
        </div>
        <div class="footer-actions">
          <button
            class="am-btn am-btn--ghost"
            @click="startScan(true)"
            :disabled="isScanning || isMerging"
            title="增量扫描：仅重算新增或已变更的文件"
          >
            重新扫描
          </button>
          <button
            class="am-btn am-btn--ghost"
            @click="handleRebuildIndex"
            :disabled="isScanning || isMerging"
            title="清空指纹缓存并重算全部文件（耗时较长，不会修改任何文件）"
          >
            重建索引
          </button>
          <button
            v-if="pendingGroups.length > 0"
            class="am-btn am-btn--ghost"
            @click="handleIgnoreAll"
            :disabled="isScanning || isMerging"
            title="忽略所有剩余重复组"
          >
            全部忽略
          </button>
          <button
            v-if="pendingGroups.length > 0"
            class="am-btn am-btn--primary"
            @click="handleBatchMerge"
            :disabled="isScanning || isMerging"
            title="批量一键将所有重复组归一化合并并删除冗余文件"
          >
            <svg v-if="isMerging" class="icon spinning" width="14" height="14" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" style="fill: none !important;"><path d="M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8z"/></svg>
            <span v-if="isMerging">正在归一化 ({{ mergeProgress.current }}/{{ mergeProgress.total }})...</span>
            <span v-else>一键批量归一化 ({{ pendingGroups.length }}组)</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { openTab } from 'siyuan';
import { Sparkles, CheckCircle2, FileText } from 'lucide-vue-next';
import { usePlugin } from '../main';
import type { AssetInfo, BlockRef } from '../utils/siyuan-db';
import {
  isImageFile,
  scanDuplicates,
  normalizeDuplicateGroup,
  batchNormalizeDuplicateGroups,
  saveDeduplicateCache,
  loadDeduplicateCache,
  carryOverGroupState,
  DEDUP_CACHE_VERSION,
  type IDuplicateGroup,
  type IDuplicateItem,
  type IDeduplicateScanProgress,
  type IDeduplicateCache,
} from '../utils/deduplicate';
import {
  loadFingerprintStore,
  saveFingerprintStore,
  clearFingerprintStore,
} from '../utils/dedup-fingerprint-store';
import type { IFingerprintStore } from '../utils/dedup-fingerprint-store';
import { formatAssetSize, formatAssetTime, getAssetBadgeText, groupReferencesByDoc } from '../utils/asset-list';
import { showConfirm } from '../utils/confirm';
import { pushMsg } from '../api';
import { log, warn, error } from '../utils/logger';

const props = defineProps<{
  visible: boolean;
  assets: AssetInfo[];
}>();

const emit = defineEmits<{
  (e: 'update:visible', visible: boolean): void;
  (e: 'completed'): void;
}>();

// 模式 Tab
const activeTab = ref<'exact' | 'similar'>('exact');
// 视觉相似度阈值 (80% ~ 100%)
const similarityThreshold = ref<number>(95);
// 上次分析完成时间戳
const lastScanTime = ref<number>(0);

// 大图纯享最大化显示模式
const maximizeImages = ref<boolean>(
  typeof localStorage !== 'undefined' && localStorage.getItem('siyuan_assets_dedup_maximize_img') === 'true'
);

watch(maximizeImages, (val) => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('siyuan_assets_dedup_maximize_img', String(val));
    }
  } catch (e) {}
});

// 扫描状态
const isScanning = ref(false);
const scanProgress = ref<IDeduplicateScanProgress>({
  phase: 'grouping',
  current: 0,
  total: 0,
  message: '',
});
const abortController = ref<{ aborted: boolean }>({ aborted: false });

// 指纹存储：跨会话复用未变更文件的哈希与感知特征
const fingerprintStore = ref<IFingerprintStore | null>(null);

// 重复组数据
const exactGroups = ref<IDuplicateGroup[]>([]);
const similarGroups = ref<IDuplicateGroup[]>([]);
const selectedGroupId = ref<string>('');
const groupSearchQuery = ref<string>('');

// 归一化执行状态
const isMerging = ref(false);
const mergeProgress = ref({ current: 0, total: 0 });

// 格式化上次分析时间
const lastScanTimeText = computed(() => {
  return lastScanTime.value > 0 ? formatAssetTime(lastScanTime.value) : '';
});

// 计算扫描百分比
const scanProgressPercent = computed(() => {
  if (!scanProgress.value.total || scanProgress.value.total <= 0) return 0;
  return Math.min(100, Math.max(0, (scanProgress.value.current / scanProgress.value.total) * 100));
});

// 当前 Tab 下的所有组
const displayGroups = computed(() => {
  return activeTab.value === 'exact' ? exactGroups.value : similarGroups.value;
});

// 待处理组 (未合并且未忽略)
const pendingExactGroups = computed(() => exactGroups.value.filter(g => !g.isProcessed && !g.isIgnored));
const pendingSimilarGroups = computed(() => similarGroups.value.filter(g => !g.isProcessed && !g.isIgnored));
const pendingGroups = computed(() => {
  return activeTab.value === 'exact' ? pendingExactGroups.value : pendingSimilarGroups.value;
});

// 过滤后的组列表 (左侧展示)
const filteredDisplayGroups = computed(() => {
  const query = groupSearchQuery.value.trim().toLowerCase();
  if (!query) return displayGroups.value;
  return displayGroups.value.filter(g => {
    return g.items.some(item => item.asset.name.toLowerCase().includes(query));
  });
});

// 当前选中的组对象
const currentSelectedGroup = computed(() => {
  return displayGroups.value.find(g => g.id === selectedGroupId.value) || displayGroups.value[0] || null;
});

// 待释放空间与冗余文件数统计
const totalRedundantCount = computed(() => {
  return pendingGroups.value.reduce((acc, g) => acc + g.redundantCount, 0);
});

const totalReclaimableBytes = computed(() => {
  return pendingGroups.value.reduce((acc, g) => acc + g.redundantSize, 0);
});

const totalReclaimableSizeText = computed(() => {
  return formatAssetSize(totalReclaimableBytes.value);
});

// 监听弹窗打开：优先读取持久化分析缓存，避免重复分析
watch(
  () => props.visible,
  (newVal) => {
    if (newVal) {
      initDialogData();
    } else {
      handleCancelScan();
    }
  }
);

// 监听 Tab 切换，默认选中第一个组
watch(
  () => activeTab.value,
  () => {
    nextTick(() => {
      const first = displayGroups.value[0];
      if (first) {
        selectedGroupId.value = first.id;
      }
    });
  }
);

/**
 * 初始化弹窗数据：优先加载持久化分析缓存
 */
async function initDialogData() {
  if (isScanning.value) return;

  try {
    const cached = await loadDeduplicateCache();
    if (cached && (cached.exactGroups?.length > 0 || cached.similarGroups?.length > 0 || cached.lastScanTime > 0)) {
      exactGroups.value = cached.exactGroups || [];
      similarGroups.value = cached.similarGroups || [];
      similarityThreshold.value = cached.similarityThreshold || 95;
      lastScanTime.value = cached.lastScanTime || 0;

      // 智能聚焦有待处理项的 Tab
      const hasExactPending = exactGroups.value.some(g => !g.isProcessed && !g.isIgnored);
      const hasSimilarPending = similarGroups.value.some(g => !g.isProcessed && !g.isIgnored);
      if (!hasExactPending && hasSimilarPending) {
        activeTab.value = 'similar';
      } else {
        activeTab.value = 'exact';
      }

      const firstGroup = displayGroups.value[0] || (activeTab.value === 'exact' ? similarGroups.value[0] : exactGroups.value[0]);
      if (firstGroup) {
        selectedGroupId.value = firstGroup.id;
      }
      return;
    }
  } catch (err) {
    warn('[DeduplicateDialog] 加载持久化缓存失败，回退自动扫描:', err);
  }

  // 首次无缓存数据，自动触发分析
  await startScan(false);
}

/**
 * 自动同步持久化比对数据
 */
async function persistCurrentCache() {
  try {
    await saveDeduplicateCache({
      version: DEDUP_CACHE_VERSION,
      lastScanTime: lastScanTime.value,
      similarityThreshold: similarityThreshold.value,
      exactGroups: exactGroups.value,
      similarGroups: similarGroups.value,
    });
  } catch (err) {
    warn('[DeduplicateDialog] 保存持久化缓存失败:', err);
  }
}

/**
 * 启动扫描分析
 * @param forceRescan 为 true 时忽略既有分组，重新构建
 * @param forceRehash 为 true 时忽略全部指纹，全量重算（"重建索引"）
 */
async function startScan(forceRescan = false, forceRehash = false) {
  if (isScanning.value) return;
  if (!forceRescan && !forceRehash && (exactGroups.value.length > 0 || similarGroups.value.length > 0)) {
    return;
  }

  isScanning.value = true;
  // 本轮的控制器对象只此一份：handleCancelScan 改的是同一个对象的 aborted，
  // 因此取消仍然生效；而后续只读这个局部量，绝不重新读 abortController.value
  // （重扫会换掉 ref，读到新控制器便会让被作废的旧扫描误认为"未被中止"）。
  const controller = { aborted: false };
  abortController.value = controller;

  try {
    if (forceRehash) {
      await clearFingerprintStore();
      fingerprintStore.value = null;
    }

    if (!fingerprintStore.value) {
      fingerprintStore.value = await loadFingerprintStore();
    }

    // usePlugin() 的返回类型是思源基类 Plugin，其上并无 settings 字段
    // （settings 定义在 AssetsManagerPlugin 子类上）。此处 `as any` 是本仓库的既有写法，
    // 见 src/utils/logger.ts:5 与 src/components/ImageEditorDialog.vue:306。
    const plugin = usePlugin() as any;
    const res = await scanDuplicates(props.assets, {
      minSimilarity: similarityThreshold.value / 100,
      fingerprints: fingerprintStore.value || undefined,
      forceRehash,
      concurrency: {
        hash: plugin?.settings?.dedupHashConcurrency,
        decode: plugin?.settings?.dedupDecodeConcurrency,
      },
      onProgress: (prog) => {
        scanProgress.value = prog;
      },
      abortSignal: controller,
    });

    // 指纹始终落盘：中止路径下也是有效的部分成果
    fingerprintStore.value = res.fingerprints;
    const persisted = await saveFingerprintStore(res.fingerprints);
    log(
      `[DeduplicateDialog] 扫描完成：复用 ${res.stats.reused} 项指纹，重算 ${res.stats.computed} 项；指纹落盘${persisted ? '成功' : '失败'}`
    );
    if (!persisted) {
      // 只影响扫描速度，不动用户的任何资源文件——文案需与此一致，不夸大后果
      pushMsg('指纹索引未能保存，下次扫描将重新计算（不影响资源文件）');
    }

    if (!controller.aborted) {
      // 必须先快照上一轮分组：下一行就会整体替换掉它们，
      // 而"已忽略/已处理"需要按稳定组 id 延续到本轮。
      const previousGroups = [...exactGroups.value, ...similarGroups.value];
      carryOverGroupState(res.exactGroups, previousGroups);
      carryOverGroupState(res.similarGroups, previousGroups);

      exactGroups.value = res.exactGroups;
      similarGroups.value = res.similarGroups;
      lastScanTime.value = Date.now();

      const firstGroup = res.exactGroups[0] || res.similarGroups[0];
      if (firstGroup) {
        activeTab.value = res.exactGroups.length > 0 ? 'exact' : 'similar';
        selectedGroupId.value = firstGroup.id;
      }

      await persistCurrentCache();
    }
  } catch (err) {
    error('[DeduplicateDialog] 扫描重复失败:', err);
    pushMsg('扫描重复文件发生异常');
  } finally {
    isScanning.value = false;
  }
}

/**
 * 用户手动点击「扫描」按钮：增量刷新（未变更文件零读取）
 */
async function handleManualRefresh() {
  await startScan(true);
}

/**
 * 全量重建指纹索引：清空既有指纹并重算全部文件。
 * 用于哈希算法升级、或怀疑指纹陈旧时的逃生入口。
 */
async function handleRebuildIndex() {
  const ok = await showConfirm({
    title: '重建指纹索引',
    message: [
      '将清空已缓存的全部文件指纹，并重新读取、解码所有资源文件。',
      '此操作耗时较长（资源量大时可达数分钟），但不会修改或删除任何文件。',
    ].join('\n'),
    confirmText: '开始重建',
    cancelText: '取消',
    danger: false,
  });
  if (!ok) return;

  // 刻意不在此清空分组列表：startScan 会快照当前分组，把「已忽略/已处理」
  // 按稳定组 id 延续到重建结果上。先清空就等于抹掉了这份快照，
  // 用户手工忽略的组会在重建后全部复活并被 一键批量归一化 扫进去。
  // 与「扫描」「重新扫描」保持一致，重建期间列表照常可见。
  await startScan(true, true);
}

/**
 * 取消扫描
 */
function handleCancelScan() {
  if (isScanning.value) {
    abortController.value.aborted = true;
    isScanning.value = false;
  }
}

/**
 * 相似度滑块调整，重新按新阈值计算分析
 */
async function handleThresholdChange() {
  startScan(true);
}

/**
 * 手动切换组内主保留项
 */
function handleSetCanonical(group: IDuplicateGroup, canonicalName: string) {
  group.canonicalAssetName = canonicalName;
  for (const item of group.items) {
    item.isCanonical = item.asset.name === canonicalName;
  }
  // 重新计算该组的预估释放空间
  let total = 0;
  for (const item of group.items) {
    if (item.asset.name !== canonicalName) {
      total += item.asset.size || 0;
    }
  }
  group.redundantSize = total;
  persistCurrentCache();
}

/**
 * 检查是否为算法最高分推荐项
 */
function isItemTopRecommendation(group: IDuplicateGroup, item: IDuplicateItem): boolean {
  if (!group.items || group.items.length === 0) return false;
  const maxScore = Math.max(...group.items.map(it => it.score));
  return item.score === maxScore;
}

/**
 * 忽略当前组
 */
function handleIgnoreGroup(group: IDuplicateGroup) {
  group.isIgnored = true;
  persistCurrentCache();
  selectNextPendingGroup();
}

/**
 * 取消忽略
 */
function handleUnignoreGroup(group: IDuplicateGroup) {
  group.isIgnored = false;
  persistCurrentCache();
}

/**
 * 忽略所有剩余组
 */
function handleIgnoreAll() {
  for (const g of pendingGroups.value) {
    g.isIgnored = true;
  }
  persistCurrentCache();
}

/**
 * 挑选下一个待处理的组
 */
function selectNextPendingGroup() {
  const next = displayGroups.value.find(g => !g.isProcessed && !g.isIgnored);
  if (next) {
    selectedGroupId.value = next.id;
  }
}

/**
 * 合并单个重复组
 */
async function handleMergeSingleGroup(group: IDuplicateGroup) {
  try {
    const stats = await normalizeDuplicateGroup(group);
    if (stats.failedItemsCount > 0) {
      pushMsg(
        `合并部分完成：${stats.deletedFilesCount} 个冗余文件已归一化，${stats.failedItemsCount} 个未能完成（详见控制台日志）。已改写部分已记录回退日志，可在删除历史中回退。`
      );
    } else {
      pushMsg(`已完成合并！修改了 ${stats.affectedBlocksCount} 处文档引用，释放 ${formatAssetSize(stats.freedBytes)} 空间。`);
    }
    await persistCurrentCache();
    emit('completed');
    selectNextPendingGroup();
  } catch (err) {
    error('[DeduplicateDialog] 单组归一化合并失败:', err);
    pushMsg('合并失败，请查看控制台日志');
  }
}

/**
 * 批量一键归一化
 */
async function handleBatchMerge() {
  const groupsToMerge = pendingGroups.value;
  if (groupsToMerge.length === 0) return;

  // 统计受影响文档与引用块概况
  let totalRefs = 0;
  const allDocIds = new Set<string>();
  for (const g of groupsToMerge) {
    for (const it of g.items) {
      if (it.asset.name !== g.canonicalAssetName) {
        totalRefs += it.asset.references?.length || 0;
        for (const r of it.asset.references || []) {
          if (r.root_id) allDocIds.add(r.root_id);
        }
      }
    }
  }

  const isSimilarMode = activeTab.value === 'similar';
  const confirmMsg = [
    `【${isSimilarMode ? '视觉相似图片' : '完全相同资源'} 归一化预检明细】`,
    `• 处理重复组数: ${groupsToMerge.length} 组`,
    `• 涉及影响文档: ${allDocIds.size} 篇`,
    `• 自动调整引用: ${totalRefs} 处`,
    `• 删除冗余文件: ${totalRedundantCount.value} 个`,
    `• 预计释放空间: ${totalReclaimableSizeText.value}`,
    '',
    isSimilarMode
      ? '[风险提醒] 当前为【视觉相似】模式！视觉相似图片虽构图相近但内容可能不完全相同，合并后非主资源将被永久物理删除，请确保已核对右侧比对视图。'
      : '注意：冗余文件将被物理删除，文档中对应的引用将无缝指向唯一主资源。',
    '是否确认执行一键批量归一化？',
  ].join('\n');

  const ok = await showConfirm({
    title: '批量资源去重与归一化确认',
    message: confirmMsg,
    confirmText: '立即归一化',
    cancelText: '取消',
    danger: true,
  });

  if (!ok) return;

  isMerging.value = true;
  mergeProgress.value = { current: 0, total: groupsToMerge.length };

  try {
    const stats = await batchNormalizeDuplicateGroups(groupsToMerge, undefined, (curr, tot) => {
      mergeProgress.value = { current: curr, total: tot };
    });

    await persistCurrentCache();
    if (stats.failedItemsCount > 0) {
      pushMsg(
        `批量归一化部分完成：删除 ${stats.deletedFilesCount} 个冗余文件，${stats.failedItemsCount} 个未能完成（详见控制台日志）。已改写部分已记录回退日志，可在删除历史中回退。`
      );
    } else {
      pushMsg(`批量去重归一化完成！更新了 ${stats.affectedDocsCount} 篇文档中的 ${stats.affectedBlocksCount} 处引用，删除 ${stats.deletedFilesCount} 个冗余文件，成功释放 ${formatAssetSize(stats.freedBytes)} 存储空间。`);
    }
    emit('completed');
  } catch (err) {
    error('[DeduplicateDialog] 批量归一化失败:', err);
    pushMsg('批量归一化过程中出现错误，请检查日志');
  } finally {
    isMerging.value = false;
  }
}

/** 按文档聚合引用，避免把同一篇文档的多个引用块显示成多篇文档 */
function docGroups(asset: AssetInfo) {
  return groupReferencesByDoc(asset.references || []);
}

/**
 * 点击引用文档，在思源后台标签页中打开定位
 */
async function handleOpenDocRef(ref: BlockRef) {
  if (!ref || !ref.id) return;
  try {
    const plugin = usePlugin();
    if (plugin && plugin.app) {
      await openTab({
        app: plugin.app,
        doc: {
          id: ref.id,
          action: ['cb-get-hl', 'cb-get-focus', 'cb-get-context'],
        },
        keepCursor: true,
      });
      pushMsg(`已在后台打开文档: ${ref.readablePath || ref.hpath || ref.id}`);
    }
  } catch (e) {
    warn('[DeduplicateDialog] 打开引用文档失败:', e);
  }
}

/**
 * 关闭弹窗
 */
function handleClose() {
  handleCancelScan();
  emit('update:visible', false);
}
</script>

<style scoped lang="scss">
.deduplicate-dialog-content {
  width: 95vw;
  max-width: 1200px;
  height: 85vh;
  max-height: 820px;
  display: flex;
  flex-direction: column;
}

.dedup-header-title {
  display: flex;
  align-items: center;
  gap: 12px;

  h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }
}

.dedup-title-icon {
  color: var(--b3-theme-primary);
}

.dedup-tab-group {
  display: flex;
  background: var(--b3-theme-surface-lighter);
  border-radius: 6px;
  padding: 2px;
  gap: 2px;
}

.dedup-tab-btn {
  border: none;
  background: transparent;
  padding: 4px 10px;
  font-size: 12px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--b3-theme-on-surface);
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s ease;

  &.is-active {
    background: var(--b3-theme-background);
    color: var(--b3-theme-on-background);
    font-weight: 600;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }
}

.dedup-tab-badge {
  background: var(--b3-theme-primary);
  color: var(--b3-theme-on-primary);
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 10px;
  line-height: 1.2;
}

.dedup-header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.last-scan-badge {
  font-size: 12px;
  color: var(--b3-theme-on-surface-light);
  background: var(--b3-theme-surface-lighter);
  padding: 3px 8px;
  border-radius: 4px;
  white-space: nowrap;
}

.similarity-slider-box {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--b3-theme-on-surface);
  background: var(--b3-theme-surface-lighter);
  padding: 4px 10px;
  border-radius: 6px;

  .slider-input {
    width: 90px;
    cursor: pointer;
  }
  .slider-val {
    font-weight: 600;
    color: var(--b3-theme-primary);
    min-width: 32px;
  }
}

.dedup-scan-banner {
  background: var(--b3-theme-surface-lighter);
  padding: 8px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid var(--b3-theme-surface);

  .scan-info {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    flex-shrink: 0;
  }

  .scan-percent {
    font-weight: 600;
    color: var(--b3-theme-primary);
  }

  .scan-progress-bar-wrap {
    flex: 1;
    height: 6px;
    background: rgba(0, 0, 0, 0.1);
    border-radius: 3px;
    overflow: hidden;
  }

  .scan-progress-bar-fill {
    height: 100%;
    background: var(--b3-theme-primary);
    transition: width 0.2s ease;
  }
}

.dedup-dialog-body {
  padding: 0 !important;
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.dedup-empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px;
  color: var(--b3-theme-on-surface);

  .empty-icon {
    font-size: 48px;
  }

  h4 {
    margin: 0;
    font-size: 18px;
    color: var(--b3-theme-on-background);
  }
}

.dedup-split-layout {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.dedup-sidebar {
  width: 310px;
  flex-shrink: 0;
  border-right: 1px solid var(--b3-theme-surface-lighter);
  display: flex;
  flex-direction: column;
  background: var(--b3-theme-background-light);

  .dedup-sidebar-header {
    padding: 10px;
    border-bottom: 1px solid var(--b3-theme-surface-lighter);
  }

  .dedup-search-input {
    width: 100%;
    height: 28px;
    font-size: 12px;
  }

  .dedup-group-list {
    flex: 1;
    overflow-y: auto;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
}

.dedup-group-item {
  display: flex;
  gap: 10px;
  padding: 8px;
  border-radius: 6px;
  background: var(--b3-theme-background);
  border: 1px solid var(--b3-theme-surface-lighter);
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    border-color: var(--b3-theme-primary);
    background: var(--b3-theme-surface-lighter);
  }

  &.is-active {
    border-color: var(--b3-theme-primary);
    background: rgba(var(--b3-theme-primary-rgb, 66, 133, 244), 0.08);
    box-shadow: inset 2px 0 0 var(--b3-theme-primary);
  }

  &.is-processed {
    opacity: 0.6;
    background: var(--b3-theme-surface);
  }

  &.is-ignored {
    opacity: 0.5;
  }

  .group-item-thumb {
    width: 48px;
    height: 48px;
    border-radius: 4px;
    overflow: hidden;
    background: #202020;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .thumb-badge-placeholder {
      font-size: 11px;
      font-weight: 700;
      color: #fff;
    }
  }

  .group-item-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .group-item-title-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .group-item-title {
    font-size: 12px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--b3-theme-on-background);
  }

  .group-item-meta {
    display: flex;
    gap: 4px;
    align-items: center;
  }

  .group-tag {
    font-size: 10px;
    padding: 1px 4px;
    border-radius: 3px;
    line-height: 1.2;

    &.count-tag {
      background: var(--b3-theme-surface-lighter);
      color: var(--b3-theme-on-surface);
    }
    &.exact-sim {
      background: rgba(46, 204, 113, 0.15);
      color: #2ecc71;
    }
    &.similar-sim {
      background: rgba(243, 156, 18, 0.15);
      color: #f39c12;
    }
  }

  .group-item-saving {
    font-size: 11px;
    color: var(--b3-theme-on-surface);
    display: flex;
    justify-content: space-between;
    align-items: center;

    strong {
      color: var(--b3-theme-primary);
    }
  }

  .status-badge {
    font-size: 10px;
    padding: 1px 4px;
    border-radius: 3px;

    &.status-processed {
      background: #2ecc71;
      color: #fff;
    }
    &.status-ignored {
      background: var(--b3-theme-on-surface-light);
      color: #fff;
    }
  }
}

.dedup-detail-area {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--b3-theme-background);
}

.detail-action-bar {
  padding: 10px 16px;
  border-bottom: 1px solid var(--b3-theme-surface-lighter);
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--b3-theme-background-light);

  .detail-action-left {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 13px;
  }

  .detail-group-badge {
    background: var(--b3-theme-primary);
    color: var(--b3-theme-on-primary);
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 4px;
    font-weight: 500;
  }

  .detail-group-sim strong {
    color: var(--b3-theme-primary);
  }

  .detail-action-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .processed-text {
    font-size: 12px;
    color: #2ecc71;
    font-weight: 500;
  }
}

.detail-compare-gallery {
  flex: 1;
  overflow-x: auto;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  gap: 16px;
  align-items: stretch;

  &.is-maximized-gallery {
    padding: 12px;
    gap: 12px;
    align-items: stretch;
  }
}

.compare-card {
  width: 290px;
  flex-shrink: 0;
  background: var(--b3-theme-background);
  border: 2px solid var(--b3-theme-surface-lighter);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: all 0.2s ease;

  &.is-maximized-card {
    width: auto;
    flex: 1;
    min-width: 320px;
    height: 100%;
  }

  &.is-canonical {
    border-color: var(--b3-theme-primary);
    box-shadow: 0 4px 14px rgba(var(--b3-theme-primary-rgb, 66, 133, 244), 0.2);
  }

  .compare-card-header {
    padding: 10px 12px;
    background: var(--b3-theme-background-light);
    border-bottom: 1px solid var(--b3-theme-surface-lighter);
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: pointer;
    flex-shrink: 0;
  }

  .header-right-badges {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .compact-meta-badge {
    font-size: 11px;
    color: var(--b3-theme-on-surface-light);
    background: var(--b3-theme-surface-lighter);
    padding: 1px 6px;
    border-radius: 4px;
  }

  .radio-label {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    font-size: 13px;

    input[type="radio"] {
      cursor: pointer;
      accent-color: var(--b3-theme-primary);
    }
  }

  .canonical-text {
    color: var(--b3-theme-on-background);
  }

  .recom-badge {
    background: rgba(46, 204, 113, 0.2);
    color: #2ecc71;
    font-size: 10px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 10px;
  }

  .compare-card-preview {
    height: 180px;
    background: #1e1e1e;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    position: relative;

    &.is-maximized-preview {
      height: 100%;
      flex: 1;
      min-height: 0;
      background: #121212;

      .preview-img {
        width: 100%;
        height: 100%;
        object-fit: contain;
      }
    }

    .preview-img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      transition: transform 0.2s ease;

      &:hover {
        transform: scale(1.03);
      }
    }

    .preview-non-image {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
    }

    .non-image-badge {
      font-size: 28px;
      font-weight: 800;
      color: #888;
      background: #2a2a2a;
      padding: 12px 20px;
      border-radius: 8px;
    }
  }

  .maximized-floating-bar {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background: rgba(0, 0, 0, 0.68);
    backdrop-filter: blur(4px);
    color: rgba(255, 255, 255, 0.9);
    padding: 6px 12px;
    font-size: 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    pointer-events: none;
    opacity: 0.9;
    transition: opacity 0.2s ease;

    .maximized-filename {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 70%;
      direction: rtl;
      text-align: left;
    }

    .maximized-res {
      font-size: 11px;
      color: #3b82f6;
      font-weight: 600;
    }
  }

  .compare-card-meta {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12px;
    border-bottom: 1px solid var(--b3-theme-surface-lighter);

    .meta-row {
      display: flex;
      justify-content: space-between;
      gap: 6px;
    }

    .meta-key {
      color: var(--b3-theme-on-surface);
      flex-shrink: 0;
    }

    .meta-val {
      color: var(--b3-theme-on-background);
      text-align: right;

      &.filename-val {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 170px;
        direction: rtl;
        text-align: left;
      }

      &.highlight-val {
        font-weight: 600;
        color: var(--b3-theme-primary);
      }

      &.time-val {
        font-size: 11px;
      }
    }

    .reedit-tag {
      background: rgba(var(--b3-theme-primary-rgb, 66, 133, 244), 0.15);
      color: var(--b3-theme-primary);
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 11px;
    }
  }

  .compare-card-refs {
    padding: 10px 12px;
    flex: 1;
    background: var(--b3-theme-background-light);
    font-size: 11px;

    &.is-empty {
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .refs-header {
      font-weight: 600;
      margin-bottom: 4px;
      color: var(--b3-theme-on-surface);
    }

    .refs-list {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .ref-item {
      display: flex;
      align-items: baseline;
      gap: 4px;
      color: var(--b3-theme-on-surface);
      cursor: pointer;
      padding: 1px 2px;
      border-radius: 3px;
      transition: all 0.15s ease;

      .ref-path {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* 同一篇文档内的引用处数，不参与截断 */
      .ref-count {
        flex: none;
        opacity: 0.65;
      }

      &:hover {
        color: var(--b3-theme-primary);
        background: var(--b3-theme-surface-lighter);
        text-decoration: underline;
      }
    }

    .ref-more {
      color: var(--b3-theme-on-surface-light);
      font-style: italic;
      margin-top: 2px;
    }

    .orphan-tag {
      color: var(--b3-theme-on-surface-light);
      font-style: italic;
    }
  }
}

.dedup-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;

  .footer-stats {
    font-size: 13px;
    color: var(--b3-theme-on-surface);

    strong {
      color: var(--b3-theme-on-background);
    }
  }

  .footer-actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }
}
</style>

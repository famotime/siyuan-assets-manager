<template>
  <!-- 限制在当前界面内的悬浮资源预览弹窗 (支持图片、MP4 视频与 MP3/常见音频) -->
  <div
    v-if="previewUrl"
    class="asset-hover-preview image-hover-preview"
    :class="{
      'is-interactive': previewType === 'audio' || previewType === 'video',
      'is-video': previewType === 'video',
      'is-audio': previewType === 'audio',
    }"
    :style="previewStyle"
    @mouseenter="$emit('mouseenter')"
    @mouseleave="$emit('mouseleave')"
  >
    <!-- 图片预览 -->
    <img v-if="previewType === 'image'" :src="previewUrl" alt="预览图" />

    <!-- 视频预览 (带半透明悬浮控制栏与居中播放指示) -->
    <div
      v-else-if="previewType === 'video'"
      class="video-preview-wrapper"
      @click="toggleVideoPlay"
    >
      <video
        ref="videoPreviewEl"
        :src="previewUrl"
        autoplay
        loop
        :muted="videoMuted"
        playsinline
        @loadedmetadata="handleVideoLoadedMetadata"
        @timeupdate="handleVideoTimeUpdate"
        @play="isVideoPlaying = true"
        @pause="isVideoPlaying = false"
        @error="handleVideoError"
      ></video>

      <!-- 暂停时居中半透明微质感播放图标 -->
      <div v-if="!isVideoPlaying" class="video-center-play-badge" title="点击播放">
        <Play :size="28" class="play-icon-offset" />
      </div>

      <!-- 底部平滑渐显的半透明控制条 -->
      <div class="video-controls-overlay" @click.stop>
        <!-- 播放/暂停按钮 -->
        <button
          class="video-ctrl-btn play-pause-btn"
          :class="{ 'is-playing': isVideoPlaying }"
          @click.stop="toggleVideoPlay"
          :title="isVideoPlaying ? '暂停' : '播放'"
        >
          <Pause v-if="isVideoPlaying" :size="14" />
          <Play v-else :size="14" class="play-icon-offset" />
        </button>

        <!-- 进度条区域 (支持点击与拖拽快进) -->
        <div
          class="video-progress-container"
          ref="videoProgressBarEl"
          @mousedown.stop="handleProgressMouseDown"
        >
          <div class="video-progress-track">
            <div class="video-progress-fill" :style="{ width: videoProgressPercent + '%' }"></div>
            <div class="video-progress-thumb" :style="{ left: videoProgressPercent + '%' }"></div>
          </div>
        </div>

        <!-- 当前时间 / 总时长 -->
        <span class="video-time-display">
          {{ formatMediaTime(videoCurrentTime) }} / {{ formatMediaTime(videoDuration) }}
        </span>

        <!-- 静音/声音切换按钮 -->
        <button
          class="video-ctrl-btn mute-btn"
          :class="{ 'is-muted': videoMuted }"
          @click.stop="toggleVideoMute"
          :title="videoMuted ? '取消静音 (恢复声音)' : '静音'"
        >
          <VolumeX v-if="videoMuted" :size="14" />
          <Volume2 v-else :size="14" />
        </button>
      </div>
    </div>

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
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted, watch } from 'vue';
import { Volume2, VolumeX, Play, Pause } from 'lucide-vue-next';
import { splitFileName } from '../utils/asset-list';

const props = defineProps<{
  previewUrl: string;
  previewType: 'image' | 'video' | 'audio' | null;
  previewAsset?: { name: string } | null;
  previewStyle?: Record<string, string>;
}>();

defineEmits<{
  (e: 'mouseenter'): void;
  (e: 'mouseleave'): void;
}>();

// 视频播放控制状态 (每次打开/切换视频始终默认静音，防止惊扰用户)
const videoPreviewEl = ref<HTMLVideoElement | null>(null);
const videoProgressBarEl = ref<HTMLDivElement | null>(null);
const videoMuted = ref(true);
const isVideoPlaying = ref(true);
const videoCurrentTime = ref(0);
const videoDuration = ref(0);
const videoLoadError = ref(false);
let isDraggingVideoProgress = false;

const videoProgressPercent = computed(() => {
  if (!videoDuration.value || videoDuration.value <= 0) return 0;
  return Math.min(100, Math.max(0, (videoCurrentTime.value / videoDuration.value) * 100));
});

function toggleVideoMute() {
  videoMuted.value = !videoMuted.value;
  if (videoPreviewEl.value) {
    videoPreviewEl.value.muted = videoMuted.value;
  }
}

function toggleVideoPlay() {
  if (!videoPreviewEl.value) return;
  if (isVideoPlaying.value) {
    videoPreviewEl.value.pause();
    isVideoPlaying.value = false;
  } else {
    const playPromise = videoPreviewEl.value.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          isVideoPlaying.value = true;
        })
        .catch((err) => {
          console.warn('[AssetMediaPreview] Video play failed:', err);
          isVideoPlaying.value = false;
        });
    } else {
      isVideoPlaying.value = true;
    }
  }
}

function handleVideoLoadedMetadata() {
  if (videoPreviewEl.value) {
    videoDuration.value = videoPreviewEl.value.duration || 0;
    videoPreviewEl.value.muted = videoMuted.value;
    const playPromise = videoPreviewEl.value.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          isVideoPlaying.value = true;
        })
        .catch((err) => {
          console.warn('[AssetMediaPreview] Video autoplay blocked or failed:', err);
          isVideoPlaying.value = false;
        });
    }
  }
}

function handleVideoTimeUpdate() {
  if (videoPreviewEl.value && !isDraggingVideoProgress) {
    videoCurrentTime.value = videoPreviewEl.value.currentTime;
    if (!videoDuration.value && videoPreviewEl.value.duration) {
      videoDuration.value = videoPreviewEl.value.duration;
    }
  }
}

function handleVideoError(e: Event) {
  console.warn('[AssetMediaPreview] Video loading error:', e);
  videoLoadError.value = true;
  isVideoPlaying.value = false;
}

function seekVideoByEvent(e: MouseEvent) {
  if (!videoProgressBarEl.value || !videoPreviewEl.value || !videoDuration.value) return;
  const rect = videoProgressBarEl.value.getBoundingClientRect();
  if (rect.width <= 0) return;
  const offsetX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
  const targetTime = (offsetX / rect.width) * videoDuration.value;
  videoPreviewEl.value.currentTime = targetTime;
  videoCurrentTime.value = targetTime;
}

function handleProgressMouseMove(e: MouseEvent) {
  if (!isDraggingVideoProgress) return;
  seekVideoByEvent(e);
}

function handleProgressMouseUp() {
  if (isDraggingVideoProgress) {
    isDraggingVideoProgress = false;
    window.removeEventListener('mousemove', handleProgressMouseMove);
    window.removeEventListener('mouseup', handleProgressMouseUp);
  }
}

function handleProgressMouseDown(e: MouseEvent) {
  if (!videoDuration.value) return;
  isDraggingVideoProgress = true;
  seekVideoByEvent(e);
  window.addEventListener('mousemove', handleProgressMouseMove);
  window.addEventListener('mouseup', handleProgressMouseUp);
}

// 音频试听静音状态 (全局记忆持久化)
const AUDIO_MUTED_STORAGE_KEY = 'siyuan-assets-manager-audio-preview-muted';
const audioMuted = ref(typeof localStorage !== 'undefined' && localStorage.getItem(AUDIO_MUTED_STORAGE_KEY) === 'true');

function toggleAudioMute() {
  audioMuted.value = !audioMuted.value;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(AUDIO_MUTED_STORAGE_KEY, String(audioMuted.value));
    }
  } catch (e) {}
  if (audioPreviewEl.value) {
    audioPreviewEl.value.muted = audioMuted.value;
  }
}

const audioPreviewEl = ref<HTMLAudioElement | null>(null);
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
    console.warn('[AssetMediaPreview] Audio play failed or blocked:', err);
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
  console.warn('[AssetMediaPreview] Audio loading error:', e);
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

// 监听 url 变动，复位状态
watch(
  () => props.previewUrl,
  (newVal) => {
    if (newVal && props.previewType === 'video') {
      videoMuted.value = true;
      isVideoPlaying.value = true;
      videoCurrentTime.value = 0;
      videoDuration.value = 0;
      videoLoadError.value = false;
    }
  }
);

onUnmounted(() => {
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
  if (isDraggingVideoProgress) {
    isDraggingVideoProgress = false;
    window.removeEventListener('mousemove', handleProgressMouseMove);
    window.removeEventListener('mouseup', handleProgressMouseUp);
  }
});
</script>

<style scoped lang="scss">
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

  /* 视频预览容器 (支持悬浮交互与半透明控制栏) */
  .video-preview-wrapper {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    overflow: hidden;
    background-color: #000;
    max-width: 440px;
    max-height: 400px;
    cursor: pointer;

    video {
      display: block;
      max-width: 440px;
      max-height: 400px;
      width: auto;
      height: auto;
      border-radius: 4px;
      background-color: #000;
    }

    /* 居中半透明微质感播放图标 */
    .video-center-play-badge {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 50px;
      height: 50px;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.62);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border: 1px solid rgba(255, 255, 255, 0.28);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      z-index: 2;
      pointer-events: none;

      .play-icon-offset {
        margin-left: 3px;
      }
    }

    &:hover .video-center-play-badge {
      transform: translate(-50%, -50%) scale(1.08);
      background: rgba(0, 0, 0, 0.76);
      border-color: rgba(255, 255, 255, 0.45);
    }

    /* 底部悬浮半透明渐变控制条 (移入预览窗口时平滑淡入) */
    .video-controls-overlay {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 42px;
      background: linear-gradient(to top, rgba(0, 0, 0, 0.88) 0%, rgba(0, 0, 0, 0.45) 70%, transparent 100%);
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 10px;
      box-sizing: border-box;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.22s ease-in-out;
      z-index: 3;
      cursor: default;
    }

    &:hover .video-controls-overlay {
      opacity: 1;
      pointer-events: auto;
    }

    /* 视频控制按钮 */
    .video-ctrl-btn {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.16);
      border: 1px solid rgba(255, 255, 255, 0.22);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      padding: 0;
      flex-shrink: 0;
      transition: all 0.18s;

      &:hover {
        background: rgba(255, 255, 255, 0.32);
        transform: scale(1.08);
      }

      &:active {
        transform: scale(0.95);
      }

      .play-icon-offset {
        margin-left: 1px;
      }

      &.mute-btn.is-muted {
        color: #f87171;
        border-color: rgba(248, 113, 113, 0.4);
        background: rgba(239, 68, 68, 0.22);
      }
    }

    /* 进度条轨道与滑块 */
    .video-progress-container {
      flex: 1;
      height: 18px;
      display: flex;
      align-items: center;
      cursor: pointer;
      position: relative;
      user-select: none;
      -webkit-user-select: none;
    }

    .video-progress-track {
      width: 100%;
      height: 3px;
      background: rgba(255, 255, 255, 0.28);
      border-radius: 2px;
      position: relative;
      transition: height 0.15s ease;
    }

    .video-progress-container:hover .video-progress-track {
      height: 5px;
    }

    .video-progress-fill {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      background: var(--b3-theme-primary);
      border-radius: 2px;
      pointer-events: none;
    }

    .video-progress-thumb {
      position: absolute;
      top: 50%;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #fff;
      transform: translate(-50%, -50%) scale(0);
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
      pointer-events: none;
      transition: transform 0.15s ease;
    }

    .video-progress-container:hover .video-progress-thumb {
      transform: translate(-50%, -50%) scale(1);
    }

    /* 时间文字展示 */
    .video-time-display {
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      color: rgba(255, 255, 255, 0.88);
      white-space: nowrap;
      user-select: none;
      flex-shrink: 0;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
    }
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

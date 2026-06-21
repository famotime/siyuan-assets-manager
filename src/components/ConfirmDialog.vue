<template>
  <div v-if="confirmState.visible" class="am-dialog-overlay" style="z-index: 2000;">
    <div class="am-dialog" style="width: 400px; max-width: 90vw;">
      <div class="am-dialog__header">
        <h3 :style="{ color: confirmState.options.danger ? 'var(--b3-theme-error)' : 'inherit' }">
          <span v-if="confirmState.options.danger">⚠️ </span>
          {{ confirmState.options.title || '确认' }}
        </h3>
        <button class="am-dialog__close" @click="cancel" aria-label="关闭">
          <svg width="20" height="20" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="am-dialog__body" style="white-space: pre-wrap; line-height: 1.6; font-size: 14px;">
        {{ confirmState.options.message }}
      </div>
      <div class="am-dialog__footer">
        <button class="am-btn am-btn--ghost" @click="cancel">{{ confirmState.options.cancelText || '取消' }}</button>
        <button class="am-btn" :class="confirmState.options.danger ? 'am-btn--danger' : 'am-btn--primary'" @click="confirm">
          {{ confirmState.options.confirmText || '确定' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { confirmState, closeConfirm } from '../utils/confirm';

function confirm() {
  closeConfirm(true);
}

function cancel() {
  closeConfirm(false);
}
</script>

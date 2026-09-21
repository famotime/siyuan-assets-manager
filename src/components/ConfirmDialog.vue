<template>
  <Teleport to="body">
    <div 
      v-if="confirmState.visible" 
      class="am-dialog-overlay am-confirm-dialog-overlay" 
      style="z-index: 3000;"
      @click.self="cancel"
    >
      <div class="am-dialog am-confirm-dialog">
        <div class="am-dialog__header">
          <h3 :style="{ color: confirmState.options.danger ? 'var(--b3-theme-error)' : 'inherit', display: 'flex', alignItems: 'center' }">
            <AlertTriangle v-if="confirmState.options.danger" :size="18" style="fill: none !important; margin-right: 6px; flex-shrink: 0;" />
            <span>{{ confirmState.options.title || '确认' }}</span>
          </h3>
          <button class="am-dialog__close" @click="cancel" aria-label="关闭">
            <svg width="20" height="20" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" style="fill: none !important;">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="am-dialog__body">
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
  </Teleport>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { AlertTriangle } from 'lucide-vue-next';
import { confirmState, closeConfirm } from '../utils/confirm';

function confirm() {
  closeConfirm(true);
}

function cancel() {
  closeConfirm(false);
}

// 监听键盘按键，在弹窗处于显示状态时支持按 Esc 快速取消
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && confirmState.value.visible) {
    e.preventDefault();
    e.stopPropagation();
    cancel();
  }
}

onMounted(() => {
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', handleKeydown, true);
  }
});

onUnmounted(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', handleKeydown, true);
  }
});
</script>

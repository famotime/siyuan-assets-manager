<template>
  <div class="plugin-app-main" v-if="visible">
    <div class="manager-dialog">
      <div class="dialog-close-btn" @click="closeManager">
        <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </div>
      <AssetsManager />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { usePlugin } from '@/main';
import AssetsManager from './components/AssetsManager.vue';

const visible = ref(false);

const plugin = usePlugin();

onMounted(() => {
  // 注册顶栏按钮，点击时打开资源管家
  plugin.addTopBar({
    icon: 'iconInbox',
    title: '资源管家',
    callback: () => {
      visible.value = !visible.value;
    },
  });
  
  // 暴露给外部控制
  (window as any)._siyuan_assets_manager_toggle = () => {
    visible.value = !visible.value;
  };
});

function closeManager() {
  visible.value = false;
}
</script>

<style lang="scss" scoped>
.plugin-app-main {
  width: 100vw;
  height: 100vh;
  position: absolute;
  top: 0;
  left: 0;
  z-index: 100; /* 高层级覆盖 */
  display: flex;
  justify-content: center;
  align-items: center;
  background-color: rgba(0, 0, 0, 0.4); /* 半透明遮罩 */
  pointer-events: auto;
}

.manager-dialog {
  width: 90vw;
  height: 90vh;
  background-color: var(--b3-theme-background);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
}

.dialog-close-btn {
  position: absolute;
  top: 16px;
  right: 16px;
  cursor: pointer;
  color: var(--b3-theme-on-surface);
  z-index: 10;
  padding: 4px;
  border-radius: 4px;
  transition: background-color 0.2s;
  
  &:hover {
    background-color: var(--b3-theme-surface-lighter);
  }
}
</style>

<style lang="scss">
.plugin-sample-vite-vue-app {
  width: 100vw;
  height: 100dvh;
  max-height: 100vh;
  position: absolute;
  top: 0px;
  left: 0px;
  pointer-events: none;
  box-sizing: border-box;
  z-index: 200; /* 提升根容器层级 */
}
</style>
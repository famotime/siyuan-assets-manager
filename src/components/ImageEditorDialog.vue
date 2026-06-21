<template>
  <div v-if="visible" class="image-editor-dialog-overlay">
    <div class="image-editor-dialog-content" :style="{ width: dialogWidth, height: dialogHeight }">
      <div class="dialog-header">
        <h3>编辑图片: {{ assetName }}</h3>
        <button class="close-btn" @click="close">×</button>
      </div>
      <div class="dialog-body">
        <div ref="tuiEditorContainer" style="width: 100%; height: 100%;"></div>
      </div>
      <div class="dialog-footer">
        <button class="b3-button b3-button--cancel" @click="close">取消</button>
        <button class="b3-button b3-button--primary" @click="save">保存并更新引用</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import ImageEditor from 'tui-image-editor';
import 'tui-image-editor/dist/tui-image-editor.css';
import { readAssetFile } from '../utils/file-system';

const props = defineProps<{
  visible: boolean;
  assetName: string;
}>();

const emit = defineEmits(['update:visible', 'save-edited']);

const tuiEditorContainer = ref<HTMLElement | null>(null);
let editorInstance: any = null;

const dialogWidth = ref('900px');
const dialogHeight = ref('600px');

watch(() => props.visible, async (newVal) => {
  if (newVal && props.assetName) {
    const blob = await readAssetFile(props.assetName);
    if (blob) {
      const url = URL.createObjectURL(blob);
      
      const img = new Image();
      img.onload = async () => {
        const targetW = img.width + 60; // 边距等补偿
        const targetH = img.height + 250; // header, footer, 菜单栏等补偿
        
        const finalW = Math.max(700, Math.min(targetW, window.innerWidth * 0.9));
        const finalH = Math.max(500, Math.min(targetH, window.innerHeight * 0.9));
        
        dialogWidth.value = `${finalW}px`;
        dialogHeight.value = `${finalH}px`;

        await nextTick();
        initEditor(url);
      };
      img.src = url;
    } else {
      // 降级：如果读不到 blob
      await nextTick();
      initEditor(`/assets/${props.assetName}`);
    }
  } else {
    if (editorInstance) {
      editorInstance.destroy();
      editorInstance = null;
    }
  }
});

function initEditor(url: string) {
  if (!tuiEditorContainer.value) return;
  
  if (editorInstance) {
    editorInstance.destroy();
  }

  editorInstance = new ImageEditor(tuiEditorContainer.value, {
    includeUI: {
      loadImage: {
        path: url,
        name: props.assetName,
      },
      theme: {
        // 默认暗色主题
      },
      menu: ['crop', 'draw', 'shape', 'icon', 'text', 'filter'],
      initMenu: 'filter',
      uiSize: {
        width: '100%',
        height: '100%'
      },
      menuBarPosition: 'bottom'
    },
    cssMaxWidth: window.innerWidth * 0.9,
    cssMaxHeight: window.innerHeight * 0.9,
    selectionStyle: {
      cornerSize: 20,
      rotatingPointOffset: 70
    }
  });
}

function close() {
  emit('update:visible', false);
}

function save() {
  if (!editorInstance) return;
  const dataUrl = editorInstance.toDataURL();
  emit('save-edited', {
    oldName: props.assetName,
    dataUrl: dataUrl
  });
  close();
}
</script>

<style scoped>
.image-editor-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: 1000;
  display: flex;
  justify-content: center;
  align-items: center;
}
.image-editor-dialog-content {
  background: var(--b3-theme-background);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  display: flex;
  flex-direction: column;
  resize: both;
  overflow: hidden;
  min-width: 600px;
  min-height: 400px;
  max-width: 95vw;
  max-height: 95vh;
}
.dialog-header {
  padding: 16px;
  border-bottom: 1px solid var(--b3-theme-surface-lighter);
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}
.dialog-header h3 {
  margin: 0;
}
.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: var(--b3-theme-on-surface);
}
.dialog-body {
  padding: 16px;
  background: #282828; /* TUI Editor 默认是暗色 */
  flex: 1;
  display: flex;
  min-height: 0; /* flex child 缩放必需 */
}
.dialog-footer {
  padding: 16px;
  border-top: 1px solid var(--b3-theme-surface-lighter);
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  flex-shrink: 0;
}
.b3-button {
  cursor: pointer;
  padding: 6px 12px;
  border-radius: 4px;
  border: 1px solid transparent;
}
.b3-button--cancel {
  background-color: transparent;
  border-color: var(--b3-theme-on-surface-light);
  color: var(--b3-theme-on-surface);
}
.b3-button--primary {
  background-color: var(--b3-theme-primary);
  color: var(--b3-theme-on-primary);
}
</style>

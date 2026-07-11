<template>
  <div v-if="visible" class="am-dialog-overlay" style="z-index: 1000;">
    <div class="am-dialog image-editor-dialog-content" :style="{ width: dialogWidth, height: dialogHeight }">
      <div class="am-dialog__header">
        <h3>编辑图片: {{ assetName }}</h3>
        <div class="header-actions" style="display: flex; gap: 8px;">
          <!-- 原本这里的“开启序号标注”按钮被移除，移至 TUI 内部原生菜单栏 -->
          <button class="am-dialog__close" @click="close" aria-label="关闭">
            <svg width="20" height="20" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="am-dialog__body" style="position: relative; background: #282828; padding: 16px; display: flex;">
        <div ref="tuiEditorContainer" style="width: 100%; height: 100%;"></div>
      </div>
      <div class="am-dialog__footer">
        <button class="am-btn am-btn--outline" @click="downloadLocal" style="margin-right: 8px;" title="当前编辑的图片另存到本地">另存</button>
        <button class="am-btn am-btn--ghost" @click="close" title="取消编辑并关闭窗口">取消</button>
        <button class="am-btn am-btn--primary" @click="save" title="保存修改并同步到所有引用此图片的文档块">保存</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import { getImageEditor } from '../utils/tui-image-editor-bridge';
import 'tui-image-editor/dist/tui-image-editor.css';
import { readAssetFile } from '../utils/file-system';
import localeZhCN from '../i18n/tui-locale-zh';
import { calculateDialogSize } from '../utils/image-editor';
import { log } from '../utils/logger';

const props = defineProps<{
  visible: boolean;
  assetName: string;
}>();

const emit = defineEmits(['update:visible', 'save-edited']);

const tuiEditorContainer = ref<HTMLElement | null>(null);
let editorInstance: any = null;

const dialogWidth = ref('900px');
const dialogHeight = ref('600px');

// 编辑器初始化就绪状态，用于 Teleport 挂载
const isEditorReady = ref(false);

watch(() => props.visible, async (newVal) => {
  if (newVal && props.assetName) {
    isEditorReady.value = false;
    
    const blob = await readAssetFile(props.assetName);
    if (blob) {
      const url = URL.createObjectURL(blob);
      
      const img = new Image();
      img.onload = async () => {
        const dialogSize = calculateDialogSize(img.width, img.height, window.innerWidth, window.innerHeight);
        
        dialogWidth.value = `${dialogSize.width}px`;
        dialogHeight.value = `${dialogSize.height}px`;

        await nextTick();
        initEditor(url);
      };
      img.src = url;
    } else {
      await nextTick();
      initEditor(`/assets/${props.assetName}`);
    }
  } else {
    isEditorReady.value = false;
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

  const ImageEditorConstructor = getImageEditor();
  log('Resolved constructor dynamically:', ImageEditorConstructor);
  editorInstance = new ImageEditorConstructor(tuiEditorContainer.value, {
    includeUI: {
      loadImage: {
        path: url,
        name: props.assetName,
      },
      theme: {
        // 默认暗色主题
        'common.bi.image': '',
        'common.bisize.width': '0px',
        'common.bisize.height': '0px'
      },
      locale: localeZhCN,
      menu: ['crop', 'draw', 'shape', 'icon', 'text', 'filter', 'annotation'],
      initMenu: 'crop',
      uiSize: {
        width: '100%',
        height: '100%'
      },
      menuBarPosition: 'bottom'
    },
    cssMaxWidth: window.innerWidth * 0.9,
    cssMaxHeight: window.innerHeight * 0.9,
    selectionStyle: {
      cornerSize: 8,
      rotatingPointOffset: 30
    }
  });


  // 设置 ready 状态以激活 Teleport
  isEditorReady.value = true;
}


function close() {
  emit('update:visible', false);
}

function downloadLocal() {
  if (!editorInstance) return;
  try {
    const dataUrl = editorInstance.toDataURL();
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = props.assetName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (e) {
    console.error("Failed to download image", e);
  }
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
.image-editor-dialog-content {
  resize: both;
  min-width: 600px;
  min-height: 400px;
  max-width: 95vw;
  max-height: 95vh;
}

/* 修复 tui-color-picker 被思源全局 CSS 覆盖导致色块变成一条线的问题 */
:deep(.tui-colorpicker-palette-button) {
  width: 16px !important;
  height: 16px !important;
  min-width: 16px !important;
  min-height: 16px !important;
  padding: 0 !important;
  margin: 0 !important;
  border: 1px solid #ccc !important;
  border-radius: 0 !important;
  box-sizing: border-box !important;
  display: block !important;
}
:deep(.tui-colorpicker-palette-button.tui-colorpicker-selected) {
  border: 2px solid #000 !important;
}
:deep(.tui-colorpicker-palette-container li) {
  margin: 0 !important;
  padding: 0 3px 3px 0 !important;
  list-style: none !important;
  float: left !important;
}

:deep(.tui-image-editor-submenu) {
  overflow: visible !important;
}

/* 按钮的通用状态修饰与 SVG 一致性过渡 */
:deep(.tui-image-editor-button) {
  cursor: pointer;
  transition: all 0.2s;
}

:deep(.tui-image-editor-button svg) {
  stroke: #8c8c8c;
  fill: none;
  transition: stroke 0.2s;
}

:deep(.tui-image-editor-button.active svg) {
  stroke: #fff;
}

:deep(.tui-image-editor-button:hover svg) {
  stroke: #fff;
}

/* 颜色选择 li 容器 */
.custom-annotation-color-button {
  display: inline-flex !important;
  align-items: center;
  height: 48px;
  vertical-align: top;
}

/* 颜色选择项包裹，采用垂直布局，以和形状按钮对齐 */
.color-item-wrapper {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

/* 颜色预览框的定位容器，用于统一中线高度为 24px */
.color-preview-container {
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.color-preview-circle {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.4);
  cursor: pointer;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.2s, border-color 0.2s;
}

.color-preview-circle:hover {
  transform: scale(1.15);
  border-color: #fff;
}

.color-preview-inner {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  border: 1px solid rgba(0, 0, 0, 0.2);
  background-color: transparent;
}

/* 预设色板弹窗 */
.preset-colors-popup {
  position: absolute;
  bottom: 56px; /* 偏高位置，配合文字在下的布局，防止遮挡标签 */
  left: 50%;
  transform: translateX(-50%);
  background: #1e1e1e;
  border: 1px solid #3c3c3c;
  border-radius: 4px;
  padding: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  z-index: 1000;
  width: 110px;
}

.preset-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  justify-items: center;
  align-items: center;
}

.preset-color-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  cursor: pointer;
  border: 1px solid #555;
  box-sizing: border-box;
  transition: transform 0.15s;
}

.preset-color-dot:hover {
  transform: scale(1.2);
}

.preset-color-custom {
  font-size: 13px;
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.15s;
  width: 16px;
  height: 16px;
}

.preset-color-custom:hover {
  transform: scale(1.2);
}

/* 自定义滑块轨道与手柄，适配 TUI 原生视觉样式 */
.custom-slider-container {
  display: inline-block;
  width: 100px;
  margin: 0 10px;
  vertical-align: middle;
}

.custom-tui-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 3px;
  background: #444;
  border-radius: 1px;
  outline: none;
  border: none;
  margin: 0;
  padding: 0;
}

.custom-tui-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #151515;
  border: 2px solid #007aff;
  cursor: pointer;
  box-shadow: 0 0 2px rgba(0, 0, 0, 0.5);
  transition: border-color 0.15s;
}

.custom-tui-slider::-webkit-slider-thumb:hover {
  border-color: #0099ff;
}

.custom-tui-slider::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #151515;
  border: 2px solid #007aff;
  cursor: pointer;
  box-shadow: 0 0 2px rgba(0, 0, 0, 0.5);
  transition: border-color 0.15s;
}

.custom-tui-slider::-moz-range-thumb:hover {
  border-color: #0099ff;
}

/* 下次序号外部包裹项 */
.custom-annotation-step-wrap {
  display: inline-flex !important;
  align-items: center;
  height: 48px;
  vertical-align: top;
}

/* 下次序号组件包裹，采用垂直布局，以和形状按钮对齐 */
.step-control-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

/* 下次序号的控件行容器，用于统一中线高度为 24px */
.step-control-row {
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.step-value-input {
  width: 40px !important;
  text-align: center;
}

.custom-reset-btn {
  margin-left: 8px;
  color: var(--b3-theme-primary);
  cursor: pointer;
  font-size: 11px;
  font-weight: bold;
  padding: 3px 8px;
  border: 1px solid #3c3c3c;
  border-radius: 3px;
  background: #252525;
  transition: background-color 0.2s, border-color 0.2s, color 0.2s;
  white-space: nowrap;
}

.custom-reset-btn:hover {
  background: #303030;
  border-color: var(--b3-theme-primary);
  color: #fff;
}

/* 下方说明标签统一规范，继承 TUI 原生 label 风格 */
.custom-label {
  display: block;
  font-size: 11px;
  color: #8c8c8c;
  margin-top: 6px;
  cursor: default;
  user-select: none;
  font-family: "Noto Sans", sans-serif;
  text-align: center;
}
</style>

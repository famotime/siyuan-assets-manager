<template>
  <div v-if="visible" class="am-dialog-overlay" style="z-index: 1000;">
    <div class="am-dialog image-editor-dialog-content" :style="{ width: dialogWidth, height: dialogHeight }">
      <div class="am-dialog__header">
        <div style="display: flex; align-items: center; gap: 8px;">
          <h3>编辑图片: {{ assetName }}</h3>
          <span v-if="isReEditMode" class="reedit-badge" title="当前处于二次编辑模式，图层为可交互矢量状态">二次编辑模式</span>
        </div>
        <div class="header-actions" style="display: flex; align-items: center; gap: 8px;">
          <button 
            v-if="isReEditMode" 
            class="am-btn am-btn--ghost am-btn--sm" 
            @click="handleResetOriginal" 
            title="清空当前所有矢量标注，恢复干净原始底图"
          >
            重置为原始底图
          </button>
          <button 
            v-if="isReEditMode" 
            class="am-btn am-btn--ghost am-btn--sm" 
            @click="handleFlattenLayers" 
            title="将图层合并固化为普通图片（移除二次编辑元数据）"
          >
            合并固化图层
          </button>
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
import { ref, watch, nextTick, onUnmounted } from 'vue';
import { getImageEditor, extractVectorDataFromTui, applyVectorDataToTui, getFabricCanvasFromTui } from '../utils/tui-image-editor-bridge';
import 'tui-image-editor/dist/tui-image-editor.css';
import { readAssetFile, readOriginalImage } from '../utils/file-system';
import { getImageBlockReEditData, removeImageBlockReEditData } from '../utils/siyuan-block';
import { getAssetInfoByName } from '../utils/siyuan-db';
import localeZhCN from '../i18n/tui-locale-zh';
import { calculateDialogSize, cleanTuiSvgArtifacts, getEditorShortcutAction, lockHostScroll, prepareCanvasExport, removeTuiSvgArtifacts, resetCanvasObjects, resetHostViewport, trimAndScaleDataUrl, unlockHostScroll } from '../utils/image-editor';
import { showConfirm } from '../utils/confirm';
import { pushMsg } from '../api';
import { log, warn, error } from '../utils/logger';
import { usePlugin } from '../main';
import { DEFAULT_IMAGE_EDITOR_TOOLS } from '../index';
import type { IAssetReEditMetadata } from '../types/reedit';

const props = defineProps<{
  visible: boolean;
  assetName: string;
  blockId?: string;
}>();

const emit = defineEmits(['update:visible', 'save-edited']);

const tuiEditorContainer = ref<HTMLElement | null>(null);
let editorInstance: any = null;

const dialogWidth = ref('900px');
const dialogHeight = ref('600px');
const originalSize = ref<{ width: number; height: number }>({ width: 0, height: 0 });

// 二次编辑模式状态
const isReEditMode = ref(false);
const reEditMetadata = ref<IAssetReEditMetadata | null>(null);
const originalStoragePath = ref('');

// 编辑器初始化就绪状态，用于 Teleport 挂载
const isEditorReady = ref(false);

/**
 * 拦截键盘快捷键，支持 Esc 退出，并防止事件冒泡至思源笔记触发思源全局撤销/重做或快捷键
 */
function handleKeyDown(e: KeyboardEvent) {
  if (!editorInstance) return;

  // 按 Esc 键退出图片编辑器（如果在文本编辑状态，先退出文本编辑）
  if (e.key === 'Escape') {
    const canvas = getFabricCanvasFromTui(editorInstance);
    const activeObj = canvas?.getActiveObject ? canvas.getActiveObject() : null;
    if (activeObj && activeObj.isEditing && typeof activeObj.exitEditing === 'function') {
      activeObj.exitEditing();
      canvas.renderAll();
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    close();
    return;
  }

  const action = getEditorShortcutAction(e);
  if (action && (action.isUndo || action.isRedo)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    if (action.isUndo) {
      if (typeof editorInstance.undo === 'function') {
        editorInstance.undo().catch(() => {});
      }
    } else if (action.isRedo) {
      if (typeof editorInstance.redo === 'function') {
        editorInstance.redo().catch(() => {});
      }
    }
    return;
  }

  // 阻断修饰键（Ctrl/Meta/Alt）组合键向宿主思源冒泡，避免误触思源全局面板或快捷操作
  if (e.ctrlKey || e.metaKey || e.altKey) {
    e.stopPropagation();
  }
}

watch(() => props.visible, async (newVal) => {
  if (newVal && props.assetName) {
    // 进入编辑器界面：立即锁定宿主滚动、清理并隔离可能存在的 TUI SVG 节点，重置视口
    lockHostScroll();
    cleanTuiSvgArtifacts();
    resetHostViewport();

    window.addEventListener('keydown', handleKeyDown, true);
    isEditorReady.value = false;
    isReEditMode.value = false;
    reEditMetadata.value = null;
    originalStoragePath.value = '';

    let imageBlob: Blob | null = null;
    let initialUrl = '';

    // 1. 获取目标 blockId（优先使用传入的 blockId，若无则尝试通过资产名反查）
    let targetBlockId = props.blockId;
    if (!targetBlockId) {
      try {
        const assetInfo = await getAssetInfoByName(props.assetName);
        if (assetInfo?.reEditBlockId) {
          targetBlockId = assetInfo.reEditBlockId;
        } else if (assetInfo?.references && assetInfo.references.length === 1) {
          targetBlockId = assetInfo.references[0].id;
        }
      } catch (e) {}
    }

    if (targetBlockId) {
      try {
        const meta = await getImageBlockReEditData(targetBlockId);
        if (meta) {
          isReEditMode.value = true;
          reEditMetadata.value = meta;
          originalStoragePath.value = meta.originalStoragePath;

          // 尝试从隔离存储中读取干净原始底图
          imageBlob = await readOriginalImage(meta.originalStoragePath);
          if (!imageBlob) {
            warn(`[ImageEditorDialog] 未能从隔离目录读取底图 ${meta.originalStoragePath}，尝试降级读取当前 assets`);
          }
        }
      } catch (err) {
        warn('[ImageEditorDialog] 查询二次编辑元数据失败:', err);
      }
    }

    // 2. 如果不是二次编辑模式或读取隔离底图失败，读取当前 assets 图片
    if (!imageBlob) {
      imageBlob = await readAssetFile(props.assetName);
    }

    if (imageBlob) {
      initialUrl = URL.createObjectURL(imageBlob);
    } else {
      initialUrl = `/assets/${props.assetName}`;
    }

    const img = new Image();
    img.onload = async () => {
      originalSize.value = { width: img.width, height: img.height };
      const dialogSize = calculateDialogSize(img.width, img.height, window.innerWidth, window.innerHeight);
      
      dialogWidth.value = `${dialogSize.width}px`;
      dialogHeight.value = `${dialogSize.height}px`;

      await nextTick();
      cleanTuiSvgArtifacts();
      resetHostViewport();
      initEditor(initialUrl, async () => {
        cleanTuiSvgArtifacts();
        resetHostViewport();
        // 如果有二次编辑矢量图层，在编辑器底图完全就绪后注入恢复
        if (isReEditMode.value && reEditMetadata.value?.vectorData) {
          log('[ImageEditorDialog] 正在还原历史矢量标注图层...');
          await applyVectorDataToTui(editorInstance, reEditMetadata.value.vectorData);
        }
        cleanTuiSvgArtifacts();
        resetHostViewport();
      });
    };
    img.onerror = async () => {
      await nextTick();
      cleanTuiSvgArtifacts();
      resetHostViewport();
      initEditor(initialUrl);
    };
    img.src = initialUrl;
  } else {
    window.removeEventListener('keydown', handleKeyDown, true);
    isEditorReady.value = false;
    if (editorInstance) {
      editorInstance.destroy();
      editorInstance = null;
    }
    removeTuiSvgArtifacts();
    unlockHostScroll();
    resetHostViewport();
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        resetHostViewport();
        cleanTuiSvgArtifacts();
      });
    }
  }
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown, true);
  if (editorInstance) {
    editorInstance.destroy();
    editorInstance = null;
  }
  removeTuiSvgArtifacts();
  unlockHostScroll();
  resetHostViewport();
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      resetHostViewport();
      cleanTuiSvgArtifacts();
    });
  }
});

async function waitForEditorImageLoaded(editor: any, maxWaitMs = 3000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const canvas = getFabricCanvasFromTui(editor);
    if (canvas && canvas.backgroundImage && (canvas.backgroundImage.width || 0) > 0) {
      await new Promise((r) => setTimeout(r, 80));
      return true;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

function initEditor(url: string, onReady?: () => Promise<void>) {
  if (!tuiEditorContainer.value) return;
  
  if (editorInstance) {
    editorInstance.destroy();
  }

  cleanTuiSvgArtifacts();
  resetHostViewport();

  const ImageEditorConstructor = getImageEditor();
  log('Resolved constructor dynamically:', ImageEditorConstructor);

  const plugin = usePlugin() as any;
  const configuredTools = plugin?.settings?.imageEditorTools;
  const menuTools = Array.isArray(configuredTools) && configuredTools.length > 0
    ? configuredTools
    : [...DEFAULT_IMAGE_EDITOR_TOOLS];

  const initMenu = menuTools.includes('crop') ? 'crop' : (menuTools[0] || '');

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
      menu: menuTools,
      // 默认初始化打开裁剪操作菜单（若已禁用裁剪则自动切换为首个可用菜单）
      initMenu: initMenu,
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

  // TUI Theme 构造后会向 body 挂载 default-icons，立即执行清理隔离与视口复位
  cleanTuiSvgArtifacts();
  resetHostViewport();

  // 设置 ready 状态以激活 Teleport
  isEditorReady.value = true;

  if (onReady) {
    (async () => {
      await waitForEditorImageLoaded(editorInstance);
      cleanTuiSvgArtifacts();
      resetHostViewport();
      try {
        await onReady();
      } catch (e) {
        warn('[ImageEditorDialog] onReady callback execution error:', e);
      }
      cleanTuiSvgArtifacts();
      resetHostViewport();
    })();
  }
}

function close() {
  emit('update:visible', false);
  removeTuiSvgArtifacts();
  unlockHostScroll();
  resetHostViewport();
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      resetHostViewport();
      cleanTuiSvgArtifacts();
    });
  }
}

async function handleResetOriginal() {
  if (!editorInstance) return;
  const confirmed = await showConfirm({
    title: '重置为原始底图',
    message: '确定要清空画布上的所有矢量标注并重置为干净原始底图吗？',
    confirmText: '确认重置',
    danger: true,
  });
  if (!confirmed) return;

  const canvas = getFabricCanvasFromTui(editorInstance);
  if (canvas) {
    resetCanvasObjects(canvas);
    pushMsg('已重置为干净原始底图');
  }
}

async function handleFlattenLayers() {
  const confirmed = await showConfirm({
    title: '合并固化图层',
    message: '合并固化后，将移除二次编辑元数据并降级为普通图片，后续保存后将无法再单独调整已有矢量元素。确定要合并固化吗？',
    confirmText: '合并固化',
    danger: true,
  });
  if (!confirmed) return;

  isReEditMode.value = false;
  originalStoragePath.value = '';
  if (props.blockId) {
    await removeImageBlockReEditData(props.blockId);
  }
  pushMsg('已合并固化图层，本次保存将作为普通位图存储');
}

async function downloadLocal() {
  if (!editorInstance) return;
  try {
    const { dataUrl } = await prepareCanvasExport(editorInstance, originalSize.value);

    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = props.assetName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (e) {
    error("Failed to download image", e);
  }
}

async function save() {
  if (!editorInstance) {
    warn("save clicked but editorInstance is null");
    return;
  }
  log("save clicked, export starting...");
  try {
    const { dataUrl, vectorData } = await prepareCanvasExport(editorInstance, originalSize.value);

    emit('save-edited', {
      oldName: props.assetName,
      dataUrl: dataUrl,
      blockId: props.blockId,
      vectorData: vectorData,
      isReEditMode: isReEditMode.value,
      originalStoragePath: originalStoragePath.value,
      originalSize: originalSize.value,
    });
    close();
  } catch (e) {
    error("Failed during save resolution adjustment", e);
    try {
      if (typeof editorInstance.stopDrawingMode === 'function') {
        editorInstance.stopDrawingMode();
      }
      let rawDataUrl = editorInstance.toDataURL ? editorInstance.toDataURL() : '';
      rawDataUrl = await trimAndScaleDataUrl(rawDataUrl, originalSize.value);
      const vectorData = extractVectorDataFromTui(editorInstance);
      emit('save-edited', {
        oldName: props.assetName,
        dataUrl: rawDataUrl,
        blockId: props.blockId,
        vectorData: vectorData,
        isReEditMode: isReEditMode.value,
        originalStoragePath: originalStoragePath.value,
        originalSize: originalSize.value,
      });
      close();
    } catch (err) {
      error("Fatal error saving image", err);
    }
  }
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

.reedit-badge {
  font-size: 11px;
  background-color: var(--b3-theme-primary);
  color: #fff;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: normal;
  line-height: 1.2;
}

.am-btn--sm {
  padding: 4px 8px;
  font-size: 12px;
  height: 26px;
  line-height: 1;
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

/* 确保顶栏帮助菜单中各按钮（含下载、加载、查看原图等）底色与布局整洁 */
:deep(.tui-image-editor-help-menu .tui-image-editor-download-btn) {
  background-color: transparent !important;
  border: none !important;
}

/* 确保主菜单与帮助菜单图标尺寸一致，且不受宿主可能存在的全局样式干扰 */
:deep(.tui-image-editor-help-menu svg),
:deep(.tui-image-editor-menu svg) {
  width: 24px !important;
  height: 24px !important;
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
  bottom: 56px;
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

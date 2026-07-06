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
      <div class="am-dialog__body" style="position: relative; background: #282828; padding: 16px; display: flex;" :class="{ 'annotation-mode-active': annotationMode }">
        <div ref="tuiEditorContainer" style="width: 100%; height: 100%;"></div>
        
        <!-- 画笔工具栏箭头选项（通过 Teleport 挂载到 TUI 原生画笔子菜单中） -->
        <teleport v-if="isEditorReady" to=".tui-image-editor-menu-draw .tui-image-editor-submenu-item">
          <li class="tui-image-editor-partition"><div></div></li>
          <li class="custom-arrow-select-button">
            <div class="tui-image-editor-button" :class="drawArrowType === 'none' ? 'active' : 'normal'" @click="drawArrowType = 'none'" title="无箭头">
              <div>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </div>
              <label>无箭头</label>
            </div>
            <div class="tui-image-editor-button" :class="drawArrowType === 'single' ? 'active' : 'normal'" @click="drawArrowType = 'single'" title="单向箭头">
              <div>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </div>
              <label>单箭头</label>
            </div>
            <div class="tui-image-editor-button" :class="drawArrowType === 'double' ? 'active' : 'normal'" @click="drawArrowType = 'double'" title="双向箭头">
              <div>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                  <polyline points="12 5 5 12 12 19" />
                </svg>
              </div>
              <label>双箭头</label>
            </div>
          </li>
        </teleport>

      </div>
      <div class="am-dialog__footer">
        <span v-if="annotationMode" style="margin-right: auto; color: var(--b3-theme-primary); font-size: 14px; font-weight: bold;">
          📍 序号标注模式进行中 (点击画面添加序号: {{ annotationStep }})
        </span>
        <button class="am-btn am-btn--outline" @click="downloadLocal" style="margin-right: 8px;" title="当前编辑的图片另存到本地">另存</button>
        <button class="am-btn am-btn--ghost" @click="close" title="取消编辑并关闭窗口">取消</button>
        <button class="am-btn am-btn--primary" @click="save" title="保存修改并同步到所有引用此图片的文档块">保存</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue';
import * as tuiImageEditorModule from 'tui-image-editor';
const ImageEditor = (tuiImageEditorModule as any).default || tuiImageEditorModule;
import 'tui-image-editor/dist/tui-image-editor.css';
import { readAssetFile } from '../utils/file-system';
import localeZhCN from '../i18n/tui-locale-zh';
import { calculateAnnotationShapeSize, calculateAnnotationTextTop, calculateDialogSize, type AnnotationShape } from '../utils/image-editor';

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

// 序号标注相关状态
const annotationMode = ref(false);
const annotationStep = ref(1);

// 画笔箭头相关状态
const drawArrowType = ref<'none' | 'single' | 'double'>('none');

let modeSyncTimer: any = null;

onMounted(() => {
  modeSyncTimer = setInterval(() => {
    if (editorInstance) {
      annotationMode.value = (editorInstance.getDrawingMode() === 'ANNOTATION');
    } else {
      annotationMode.value = false;
    }
  }, 200);
});

onUnmounted(() => {
  if (modeSyncTimer) {
    clearInterval(modeSyncTimer);
  }
});

watch(() => props.visible, async (newVal) => {
  if (newVal && props.assetName) {
    annotationMode.value = false;
    annotationStep.value = 1;
    drawArrowType.value = 'none';
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

  editorInstance = new ImageEditor(tuiEditorContainer.value, {
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
      menu: ['crop', 'draw', 'shape', 'icon', 'text', 'filter'],
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

  // 同步步数自增
  editorInstance.on('annotationStepChanged', (newStep: number) => {
    annotationStep.value = newStep;
  });

  if (editorInstance._graphics) {
    const canvas = editorInstance._graphics.getCanvas();

    // 监听画笔自由绘制路径
    canvas.on('path:created', (options: any) => {
      const originalPath = options.path;
      if (!originalPath || drawArrowType.value === 'none') return;

      const pathData = originalPath.path;
      if (!pathData || pathData.length < 2) return;

      const strokeWidth = originalPath.strokeWidth || 1;
      const len = Math.max(12, strokeWidth * 3);
      const arrowAngle = Math.PI * 5 / 6;

      const newPathData = [...pathData];

      // 添加尾部箭头 (单向或双向时都需要在尾部生成)
      if (drawArrowType.value === 'single' || drawArrowType.value === 'double') {
        const endPt = getSegmentEndPoint(pathData[pathData.length - 1]);
        const endDir = getEndDirection(pathData);
        if (endPt && endDir) {
          const angle = Math.atan2(endDir.dy, endDir.dx);
          const x1 = endPt.x + len * Math.cos(angle + arrowAngle);
          const y1 = endPt.y + len * Math.sin(angle + arrowAngle);
          const x2 = endPt.x + len * Math.cos(angle - arrowAngle);
          const y2 = endPt.y + len * Math.sin(angle - arrowAngle);

          newPathData.push(['M', x1, y1]);
          newPathData.push(['L', endPt.x, endPt.y]);
          newPathData.push(['L', x2, y2]);
        }
      }

      // 添加头部箭头 (仅在双向时生成)
      if (drawArrowType.value === 'double') {
        const startPt = { x: pathData[0][1], y: pathData[0][2] };
        const startDir = getStartDirection(pathData);
        if (startPt && startDir) {
          const angle = Math.atan2(startDir.dy, startDir.dx);
          const x1 = startPt.x + len * Math.cos(angle + arrowAngle);
          const y1 = startPt.y + len * Math.sin(angle + arrowAngle);
          const x2 = startPt.x + len * Math.cos(angle - arrowAngle);
          const y2 = startPt.y + len * Math.sin(angle - arrowAngle);

          newPathData.push(['M', x1, y1]);
          newPathData.push(['L', startPt.x, startPt.y]);
          newPathData.push(['L', x2, y2]);
        }
      }

      // 原地更新路径数据
      originalPath._setPath(newPathData);
      originalPath.setCoords();
      canvas.renderAll();
    });

    // 监听直线工具绘制（TUI直线工具添加的是fabric.Line）
    canvas.on('object:added', (options: any) => {
      const obj = options.target;
      if (!obj) return;

      if (drawArrowType.value !== 'none') {
        if (obj.type === 'line' && !obj.arrowProcessed) {
          obj.arrowProcessed = true;

          const arrowType = drawArrowType.value;
          const strokeWidth = obj.strokeWidth || 1;
          const len = Math.max(12, strokeWidth * 3);
          const arrowAngle = Math.PI * 5 / 6;

          const originalRender = obj._render;

          obj._render = function(this: any, ctx: CanvasRenderingContext2D) {
            // 1. 绘制原本的直线
            originalRender.call(this, ctx);

            // 2. 绘制箭头
            ctx.save();

            // 计算相对于直线中心点的局部坐标
            const cx = (this.x1 + this.x2) / 2;
            const cy = (this.y1 + this.y2) / 2;
            const startPt = { x: this.x1 - cx, y: this.y1 - cy };
            const endPt = { x: this.x2 - cx, y: this.y2 - cy };

            ctx.strokeStyle = this.stroke;
            ctx.lineWidth = this.strokeWidth;
            ctx.lineCap = this.strokeLineCap;
            ctx.lineJoin = this.strokeLineJoin;

            // 绘制尾部箭头
            if (arrowType === 'single' || arrowType === 'double') {
              const dx = endPt.x - startPt.x;
              const dy = endPt.y - startPt.y;
              const angle = Math.atan2(dy, dx);

              const x1 = endPt.x + len * Math.cos(angle + arrowAngle);
              const y1 = endPt.y + len * Math.sin(angle + arrowAngle);
              const x2 = endPt.x + len * Math.cos(angle - arrowAngle);
              const y2 = endPt.y + len * Math.sin(angle - arrowAngle);

              ctx.beginPath();
              ctx.moveTo(x1, y1);
              ctx.lineTo(endPt.x, endPt.y);
              ctx.lineTo(x2, y2);
              ctx.stroke();
            }

            // 绘制头部箭头
            if (arrowType === 'double') {
              const dx = startPt.x - endPt.x;
              const dy = startPt.y - endPt.y;
              const angle = Math.atan2(dy, dx);

              const x1 = startPt.x + len * Math.cos(angle + arrowAngle);
              const y1 = startPt.y + len * Math.sin(angle + arrowAngle);
              const x2 = startPt.x + len * Math.cos(angle - arrowAngle);
              const y2 = startPt.y + len * Math.sin(angle - arrowAngle);

              ctx.beginPath();
              ctx.moveTo(x1, y1);
              ctx.lineTo(startPt.x, startPt.y);
              ctx.lineTo(x2, y2);
              ctx.stroke();
            }

            ctx.restore();
          };
        }
      }
    });
  }

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

// 路径与箭头方向辅助计算函数
function getSegmentEndPoint(segment: any[]): { x: number; y: number } | null {
  if (!segment || segment.length < 3) return null;
  const type = segment[0];
  if (type === 'M' || type === 'L') {
    return { x: segment[1], y: segment[2] };
  } else if (type === 'Q') {
    return { x: segment[3], y: segment[4] };
  } else if (type === 'C') {
    return { x: segment[5], y: segment[6] };
  }
  return null;
}

function getEndDirection(pathData: any[][]): { dx: number; dy: number } | null {
  if (pathData.length < 2) return null;
  const lastSeg = pathData[pathData.length - 1];
  const endPt = getSegmentEndPoint(lastSeg);
  if (!endPt) return null;

  for (let i = pathData.length - 2; i >= 0; i--) {
    const prevSeg = pathData[i];
    const prevPt = getSegmentEndPoint(prevSeg) || (i === 0 ? { x: pathData[0][1], y: pathData[0][2] } : null);
    if (prevPt) {
      const dx = endPt.x - prevPt.x;
      const dy = endPt.y - prevPt.y;
      if (dx !== 0 || dy !== 0) {
        return { dx, dy };
      }
    }
  }
  return null;
}

function getStartDirection(pathData: any[][]): { dx: number; dy: number } | null {
  if (pathData.length < 2) return null;
  const startPt = { x: pathData[0][1], y: pathData[0][2] };

  for (let i = 1; i < pathData.length; i++) {
    const nextSeg = pathData[i];
    const nextPt = getSegmentEndPoint(nextSeg);
    if (nextPt) {
      const dx = startPt.x - nextPt.x;
      const dy = startPt.y - nextPt.y;
      if (dx !== 0 || dy !== 0) {
        return { dx, dy };
      }
    }
  }
  return null;
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

/* 序号标注的自定义子菜单容器样式与定位 */
.annotation-mode-active :deep(.tui-image-editor-submenu > div:not(.tui-image-editor-menu-annotation):not(.tui-image-editor-submenu-style)) {
  display: none !important;
}

/* 当序号标注激活时，强制子菜单面板显示 */
.annotation-mode-active :deep(.tui-image-editor-submenu) {
  display: table !important;
  overflow: visible !important;
}

:deep(.tui-image-editor-submenu) {
  overflow: visible !important;
}

/* 强制自定义子菜单容器显示并像原生一样作为 table-cell 垂直对齐 */
.annotation-mode-active :deep(.tui-image-editor-menu-annotation) {
  display: table-cell !important;
  vertical-align: bottom;
  text-align: center;
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

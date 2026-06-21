<template>
  <div v-if="visible" class="image-editor-dialog-overlay">
    <div class="image-editor-dialog-content" :style="{ width: dialogWidth, height: dialogHeight }">
      <div class="dialog-header">
        <h3>编辑图片: {{ assetName }}</h3>
        <div class="header-actions" style="display: flex; gap: 8px;">
          <!-- 原本这里的“开启序号标注”按钮被移除，移至 TUI 内部原生菜单栏 -->
          <button class="close-btn" @click="close">×</button>
        </div>
      </div>
      <div class="dialog-body" style="position: relative;" :class="{ 'annotation-mode-active': annotationMode }">
        <div ref="tuiEditorContainer" style="width: 100%; height: 100%;"></div>
        
        <!-- 自定义序号标注子菜单（悬浮在底部原生菜单上方） -->
        <div v-if="annotationMode" class="custom-submenu-overlay">
          <div class="submenu-item">
            <span class="submenu-label">形状</span>
            <select v-model="annotationShape" class="b3-select">
              <option value="circle">● 圆形</option>
              <option value="rect">■ 方形</option>
              <option value="triangle">▲ 三角形</option>
            </select>
          </div>
          <div class="submenu-item">
            <span class="submenu-label">背景色</span>
            <input type="color" v-model="annotationColor" class="color-picker-input" />
          </div>
          <div class="submenu-item">
            <span class="submenu-label">文字色</span>
            <input type="color" v-model="annotationTextColor" class="color-picker-input" />
          </div>
          <div class="submenu-item">
            <span class="submenu-label">文字大小</span>
            <div style="display: flex; align-items: center; gap: 8px;">
              <input type="range" v-model="annotationFontSize" min="12" max="60" />
              <span style="width: 16px; text-align: right;">{{ annotationFontSize }}</span>
            </div>
          </div>
          <div class="submenu-item">
            <span class="submenu-label">下次序号</span>
            <input type="number" v-model="annotationStep" class="b3-text-field" style="width: 50px; text-align: center; font-size: 12px; padding: 2px;" min="1" />
          </div>
        </div>

      </div>
      <div class="dialog-footer">
        <span v-if="annotationMode" style="margin-right: auto; color: var(--b3-theme-primary); font-size: 14px; font-weight: bold;">
          📍 序号标注模式进行中 (点击画面添加序号: {{ annotationStep }})
        </span>
        <button class="b3-button b3-button--outline" @click="downloadLocal" style="margin-right: 8px;" title="当前编辑的图片另存到本地">另存</button>
        <button class="b3-button b3-button--cancel" @click="close" title="取消编辑并关闭窗口">取消</button>
        <button class="b3-button b3-button--primary" @click="save" title="保存修改并同步到所有引用此图片的文档块">保存</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import ImageEditor from 'tui-image-editor';
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

// 序号标注相关状态
const annotationMode = ref(false);
const annotationStep = ref(1);
const annotationShape = ref('circle');
const annotationColor = ref('#ff4d4f');
const annotationTextColor = ref('#ffffff');
const annotationFontSize = ref(20);
let customMenuEl: HTMLElement | null = null;

watch(() => props.visible, async (newVal) => {
  if (newVal && props.assetName) {
    annotationMode.value = false;
    annotationStep.value = 1;
    
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

  // 绑定 mousedown 事件实现点击添加序号
  editorInstance.on('mousedown', async (event: any, originPointer: any) => {
    if (!annotationMode.value) return;
    
    // 如果没有获取到有效坐标，直接返回
    if (!originPointer || typeof originPointer.x !== 'number') return;
    
    const x = originPointer.x;
    const y = originPointer.y;
    const currentStep = annotationStep.value;
    
    // 立即增加步数，防止双击触发相同序号
    annotationStep.value++;
    
    try {
      let shapeObj: any = null;
      const shape = annotationShape.value as AnnotationShape;
      const fontSize = Number(annotationFontSize.value);
      const shapeSize = calculateAnnotationShapeSize(shape, fontSize);

      // 1. 添加背景形状
      if (shape === 'circle') {
        shapeObj = await editorInstance.addShape('circle', {
          fill: annotationColor.value,
          strokeWidth: 0,
          rx: shapeSize / 2, // TUI Editor 画圆需要 rx 和 ry
          ry: shapeSize / 2,
          isRegular: true
        });
      } else if (shape === 'rect') {
        shapeObj = await editorInstance.addShape('rect', {
          fill: annotationColor.value,
          strokeWidth: 0,
          width: shapeSize,
          height: shapeSize,
          isRegular: true
        });
      } else if (shape === 'triangle') {
        shapeObj = await editorInstance.addShape('triangle', {
          fill: annotationColor.value,
          strokeWidth: 0,
          width: shapeSize,
          height: shapeSize,
          isRegular: true
        });
      }

      const textTop = calculateAnnotationTextTop(shape, y, shapeSize, fontSize);
      
      // 2. 添加文字序号
      const textObj = await editorInstance.addText(String(currentStep), {
        styles: {
          fill: annotationTextColor.value,
          fontSize,
          fontWeight: 'bold',
          textAlign: 'center'
        }
      });

      // 3. 强行使用 Fabric.js 底层 API 进行绝对居中对齐，绕过 TUI Editor 的位置 Bug
      if (editorInstance._graphics) {
        const canvas = editorInstance._graphics.getCanvas();
        
        // 修正背景形状中心
        if (shapeObj) {
          const fabricShape = editorInstance._graphics.getObject(shapeObj.id);
          if (fabricShape) {
            fabricShape.set({
              originX: 'center',
              originY: 'center',
              left: x,
              top: y
            });
            fabricShape.setCoords();
          }
        }
        
        // 修正文字中心
        if (textObj) {
          const fabricText = editorInstance._graphics.getObject(textObj.id);
          if (fabricText) {
            fabricText.set({
              originX: 'center',
              originY: 'center',
              left: x,
              // 数字没有下沉字母(如g,y)，Fabric 默认居中会稍微偏上，这里给个微小的视觉补偿 (约字号的 8%)
              top: textTop
            });
            fabricText.setCoords();
          }
        }
        
        canvas.renderAll();
      }

    } catch (e) {
      console.error('Failed to add annotation', e);
    }
  });

  // 把自定义按钮注入到 TUI 原生菜单 DOM 中
  injectCustomMenu();
}

function injectCustomMenu() {
  if (!tuiEditorContainer.value) return;
  
  let attempts = 0;
  const timer = setInterval(() => {
    attempts++;
    // TUI Editor 的主菜单本身通常就是一个 ul 或者是包含了 .tui-image-editor-item 的容器
    const menuContainer = tuiEditorContainer.value?.querySelector('.tui-image-editor-menu');
    
    if (menuContainer) {
      clearInterval(timer);
      
      // 防止重复注入
      if (menuContainer.querySelector('.custom-annotation-menu')) return;

      // 创建自定义 li
      const li = document.createElement('li');
      li.className = 'tui-image-editor-item normal custom-annotation-menu';
      li.style.cursor = 'pointer';
      li.title = '序号标注'; // 使用 tooltip 提示
      // 替换为用户提供的 SVG 图标，将 #333 改为 currentColor 以适配暗色/亮色激活状态
      li.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #fff;">
          <svg width="24" height="24" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M20 9H42" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M20 19H42" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M20 29H42" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M20 39H42" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M6 29H12V32L6 38V39H12" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M7 11L9 9V19M9 19H7M9 19H11" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
      `;

      // 点击事件
      li.addEventListener('click', (e) => {
        e.stopPropagation(); // 防止冒泡触发其他逻辑
        toggleAnnotationMode();
        
        // 样式控制：移除其他菜单的激活状态
        const allItems = menuContainer.querySelectorAll('.tui-image-editor-item');
        allItems.forEach(item => {
          item.classList.remove('active');
          item.classList.add('normal');
        });
        
        if (annotationMode.value) {
          li.classList.remove('normal');
          li.classList.add('active');
          // 手动高亮自定义按钮，为了符合 TUI 暗黑主题的 active 态，可以加背景
          li.style.backgroundColor = '#fff';
          (li.querySelector('div') as HTMLElement).style.color = '#222';
        } else {
          li.style.backgroundColor = 'transparent';
          (li.querySelector('div') as HTMLElement).style.color = '#fff';
        }
      });

      // 监听其他原生按钮的点击，自动退出我们的标注模式
      const nativeItems = menuContainer.querySelectorAll('.tui-image-editor-item:not(.custom-annotation-menu)');
      nativeItems.forEach(item => {
        item.addEventListener('click', () => {
          if (annotationMode.value) {
            annotationMode.value = false;
            annotationStep.value = 1;
            li.classList.remove('active');
            li.classList.add('normal');
            li.style.backgroundColor = 'transparent';
            (li.querySelector('div') as HTMLElement).style.color = '#fff';
          }
        });
      });

      menuContainer.appendChild(li);
      customMenuEl = li;
    } else if (attempts > 20) {
      clearInterval(timer); // 超过2秒放弃
    }
  }, 100);
}

function toggleAnnotationMode() {
  annotationMode.value = !annotationMode.value;
  if (annotationMode.value) {
    // 开启模式
    if (editorInstance) {
      editorInstance.stopDrawingMode();
      editorInstance.deactivateAll();
      editorInstance.changeCursor('crosshair');
    }
  } else {
    // 关闭模式
    if (editorInstance) {
      editorInstance.changeCursor('default');
    }
  }
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
  pointer-events: auto;
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
  line-height: 1;
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
.b3-button--outline {
  background-color: transparent;
  border-color: var(--b3-theme-primary);
  color: var(--b3-theme-primary);
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

/* 序号标注的自定义子菜单 */
.annotation-mode-active :deep(.tui-image-editor-submenu) {
  display: none !important;
}

.custom-submenu-overlay {
  position: absolute;
  bottom: 80px; /* 原生菜单高度约64px + padding 16px */
  left: 16px;
  right: 16px;
  height: 50px;
  background-color: #151515; /* 使用深色实色背景，防止和底图重叠看不清 */
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 32px;
  z-index: 100;
  pointer-events: auto;
  border-bottom: 1px solid #333; /* 与底部主菜单的分割线 */
}
.submenu-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: #fff;
  font-size: 11px;
}
.submenu-label {
  color: #aaa;
  font-weight: 600;
}
.b3-select {
  background: transparent;
  color: #fff;
  border: none;
  cursor: pointer;
  outline: none;
  font-size: 12px;
}
.b3-select option {
  background: #333;
}
.color-picker-input {
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  background: transparent;
}
.color-picker-input::-webkit-color-swatch {
  border: 1px solid #fff;
  border-radius: 50%;
}
.color-picker-input::-webkit-color-swatch-wrapper {
  padding: 0;
}

/* 隐藏 TUI Image Editor 原生的 Header 按钮（Load 和 Download） */
:deep(.tui-image-editor-header-buttons) {
  display: none !important;
}

/* 隐藏 TUI Image Editor 左上角的 LOGO / 标题 */
:deep(.tui-image-editor-header-logo) {
  display: none !important;
}
</style>

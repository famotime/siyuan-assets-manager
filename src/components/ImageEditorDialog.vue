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
            <input type="number" v-model="annotationStep" class="am-input" style="width: 50px; text-align: center; font-size: 12px; padding: 2px;" min="1" />
          </div>
        </div>

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

  // 绑定 Fabric Canvas 事件实现拖拽与点击添加序号的分离
  if (editorInstance._graphics) {
    const canvas = editorInstance._graphics.getCanvas();
    
    let startX = 0;
    let startY = 0;
    let isMouseDown = false;
    let lastClearedTime = 0; // 记录上次清除选中的时间戳

    canvas.on('selection:cleared', () => {
      lastClearedTime = Date.now();
    });

    canvas.on('mouse:down', (options: any) => {
      if (!annotationMode.value) return;
      
      isMouseDown = true;
      const pointer = canvas.getPointer(options.e);
      startX = pointer.x;
      startY = pointer.y;

      // 记录起始坐标，用于联动移动
      const activeObject = canvas.getActiveObject();
      if (activeObject) {
        activeObject.lastLeft = activeObject.left;
        activeObject.lastTop = activeObject.top;
        if (activeObject.relatedObj) {
          activeObject.relatedObj.lastLeft = activeObject.relatedObj.left;
          activeObject.relatedObj.lastTop = activeObject.relatedObj.top;
        }
      }
    });

    canvas.on('mouse:up', async (options: any) => {
      if (!annotationMode.value || !isMouseDown) return;
      isMouseDown = false;

      const pointer = canvas.getPointer(options.e);
      const endX = pointer.x;
      const endY = pointer.y;

      // 计算移动位移
      const dist = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));

      // 判断此次点击是否伴随着“取消选择”动作 (时间差在 300ms 以内)
      const hasJustCleared = (Date.now() - lastClearedTime) < 300;

      // 1. 如果点击到了物体（options.target 不为空），说明想选择或拖拽它
      // 2. 如果发生了移动（dist > 5 像素），说明是拖动/选择框选行为
      // 3. 如果点击时触发了取消选择，则此行为只取消选择，不新增序号
      if (options.target || dist > 5 || hasJustCleared) {
        return;
      }

      // 在空白处单纯点击，则在该位置添加新序号
      await addAnnotationAt(endX, endY);
    });

    canvas.on('object:moving', (e: any) => {
      const activeObject = e.target;
      if (!activeObject) return;

      if (activeObject.relatedObj) {
        const related = activeObject.relatedObj;
        if (activeObject.lastLeft !== undefined && activeObject.lastTop !== undefined) {
          const dx = activeObject.left - activeObject.lastLeft;
          const dy = activeObject.top - activeObject.lastTop;
          related.set({
            left: related.left + dx,
            top: related.top + dy
          });
          related.setCoords();
        }
      }
      activeObject.lastLeft = activeObject.left;
      activeObject.lastTop = activeObject.top;
    });
  }

  // 把自定义按钮注入到 TUI 原生菜单 DOM 中
  injectCustomMenu();
}

// 在空白处点击添加序号的具体实现
async function addAnnotationAt(x: number, y: number) {
  if (!editorInstance) return;
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
        rx: shapeSize / 2,
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
      
      const fabricShape = shapeObj ? editorInstance._graphics.getObject(shapeObj.id) : null;
      const fabricText = textObj ? editorInstance._graphics.getObject(textObj.id) : null;

      // 优化边框手柄样式，避免太粗覆盖操作对象，并禁用旋转
      const setHandleStyle = (obj: any) => {
        obj.set({
          cornerSize: 8,           // 细化为 8px 的手柄大小
          borderScaleFactor: 1,    // 细化边框线宽为 1
          borderColor: '#007aff',  // 选中框边框颜色
          cornerColor: '#007aff',  // 手柄控制点填充色
          cornerStrokeColor: '#ffffff', // 手柄控制点描边颜色
          transparentCorners: false,    // 实心方块手柄
          hasRotatingPoint: false       // 禁用旋转点，避免操作序号时误旋转
        });
      };

      // 修正背景形状中心
      if (fabricShape) {
        fabricShape.set({
          originX: 'center',
          originY: 'center',
          left: x,
          top: y
        });
        setHandleStyle(fabricShape);
        fabricShape.setCoords();
      }
      
      // 修正文字中心
      if (fabricText) {
        fabricText.set({
          originX: 'center',
          originY: 'center',
          left: x,
          top: textTop
        });
        setHandleStyle(fabricText);
        fabricText.setCoords();
      }

      // 建立两者的双向联动关联
      if (fabricShape && fabricText) {
        fabricShape.relatedObj = fabricText;
        fabricText.relatedObj = fabricShape;
      }
      
      // 生成后不选中新建的序号对象，以便于连续点击画布快速生成序列
      canvas.discardActiveObject();
      canvas.renderAll();

      // 在 TUI Image Editor 的异步更新执行后，再次确保取消选中状态
      setTimeout(() => {
        canvas.discardActiveObject();
        canvas.renderAll();
      }, 50);
    }

  } catch (e) {
    console.error('Failed to add annotation', e);
  }
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
}

// 监听序号标注模式的开关，动态调整鼠标光标模式
watch(annotationMode, (newVal) => {
  if (!editorInstance || !editorInstance._graphics) return;
  const canvas = editorInstance._graphics.getCanvas();
  if (newVal) {
    editorInstance.stopDrawingMode();
    editorInstance.deactivateAll();
    
    // 空白处为十字光标，悬浮在已有对象上时自动变为拖拽移动图标
    canvas.defaultCursor = 'crosshair';
    canvas.hoverCursor = 'move';
  } else {
    canvas.defaultCursor = 'default';
    canvas.hoverCursor = 'default';
  }
  canvas.requestRenderAll();
});

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

/* 序号标注的自定义子菜单 */
.annotation-mode-active :deep(.tui-image-editor-submenu) {
  display: none !important;
}

.custom-submenu-overlay {
  position: absolute;
  bottom: 80px; /* 与底部主菜单的距离 */
  left: 0;
  right: 0;
  height: 80px; /* 增加高度，留出更多的上下空白间距 */
  background-color: rgba(21, 21, 21, 0.95); /* 统一暗色背景 */
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 40px; /* 选项之间的水平间距 */
  z-index: 100;
  pointer-events: auto;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  border-top: 1px solid rgba(255, 255, 255, 0.1);
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
  white-space: nowrap;
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

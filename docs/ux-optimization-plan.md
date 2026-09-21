# 资源管家 UI/UX 优化方案

> 审视视角：从业多年的互联网应用 UX 资深设计师  
> 审计范围：插件全部 UI 组件、样式代码、交互方式  
> 生成日期：2026-06-21 (早期版本)  
> 
> 💡 **最新设计系统与全面重构规范请查阅**：[资源管家 UI/UX 全面重构与主题自适应设计规范](./ux-ui-redesign-and-theming-specification.md)（包含线框图标防思源 CSS 污染机制、WCAG 2.1 AA 亮暗自适应色阶矩阵、图标+Tooltip 范式与指标药丸栏重构方案）。

---

## 一、总体评价

当前插件功能完整、核心流程跑通，但 UI 处于 **"能用但不精致"** 的阶段。主要体现在：

- 样式碎片化严重，没有统一的设计系统
- 交互反馈缺失，按钮、列表行等交互元素缺乏状态变化
- 视觉层次不够分明，信息密度高但引导性弱
- 多个组件各自重复定义样式，数值不一致

下面按 **样式体系 → 组件一致性 → 交互体验 → 视觉层次 → 可访问性** 五个维度展开。

---

## 二、核心问题与优化建议

### 2.1 没有设计系统 — 样式碎片化

#### 问题

| 问题 | 具体表现 |
|------|----------|
| 无全局样式文件 | `src/index.scss` 为空文件，0 字节 |
| 无设计令牌 | 没有统一的 spacing、font-size、border-radius、shadow、z-index 等变量定义 |
| 主题目录为空 | `src/components/SiyuanTheme/` 目录存在但为空 |
| 各组件各自为政 | `.b3-button` 在 3 个组件中各定义一次，参数各不相同 |

#### 建议

在 `src/index.scss` 中建立插件级设计令牌系统：

```scss
// ===== 设计令牌 =====

// 间距系统 (4px 基准)
$spacing-xs: 4px;
$spacing-sm: 8px;
$spacing-md: 12px;
$spacing-lg: 16px;
$spacing-xl: 24px;

// 圆角
$radius-sm: 4px;
$radius-md: 8px;
$radius-lg: 12px;

// 字号
$font-size-xs: 11px;
$font-size-sm: 12px;
$font-size-md: 13px;
$font-size-base: 14px;
$font-size-lg: 16px;
$font-size-xl: 18px;

// 阴影层级
$shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.1);
$shadow-md: 0 4px 16px rgba(0, 0, 0, 0.15);
$shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.2);
$shadow-xl: 0 12px 32px rgba(0, 0, 0, 0.25);

// z-index 层级表
$z-base: 1;
$z-dropdown: 10;
$z-sticky: 20;
$z-overlay: 100;
$z-modal: 200;
$z-modal-nested: 300;
$z-tooltip: 400;
$z-preview: 500;

// 动画
$transition-fast: 0.15s ease;
$transition-normal: 0.2s ease;
$transition-slow: 0.3s ease;
```

---

### 2.2 按钮样式不一致

#### 问题

`.b3-button` 在三个组件中分别定义，参数完全不同：

| 属性 | AssetsManager | VirtualAssetList | ImageEditorDialog |
|------|--------------|-----------------|-------------------|
| `padding` | `0 12px` | `4px 8px` | `6px 12px` |
| `font-size` | `14px` | `12px` | 未设置 |
| `height` | `32px` | 自适应 | 自适应 |
| `border-radius` | `4px` | `4px` | `4px` |
| hover 效果 | ❌ 无 | ❌ 无 | ❌ 无 |
| focus 效果 | ❌ 无 | ❌ 无 | ❌ 无 |
| active 效果 | ❌ 无 | ❌ 无 | ❌ 无 |
| disabled 效果 | ❌ 无 | ❌ 无 | ❌ 无 |

#### 建议

在全局样式中统一定义按钮系统，包含两种尺寸和完整的交互状态：

```scss
// ===== 按钮系统 =====

// 基础按钮
.am-btn {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid transparent;
  border-radius: $radius-sm;
  font-size: $font-size-md;
  font-weight: 500;
  white-space: nowrap;
  transition: all $transition-fast;
  user-select: none;

  // 默认尺寸
  height: 32px;
  padding: 0 14px;

  // 小尺寸（列表内操作按钮）
  &--sm {
    height: 26px;
    padding: 0 10px;
    font-size: $font-size-sm;
  }

  // 主色按钮
  &--primary {
    background-color: var(--b3-theme-primary);
    color: var(--b3-theme-on-primary);

    &:hover { filter: brightness(1.1); }
    &:active { filter: brightness(0.95); transform: scale(0.98); }
  }

  // 轮廓按钮
  &--outline {
    background-color: transparent;
    border-color: var(--b3-theme-primary);
    color: var(--b3-theme-primary);

    &:hover { background-color: var(--b3-theme-primary); color: var(--b3-theme-on-primary); }
  }

  // 危险按钮
  &--danger {
    background-color: var(--b3-theme-error);
    color: var(--b3-theme-on-error);

    &:hover { filter: brightness(1.1); }
    &:active { filter: brightness(0.95); }
  }

  // 取消/次要按钮
  &--ghost {
    background-color: transparent;
    border-color: var(--b3-theme-surface-lighter);
    color: var(--b3-theme-on-surface);

    &:hover { background-color: var(--b3-theme-surface-lighter); }
  }

  // 禁用态
  &:disabled, &[disabled] {
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: none;
  }
}
```

---

### 2.3 列表行缺乏交互反馈

#### 问题

- 资源列表行（`VirtualAssetList`）没有任何 hover 效果
- 鼠标悬停在行上时没有背景变化，无法直观感知当前聚焦的是哪一行
- 行内操作按钮在视觉上同时全部展示，信息过载
- 文件名区域有 `cursor: pointer`（因为悬停预览），但没有下划线或颜色变化暗示可交互

#### 建议

```scss
// 列表行 hover
.asset-item {
  transition: background-color $transition-fast;

  &:hover {
    background-color: var(--b3-theme-background-light);
  }

  // 操作按钮默认隐藏，hover 时显示
  .asset-actions {
    opacity: 0;
    transition: opacity $transition-fast;
  }

  &:hover .asset-actions {
    opacity: 1;
  }
}

// 文件名 hover 提示
.asset-name:hover {
  color: var(--b3-theme-primary);
  text-decoration: underline;
  text-decoration-style: dotted;
}
```

> [!TIP]
> 操作按钮 "hover 时才显示" 是文件管理器类应用（如 macOS Finder、VS Code 资源管理器）的常见模式，可大幅降低视觉噪音。"删除"按钮因高风险性，可始终以图标形式显示但淡化处理。

---

### 2.4 大量内联样式 — 维护性差

#### 问题

`VirtualAssetList.vue` 的模板中几乎每个元素都使用了长串内联 `style`，例如：

```html
<div style="width: 40px; height: 40px; margin-right: 12px; background: var(--b3-theme-background-light); display: flex; justify-content: center; align-items: center; border-radius: 4px; overflow: hidden; flex-shrink: 0;">
```

共计 **17 处** 内联样式。这导致：
- 无法统一修改（改一个值要找遍模板）
- 无法定义 hover/focus 等伪类状态
- 无法使用 SCSS 变量和嵌套
- 代码可读性差

#### 建议

将所有内联样式迁移到 `<style scoped>` 中，使用语义化类名：

```html
<!-- Before -->
<div style="width: 40px; height: 40px; margin-right: 12px; ...">

<!-- After -->
<div class="asset-thumbnail">
```

```scss
.asset-thumbnail {
  width: 40px;
  height: 40px;
  margin-right: $spacing-md;
  background: var(--b3-theme-background-light);
  display: flex;
  justify-content: center;
  align-items: center;
  border-radius: $radius-sm;
  overflow: hidden;
  flex-shrink: 0;
}
```

---

### 2.5 弹窗（Dialog）样式不统一

#### 问题

项目中有 **3 个弹窗**（主面板、重命名、图片编辑器），样式各自定义且数值不一致：

| 属性 | 主面板 (App.vue) | 重命名 (App.vue) | 重命名 (AssetsManager) | 图片编辑器 |
|------|---------|---------|---------|---------|
| `border-radius` | `8px` | `8px` | `8px` | `8px` |
| `box-shadow` | `0 8px 24px rgba(0,0,0,0.2)` | `0 4px 12px rgba(0,0,0,0.15)` | `0 4px 16px rgba(0,0,0,0.2)` | `0 4px 12px rgba(0,0,0,0.15)` |
| header `padding` | 无 header | `16px` | `12px 16px` | `16px` |
| footer `padding` | 无 footer | `16px` | `12px 16px` | `16px` |
| 遮罩透明度 | `rgba(0,0,0,0.4)` | `rgba(0,0,0,0.5)` | `rgba(0,0,0,0.5)` | `rgba(0,0,0,0.5)` |

此外，**重命名弹窗的样式在 `App.vue` 和 `AssetsManager.vue` 中重复定义了两套**，属于冗余代码。

#### 建议

抽取统一的弹窗基础样式：

```scss
// ===== 弹窗系统 =====
.am-dialog-overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.45);
  z-index: $z-modal;
  display: flex;
  justify-content: center;
  align-items: center;
  pointer-events: auto;
}

.am-dialog {
  background: var(--b3-theme-background);
  border-radius: $radius-md;
  box-shadow: $shadow-lg;
  display: flex;
  flex-direction: column;
  overflow: hidden;

  &__header {
    padding: $spacing-lg;
    border-bottom: 1px solid var(--b3-theme-surface-lighter);
    display: flex;
    justify-content: space-between;
    align-items: center;

    h3 { margin: 0; font-size: $font-size-lg; }
  }

  &__body {
    padding: $spacing-lg;
    flex: 1;
    min-height: 0;
  }

  &__footer {
    padding: $spacing-md $spacing-lg;
    border-top: 1px solid var(--b3-theme-surface-lighter);
    display: flex;
    justify-content: flex-end;
    gap: $spacing-md;
  }

  &__close {
    background: none;
    border: none;
    font-size: 20px;
    cursor: pointer;
    color: var(--b3-theme-on-surface);
    line-height: 1;
    padding: $spacing-xs;
    border-radius: $radius-sm;
    transition: background-color $transition-fast;

    &:hover { background-color: var(--b3-theme-surface-lighter); }
  }
}
```

---

### 2.6 z-index 混乱

#### 问题

当前 z-index 值分布在 6 个文件中，数值没有规律：

| z-index | 位置 | 用途 |
|---------|------|------|
| `10` | App.vue | 关闭按钮 |
| `100` | App.vue / ImageEditorDialog | 主面板遮罩 / 标注子菜单 |
| `200` | App.vue | 根容器 |
| `1000` | ImageEditorDialog | 图片编辑器遮罩 |
| `1001` | AssetsManager | 重命名弹窗遮罩 |
| `1100` | App.vue | 全局重命名弹窗遮罩 |
| `9999` | AssetsManager | 图片悬浮预览 |

存在的风险：
- `9999` 是典型的 "z-index 战争" 信号
- 图片预览 (9999) 会遮住弹窗 (1000/1100)，但弹窗才应该在最顶层
- 没有文档化的层级系统

#### 建议

建立统一的层级表（见 2.1 设计令牌），按语义分配：

```
$z-base:          1    // 普通内容
$z-dropdown:      10   // 下拉菜单
$z-sticky:        20   // 粘性元素
$z-overlay:       100  // 主面板遮罩
$z-modal:         200  // 弹窗 (重命名、图片编辑器)
$z-modal-nested:  300  // 嵌套弹窗 (弹窗内再弹弹窗)
$z-tooltip:       400  // 工具提示
$z-preview:       500  // 图片悬浮预览
```

---

### 2.7 图片编辑器硬编码颜色

#### 问题

`ImageEditorDialog.vue` 中大量使用硬编码颜色值：

```css
background: #282828;           /* TUI 编辑器背景 */
background-color: #151515;     /* 标注子菜单背景 */
border-bottom: 1px solid #333; /* 分割线 */
color: #fff;                   /* 子菜单文字 */
color: #aaa;                   /* 子菜单标签 */
background: #333;              /* select option */
border: 1px solid #ccc;        /* 颜色选择器边框 */
border: 2px solid #000;        /* 选中态边框 */
```

这些颜色无法跟随思源笔记的主题变化（如亮色主题下，`#282828` 背景会非常突兀）。

#### 建议

- TUI Editor 本身强制暗色，`#282828` 背景可以保留但应加注释说明原因
- 标注子菜单的颜色改为使用 CSS 变量，使其至少在视觉上与 TUI 暗色主题保持协调感

```scss
.custom-submenu-overlay {
  // TUI Editor 强制暗色主题，此处使用与其协调的暗色系
  background-color: rgba(21, 21, 21, 0.95);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}
```

---

### 2.8 排序指示器过于简陋

#### 问题

列表表头的排序指示用的是纯文本 `↑` `↓` 字符：

```html
文件名 <span v-if="sortField === 'name'">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
```

- 没有视觉权重区分，不够醒目
- 未激活的列头没有任何提示"可以点击排序"
- 点击排序时没有任何过渡动画

#### 建议

- 使用 SVG 小箭头图标替代文本字符
- 未激活的列头显示淡化的双箭头（↕），提示可排序
- 当前排序列使用主题色高亮
- 添加排序切换时的旋转动画

```html
<svg class="sort-icon" :class="{ active: sortField === 'name', desc: sortOrder === 'desc' }">
  <path d="M7 10l5 5 5-5z"/>
</svg>
```

```scss
.sort-icon {
  width: 16px;
  height: 16px;
  fill: var(--b3-theme-on-surface-light);
  transition: transform $transition-fast;
  opacity: 0.3;

  &.active {
    opacity: 1;
    fill: var(--b3-theme-primary);
  }

  &.desc {
    transform: rotate(180deg);
  }
}
```

---

### 2.9 表头与列表行的对齐依赖硬编码宽度

#### 问题

表头和列表行使用硬编码的固定宽度来对齐列：

```
缩略图: 52px (header) / 40px+12px margin (row)
后缀名: 80px
大小: 100px
引用数: 100px
操作: 220px
```

这种方式：
- 窄屏下操作列可能溢出
- 宽屏下空间浪费
- 后缀名 80px 对于 `.webp` 等长后缀够用，但 "引用数" 100px 与内容相比显得过宽

#### 建议

- 使用 CSS Grid 或 `table-layout: fixed` 代替手动宽度分配
- 考虑对操作列使用 `min-width` 而非固定宽度
- 窄屏下可隐藏低优先级列（如后缀名），或将操作按钮折叠为下拉菜单

---

### 2.10 关闭按钮使用文本字符 `×`

#### 问题

重命名弹窗的关闭按钮使用了 HTML 文本 `×` 字符：

```html
<button class="close-btn" @click="closeGlobalRenameDialog">×</button>
```

- `×` 在不同字体下渲染大小不一致
- 点击区域仅依赖文本大小，偏小
- 与主面板的 SVG 关闭按钮风格不统一（主面板用了内联 SVG 叉号）

#### 建议

统一使用 SVG 图标，并确保足够的点击区域（至少 32×32px）：

```html
<button class="am-dialog__close" @click="close" aria-label="关闭">
  <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
</button>
```

---

### 2.11 非图片资源的图标过于简陋

#### 问题

非图片类型的资源使用 emoji `📁` 作为缩略图占位：

```html
<span v-else>📁</span>
```

- emoji 在不同操作系统上的渲染差异很大
- 没有区分不同文件类型（PDF、音频、视频等都显示同一个 emoji）
- 与整体 UI 的视觉风格不协调

#### 建议

根据文件扩展名显示对应的 SVG 图标：

| 文件类型 | 扩展名 | 图标 |
|---------|--------|------|
| PDF | `.pdf` | 📄 PDF 图标 |
| 音频 | `.mp3` `.wav` `.ogg` | 🎵 音频图标 |
| 视频 | `.mp4` `.webm` | 🎬 视频图标 |
| 文档 | `.docx` `.xlsx` | 📝 文档图标 |
| 其他 | 其余 | 📎 通用文件图标 |

使用统一风格的 SVG 图标集（推荐 Lucide Icons 或思源内置图标），保持视觉一致。

---

### 2.12 加载状态过于简单

#### 问题

加载状态仅显示一行文字：

```html
<div v-else class="loading-state">
  正在扫描 Siyuan 数据库并构建资源关联表，请稍候...
</div>
```

- 没有加载动画（旋转、骨架屏等），用户不确定是否在工作
- 刷新按钮在加载时有旋转 SVG，但主内容区域没有

#### 建议

- 使用旋转图标 + 文字的组合
- 或使用骨架屏（Skeleton）模拟列表加载态，减少布局跳动
- 文案可以更精简

```html
<div class="loading-state">
  <svg class="spinning-icon" .../>
  <span>正在扫描资源...</span>
</div>
```

---

### 2.13 `window.confirm` 破坏沉浸感

#### 问题

当前的确认操作（删除、清理、后缀名修改等）全部使用了浏览器原生 `window.confirm()`：

```typescript
const confirmDelete = window.confirm(`确定要删除 ${asset.name} 吗？...`);
const delOld = window.confirm(`图片已保存为 ${newName} 且引用已更新。\n是否将旧图片 ${oldName} 放入回收站？`);
```

原生对话框的问题：
- **样式无法自定义**，与插件 UI 风格完全割裂
- **阻塞主线程**，用户体验生硬
- **在某些 webview 环境下表现不一致**

#### 建议

封装一个应用内确认弹窗组件 `ConfirmDialog`，复用弹窗系统样式。对于危险操作（删除、清理），使用红色主题强调风险：

```
┌──────────────────────────────┐
│  ⚠️ 确认删除                  │
│                              │
│  确定要删除 screenshot.png？  │
│  此操作不可撤销。             │
│                              │
│           [取消]  [确认删除]   │
└──────────────────────────────┘
```

---

### 2.14 输入框缺乏聚焦反馈

#### 问题

搜索框和重命名输入框没有定义 `:focus` 状态：

```css
.b3-text-field {
  border: 1px solid var(--b3-theme-surface-lighter);
  /* 没有 :focus 样式 */
}
```

用户点击输入框后没有视觉变化，不清楚焦点在哪。

#### 建议

```scss
.am-input:focus {
  border-color: var(--b3-theme-primary);
  box-shadow: 0 0 0 2px rgba(var(--b3-theme-primary-rgb), 0.2);
  outline: none;
}
```

---

## 三、优先级排序

| 优先级 | 编号 | 优化项 | 影响面 | 工作量 |
|--------|------|--------|--------|--------|
| **P0** | 2.1 | 建立设计令牌系统 | 全局 | 中 |
| **P0** | 2.2 | 统一按钮样式 | 全局 | 中 |
| **P0** | 2.3 | 列表行交互反馈 | 主界面 | 小 |
| **P0** | 2.4 | 内联样式迁移到 class | VirtualAssetList | 中 |
| **P1** | 2.5 | 统一弹窗样式 | 全局弹窗 | 中 |
| **P1** | 2.6 | z-index 规范化 | 全局 | 小 |
| **P1** | 2.13 | 替换 window.confirm | 全局交互 | 中 |
| **P1** | 2.14 | 输入框聚焦反馈 | 搜索/重命名 | 小 |
| **P2** | 2.8 | 排序指示器优化 | 列表表头 | 小 |
| **P2** | 2.10 | 统一关闭按钮为 SVG | 弹窗 | 小 |
| **P2** | 2.11 | 非图片资源图标 | 列表 | 小 |
| **P2** | 2.12 | 加载状态增强 | 主界面 | 小 |
| **P2** | 2.7 | 图片编辑器颜色处理 | 编辑器 | 小 |
| **P2** | 2.9 | 列宽度自适应 | 列表 | 中 |

---

## 四、建议实施路径

```
第一步：建立基础设施
├── 在 index.scss 中定义设计令牌
├── 定义全局按钮样式 (.am-btn)
├── 定义全局弹窗样式 (.am-dialog)
└── 定义全局输入框样式 (.am-input)

第二步：迁移组件样式
├── VirtualAssetList 内联样式 → class
├── 统一所有 .b3-button → .am-btn
├── 统一所有弹窗 → .am-dialog
└── 规范化 z-index

第三步：增强交互
├── 添加列表行 hover
├── 添加按钮交互态
├── 优化排序指示器
└── 封装 ConfirmDialog 替换 window.confirm

第四步：视觉精修
├── 非图片文件类型图标
├── 加载状态动画
└── 图片编辑器配色协调
```

> [!IMPORTANT]
> 建议每一步完成后都进行完整的视觉走查和功能回归测试，避免样式迁移引入布局问题。

# 资源管家 UI/UX 设计规范 (Design System & Specification)

> **版本**：v1.2.0  
> **适用项目**：思源笔记资源管家插件 (`siyuan-assets-manager`)  
> **定位**：插件全界面视觉规范、交互范式与设计系统单一事实来源 (Single Source of Truth)  
> **核心原则**：桌面生产力、高信噪比、思源宿主原生融合、亮暗双模完美自适应、拒绝平庸设计 (Anti-AI Slop)

---

## 目录

- [一、设计哲学与核心原则](#一设计哲学与核心原则)
  - [1.1 桌面生产力与秩序美学](#11-桌面生产力与秩序美学)
  - [1.2 思源原生融合 (Host-Native Affinity)](#12-思源原生融合-host-native-affinity)
  - [1.3 拒绝平庸的“AI Slop”设计理念](#13-拒绝平庸的ai-slop设计理念)
- [二、设计令牌系统 (Design Tokens)](#二设计令牌系统-design-tokens)
  - [2.1 4px 韵律间距与尺寸令牌](#21-4px-韵律间距与尺寸令牌)
  - [2.2 圆角与阴影层级](#22-圆角与阴影层级)
  - [2.3 字阶与字重系统](#23-字阶与字重系统)
  - [2.4 严格分层的 Z-Index 语义表](#24-严格分层的-z-index-语义表)
  - [2.5 动效与时间函数](#25-动效与时间函数)
- [三、图标系统工程化与宿主 CSS 污染绝对防御](#三图标系统工程化与宿主-css-污染绝对防御)
  - [3.1 思源 CSS 强污染机理与防御策略](#31-思源-css-强污染机理与防御策略)
  - [3.2 线框图标双保险防御架构](#32-线框图标双保险防御架构)
  - [3.3 规范化矢量语义图标库（严禁 Emoji 乱用）](#33-规范化矢量语义图标库严禁-emoji-乱用)
- [四、亮暗双主题自适应色彩体系 (WCAG 2.1 AA+)](#四亮暗双主题自适应色彩体系-wcag-21-aa)
  - [4.1 动态混色系统 (color-mix) 与主题变量映射](#41-动态混色系统-color-mix-与主题变量映射)
  - [4.2 六大资源分类色彩矩阵 (Light vs Dark)](#42-六大资源分类色彩矩阵-light-vs-dark)
  - [4.3 状态微标与功能色阶](#43-状态微标与功能色阶)
- [五、核心交互范式与基础组件](#五核心交互范式与基础组件)
  - [5.1 按钮系统规范 (Button Hierarchy)](#51-按钮系统规范-button-hierarchy)
  - [5.2 思源原生 Tooltip (b3-tooltips) 规范](#52-思源原生-tooltip-b3-tooltips-规范)
  - [5.3 输入框与固定扩展名组件 (.am-input-group)](#53-输入框与固定扩展名组件-am-input-group)
  - [5.4 应用内阻塞确认弹窗 (ConfirmDialog 体系)](#54-应用内阻塞确认弹窗-confirmdialog-体系)
- [六、信息架构与高信噪比布局规范](#六信息架构与高信噪比布局规范)
  - [6.1 两段式弹性顶栏布局 (Two-Tier Header)](#61-两段式弹性顶栏布局-two-tier-header)
  - [6.2 分段指标药丸导航栏 (Segmented Metric Pills)](#62-分段指标药丸导航栏-segmented-metric-pills)
  - [6.3 虚拟列表与渐进式呈现 (Progressive Disclosure)](#63-虚拟列表与渐进式呈现-progressive-disclosure)
  - [6.4 底部悬浮批量操作浮岛 (Floating Batch Action Dock)](#64-底部悬浮批量操作浮岛-floating-batch-action-dock)
  - [6.5 统一模态弹窗系统 (Unified Modal Architecture)](#65-统一模态弹窗系统-unified-modal-architecture)
  - [6.6 插件原生设置面板卡片化布局规范](#66-插件原生设置面板卡片化布局规范)
- [七、可访问性与性能约束](#七可访问性与性能约束)
  - [7.1 键盘无障碍与焦点管理](#71-键盘无障碍与焦点管理)
  - [7.2 虚拟滚动与高密度渲染性能](#72-虚拟滚动与高密度渲染性能)
  - [7.3 质量验收核对表 (Pre-Delivery Checklist)](#73-质量验收核对表-pre-delivery-checklist)

---

## 一、设计哲学与核心原则

### 1.1 桌面生产力与秩序美学

- **工具透明性 (Instrumental Transparency)**：界面的本质是服务于资产检索、引用核实与安全处理，而非喧宾夺主。背景色与容器边界应当克制后退，操作引导与元数据呈现应当清晰精准。
- **高密度与可呼吸感并存 (Dense yet Breathable)**：单屏保持至少展示 10~15 条资源项的桌面效率密度；通过 4px 韵律网格、文字权重反差与微边框隔断建立视觉节奏，杜绝无效留白。
- **渐进式呈现 (Progressive Disclosure)**：非高频操作默认弱化，悬停时即时响应浮现，减少常态下的视觉噪声。

### 1.2 思源原生融合 (Host-Native Affinity)

- **主题无缝跟随**：严禁私自硬编码 HEX 颜色。所有核心色彩一律基于思源原生设计变量 `--b3-theme-*` 派生，确保在思源官方明暗主题及第三方社区主题（如 Savor、Asri、Sofun 等）下保持原生一致性。
- **原生交互控件对齐**：使用思源原生的 `b3-tooltips` 提示气泡、`b3-switch` 开关与 `b3-text-field` 语义类，保证操作心智与主程序统一。

### 1.3 拒绝平庸的“AI Slop”设计理念

为保证专业桌面软件的高效与稳健，本插件在 UI 层面坚决执行“四不”原则：
1. **不滥用无节制毛玻璃与荧光渐变**：严禁在滚动态全屏使用 `backdrop-filter: blur()`，仅在轻量浮层（如悬浮操作浮岛、悬浮预览卡片）做克制修饰，避免主线程滚动掉帧。
2. **不使用对比度缺失的死灰文字**：所有文本颜色对比度严格符合 WCAG 2.1 AA+，杜绝低于 3:1 的低反差灰色。
3. **不使用移动端膨胀大圆角与巨大留白**：坚决摒弃 `rounded-2xl`（16px+）等破坏桌面排版的泡泡圆角，交互控件统一采用 4px~8px 的严谨紧凑圆角。
4. **不使用操作系统 Emoji 充当 UI 界面图标**：不同操作系统与设备环境的 Emoji 渲染风格断层严重，全界面必须使用专业矢量线框图标（Lucide）。

---

## 二、设计令牌系统 (Design Tokens)

所有设计令牌集中定义于 `src/index.scss`，严禁在业务组件中随意写入无章法的魔数。

### 2.1 4px 韵律间距与尺寸令牌

```scss
// ===== 基础间距令牌 (基于 4px 韵律) =====
$spacing-xs: 4px;   // 微间距、徽章内边距
$spacing-sm: 8px;   // 紧凑间距、图标文字间距、表单元素内边距
$spacing-md: 12px;  // 标准间距、工具栏项目间隙
$spacing-lg: 16px;  // 弹窗内边距、区块外边距
$spacing-xl: 24px;  // 大容器留白、弹窗边缘安全区

// ===== 交互控件标准化高度 =====
$height-control-sm: 26px; // 列表内紧凑按钮、行操作控件
$height-control-md: 30px; // 指标药丸、工具栏按钮、检索输入框
$height-control-lg: 32px; // 主操作按钮、弹窗操作栏按钮
```

### 2.2 圆角与阴影层级

```scss
// ===== 圆角令牌 =====
$radius-xs: 2px;  // 微型缩略图角标、序号标签
$radius-sm: 4px;  // 基础按钮、输入框、下拉框、缩略图
$radius-md: 6px;  // 设置卡片、浮动浮岛药丸
$radius-lg: 8px;  // 模态弹窗视窗、悬浮预览面板
$radius-pill: 15px; // 顶部指标胶囊药丸 (高度 30px 时完全圆角)

// ===== 阴影层级 =====
$shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.1);    // 下拉面板、微型气泡
$shadow-md: 0 4px 12px rgba(0, 0, 0, 0.15);  // 悬浮工具栏、提示卡片
$shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.2);   // 模态弹窗、去重对比视窗
$shadow-xl: 0 12px 32px rgba(0, 0, 0, 0.25); // 悬浮批量操作浮岛、全屏预览
```

### 2.3 字阶与字重系统

```scss
// ===== 字号阶梯 =====
$font-size-xs:   11px; // 次要元数据、药丸计数、更新时间小字
$font-size-sm:   12px; // 辅助说明、列头标题、列表内小按钮
$font-size-md:   13px; // 列表正文、输入框文本、设置项描述
$font-size-base: 14px; // 弹窗正文、按钮默认字号、小标题
$font-size-lg:   16px; // 弹窗主标题
$font-size-xl:   18px; // 插件主标题、全屏视图主标

// ===== 字重阶梯 =====
$font-weight-normal: 400;
$font-weight-medium: 500;
$font-weight-semibold: 600;
$font-weight-bold: 700;
```

### 2.4 严格分层的 Z-Index 语义表

为彻底根绝“z-index 军备竞赛”，插件全域禁止出现 `9999` 等无规则数值，严格依据下表执行：

| 变量名 | 层级数值 | 适用场景 |
|---|---|---|
| `$z-base` | `1` | 常规内容流、列表行背景 |
| `$z-dropdown` | `10` | 输入框下拉候选菜单、行内操作展开菜单 |
| `$z-sticky` | `20` | 表头粘性吸顶、分页浮动栏 |
| `$z-overlay` | `100` | 主界面遮罩、操作遮蔽层 |
| `$z-batch-dock` | `110` | 底部悬浮批量操作浮岛 (`$z-overlay + 10`) |
| `$z-modal` | `200` | 插件主窗口、基础弹窗 |
| `$z-modal-nested` | `300` | 弹窗内次级弹窗 |
| `$z-tooltip` | `400` | 提示气泡 (`b3-tooltips`) |
| `$z-preview` | `500` | 列表媒体悬浮预览卡片 |
| `$z-editor` | `1000` | 全局 TUI 图片二次编辑弹窗 |
| `$z-deduplicate` | `1050` | 智能去重比对弹窗 |
| `$z-rename` | `1100` | 全局重命名弹窗遮罩 |
| `$z-confirm` | `3000` | 应用内阻断式确认弹窗 (`ConfirmDialog`) |

### 2.5 动效与时间函数

```scss
$transition-fast:   0.15s ease;                     // 按钮悬停、图标着色、行背景变化
$transition-normal: 0.2s cubic-bezier(0.16, 1, 0.3, 1); // 悬浮浮岛弹出、弹窗淡入淡出
$transition-slow:   0.3s ease;                      // 折叠面板展开收起
```

---

## 三、图标系统工程化与宿主 CSS 污染绝对防御

### 3.1 思源 CSS 强污染机理与防御策略

思源原生及大部分社区主题（如 Savor、Asri 等）为了使系统图标跟随字体变色，通常在全局样式表中定义了激进的强行覆盖规则：

```css
/* 思源或主题全局强行污染规则 */
svg { fill: currentColor !important; }
.b3-button svg, .b3-dialog svg, .b3-list-item svg { fill: currentColor !important; }
```

现代专业线框图标（如 Lucide）的设计规范是 **Stroke 轮廓构形**（`fill: none`, `stroke: currentColor`, `stroke-width: 2`）。若无防御，镂空图形会被宿主全局样式强制填满，导致**撤销箭头变成黑扇形、画笔变成黑块、垃圾桶变成黑方砖**。

### 3.2 线框图标双保险防御架构

为彻底杜绝此类污染，采取**“行内强防御 + 全局 SCSS 深度穿透屏障”**双保险机制：

#### 保险 1：行内样式强防御
在所有组件模板的 `<svg>` 或 Lucide 组件节点上，强制显式绑定行内样式：
```html
<RotateCw :size="14" style="fill: none !important;" />
<Trash2 :size="14" style="fill: none !important;" />
```

#### 保险 2：全局 SCSS 绝对防御屏障
在 `src/index.scss` 中加入最高权重的作用域选择器，拦截并修复一切未显式标记 `data-allow-fill` 的矢量线框元素：

```scss
// ===== 线框图标绝对防御屏障 (Anti-Pollution Shield) =====
.siyuan-assets-manager-app,
.assets-manager-container,
.am-dialog,
.am-tab-container,
.am-modal-dialog,
.am-confirm-dialog-overlay {
  svg:not([data-allow-fill]),
  .lucide,
  svg.lucide {
    fill: none !important;
    stroke: currentColor !important;
    stroke-linecap: round;
    stroke-linejoin: round;

    path, circle, rect, line, polyline, polygon {
      &:not([data-allow-fill]) {
        fill: none !important;
      }
    }
  }
}
```

### 3.3 规范化矢量语义图标库（严禁 Emoji 乱用）

项目内全量清退所有 Emoji 占位，收拢为标准化 Lucide 矢量图标，严格对应业务语意：

| 原 Emoji / 裸文本 | 所在位置 | 统一规范组件 | 视觉寓意与状态 |
|---|---|---|---|
| `⚠️` | `ConfirmDialog` 标题前缀 | `<AlertTriangle :size="18" />` | 危险操作警示，色值绑定 `--b3-theme-error` |
| `✨` | `DeduplicateDialog` 空状态 | `<Sparkles :size="36" />` | 洁净无冗余感知，色值绑定主题色 |
| `📄` | 文档路径标示 | `<FileText :size="12" />` | 严谨的文档元数据标示 |
| `✅` | 已完成/已合并徽标 | `<CheckCircle2 :size="14" />` | 绿色成功完成状态 |
| `↑` / `↓` 字符 | 列表表头排序指示 | `<ArrowUp :size="12" />` / `<ArrowDown :size="12" />` | 消除字符不等宽抖动，激活态高亮 |
| `📁` 字符 | 非图片文件缩略图 | `<div class="file-icon">{{ badgeText }}</div>` | 语义化文件类型徽章（如 PDF/AUDIO/DOC） |
| `...` 文本 | 加载与旋转状态 | `<RotateCw :size="14" class="spinning" />` | 平滑旋转微动效 |

---

## 四、亮暗双主题自适应色彩体系 (WCAG 2.1 AA+)

### 4.1 动态混色系统 (color-mix) 与主题变量映射

插件通过现代 CSS `color-mix()` 技术，完全以思源宿主变量为基底动态推导半透明表面与状态色阶，完美自适应任何明暗及彩色主题：

```scss
:root {
  // 1. 交互表面令牌
  --am-surface-hover: color-mix(in srgb, var(--b3-theme-on-surface, #333) 6%, transparent);
  --am-surface-active: color-mix(in srgb, var(--b3-theme-on-surface, #333) 10%, transparent);

  // 2. 主题主色半透明变体
  --am-primary-subtle: color-mix(in srgb, var(--b3-theme-primary, #4285f4) 12%, transparent);
  --am-primary-hover: color-mix(in srgb, var(--b3-theme-primary, #4285f4) 18%, transparent);
  --am-primary-border: color-mix(in srgb, var(--b3-theme-primary, #4285f4) 40%, transparent);

  // 3. 列表行悬浮高亮 (亮色模式)
  --am-row-hover: color-mix(in srgb, var(--b3-theme-primary, #4285f4) 6%, var(--b3-theme-surface, #fff));
  --am-row-hover-unref: color-mix(in srgb, #f59e0b 6%, var(--b3-theme-surface, #fff));

  // 4. 危险与警示色阶
  --am-error-subtle: color-mix(in srgb, var(--b3-theme-error, #d23f31) 10%, transparent);
  --am-error-hover: color-mix(in srgb, var(--b3-theme-error, #d23f31) 16%, transparent);
  --am-error-border: color-mix(in srgb, var(--b3-theme-error, #d23f31) 35%, transparent);

  // 5. 边框层级
  --am-border-subtle: color-mix(in srgb, var(--b3-border-color, var(--b3-theme-surface-lighter, #e5e7eb)) 70%, transparent);
  --am-border-strong: var(--b3-border-color, var(--b3-theme-surface-lighter, #d1d5db));
}

// 适配思源暗色主题 (宿主 html[data-theme-mode="dark"] 自动切换)
html[data-theme-mode="dark"] {
  --am-row-hover: color-mix(in srgb, var(--b3-theme-primary, #4285f4) 9%, var(--b3-theme-surface, #2c2c2c));
  --am-row-hover-unref: color-mix(in srgb, #fbbf24 8%, var(--b3-theme-surface, #2c2c2c));
}
```

### 4.2 六大资源分类色彩矩阵 (Light vs Dark)

分类色彩是用户快速识别资源类型的核心心理锚点。在明暗双模式下，分类色彩均经过对比度调优（亮色下稳重深沉、暗色下微降饱和度并提升明度），完全符合 WCAG 2.1 AA 标准（对比度 $\ge 4.5:1$）：

```scss
:root {
  // 亮色模式 (对比度 >= 4.8:1)
  --am-cat-all:     var(--b3-theme-primary, #4285f4);
  --am-cat-image:   #059669; // 翡翠绿 (Emerald 600)
  --am-cat-doc:     #2563eb; // 经典蓝 (Blue 600)
  --am-cat-audio:   #d97706; // 琥珀橙 (Amber 600)
  --am-cat-video:   #dc2626; // 玫瑰红 (Red 600)
  --am-cat-archive: #7c3aed; // 罗兰紫 (Violet 600)
  --am-badge-original-color: #b45309;
}

html[data-theme-mode="dark"] {
  // 暗色模式 (对比度 >= 5.5:1)
  --am-cat-all:     var(--b3-theme-primary, #4285f4);
  --am-cat-image:   #34d399; // 浅翠绿 (Emerald 400)
  --am-cat-doc:     #60a5fa; // 浅天蓝 (Blue 400)
  --am-cat-audio:   #fbbf24; // 暖琥珀 (Amber 400)
  --am-cat-video:   #f87171; // 珊瑚红 (Red 400)
  --am-cat-archive: #a78bfa; // 浅薰衣草 (Violet 400)
  --am-badge-original-color: #fbbf24;
}
```

### 4.3 状态微标与功能色阶

- **二次编辑标注 (`--reedit`)**：绑定 `var(--b3-theme-primary)`，纯线框文字与描边，无突兀背景；
- **原始隔离底图 (`--original`)**：绑定 `var(--am-badge-original-color)`，提示用户该底图受到特殊隔离保护；
- **丢失物理文件 (`--missing`)**：绑定 `var(--b3-theme-error)`，标红展示提示修复或清理；
- **音频静音标记**：半透明警示红色阶 `var(--am-error-subtle)` + `var(--b3-theme-error)`。

---

## 五、核心交互范式与基础组件

### 5.1 按钮系统规范 (Button Hierarchy)

插件全域采用统一的 `.am-btn` 体系，废弃各自为政的行内定义：

| 类名修饰符 | 尺寸/外观 | 适用场景 | 交互态反馈 |
|---|---|---|---|
| `.am-btn` | `32px` 高度，文字按钮 | 弹窗底部操作、主要表单确认 | 背景微调、Scale 微动 |
| `.am-btn--sm` | `26px` 高度，紧凑按钮 | 列表内操作、浮岛辅助按钮 | 紧凑边距、字号 12px |
| `.am-btn--icon` | `28px × 28px`，透明底 | 工具栏动作、列表操作列 | Hover 微浮动、浅底背景 |
| `.am-btn--primary` | 主题色填充、反白文字 | 主操作确认（合并、保存、提交） | Hover 亮度 +10%、Active 0.98 缩放 |
| `.am-btn--danger` | 错误红填充、反白文字 | 高风险破坏性操作（单删、批删） | Hover 亮度提升、危险警示 |
| `.am-btn--icon-danger`| 纯图标、悬停变红 | 列表操作列删除按钮 | 默认低调浅灰，Hover 激活浅红背景与红图标 |
| `.am-btn--ghost` | 透明底、边框线条 | 取消、关闭操作 | Hover 浅灰背景填充 |

### 5.2 思源原生 Tooltip (`b3-tooltips`) 规范

彻底废除 HTML 原生延迟高、不可定制的 `title` 属性，全量使用思源原生 `b3-tooltips`。

#### 文案构建公式
$$\text{Tooltip 提示内容} = \text{动作意图 (动词短语)} + \text{ [快捷键 / 影响说明]}$$

- 示例：`刷新资源列表 (R)`、`重命名此资源并自动更新引用`、`批量删除选中的 5 个文件`、`在后台打开并定位引用此资源的文档`。

#### 方位与防溢出约束
- 默认工具栏居中操作采用底部提示：`b3-tooltips b3-tooltips__s`；
- 紧贴右上角或弹窗右边缘的按钮采用西南向对齐：`b3-tooltips b3-tooltips__sw`；并在 SCSS 中增加防溢出保护：

```scss
.b3-tooltips__sw {
  &::after {
    left: auto !important;
    right: 0 !important;
    transform: none !important;
    white-space: nowrap !important;
    z-index: 1001 !important;
  }
  &::before {
    left: auto !important;
    right: 8px !important;
    transform: none !important;
    z-index: 1001 !important;
  }
}
```

### 5.3 输入框与固定扩展名组件 (`.am-input-group`)

重命名资产时，用户误改或删去扩展名会导致文件解析损坏。为此构建专用的 `.am-input-group` 组件，将后缀名剥离为不可变动的锁定挂件（Addon）：

```html
<div class="am-input-group">
  <input v-model="baseName" type="text" class="am-input" placeholder="输入新文件名" />
  <span v-if="ext" class="am-input-group__addon">.{{ ext }}</span>
</div>
```

```scss
.am-input {
  height: 32px;
  padding: 4px 8px;
  border: 1px solid var(--b3-theme-surface-lighter);
  border-radius: 4px;
  background: var(--b3-theme-background-light);
  color: var(--b3-theme-on-background);
  transition: all $transition-fast;

  &:focus {
    border-color: var(--b3-theme-primary);
    box-shadow: 0 0 0 2px rgba(var(--b3-theme-primary-rgb, 66, 133, 244), 0.2);
    outline: none;
  }
}

.am-input-group {
  display: flex;
  align-items: stretch;
  width: 100%;

  .am-input {
    flex: 1;
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }

  &__addon {
    display: inline-flex;
    align-items: center;
    padding: 0 10px;
    font-size: 13px;
    color: var(--b3-theme-on-surface-light);
    background-color: var(--b3-theme-surface-lighter);
    border: 1px solid var(--b3-border-color);
    border-left: none;
    border-top-right-radius: 4px;
    border-bottom-right-radius: 4px;
    user-select: none;
  }
}
```

### 5.4 应用内阻塞确认弹窗 (`ConfirmDialog` 体系)

彻底废除浏览器原生 `window.confirm()`（其破坏沉浸感、不同 Webview 渲染不一致且会挂起事件轮询）。通过响应式状态管理器 `showConfirm()` 统一触发：

- **最高优先级呈现**：固定处于 `$z-confirm: 3000`，绝对凌驾于所有业务弹窗和全屏编辑器之上；
- **快捷键物理拦截**：按下 `Escape` 键自动触发取消，且使用事件捕获严格阻止事件穿透到宿主编辑器；
- **破坏性操作警示**：当 `danger: true` 时，头部自动带出 `<AlertTriangle>` 红标，确认按钮自动转为 `.am-btn--danger`。

---

## 六、信息架构与高信噪比布局规范

### 6.1 两段式弹性顶栏布局 (Two-Tier Header)

为防止小屏或分屏窄视口下顶栏控件错位挤压，主面板采用严格的两段式弹性解耦布局：

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 资源管家  [1,420 / 1,420 项 · 284 MB]             上次刷新：10:30  [↻刷新] [✨去重] [🗑清理] [⏱日志] │ ← Top Tier
├─────────────────────────────────────────────────────────────────────────────────┤
│ [ ≡ | ⑉ ]  [🔍 搜索资源名称...       (x)]  [全部属性 ▾]        [按总大小 ▾] [↓] [⇕] │ ← Filter Tier
└─────────────────────────────────────────────────────────────────────────────────┘
```

1. **第一层 (Top Tier - Brand & Global Actions)**：
   - 左侧：品牌标题 + 实时统计徽章（`sortedAssets.length / assets.length 项 · 总大小`）；
   - 右侧：上次刷新时间文本 + 核心动作按钮群（刷新、去重、综合清理、操作日志；多选状态下平滑切换为批量删除与取消）；
2. **第二层 (Filter Tier - View & Query Toolbar)**：
   - 左侧：双视图模式切换药丸（平铺视图 vs 文档归类） + 复合搜索胶囊输入舱 + 属性筛选下拉（全部、可二次编辑、原始底图、未引用、丢失资源、大文件）；
   - 右侧：文档模式专属控制组件（文档卡片排序字段、升降序切换按钮、全部折叠/展开按钮）。

### 6.2 分段指标药丸导航栏 (Segmented Metric Pills)

传统看板通常采用占用近 70px 纵深的大块卡片，严重挤压列表可视高度。本规范将其压缩重构为一组水平滑动的**分段指标药丸栏 (Height 30px)**：

```html
<div class="category-pills-bar">
  <button
    v-for="card in categoryCards"
    :key="card.key"
    class="category-pill"
    :class="{ 'is-active': activeCategory === card.key }"
    @click="handleCategoryClick(card.key)"
  >
    <span class="pill-icon" :style="{ color: card.color }">
      <component :is="card.icon" :size="14" style="fill: none !important;" />
    </span>
    <span class="pill-label">{{ card.label }}</span>
    <span class="pill-badge">{{ categoryStats[card.key]?.count || 0 }}</span>
    <span class="pill-size">{{ categoryStats[card.key]?.sizeText || '0 B' }}</span>
  </button>
</div>
```

- **视觉收益**：垂直方向直接释放出 **40px+** 的主视口空间（等同于多展示 1 行完整资产数据）；
- **响应式支持**：底边集成 `3px` 极细微滚动条，在任何窄屏下均可平滑横滑，不产生折行换行。

### 6.3 虚拟列表与渐进式呈现 (Progressive Disclosure)

为承载数以万计的笔记资源，列表采用 `@vueuse/core` 的 `useVirtualList` 进行视口虚拟滚动开窗，同时遵循渐进式视觉流呈现原则：

```
+----+------+--------------------------+------+--------+---------------------+----+-------------------+
| [] | 🖼  | screenshot-2026.png  [可编辑] | .png | 1.2 MB | 2026-10-02 10:00:00 | 2  |  [↗] [✎] [I] [🗑]  |
+----+------+--------------------------+------+--------+---------------------+----+-------------------+
                                                                                     ^ 悬停/选中时完全显现
                                                                                     (静止时 opacity 0.25)
```

1. **静止常态**：末尾操作按钮列降低透明度至 `opacity: 0.25`，整屏消除数十个高对比重复图标，信噪比大幅提升；
2. **行悬停态**：背景变为柔和主题浅色（`var(--am-row-hover)`），文件名微高亮，操作按钮平滑浮现（`opacity: 1`）；
3. **行选中态**：背景切换为主题半透明底色（`rgba(66, 133, 244, 0.12)`），操作列保持常显；
4. **列宽对齐**：使用固定像素列（复选框 32px、预览 48px、后缀 75px、大小 85px、更新时间 155px、文档数 70px、操作 170px）与自适应列（文件名 `flex: 1`）结合，确保表头与表体严格像素级垂直对齐。

### 6.4 底部悬浮批量操作浮岛 (Floating Batch Action Dock)

当用户通过 Shift / Ctrl 批量勾选多个资产时，视线与鼠标通常处于列表中下部。为符合菲茨定律（Fitts's Law）就近交互原则，在列表正下方滑入悬浮操作浮岛：

```html
<div v-if="selectedNames.size > 0" class="am-batch-floating-dock">
  <div class="am-batch-floating-dock__info">
    <span>已选 <strong class="am-batch-floating-dock__count">{{ selectedNames.size }}</strong> 项</span>
    <span>({{ selectedSummary.sizeText }})</span>
  </div>
  <div class="am-batch-floating-dock__divider"></div>
  <div class="am-batch-floating-dock__actions">
    <button class="am-btn am-btn--sm am-btn--ghost" @click="clearSelection">取消选择</button>
    <button class="am-btn am-btn--sm am-btn--danger" @click="handleBatchDelete">
      <Trash2 :size="13" style="fill: none !important;" />
      <span>批量删除</span>
    </button>
  </div>
</div>
```

- **出现动效**：通过 `@keyframes am-dock-slide-up` 实现由下至上伴随微缩放的平滑滑入；
- **安全阻断**：点击“批量删除”即刻调起 `ConfirmDialog`，列出已选文件名清单与受影响引用数，杜绝误触。

### 6.5 统一模态弹窗系统 (Unified Modal Architecture)

全插件所有模态弹窗（包括资产管理主视窗、智能去重比对、删除操作审计与回退历史、图片编辑器、重命名弹窗）均继承统一的基础骨架：

```html
<div class="am-dialog-overlay" @click.self="handleMaskClose">
  <div class="am-dialog [custom-dialog-class]">
    <!-- 统一弹窗头 -->
    <header class="am-dialog__header">
      <div class="header-title-box">
        <component :is="TitleIcon" :size="18" style="fill: none !important;" />
        <h3>{{ dialogTitle }}</h3>
        <span v-if="badgeText" class="header-badge">{{ badgeText }}</span>
      </div>
      <button class="am-dialog__close b3-tooltips b3-tooltips__sw" aria-label="关闭窗口 (Esc)" @click="handleClose">
        <X :size="16" style="fill: none !important;" />
      </button>
    </header>

    <!-- 统一内容区 -->
    <main class="am-dialog__body">
      <slot />
    </main>

    <!-- 统一操作底栏 -->
    <footer class="am-dialog__footer">
      <slot name="footer" />
    </footer>
  </div>
</div>
```

### 6.6 插件原生设置面板卡片化布局规范

在思源原生设置弹窗内，针对插件配置项构建舒适优雅的卡片化开关与网格体系：
- **卡片式开关 (`.am-setting-card`)**：标题加粗、描述文字自适应折行、右侧内嵌原生 `b3-switch`；激活时背景产生浅蓝/浅绿光晕并带有平滑边框过渡；
- **工具启用网格 (`.am-setting-tools-grid`)**：自适应网格展示图片编辑器标注工具卡片（`.am-setting-tool-chip`），集成线框图标、工具名称与复选框。

---

## 七、可访问性与性能约束

### 7.1 键盘无障碍与焦点管理

1. **Escape 全局关闭**：所有模态浮层与弹窗（主视窗、去重、历史、编辑、重命名、确认弹窗）均注册顶层 Escape 按键捕获，且使用 `e.stopPropagation()` 阻止穿透到思源宿主，防止意外触发思源全局搜索或撤销。
2. **快捷键支持**：
   - 资源列表聚焦时支持 `Ctrl + A` 全选当前筛选视图内的所有文件；
   - 包含多选时支持按 `Delete` / `Backspace` 快速触发批量删除阻断确认；
   - 重命名弹窗打开时，自动对焦并全选基本文件名（去除扩展名部分）。
3. **输入焦点反馈**：所有输入框与下拉选择器均带有明显的 `:focus` 外发光（`box-shadow: 0 0 0 2px rgba(...)`），高亮当前光标锚点。

### 7.2 虚拟滚动与高密度渲染性能

1. **视口精准开窗**：虚拟滚动行高与 CSS 容器实际测量高度严格同源绑死，确保万级资源下 DOM 节点数恒定在 30 个以内。
2. **图片异步解码与懒加载**：列表与画廊中的缩略图均显式声明 `loading="lazy"` 与 `decoding="async"`，规避滚动时批量图像解码阻塞主线程。
3. **宿主隔离脱标**：通过 `src/utils/host-isolation.ts` 物理清理 TUI 隐式注入到 `document.body` 的空 SVG 节点，根容器设置 `pointer-events: none` 与 `overflow: visible`，严禁干扰思源底层的文档视口。

### 7.3 质量验收核对表 (Pre-Delivery Checklist)

在任何界面修改提交前，必须逐项自查以下硬性指标：

- [x] **图标无黑坨污染**：在思源默认亮色、默认暗色以及高权重第三方主题下走查，所有线框图标鏤空处均无黑色实心填充；
- [x] **杜绝操作系统 Emoji**：界面中无一处使用系统原生 Emoji 充当 UI 按钮或状态标记；
- [x] **双模高对比度**：正文文字对比度 $\ge 7:1$，元数据与辅助说明对比度 $\ge 4.5:1$；无突兀的固定 HEX 颜色遗留；
- [x] **操作按钮全配备 Tooltip**：所有纯图标按钮均包含思源原生 `b3-tooltips`，靠右边缘按钮使用西南定位 `b3-tooltips__sw`；
- [x] **双视图像素对齐**：平铺列表视图与文档归类视图在不同窗宽下，列头与数据行保持严格对齐；
- [x] **就近批处理闭环**：多选时底部悬浮浮岛平滑滑出，批量删除前弹出阻塞确认弹窗保护数据安全；
- [x] **宿主无痛集成**：所有模态窗口均支持 Esc 关闭，不污染思源原生事件栈。

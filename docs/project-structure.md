# 项目结构

更新日期：2026-11-08

## 顶层目录

| 路径 | 职责 |
| --- | --- |
| `src/` | 插件源码，包含 Siyuan 插件入口、Vue 应用、组件、工具函数和类型声明 |
| `tests/` | Vitest 单元测试（55 套件 / 526 测试），覆盖资源解析、目录扫描装配、工作流编排、块引用更新、列表逻辑、跳转内核、选中/缩略图状态机、图片编辑辅助逻辑、元数据压缩、TUI/Fabric 桥接与底图管理 |
| `docs/` | 项目维护与重构文档（结构说明、设计方案、重构计划）；`docs/reference/` 为本地参考资料（不入库） |
| `developer_docs/` | Siyuan 插件和 API 参考资料，不参与运行时代码（仅本机，不入库） |
| `dist/` | 构建输出目录，由 `pnpm run build` 生成 |

## 设计与流程文档

| 路径 | 说明 |
| --- | --- |
| `docs/design.md` | 资源管家 UI/UX 设计规范 (Design System & Specification，单一事实来源) |
| `docs/refactor-plan.md` | 重构计划与演进记录（当前轮次：2026-11-08 RF-001~008） |
| `docs/project-structure.md` | 项目目录与模块职责结构说明 |

> 历史设计方案与产品预览文章已归档至 `docs/reference/`（本地参考资料，不入库）。

## 运行时代码

| 路径 | 职责 |
| --- | --- |
| `src/index.ts` | Siyuan 插件类入口；注册图标、平台信息、顶层生命周期和图片右键菜单（支持 blockId 检测与二次编辑状态动态感知） |
| `src/main.ts` | Vue 应用挂载、卸载和插件实例绑定 |
| `src/App.vue` | 顶层应用编排；管理主面板显示、全局图片编辑与重命名弹窗交互 |
| `src/api.ts` | Siyuan kernel API 精简封装（保留 SQL 查询、通知推送、文件读写、块更新与块自定义属性读写等核心方法） |
| `src/index.scss` | 全局样式入口 |
| `src/i18n/index.ts` | 插件级 i18n 访问器：`plugin.i18n`（随思源语言设置）→ 内置 zh_CN.json 兜底 → key 本身；支持 `{name}` 插值与英文复数 |
| `src/i18n/*.json` | 插件国际化文案（zh_CN / en_US） |
| `src/i18n/tui-locale-zh.ts` | TUI Image Editor 中文词条 |

## Vue 组件

| 路径 | 职责 |
| --- | --- |
| `src/components/AssetsManager.vue` | 资源管理主面板；两阶段扫描/快照增量加载编排、多维筛选、平铺与文档归类视图切换、定向更新壳（`applyTargetedAssetUpdate` 纯函数承接列表变换）、操作工具栏编排 |
| `src/components/AssetMediaPreview.vue` | 媒体悬浮预览子组件；支持图片大图自适应、音视频悬浮播放器（默认静音、进度快进、播放/暂停、音频声波律动与动态定位） |
| `src/components/VirtualAssetList.vue` | 虚拟滚动平铺列表；列表高性能渲染、类型徽章展示与行级操作事件；缩略图 Blob 缓存与行选中逻辑复用 `asset-thumbnail` / `asset-selection` |
| `src/components/DocumentAssetGroupList.vue` | 按文档归类视图；把分组摊平成行序列后交由 `useVirtualList` 开窗渲染，折叠的文档不产生资源行，行高由 `DOC_ROW_HEIGHTS` 内联绑定；与平铺列表共享缩略图/选中实现 |
| `src/components/DeduplicateDialog.vue` | 去重与归一化弹窗；扫描调度与进度、精确/相似双 Tab、主资源切换、批量归一化（确认文案由 `buildBatchMergeConfirmMessage` 生成）、文档跳转复用 `doc-jump` |
| `src/components/DeletionHistoryDialog.vue` | 删除审计与回退历史弹窗；历史记录容量配置、分类筛选（全部/去重/清理/手动）、系统回收站跳转、清空日志、悬浮缩略图与逆向回退确认 |
| `src/components/DeletionHistoryCard.vue` | 单批次操作卡片子组件；展示批次类型徽章、去向、时间、文件与容量统计、展开明细表格、关联文档快速跳转、回退报告与一键回退 |
| `src/components/ImageEditorDialog.vue` | TUI Image Editor 弹窗；支持二次编辑模式、干净原始底图加载与矢量图层注入还原、重置为原始底图、合并固化图层、高保真导出与保存 |
| `src/components/ConfirmDialog.vue` | 通用确认对话框组件 |

## 工具与服务层模块

### 领域模型与装配层（纯逻辑，零 UI 依赖）

| 路径 | 职责 |
| --- | --- |
| `src/utils/asset-model.ts` | 资产领域模型层：`AssetInfo`/`BlockRef` 类型、系统保护名单、纯装配函数（引用挂载/统计/元数据绑定）与 `getNotebookMap` 环境查询；禁止依赖上层模块（module-boundaries 守护），打破原 siyuan-db 三角循环 |
| `src/utils/catalog-resolve.ts` | 目录库存纯装配层（零 I/O）：扫描契约类型族 + `resolveCatalogPipelineFromEntries` 融合流水线（块引用/属性视图保底/PDF 伴生/AI 会话/画布/Sidecar/底图拓扑）+ `resolveCatalogInventory` + `mergeAssetStatsInto` |
| `src/utils/asset-list.ts` | 展示层纯函数集：过滤（含 `reeditable`）、排序、分类统计、扩展名/徽章/大小/时间格式化、清理汇总计算与文档分组（`groupAssetsByDocument`） |

### 扫描与查询编排层

| 路径 | 职责 |
| --- | --- |
| `src/utils/asset-catalog.ts` | 目录扫描编排门面：两阶段渐进扫描（本地快速枚举/内核 readDir 降级）、引用支持源采集（含 IAL→Sidecar 自动迁移）、增量块校验三路查询、库存 TTL 缓存与渲染后 stat 并发补全；对 catalog-resolve 全量 re-export |
| `src/utils/catalog-snapshot.ts` | 扫描快照持久化与秒开：快照序列化/载入、stat 缓存叠加、水位线管理 |
| `src/utils/siyuan-db.ts` | 高层资产查询门面：`getAllAssetsInfo`、`getAssetInfoByName`（含 Sidecar 自愈）、底图删除/孤儿清理；类型与纯函数经 re-export 保持兼容 |
| `src/utils/request-guard.ts` | 内核请求守卫：超时控制与并发上限，防止大工作空间下请求无限挂起 |
| `src/utils/canvas-asset.ts` | 无界画布资产：画布 JSON 引用解析、工作空间递归扫描、画布专属资产清单构建、删除/空目录清理与 `openCanvasInTab` 集成 |

### 业务工作流服务层

| 路径 | 职责 |
| --- | --- |
| `src/utils/cleanup-workflow.ts` | 删除与清理业务编排服务层；集中封装单文件删除、批量删除与综合清理长流程，实现二次确认提示、底图警告、文件删除、引用清理与审计批次记录 |
| `src/utils/asset-workflow.ts` | 保存编辑与重命名长业务编排服务层（deps 注入风格）；封装图片保存编辑工作流（位图保存、引用更新、底图归档、属性同步写入、原图删除）与资源重命名工作流 |
| `src/utils/asset-targeted-update.ts` | 定向更新列表变换纯函数：rename/edit × 旧名存在/缺失 × deletedOld × 原图引用联动 × 选中集迁移的完整状态机，缩略图失效经 deps 注入 |

### 去重与归一化

| 路径 | 职责 |
| --- | --- |
| `src/utils/deduplicate.ts` | 去重扫描门面与调度流水线（大小分桶 → SHA-256 → 感知哈希）、指纹增量复用、多组归一化合并、缓存持久化与 `buildBatchMergeConfirmMessage` 确认文案 |
| `src/utils/dedup-hash.ts` | 图像感知哈希算法纯计算层；提供高效 SHA-256 计算、环境保底哈希、9x8 灰度矩阵 64 位 dHash 生成与汉明距离计算 |
| `src/utils/dedup-normalize.ts` | 去重归一化合并工作流层；执行单组冗余合并、块引用重定向、数据库单元格改写、二次编辑元数据迁移、合并前快照采集与物理文件删除 |
| `src/utils/dedup-fingerprint-store.ts` | per-asset 指纹（sha256/dHash/分辨率）的失效校验、裁剪与持久化；仅走 `plugin.saveData`，不落 localStorage |

### 审计与回退

| 路径 | 职责 |
| --- | --- |
| `src/utils/deletion-logger.ts` | 删除历史批次的持久化（`plugin.saveData`，上限 0~100）、回退状态与回退报告（成功/跳过/失败/位置降级/精确/近似/属性/数据库单元格）写入；批次条目含合并前快照、数据库单元格快照与部分失败标记 |
| `src/utils/rollback-engine.ts` | 删除批次逆向回退：去重批次按快照精确/近似还原块正文、块属性（题头图等）与数据库单元格，单文件/批量删除批次按快照与位置锚点还原被清空的块；并提供回退文件预检 `checkRollbackFilePresence` |
| `src/utils/rollback-anchor.ts` | 回退位置锚点：删除前经 `/api/block/getChildBlocks`（内核 AST 文档序）采集真实前/后兄弟与父块、文档两级序号；回退时按"相邻块 → 父块序号 → 文档序号 → 旧候选链"再锚定，并标记位置降级 |
| `src/utils/inverse-reference.ts` | 引用逆向还原决策层：借合并前快照区分 `exact`（正向变换等于当前值 ⇒ 整段写回快照）/ `approximate`（值已被改动 ⇒ 按原引用处数限量改回）/ `skip`（已不含主图引用 ⇒ 不动） |

### 块与属性视图读写

| 路径 | 职责 |
| --- | --- |
| `src/utils/siyuan-block.ts` | 对引用资源的 blocks 执行替换/移除/删除（含 kramdown 实时兜底）、`custom-asset-reedit` 块属性读写、引用零值复核与批量引用计数查询 |
| `src/utils/attribute-view.ts` | 属性视图（数据库）解析与改写：引用提取、按名替换/移除，单元格快照采集 `captureAttributeViewAssetCells` 与两套还原（去重按名改回 `restoreAttributeViewAssetCells`、删除整值还原 `restoreAttributeViewCellsAfterDeletion`）；文件读写样板收敛于内部助手 |
| `src/utils/asset-markdown.ts` | Markdown 中 assets 引用解析、替换、移除和正则转义（零依赖叶子模块） |
| `src/utils/doc-group-rows.ts` | 按文档归类的行模型；把分组摊平为一维虚拟滚动行序列（`buildDocRows`），并集中定义行高常量 `DOC_ROW_HEIGHTS` |

### UI 支撑与基础设施

| 路径 | 职责 |
| --- | --- |
| `src/utils/doc-jump.ts` | 文档跳转内核：画布路径统一解析 `resolveCanvasPath`、单引用跳转 `openBlockRefInTab`（伪引用提示/失效预检/openTab action 契约/文案注入）与循环多开参数组装 `buildOpenTabOptions` |
| `src/utils/asset-thumbnail.ts` | 缩略图 Blob URL 缓存工厂 `createThumbnailCache`：原始底图/画布资产按需加载、并发去重、失效释放与整体 dispose（deps 注入可单测） |
| `src/utils/asset-selection.ts` | 行选中纯状态机：Shift 区间/Ctrl·Cmd 切换/单选三态（`applyRowClickSelection`）与勾选框切换 `toggleAssetSelection` |
| `src/utils/image-editor.ts` | 图片编辑器弹窗尺寸计算、导出流水线（`prepareCanvasExport`）、画布对象重置（`resetCanvasObjects`）、100% 物理分辨率换算、Alpha 像素切边与重采样、键盘快捷键处理、删除日志缩略图生成 |
| `src/utils/editor-tools.ts` | 图片编辑器工具栏配置与 SVG 图标常量层；管理画笔、形状、箭头、文本、序号、马赛克等工具选项与状态 |
| `src/utils/plugin-settings.ts` | 插件设置面板原生 DOM 构建器与数据持久化；支持 7 项核心开关配置与 `imageEditorTools` 动态保存 |
| `src/utils/plugin-entry.ts` | 插件入口纯函数；从 DOM 获取资源文件名与最近块 `data-node-id` |
| `src/utils/asset-actions.ts` | 编辑后文件名生成、重命名输入校验和扩展名决策 |
| `src/utils/reedit-data.ts` | 二次编辑元数据合法性校验、自适应阈值压缩（<2KB 明文 vs >=2KB `lz-string` 编码）与反序列化 |
| `src/utils/tui-image-editor-bridge.ts` | TUI / Fabric 桥接模块；抽取纯矢量图层、反序列化注入 Fabric Canvas、序号联动关系重建 |
| `src/utils/host-isolation.ts` | 宿主视口滚动锁定拦截与 TUI 隐式 SVG 节点物理脱标清理 |
| `src/utils/file-system.ts` | 存储门面兼容桥接层；资源文件读取、保存、删除、重命名，以及原始底图隔离存储（`storage/petal/siyuan-assets-manager/originals/`）的安全读写 |
| `src/utils/storage/` | 统一存储门面与 Seam 抽象（`IStorageAdapter`、`ElectronStorageAdapter`、`HttpStorageAdapter`、`MemoryStorageAdapter`、`normalizeOriginalStoragePath`） |
| `src/utils/concurrency.ts` | 保序并发池：在飞数受限、可中止、进度上报 |
| `src/utils/confirm.ts` | 交互式确认弹窗 Promise 封装 |
| `src/utils/logger.ts` | 日志服务 |
| `src/utils/plugin-context.ts` | 插件全局上下文安全获取（utils 层获取插件实例的唯一通道） |

### 依赖方向约定（tests/module-boundaries.test.ts 守护）

```
main / 组件 → 各 utils 模块
asset-catalog（编排）→ catalog-resolve（纯装配）→ asset-model（纯模型）→ asset-markdown / api
siyuan-db（查询门面）→ asset-model + asset-catalog + siyuan-block + attribute-view
asset-model 禁止反向依赖 catalog / block / attribute-view / siyuan-db
utils 禁止 import src/main（组件层同样约定，DeduplicateDialog 已对齐 plugin-context）
```

## 类型

| 路径 | 职责 |
| --- | --- |
| `src/types/index.d.ts` | Siyuan 常用全局类型、窗口扩展和前端平台枚举 |
| `src/types/api.d.ts` | Siyuan API 返回结构补充声明 |
| `src/types/reedit.d.ts` | 二次编辑元数据 `IAssetReEditMetadata`、矢量图层载荷与保存事件类型定义 |
| `src/shims-vue.d.ts` | `*.vue` 模块类型声明（供 tsc 解析 SFC 导入） |

## 测试 (54 Suites / 514 Tests)

### 领域模型与目录扫描

| 路径 | 覆盖范围 |
| --- | --- |
| `tests/asset-catalog.test.ts` | 装配管线：Sidecar 保护、AV 引用、`.pdf.sya` 伴生、系统保护、AI 会话、avRawContents 保底 |
| `tests/asset-catalog-cache.test.ts` | 库存 TTL 缓存：命中/过期/失效/合并 |
| `tests/asset-catalog-incremental.test.ts` | 增量三路查询与两入口一致性 |
| `tests/asset-catalog-fetch.test.ts` | 采集编排：本地快速枚举/内核 readDir/双失败降级链、IAL→Sidecar 自动迁移写路径、degraded 降级标记 |
| `tests/catalog-snapshot.test.ts` | 快照序列化/载入与 stat 缓存叠加 |
| `tests/stat-fill-priority.test.ts` | stat 补全优先级与节流契约 |
| `tests/missing-assets.test.ts` | 丢失资源识别与统计 |
| `tests/siyuan-db.test.ts` | 资源聚合、二次编辑绑定、SQL 注入安全、孤儿底图与清理 |
| `tests/canvas-asset.test.ts` | 画布引用解析、时间戳修复、清单构建与 openCanvasInTab |
| `tests/request-guard.test.ts` | 请求守卫超时与并发控制 |
| `tests/module-boundaries.test.ts` | 架构边界：utils 禁止反向引用主入口、asset-model 零上层依赖、catalog/block/av 无 siyuan-db 回边 |

### 业务工作流与审计回退

| 路径 | 覆盖范围 |
| --- | --- |
| `tests/cleanup-workflow.test.ts` | 单文件删除、底图警告、批量删除与综合清理长流程业务编排 |
| `tests/asset-workflow.test.ts` | 图片保存编辑与重命名长流程业务编排、底图归档分支与块属性广播 |
| `tests/asset-targeted-update.test.ts` | 定向更新表驱动矩阵：rename/edit × 存在/缺失 × deletedOld × 原图联动 × 选中迁移 × 缩略图回调 |
| `tests/deletion-logger.test.ts` | 批次持久化与回退报告写入 |
| `tests/rollback-anchor.test.ts` | 位置锚点采集与回退再锚定链 |
| `tests/rollback-engine.test.ts` | 去重/删除批次快照还原、IAL 题头图还原、位置降级统计与回退文件预检 |
| `tests/inverse-reference.test.ts` | 逆向还原三态、同组多冗余顺序无关终态、URI 编码与旧日志降级 |
| `tests/attribute-view.test.ts` | 引用提取与替换、单元格快照采集、两套还原、缩进保真、跳过计数、av 块查询降级 |

### 去重与归一化

| 路径 | 覆盖范围 |
| --- | --- |
| `tests/deduplicate.test.ts` | 去重扫描三阶段与指纹复用增量、score 重算、组身份顺序无关性、缓存版本判废、归一化安全复核 |
| `tests/dedup-hash.test.ts` | SHA-256、保底哈希、9x8 灰度 dHash 与汉明距离 |
| `tests/dedup-fingerprint-store.test.ts` | 指纹失效判据、裁剪、存取往返与版本判空 |
| `tests/dedup-batch-confirm.test.ts` | 批量归一化确认文案：跨组文档去重统计口径与相似模式文案切换 |

### 列表、选中与缩略图

| 路径 | 覆盖范围 |
| --- | --- |
| `tests/asset-list.test.ts` | 过滤、排序、徽章、格式化、清理统计与文档分组 |
| `tests/asset-selection.test.ts` | 行选中状态机：Shift 区间/Ctrl·Cmd/单选/稀疏窗口/不可变性 |
| `tests/asset-thumbnail.test.ts` | 缩略图缓存：三分支直链、并发去重、失败重试、invalidate/dispose 释放 |
| `tests/doc-group-rows.test.ts` | 文档归类行模型：折叠/展开、搜索强制展开、行高常量、key 唯一性 |
| `tests/doc-asset-group.test.ts` | 文档资源分组逻辑 |
| `tests/document-asset-group-list.test.ts` | 文档归类视图组件：渲染契约与万级资源虚拟窗口 |
| `tests/asset-manager-toolbar.test.ts` | 主面板顶部操作区与刷新时间推进 |
| `tests/asset-manager-doc-sort.test.ts` | 文档卡片排序与编辑后重排 |
| `tests/asset-manager-video-preview.test.ts` | 视频悬浮预览默认静音契约 |
| `tests/asset-media-preview.test.ts` | 媒体悬浮预览组件播放控制事件 |

### 跳转与弹窗

| 路径 | 覆盖范围 |
| --- | --- |
| `tests/doc-jump.test.ts` | 跳转内核：画布路径口径、伪引用、失效预检（含多 id 任一存活）、openTab 契约与错误降级 |
| `tests/deletion-history-dialog.test.ts` | 历史弹窗生命周期、回收站、回退阻塞与跳转 |
| `tests/deletion-history-card.test.ts` | 单批次卡片渲染与事件 |
| `tests/confirm.test.ts` | 交互式确认弹窗 Promise 契约 |

### 图片编辑与基础设施

| 路径 | 覆盖范围 |
| --- | --- |
| `tests/image-editor.test.ts` | 编辑器尺寸、分辨率、画布重置、Alpha 扫描、快捷键、host-isolation 直连断言 |
| `tests/tui-bridge.test.ts` | TUI 构造解析、Fabric Canvas 提取与矢量图层还原 |
| `tests/reedit-data.test.ts` | 元数据校验、自适应压缩往返与容错 |
| `tests/host-isolation.test.ts` | 视口滚动锁定与脱标清理 |
| `tests/siyuan-block.test.ts` | 块引用替换/移除/删除、IAL 解析与 re-edit 属性读写 |
| `tests/siyuan-block-batch-verify.test.ts` | 批量引用计数分批查询与失败上抛 |
| `tests/asset-markdown.test.ts` | 引用提取、特殊字符替换、图片/链接/纯路径移除 |
| `tests/asset-markdown-excerpt.test.ts` | markdown 摘要裁剪 |
| `tests/asset-actions.test.ts` | 编辑命名、重命名校验和扩展名确认 |
| `tests/file-system.test.ts` | 路径规范化、绝对路径计算与 DataURL 转 Blob |
| `tests/storage.test.ts` | 统一存储门面与多适配器读写 |
| `tests/concurrency.test.ts` | 并发池契约：保序、在飞上限、中止、进度单调 |
| `tests/settings.test.ts` | 设置面板 DOM 渲染与持久化 |
| `tests/plugin-entry.test.ts` | 入口资源名解析与 blockId 提取 |
| `tests/plugin-context.test.ts` | 插件上下文安全获取 |
| `tests/i18n.test.ts` | i18n 访问器兜底与插值 |
| `tests/logger.test.ts` | 日志输出 |
| `tests/project-metadata.test.ts` | 插件元数据和 i18n 文案校验 |

## 构建与验证

| 命令 | 说明 |
| --- | --- |
| `pnpm install` | 安装依赖（强制 pnpm，`preinstall` 以 only-allow 校验） |
| `pnpm test` | 运行全部 Vitest 单元测试（55 套件 / 526 测试，jsdom 环境） |
| `pnpm run build` | 生产构建，输出 `dist/` 并生成 `package.zip`（含集市规范校验） |
| `pnpm run dev` | Vite watch 构建到配置的 Siyuan 工作空间插件目录 |
| `npx tsc --noEmit` | 类型检查（当前 0 告警） |

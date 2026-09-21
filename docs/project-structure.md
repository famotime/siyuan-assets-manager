# 项目结构

更新日期：2026-08-15

## 顶层目录

| 路径 | 职责 |
| --- | --- |
| `src/` | 插件源码，包含 Siyuan 插件入口、Vue 应用、组件、工具函数和类型声明 |
| `tests/` | Vitest 单元测试，覆盖资源解析、工作流编排、块引用更新、列表逻辑、入口工具、图片编辑辅助逻辑、元数据压缩、TUI/Fabric 桥接与底图管理 |
| `docs/` | 项目维护与重构文档，包含结构说明、基于块属性的图片二次编辑方案、重构计划等 |
| `developer_docs/` | Siyuan 插件和 API 参考资料，不参与运行时代码 |
| `dist/` | 构建输出目录，由 `npm run build` 生成 |

## 设计与技术规范文档

| 路径 | 说明 |
| --- | --- |
| `docs/deduplicate-safety-optimization-plan.md` | 图片去重与归一化安全优化方案与实施计划（消除裂图与资源丢失隐患） |
| `docs/unreferenced-assets-detection-specification.md` | 未引用资源与孤儿底图识别设计方案与判定规范（对齐思源官方内核规则） |
| `docs/secondary-image-editing-plan.md` | 矢量图片二次编辑与隔离底图技术方案 |
| `docs/ux-ui-redesign-and-theming-specification.md` | 资源管家 UI/UX 全面重构与主题自适应设计规范（资深设计师视角，拒绝 AI Slop） |
| `docs/ux-optimization-plan.md` | 用户体验与交互优化规范方案 (历史版本) |
| `docs/refactor-plan.md` | 重构计划与演进记录 |
| `docs/project-structure.md` | 项目目录与模块职责结构说明 |

## 运行时代码

| 路径 | 职责 |
| --- | --- |
| `src/index.ts` | Siyuan 插件类入口；注册图标、平台信息、顶层生命周期和图片右键菜单（支持 blockId 检测与二次编辑状态动态感知） |
| `src/main.ts` | Vue 应用挂载、卸载和插件实例绑定 |
| `src/App.vue` | 顶层应用编排；管理主面板显示、全局图片编辑与重命名弹窗交互 |
| `src/api.ts` | Siyuan kernel API 精简封装（保留 SQL 查询、通知推送、文件读写、块更新与块自定义属性读写等核心方法） |
| `src/index.scss` | 全局样式入口 |
| `src/i18n/*.json` | 插件国际化文案 |

## Vue 组件

| 路径 | 职责 |
| --- | --- |
| `src/components/AssetsManager.vue` | 资源管理主面板；加载资源、多维筛选（含可二次编辑）、大图预览、定位引用、删除、清理孤儿资源与清理孤立底图 |
| `src/components/VirtualAssetList.vue` | 虚拟滚动资源列表；负责列表高性能渲染、非图片类型徽章展示（`getAssetBadgeText`）、`[可二次编辑]` 徽标展示和行级操作事件 |
| `src/components/DocumentAssetGroupList.vue` | 按文档归类视图；把分组摊平成行序列后交由 `useVirtualList` 开窗渲染，折叠的文档不产生资源行，行高由 `DOC_ROW_HEIGHTS` 内联绑定 |
| `src/components/ImageEditorDialog.vue` | TUI Image Editor 弹窗；支持二次编辑模式、干净原始底图加载与矢量图层注入还原、重置为原始底图、合并固化图层、高保真导出与保存 |
| `src/components/ConfirmDialog.vue` | 通用确认对话框组件 |

## 工具模块

| 路径 | 职责 |
| --- | --- |
| `src/utils/asset-workflow.ts` | 业务服务层；封装图片保存编辑工作流（位图保存、引用更新、底图归档、属性同步写入、原图删除）与资源重命名工作流 |
| `src/utils/asset-actions.ts` | 编辑后文件名生成、重命名输入校验和扩展名决策 |
| `src/utils/asset-list.ts` | 资源过滤（支持 `reeditable`）、排序、扩展名拆分、类型徽章生成（`getAssetBadgeText`）、大小格式化、孤儿资源与孤立底图统计 |
| `src/utils/asset-markdown.ts` | Markdown 中 assets 引用解析、替换、移除和正则转义 |
| `src/utils/doc-group-rows.ts` | 按文档归类的行模型；把分组摊平为一维虚拟滚动行序列（`buildDocRows`），并集中定义行高常量 `DOC_ROW_HEIGHTS` |
| `src/utils/file-system.ts` | 资源文件读取、保存、删除、重命名，以及原始底图隔离存储（`storage/petal/siyuan-assets-manager/originals/`）的安全保存、读取、删除与列表 |
| `src/utils/image-editor.ts` | 图片编辑器弹窗尺寸计算、导出流水线（`prepareCanvasExport`）、画布对象重置（`resetCanvasObjects`）、100% 物理分辨率换算、Alpha 像素切边与重采样、键盘快捷键处理 |
| `src/utils/plugin-entry.ts` | 插件入口纯函数；从 DOM 获取资源文件名与最近块 `data-node-id` |
| `src/utils/reedit-data.ts` | 二次编辑元数据合法性校验、自适应阈值压缩（<2KB 明文 vs >=2KB `lz-string` 编码）与反序列化 |
| `src/utils/siyuan-block.ts` | 对引用资源的 blocks 执行替换/移除/删除，以及 `custom-asset-reedit` 块属性读写与批量查询 |
| `src/utils/siyuan-db.ts` | 资源文件聚合、引用统计、二次编辑元数据绑定、孤立底图扫描与一键清理 |
| `src/utils/tui-image-editor-bridge.ts` | TUI / Fabric 桥接模块；抽取纯矢量图层、反序列化注入 Fabric Canvas、序号联动关系重建 |
| `src/utils/deduplicate.ts` | 去重扫描三阶段流水线（size 分桶 → 精确哈希 → 感知哈希）、指纹复用增量、分组归一化、内容派生组身份与缓存持久化 |
| `src/utils/dedup-fingerprint-store.ts` | per-asset 指纹（sha256/dHash/分辨率）的失效校验、裁剪与持久化；仅走 `plugin.saveData`，不落 localStorage |
| `src/utils/concurrency.ts` | 保序并发池：在飞数受限、可中止、进度上报 |

## 类型

| 路径 | 职责 |
| --- | --- |
| `src/types/index.d.ts` | Siyuan 常用全局类型、窗口扩展和前端平台枚举 |
| `src/types/api.d.ts` | Siyuan API 返回结构补充声明 |
| `src/types/reedit.d.ts` | 二次编辑元数据 `IAssetReEditMetadata`、矢量图层载荷与保存事件类型定义 |

## 测试

| 路径 | 覆盖范围 |
| --- | --- |
| `tests/asset-workflow.test.ts` | 图片保存编辑与重命名长流程业务编排、底图归档分支与块属性广播 |
| `tests/asset-actions.test.ts` | 编辑命名、重命名校验和扩展名确认 |
| `tests/asset-list.test.ts` | 过滤（含二次编辑）、排序、扩展名、徽章文本提取、大小格式化、孤儿资源与底图统计 |
| `tests/asset-manager-toolbar.test.ts` | 顶部操作区按钮顺序（刷新·去重·清理·日志）、上次刷新时间的占位/更新与刷新期间列表不被卸载 |
| `tests/asset-markdown.test.ts` | assets 引用提取、正则特殊字符替换、图片/链接/纯路径移除 |
| `tests/doc-group-rows.test.ts` | 文档归类行模型：折叠/展开行序列、搜索强制展开、行高常量、行 key 唯一性 |
| `tests/document-asset-group-list.test.ts` | 文档归类视图组件：分组渲染与折叠契约、万级资源下只渲染视口内的行 |
| `tests/file-system.test.ts` | 文件路径规范化、绝对路径计算与 DataURL 转 Blob 校验 |
| `tests/image-editor.test.ts` | 图片编辑器尺寸、分辨率计算、画布对象重置、Alpha 像素扫描与快捷键判断 |
| `tests/plugin-entry.test.ts` | 入口资源名解析、blockId 提取和根容器 id |
| `tests/project-metadata.test.ts` | 插件元数据和 i18n 文案校验 |
| `tests/reedit-data.test.ts` | 元数据校验、自适应压缩与解压往返、Hash 计算与容错 |
| `tests/siyuan-block.test.ts` | 块引用替换/移除/删除、`custom-asset-reedit` 块属性读写与 IAL 解析 |
| `tests/siyuan-db.test.ts` | 资源文件聚合、二次编辑状态绑定、孤立底图扫描与清理 |
| `tests/tui-bridge.test.ts` | TUI 构造函数解析、Fabric Canvas 提取、纯矢量图层抽取与反序列化还原 |
| `tests/deduplicate.test.ts` | 去重扫描三阶段与指纹复用增量、`score` 每次重算、组身份顺序无关性、缓存 schema 版本判废、归一化安全复核 |
| `tests/dedup-fingerprint-store.test.ts` | 指纹失效判据（size/updated/updated>0/字段缺失）、裁剪、存取往返与版本不符判空、不写 localStorage |
| `tests/concurrency.test.ts` | 并发池契约：保序返回、在飞上限、中止不再启动、进度单调、非法 limit 回退 |

## 构建与验证

| 命令 | 说明 |
| --- | --- |
| `npm test` | 运行全部 Vitest 单元测试 |
| `npm run build` | 生产构建，输出 `dist/` 并生成 `package.zip` |
| `npm run dev` | Vite watch 构建到配置的 Siyuan 工作空间插件目录 |

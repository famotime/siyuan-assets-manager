# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and coding agents when working with this repository.

## Project Overview

思源笔记资源管家插件 (SiYuan Assets Manager) — 一站式管理思源笔记中的所有资源文件（图片/附件），支持**基于思源块属性的图片矢量二次编辑**、**原始底图隔离保护**、引用自动同步更新与孤儿资源清理。

- **Tech Stack**: Vue 3 SFC + TypeScript + Vite + Sass + Vitest (jsdom) + TUI Image Editor / Fabric.js + lz-string
- **Entry Points**: `src/index.ts` (Plugin Lifecycle & Menus), `src/main.ts` (Vue Mount/Unmount), `src/App.vue` (UI Root & Dialogs)

## Build & Test Commands

| Command | Description |
|---|---|
| `npm test` | 运行全部 Vitest 单元测试（14 套件 / 66+ 测试） |
| `npx vitest run tests/<file>.test.ts` | 运行单文件单元测试（如 `tests/asset-workflow.test.ts`） |
| `npm run build` | 生产构建，输出到 `dist/` 并打包 `package.zip` |
| `npm run dev` | Watch 构建至 `.env` 中 `VITE_SIYUAN_WORKSPACE_PATH` 配置的插件目录 |
| `npm run release` | 交互式发布版本（版本号更新、commit、tag、push） |

## Architecture & Core Concepts

1. **Secondary Image Editing (矢量二次编辑)**:
   - 标注（矩形/箭头/序号/文字）以矢量结构保存在思源图像块属性 `custom-asset-reedit` 中，自动采用 `lz-string` 自适应压缩。
   - 原始干净底图隔离归档在 `/data/storage/petal/siyuan-assets-manager/originals/`，防止原生清理误删，二次编辑时底图无残留重影。
2. **Business Workflow Layer (`src/utils/asset-workflow.ts`)**:
   - 集中封装图片保存编辑工作流（保存位图、更新引用、归档底图、写入 `custom-asset-reedit` 块属性、原图删除确认）与重命名工作流，与 Vue 组件解耦。
3. **Image Export & Layer Restoration**:
   - `src/utils/image-editor.ts`: 导出流水线（`prepareCanvasExport`）、画布重置（`resetCanvasObjects`）、100% 分辨率换算、Alpha 像素级透明切边。
   - `src/utils/tui-image-editor-bridge.ts`: 抽取 Fabric 矢量图层、反序列化注入 Fabric Canvas、序号-形状双向关联恢复。

## Key Modules

| Path | Responsibility |
|---|---|
| `src/index.ts` | 插件类入口，顶栏图标、图片右键菜单（感知二次编辑状态） |
| `src/App.vue` | 顶层弹窗与交互编排 |
| `src/components/AssetsManager.vue` | 资源管理主面板：搜索、多维筛选、悬浮预览、孤儿/孤立底图清理 |
| `src/components/VirtualAssetList.vue` | 虚拟滚动列表：高性能渲染、类型徽章（`getAssetBadgeText`） |
| `src/components/ImageEditorDialog.vue` | 图片编辑弹窗：图层注入还原、重置底图、合并固化、保存导出 |
| `src/utils/asset-workflow.ts` | 保存编辑与重命名业务编排服务层 |
| `src/utils/reedit-data.ts` | 二次编辑元数据自适应压缩/解压、HTML 实体兼容与校验 |
| `src/utils/tui-image-editor-bridge.ts` | Fabric 矢量图层提取/注入/反序列化桥接 |
| `src/utils/file-system.ts` | 资源文件与隔离底图存储（Electron FS 直写 / Web API 回退） |
| `src/utils/siyuan-block.ts` | 块引用替换/清理、`custom-asset-reedit` 属性读写与批量查询 |
| `src/utils/siyuan-db.ts` | 资源文件聚合、引用统计、孤立底图扫描与清理 |
| `src/utils/image-editor.ts` | 导出流水线、画布重置、分辨率换算、Alpha 切边 |
| `src/utils/asset-list.ts` | 资源过滤、排序、扩展名拆分、图标徽章、大小格式化与清理统计 |
| `src/utils/asset-actions.ts` | 编辑后命名生成、重命名校验与扩展名决策 |
| `src/utils/asset-markdown.ts` | Markdown 中 `assets/` 引用解析、正则转义、替换与移除 |
| `src/api.ts` | 思源 Kernel 9 个核心 API 封装（SQL、通知、文件、块与属性） |

## Development Rules & Invariants

- **Test-First**: 修改 `src/utils/` 业务逻辑时，必须先补充/同步更新 `tests/*.test.ts`。
- **Build Target**: 构建格式为 CommonJS (`lib: { formats: ["cjs"] }`)，`siyuan` 与 `process` 外部化不打包。
- **i18n**: 用户可见文案需同步维护在 `src/i18n/zh_CN.json` 和 `src/i18n/en_US.json`。
- **Doc Updates**: 重大架构改动时同步更新 `docs/project-structure.md` 与 `docs/refactor-plan.md`。

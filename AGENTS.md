# Repository Guidelines

本文件是 siyuan-assets-manager（思源笔记资源管家插件）的 Agent 指南，帮助编程 Agent 快速了解项目架构与开发规范。

## 1. 项目概览与技术栈

- **定位**：思源笔记资源全生命周期管理插件（资源浏览、引用追踪、重命名、孤儿清理、图片二次编辑与图层无损还原）。
- **技术栈**：Vue 3 SFC + TypeScript + Vite + Sass + Vitest (jsdom) + TUI Image Editor / Fabric.js + lz-string。

## 2. 核心架构与关键特性

1. **矢量二次编辑（Secondary Editing）**：
   - 编辑标注（矩形/箭头/序号/文字）以矢量数据自适应压缩（`lz-string`）保存在思源图像块属性 `custom-asset-reedit` 中。
   - 原始干净底图隔离归档在 `/data/storage/petal/siyuan-assets-manager/originals/`，规避思源原生清理误删，二次编辑时底图无残留重影。
2. **长流程业务编排服务层**：
   - `src/utils/asset-workflow.ts` 集中编排位图保存、引用替换、底图归档、块属性广播写入与原图删除确认，与 Vue UI 解耦。
3. **图片高保真导出与图层还原**：
   - `src/utils/image-editor.ts` 负责 100% 原始分辨率还原、Alpha 像素切边与画布重置。
   - `src/utils/tui-image-editor-bridge.ts` 负责 Fabric 矢量图层提取、反序列化注入与序号联动配对。

## 3. 模块职责清单

| 模块 / 路径 | 核心职责 |
|---|---|
| `src/index.ts` | 插件类入口，注册顶栏图标、图片右键菜单（动态感知二次编辑状态）与生命周期 |
| `src/main.ts` | Vue 应用挂载与卸载绑定 |
| `src/App.vue` | 顶层弹窗与交互编排 |
| `src/components/AssetsManager.vue` | 资源管理主面板：搜索、多维筛选（含可二次编辑）、悬浮预览、孤儿资源与孤立底图清理 |
| `src/components/VirtualAssetList.vue` | 虚拟滚动列表：高性能渲染、类型徽章（`getAssetBadgeText`）与行级操作 |
| `src/components/ImageEditorDialog.vue` | TUI Editor 弹窗：矢量图层还原注入、重置底图、固化图层、导出与保存 |
| `src/utils/asset-workflow.ts` | 保存编辑与重命名长业务编排服务层 |
| `src/utils/reedit-data.ts` | 二次编辑元数据自适应压缩/解压、HTML 实体兼容与校验 |
| `src/utils/tui-image-editor-bridge.ts` | Fabric 矢量图层抽取、反序列化注入、序号-形状双向关联恢复 |
| `src/utils/file-system.ts` | 资源文件与隔离原始底图存储（Electron FS 直写 / Web API 回退） |
| `src/utils/siyuan-block.ts` | 块引用替换/清理、`custom-asset-reedit` 块属性读写与批量查询 |
| `src/utils/siyuan-db.ts` | 资源文件聚合、引用统计、二次编辑元数据绑定、孤立底图扫描与清理 |
| `src/utils/image-editor.ts` | 导出流水线（`prepareCanvasExport`）、画布重置、100% 分辨率换算、Alpha 切边 |
| `src/utils/asset-list.ts` | 资源过滤、排序、扩展名拆分、图标徽章（`getAssetBadgeText`）、大小格式化与清理统计 |
| `src/utils/asset-actions.ts` | 编辑后命名生成、重命名校验与扩展名决策 |
| `src/utils/asset-markdown.ts` | Markdown 中 `assets/` 引用解析、正则特殊字符转义、替换与移除 |
| `src/api.ts` | 思源 Kernel 核心 API 封装（SQL 查询、通知、文件读写、块与属性操作） |

## 4. 开发与测试命令

- `npm install` — 安装依赖。
- `npm test` — 运行 Vitest 单元测试（14 套件 / 66+ 测试，jsdom 环境）。
- `npx vitest run tests/asset-workflow.test.ts` — 运行指定测试文件。
- `npm run build` — 生产构建，输出到 `dist/` 并生成 `package.zip`。
- `npm run dev` — Watch 构建至 `.env` 中 `VITE_SIYUAN_WORKSPACE_PATH` 配置的插件目录。
- `npm run release` — 发布版本（更新版本号、commit、tag、push）。

## 5. 关键约束与开发规范

1. **代码风格**：2 空格缩进、单引号、UTF-8；Vue SFC 顺序为 `<template>` → `<script setup>` → `<style>`。新增注释默认使用简体中文。
2. **测试优先**：修改或新增 `src/utils/` 逻辑时必须补充对应 `tests/*.test.ts` 单元测试，确保 `npm test` 全通。
3. **打包约束**：产物为 CommonJS 格式（`lib: { formats: ["cjs"] }`），`siyuan` 与 `process` 模块 external 不打包。
4. **国际化**：用户可见文案需维护在 `src/i18n/*.json`（en_US 与 zh_CN 同步）。
5. **提交规范**：遵循 Conventional Commits（如 `feat(editor): ...`, `fix: ...`, `refactor: ...`）。

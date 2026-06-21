# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

思源笔记资源管家插件 — 一站式管理 SiYuan Note (思源笔记) 中的所有资源文件（图片、附件等）。基于 Vue 3 + TypeScript + Vite 构建，使用 Vitest 进行单元测试。

## Build & Test Commands

| 命令 | 说明 |
|------|------|
| `npm test` | 运行全部 Vitest 单元测试（jsdom 环境） |
| `npm run build` | 生产构建，输出 `dist/` 并生成 `package.zip` |
| `npm run dev` | Vite watch 构建到思源工作空间插件目录（需配置 `.env`） |
| `npm run release` | 交互式发布：版本号更新、commit、tag、push |

- `.env` 配置 `VITE_SIYUAN_WORKSPACE_PATH` 指向思源笔记工作空间根目录（包含 `data/` 文件夹），`npm run dev` 会自动构建到 `{workspace}/data/plugins/siyuan-assets-manager/`。
- 测试命令：`npx vitest run`、`npx vitest run tests/siyuan-block.test.ts`（运行单文件测试）。

## Architecture

### 入口与生命周期

- `src/index.ts` — 插件主类 `AssetsManagerPlugin`，继承 `siyuan.Plugin`。`onload()` 注册图标、绑定图片右键菜单。`onunload()` 卸载 Vue 应用。
- `src/main.ts` — Vue 应用的挂载与卸载，将插件实例绑定到全局 `window._siyuan_assets_manager`。
- 插件通过全局窗口函数（`window._siyuan_assets_manager_open_editor`）暴露编辑/重命名能力给右键菜单。

### 关键模块职责

| 模块 | 文件 | 说明 |
|------|------|------|
| 资源扫描聚合 | `src/utils/siyuan-db.ts` | 读取 `/data/assets` 目录、查询 blocks、从 markdown 提取引用、生成 AssetInfo |
| 块引用更新 | `src/utils/siyuan-block.ts` | 替换/移除 blocks 中的资源引用，清理空块 |
| Markdown 解析 | `src/utils/asset-markdown.ts` | 提取、替换、移除 markdown 中的 assets 引用 |
| 文件系统操作 | `src/utils/file-system.ts` | 资源文件的读取/保存/删除/重命名 |
| 资源列表逻辑 | `src/utils/asset-list.ts` | 过滤、排序、格式化、孤儿资源统计 |
| 资源重命名校验 | `src/utils/asset-actions.ts` | 编辑命名、重名校验、扩展名决策 |
| 图片编辑器工具 | `src/utils/image-editor.ts` | 弹窗尺寸和标注定位计算 |
| 入口工具函数 | `src/utils/plugin-entry.ts` | DOM 元素中解析资源名和容器 id |
| SiYuan API 包装 | `src/api.ts` | 包装 SiYuan Kernel API 接口 |

### Vue 组件

| 组件 | 说明 |
|------|------|
| `src/App.vue` | 顶层弹窗编排：管理主面板显示/隐藏、全局编辑/重命名弹窗 |
| `src/components/AssetsManager.vue` | 资源管理主面板：加载、搜索、筛选、排序、删除、清理 |
| `src/components/VirtualAssetList.vue` | 虚拟滚动列表，行级操作事件 |
| `src/components/ImageEditorDialog.vue` | TUI Image Editor 弹窗，图片编辑 + 序号标注 |

### 关键约束

- 构建产物为 CommonJS 格式（`lib: { formats: ["cjs"] }`），入口为 `src/index.ts`。
- `siyuan` 和 `process` 模块 external 不打包，由思源笔记运行时提供。
- 类型声明使用全局 `d.ts` 文件（`src/types/`），非 `@types` 包。
- 国际化文件位于 `src/i18n/*.json`，构建时自动复制到输出目录。
- 测试使用 `jsdom` 环境，不支持 Node.js 原生模块或 SiYuan Kernel API 调用。
- `plugin.json` 中的 `name` 字段被构建脚本引用为输出目录名，修改需同步 `vite.config.ts` 中的 `pluginInfo.name` 引用路径。

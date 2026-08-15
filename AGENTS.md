# Repository Guidelines

本文件是 siyuan-assets-manager（思源笔记资源管家插件）的贡献者指南。

## Project Structure & Module Organization

- `src/` — 全部源码：`src/index.ts`（插件主类与生命周期）、`src/main.ts`（Vue 挂载）、`src/api.ts`（SiYuan Kernel API 封装）、`src/components/`（Vue 组件）、`src/utils/`（业务逻辑）、`src/i18n/`（en_US.json / zh_CN.json）、`src/types/`（全局 d.ts 类型）。
- `tests/` — Vitest 单元测试，`tests/mocks/siyuan.ts` 提供 `siyuan` 模块 mock。
- `docs/` 与 `developer_docs/` — 设计文档与 SiYuan 插件开发参考。
- 根目录 — `plugin.json`（插件元数据，`name` 决定输出目录名）、`vite.config.ts`、`release.js`、`package.zip`（构建产物，勿手改）。

## Build, Test, and Development Commands

- `npm install` — 安装依赖。
- `npm run dev` — Vite watch 构建到思源工作空间插件目录（先按 `.env.example` 配置 `VITE_SIYUAN_WORKSPACE_PATH`）。
- `npm run build` — 生产构建，输出到 `dist/` 并生成 `package.zip`。
- `npm test` — 运行全部 Vitest 测试（jsdom 环境）。
- `npm run release[:patch|:minor|:major]` — 发布：更新版本号、commit、tag、push。
- `npx eslint .` — 代码检查（@antfu/eslint-config + perfectionist）。

## Coding Style & Naming Conventions

- 2 空格缩进、单引号、UTF-8，规则见 `.editorconfig` 与 `eslint.config.mjs`；Vue SFC 块顺序为 `template` → `script` → `style`。
- 文件与变量使用 camelCase，Vue 组件使用 PascalCase，工具函数按职责放入 `src/utils/` 对应文件。
- 用户可见文案必须写入 `src/i18n/*.json`，新增 key 需中英文同步。

## Testing Guidelines

- 框架为 Vitest + jsdom；测试文件放在 `tests/`，命名为 `*.test.ts`。
- `siyuan` 模块在 `vitest.config.ts` 中重定向到 mock；jsdom 环境不支持 Node 原生模块或真实 Kernel API 调用。
- 运行全部测试用 `npm test`；单文件用 `npx vitest run tests/asset-list.test.ts`。
- 新增或修改 `src/utils/` 逻辑时应补充对应单元测试。

## Commit & Pull Request Guidelines

- 提交信息遵循 Conventional Commits，使用中文描述，可选 scope，如 `feat(editor): 新增裁剪功能`、`fix: 修复重命名报错`、`refactor: 重构资源管理逻辑`、`style: 优化按钮样式`。
- PR 需说明改动动机与影响范围，关联相关 issue，UI 改动附截图；合并前须通过 `npm test` 与 `npm run build`。

## Agent-Specific Instructions

- 除非用户特别指定，对话默认使用简体中文。
- `docs/project-structure.md` 记录了更详细的模块说明，改动较大时请同步更新。

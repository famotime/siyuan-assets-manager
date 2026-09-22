# 重构计划

## 1. 项目快照

- 生成日期：2026-09-22
- 范围：`siyuan-assets-manager`（思源笔记资源管家插件）v1.2.2 全代码库
- 目标：在保证图片二次编辑、去重比对与归一化合并、逆向回退、未引用清理、媒体悬浮预览等全部核心功能行为 100% 不变的前提下，对超大型 Vue 组件（`AssetsManager.vue` 2634 行、`DeletionHistoryDialog.vue` 1912 行）、庞大工具模块（`src/utils/deduplicate.ts` 1163 行）以及插件入口配置 DOM（`src/index.ts` 531 行）进行模块解耦与职责分层，强化自动化测试覆盖并刷新架构文档。
- 文档刷新目标：`docs/project-structure.md`、`README.md`、`README_zh_CN.md`、`AGENTS.md`、`CLAUDE.md`
- 当前基线验证：`npm test`（35 suites / 335 tests 全部通过）；代码树干净无未提交修改。

## 2. 架构与模块分析

| 模块 | 关键文件 | 当前职责 | 主要痛点 | 测试覆盖情况 |
| --- | --- | --- | --- | --- |
| 资源管理主面板与清理编排 | `src/components/AssetsManager.vue` | 资源浏览检索、平铺与文档归类双视图、媒体悬浮预览、单文件/批量删除与综合清理编排 | 单文件长达 2,634 行 (83KB)，内嵌 430+ 行文件删除与清理业务流程，且混杂了 400+ 行音视频悬浮预览播放控制与动画逻辑，无法脱离 UI 单测业务流 | `tests/asset-manager-*.test.ts` 覆盖了工具栏、文档排序与视频预览，但删除清理编排缺少无 Headless DOM 的轻量单元测试 |
| 去重比对与归一化合并引擎 | `src/utils/deduplicate.ts` | 文件大小分桶、SHA-256、dHash 感知哈希计算、汉明距离换算、扫描调度、单组/多组归一化合并、快照记录与物理删除 | 单文件 1,163 行，同时承担了底层图像感知哈希算法、扫描并发调度流水线、以及深度涉及思源块与属性视图改写的归一化合并服务，职责过于发散 | `tests/deduplicate.test.ts` 已深度覆盖 36 个测试场景，但算法与合并工作流未做文件级隔离 |
| 删除审计与回退历史弹窗 | `src/components/DeletionHistoryDialog.vue` | 批次历史列表、回收站跳转、历史容量配置、单批次展开折叠、被删文件明细表格、缩略图 hover 触发、逆向回退报告 | 单文件 1,912 行 (57KB)，单个卡片的展开折叠、明细表格、回退操作与报告完全挤在顶层弹窗组件内，模板与脚本体量极大 | `tests/deletion-history-dialog.test.ts` 覆盖了 9 个生命周期与显隐测试，卡片子组件未独立 |
| 插件入口与设置面板 | `src/index.ts` | 插件生命周期、Tab 管理、图片右键菜单注册、设置弹窗 DOM 拼接构建与图标常量 | 单文件 531 行，内含 80 行大段内联 SVG 图标和 220 行原生 DOM 节点创建与事件组装，侵入核心生命周期入口 | `tests/settings.test.ts` 覆盖了设置项渲染与保存，但入口与配置构建未解耦 |

## 3. 按优先级排序的重构待办

| ID | 优先级 | 模块/场景 | 涉及文件 | 重构目标 | 风险等级 | 重构前测试清单 | 文档影响 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RF-001 | P0 | 解耦 `AssetsManager.vue` 中的单文件删除、批量删除与综合清理业务编排 | `src/components/AssetsManager.vue`、`src/utils/cleanup-workflow.ts`（新增）、`tests/cleanup-workflow.test.ts`（新增） | 抽离 430+ 行文件删除、清理与批次历史记录逻辑至独立 workflow 服务层，实现纯逻辑单测 | 高 | - [x] 单个普通资源删除：验证确认提示生成、文件删除、引用清理与批次记录；<br>- [x] 原始底图删除：验证高风险关联文档警告、底图删除与批次不可回退标记；<br>- [x] 批量删除：混合普通资源与底图时分别正确处理与统计 freedBytes；<br>- [x] 综合清理：未引用孤儿资源与孤立底图的完整扫描与批次清理 | `docs/project-structure.md`：记录 cleanup-workflow 职责；`README.md`：更新清理服务说明 | done |
| RF-002 | P0 | 拆分 `src/utils/deduplicate.ts`：解耦算法计算层、扫描编排层与归一化合并工作流 | `src/utils/deduplicate.ts`、`src/utils/dedup-hash.ts`（新增）、`src/utils/dedup-normalize.ts`（新增）、`tests/dedup-hash.test.ts`（新增） | 将底层感知哈希算法与长流程归一化合并解耦，`deduplicate.ts` 作为门面保持 100% 接口与测试向后兼容 | 高 | - [x] SHA-256 与简易保底哈希在各环境下的计算一致性；<br>- [x] 9x8 灰度矩阵生成 64 位 dHash 与汉明距离计算；<br>- [x] 归一化单组合并：块引用替换、元数据迁移与物理文件删除；<br>- [x] 多组批量归一化：聚合统计与部分失败容错记录 | `docs/project-structure.md`：更新 dedup 相关模块职责 | done |
| RF-003 | P1 | 抽取 `AssetsManager.vue` 媒体悬浮预览子组件（`AssetMediaPreview.vue`） | `src/components/AssetsManager.vue`、`src/components/AssetMediaPreview.vue`（新增）、`tests/asset-media-preview.test.ts`（新增） | 将图片、视频播放控制（静音、进度快进、播放/暂停）与音频律动逻辑抽为独立组件，精简主面板近 600 行 | 中 | - [x] 视频预览初始化默认静音，包含进度条与播放/暂停控制；<br>- [x] 点击静音按钮切换声音状态，点击播放按钮切换播放/暂停；<br>- [x] 音频预览加载与声波律动控制；<br>- [x] 重新打开或切换资源时视频预览重置为默认静音 | `docs/project-structure.md`：记录 AssetMediaPreview 组件 | done |
| RF-004 | P1 | 解耦 `src/index.ts`：抽离设置面板构建器与编辑器工具常量 | `src/index.ts`、`src/utils/editor-tools.ts`（新增）、`src/utils/plugin-settings.ts`（新增） | 抽离 80 行内联 SVG 工具定义与 220 行原生 DOM 设置面板构建，使入口聚焦于思源插件生命周期与事件监听 | 低 | - [x] 插件打开 680px 设置弹窗，包含 7 个选项且支持自动持久化；<br>- [x] 开关卡片切换并触发 `saveData`；<br>- [x] 工具栏图标选择与取消选择更新 `imageEditorTools`；<br>- [x] 并发度与保留上限数值限制与容错 | `docs/project-structure.md`：更新入口与配置模块说明 | done |
| RF-005 | P1 | 拆分 `DeletionHistoryDialog.vue`：提取单批次卡片子组件（`DeletionHistoryCard.vue`） | `src/components/DeletionHistoryDialog.vue`、`src/components/DeletionHistoryCard.vue`（新增）、`tests/deletion-history-card.test.ts`（新增） | 将单个历史批次的头部、折叠、明细表格、回退报告和缩略图悬浮抽为子组件，降低主弹窗维护复杂度 | 中 | - [x] 批次列表渲染与展开/折叠切换；<br>- [x] 去重批次展示主保留项与受影响引用；<br>- [x] 单文件/批量删除批次展示关联文档标题与跳转；<br>- [x] 已回退批次展示回退统计与报告 | `docs/project-structure.md`：记录 DeletionHistoryCard 组件 | done |
| RF-006 | P2 | 刷新项目架构文档、开发指南与 Agent 指引 | `docs/project-structure.md`、`README.md`、`AGENTS.md`、`CLAUDE.md` | 全面同步新增服务层、工具模块与子组件职责映射，保持 Agent 指南精简高效 | 低 | - [x] 架构文档与实际代码目录 100% 对齐；<br>- [x] `npm test` 39 套件 356 测试全部绿灯通过；<br>- [x] `npm run build` 成功打包 CommonJS 产物 | `docs/project-structure.md`、`README.md` 全部刷新 | done |

## 优先级说明：
- `P0`：价值高且风险高，优先编写对应单元测试并实施重构
- `P1`：中等风险或中等价值，解耦大型组件与降低代码认知负载
- `P2`：低风险清理与文档全面刷新，在全部获批条目完成后统一交付

状态说明：
- `pending`：等待用户审批
- `in_progress`：正在实施重构与测试
- `done`：实施与验证已完成
- `blocked`：因外部依赖阻塞

## 4. 执行日志

| ID | 开始日期 | 结束日期 | 验证命令 | 结果 | 已刷新文档 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| 基线验证 | 2026-09-22 | 2026-09-22 | `npm test` | pass（35 suites / 335 tests） | 无 | 当前基线全绿，代码树干净 |
| RF-001 | 2026-09-22 | 2026-09-22 | `npx vitest run tests/cleanup-workflow.test.ts`；`npm test` | pass（36 suites / 343 tests） | `docs/project-structure.md`、`README.md` | 抽取 `cleanup-workflow.ts` 服务层，单文件/批量删除/综合清理长流程解耦并覆盖 8 项单元测试 |
| RF-002 | 2026-09-22 | 2026-09-22 | `npx vitest run tests/dedup-hash.test.ts tests/deduplicate.test.ts`；`npm test` | pass（37 suites / 349 tests） | `docs/project-structure.md` | 拆分 `dedup-hash.ts` 纯算法与 `dedup-normalize.ts` 归一化工作流，36 个原有测试全部通过且新增 6 个算法测试 |
| RF-003 | 2026-09-22 | 2026-09-22 | `npx vitest run tests/asset-media-preview.test.ts tests/asset-manager-video-preview.test.ts`；`npm test` | pass（38 suites / 352 tests） | `docs/project-structure.md` | 抽取 `AssetMediaPreview.vue` 媒体悬浮预览子组件，主面板精简 800+ 行，测试全部通过 |
| RF-004 | 2026-09-22 | 2026-09-22 | `npx vitest run tests/settings.test.ts`；`npm test` | pass（38 suites / 352 tests） | `docs/project-structure.md` | 抽取 `editor-tools.ts` 与 `plugin-settings.ts`，主入口 `src/index.ts` 精简至 228 行，设置单测全绿 |
| RF-005 | 2026-09-22 | 2026-09-22 | `npx vitest run tests/deletion-history-card.test.ts tests/deletion-history-dialog.test.ts`；`npm test` | pass（39 suites / 356 tests） | `docs/project-structure.md` | 抽取 `DeletionHistoryCard.vue` 卡片子组件，主弹窗模板与卡片解耦，新增 4 个单测，全量 39 套件 356 测试全通 |
| RF-006 | 2026-09-22 | 2026-09-22 | `npm test`；`npm run build` | pass（39 suites / 356 tests，构建成功） | `docs/project-structure.md`、`README.md`、`AGENTS.md`、`CLAUDE.md` | 架构文档、产品功能、Agent 指南与 Claude 规则已全部完成同步 |

## 5. 决策与确认

- 用户批准的条目：全部批准（RF-001 ~ RF-006），全部按计划圆满完成
- 延后的条目：无
- 阻塞条目及原因：无

## 6. 文档刷新

- [x] `docs/project-structure.md`：已完整同步最新服务层、算法层、子组件与全量 39 套件测试映射
- [x] `README.md`：已补充删除审计与逆向回退亮点介绍
- [x] `AGENTS.md`：已更新职责清单与 39 套件 / 356 单元测试指标
- [x] `CLAUDE.md`：已同步核心架构与关键模块
- [x] 最终同步检查：全量测试 39 suites / 356 tests 全绿，`npm run build` 产物正常，CommonJS 格式保持完好

## 7. 交付成果总结

1. **RF-001**：解耦 `AssetsManager.vue` 核心业务编排至 `src/utils/cleanup-workflow.ts`，新增 8 项独立测试，主组件职责单一化。
2. **RF-002**：解耦 `src/utils/deduplicate.ts`，纯算法抽离至 `src/utils/dedup-hash.ts`，归一化工作流抽离至 `src/utils/dedup-normalize.ts`，门面完全兼容，新增 6 项测试。
3. **RF-003**：抽取 `src/components/AssetMediaPreview.vue` 媒体悬浮预览子组件，主面板精简 800+ 行，测试全部通过。
4. **RF-004**：解耦 `src/index.ts`，提取 `src/utils/editor-tools.ts` 与 `src/utils/plugin-settings.ts`，入口文件精简至 228 行。
5. **RF-005**：抽取 `src/components/DeletionHistoryCard.vue` 单批次卡片子组件，主弹窗模板精简，新增 4 项卡片测试。
6. **RF-006**：全面更新系统架构文档、产品文档、Agent 指南，自动化构建与全量测试 100% 验证通过。

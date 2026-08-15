# 重构计划

## 1. 项目快照

- 生成日期：2026-08-15
- 范围：`siyuan-assets-manager`（思源笔记资源管家插件）主代码库
- 目标：在保证图片二次编辑、图层无损还原、资源扫描与文档引用替换等所有核心功能行为不变的前提下，解耦全局保存与重命名业务编排、拆分大型组件 `ImageEditorDialog.vue`、修复文件图标扩展名截断 Bug、精简模板冗余 API 并刷新项目架构文档。
- 文档刷新目标：`docs/project-structure.md`、`README.md`、`README_zh_CN.md`
- 当前基线验证：`npm test`（13 suites / 61 tests 全部通过）；`npm run build` 成功。

## 2. 架构与模块分析

| 模块 | 关键文件 | 当前职责 | 主要痛点 | 测试覆盖情况 |
| --- | --- | --- | --- | --- |
| 插件入口与生命周期 | `src/index.ts`、`src/main.ts`、`src/utils/plugin-entry.ts` | 插件注册、平台识别、顶栏与图片右键菜单注册、生命周期管理 | 入口已初步模块化，但右键菜单与全局方法调用仍依赖 `window` 桥接 | `tests/plugin-entry.test.ts` 已覆盖主要逻辑 |
| 全局业务编排与弹窗 | `src/App.vue`、`src/utils/asset-actions.ts` | 顶栏打开资源管家、全局图片编辑保存、全局重命名及引用同步 | `App.vue` 中 `handleGlobalSaveEdited` 承载了近 100 行的文件保存、引用替换、原始底图归档、`custom-asset-reedit` 块属性同步写入和删除原图确认等业务流程，未与 UI 完全解耦，难以单独做单元测试 | `tests/asset-actions.test.ts` 仅覆盖了命名校验，长流程编排未覆盖 |
| 列表管理与虚拟滚动 | `src/components/AssetsManager.vue`、`src/components/VirtualAssetList.vue`、`src/utils/asset-list.ts` | 资源列表渲染、虚拟滚动、搜索过滤、排序、悬浮预览、孤立底图扫描与清理 | `VirtualAssetList.vue` 中非图片文件图标提取使用了 `.ext.substring(1)`，导致 `pdf` 变成 `DF`、无点文件名异常等潜在 Bug；格式化逻辑分散 | `tests/asset-list.test.ts` 覆盖了过滤与排序，缺少 Badge 文案提取场景 |
| 图片编辑器集成与导出 | `src/components/ImageEditorDialog.vue`、`src/utils/image-editor.ts`、`src/utils/tui-image-editor-bridge.ts` | TUI Editor 实例管理、二次编辑模式图层还原、多步骤位图导出流水线（分辨率还原、Alpha裁剪、缩放） | 698 行单组件承担了复杂的导出流水线、图层操作（固化/重置）、快捷键拦截与大量 CSS，组件体积过大 | `tests/image-editor.test.ts` 与 `tests/tui-bridge.test.ts` 已覆盖基础纯函数，但导出编排缺少分层 |
| 二次编辑元数据与底层存储 | `src/utils/reedit-data.ts`、`src/utils/file-system.ts`、`src/utils/siyuan-block.ts`、`src/utils/siyuan-db.ts` | 元数据自适应压缩/解压、原始底图隔离存储、块属性读写与孤立底图清理 | 逻辑分层已较清晰，各模块职责明确，但路径处理与错误回退需保证极高一致性 | `tests/reedit-data.test.ts`、`tests/file-system.test.ts`、`tests/siyuan-db.test.ts` 等已深度覆盖 |
| API 封装与模板遗留 | `src/api.ts`、`src/types/api.d.ts`、`src/components/SiyuanTheme/` | 封装思源 Kernel HTTP API | `api.ts` 包含 400+ 行未引用的模板脚手架 API，`siyuan-db.ts` 存在重复 import；存在空目录 `src/components/SiyuanTheme` | 需确保清理后编译打包与既有 API 调用完全兼容 |

## 3. 按优先级排序的重构待办

| ID | 优先级 | 模块/场景 | 涉及文件 | 重构目标 | 风险等级 | 重构前测试清单 | 文档影响 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RF-001 | P0 | 全局编辑保存与重命名业务编排解耦 | `src/App.vue`、`src/utils/asset-actions.ts`、`src/utils/asset-workflow.ts`（新增）、`tests/asset-workflow.test.ts`（新增） | 将 `handleGlobalSaveEdited` 中的文件保存、引用更新、底图归档、块属性同步写入、原图删除等业务编排抽取为独立可测试的 workflow 服务 | 高 | - [x] 正常保存编辑生成新文件并更新引用块；- [x] 首次编辑时自动归档原始底图；- [x] 二次编辑时复用既有底图路径；- [x] 写入 `custom-asset-reedit` 块属性；- [x] 提示并执行原图删除 | `docs/project-structure.md`：记录 workflow 服务层职责；`README.md`：更新二次编辑保存流程说明 | done |
| RF-002 | P0 | 列表图标与扩展名展示一致性及 Bug 修复 | `src/components/VirtualAssetList.vue`、`src/utils/asset-list.ts`、`tests/asset-list.test.ts` | 修复非图片文件图标截断 Bug（`substring(1)` 问题），提供统一的 `getAssetBadgeText` 工具函数，规范列表扩展名与徽章展示 | 中 | - [x] `sample.pdf` 正确展示为 `PDF`（非 `DF`）；- [x] `archive.tar.gz` 提取为 `GZ`；- [x] 无扩展名文件显示 `FILE`；- [x] 点开头隐藏文件如 `.gitignore` 正常处理 | `docs/project-structure.md`：更新 asset-list 工具职责 | done |
| RF-003 | P1 | 图片编辑器导出流水线与图层操作分层 | `src/components/ImageEditorDialog.vue`、`src/utils/image-editor.ts`、`tests/image-editor.test.ts` | 将 `ImageEditorDialog.vue` 中多步骤导出流程（停止绘制、抽取矢量、生成 DataURL、Alpha 裁剪、异常保底）和图层操作抽取为纯函数/辅助逻辑，降低 Vue SFC 复杂度 | 中 | - [x] 正常导出包含矢量数据与裁剪 DataURL；- [x] 异常情况自动保底 fallback；- [x] 重置原始底图清空非背景对象；- [x] 固化图层清除块属性 | `docs/project-structure.md`：更新图片编辑器辅助工具说明 | done |
| RF-004 | P1 | API 模块瘦身与重复导入清理 | `src/api.ts`、`src/types/api.d.ts`、`src/utils/siyuan-db.ts` | 清理 `api.ts` 中 400+ 行无用的模板脚手架 API，只保留插件实际使用的 9 个核心 API；清理 `siyuan-db.ts` 重复导入 `sql as sqlQuery` | 低 | - [x] 现有所有单元测试通过；- [x] `npm run build` 打包构建无报错 | `docs/project-structure.md`：更新 API 模块边界说明 | done |
| RF-005 | P2 | 模板遗留空目录清理 | `src/components/SiyuanTheme/` | 删除无引用的空目录 `src/components/SiyuanTheme` | 低 | - [x] 项目编译与代码检查正常 | `docs/project-structure.md`：清理目录树 | done |
| RF-006 | P2 | 刷新项目架构文档与 README | `docs/project-structure.md`、`README.md`、`README_zh_CN.md` | 全面同步二次编辑数据流、矢量图层还原、隔离底图管理、孤立底图清理、最新目录结构与测试命令 | 低 | - [x] 文档内容与实际代码实现 100% 对应；- [x] 中英文 README 描述保持一致 | `docs/project-structure.md`、`README.md`、`README_zh_CN.md` 全部刷新 | done |

优先级说明：
- `P0`：价值高且风险高，或包含实际缺陷修复，优先实施并强化测试覆盖
- `P1`：中等风险或中等价值，降低复杂组件与模块耦合度
- `P2`：低风险清理与文档全面刷新，最后执行

状态说明：
- `pending`
- `in_progress`
- `done`
- `blocked`

## 4. 执行日志

| ID | 开始日期 | 结束日期 | 验证命令 | 结果 | 已刷新文档 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| 基线验证 | 2026-08-15 | 2026-08-15 | `npm test`；`npm run build` | pass（13 suites / 61 tests） | 无 | 基线全绿，代码树干净 |
| RF-001 | 2026-08-15 | 2026-08-15 | `npx vitest run tests/asset-workflow.test.ts`；`npm test`；`npm run build` | pass（14 suites / 64 tests） | `docs/project-structure.md`、`README.md` | 新增 `asset-workflow.ts` 并抽离 `App.vue` 长业务流程编排，完成自动化测试 |
| RF-002 | 2026-08-15 | 2026-08-15 | `npx vitest run tests/asset-list.test.ts`；`npm test`；`npm run build` | pass（14 suites / 65 tests） | `docs/project-structure.md`、`README.md` | 新增 `getAssetBadgeText` 修复非图片图标文本截断 Bug，并在 `VirtualAssetList` 中完成替换 |
| RF-003 | 2026-08-15 | 2026-08-15 | `npx vitest run tests/image-editor.test.ts`；`npm test`；`npm run build` | pass（14 suites / 66 tests） | `docs/project-structure.md`、`README.md` | 抽出 `prepareCanvasExport` 与 `resetCanvasObjects`，重构 `ImageEditorDialog.vue` 的导出与重置流程 |
| RF-004 | 2026-08-15 | 2026-08-15 | `npm test`；`npm run build` | pass（14 suites / 66 tests） | `docs/project-structure.md`、`README.md` | 精简 `src/api.ts` 为 9 个核心方法，消除 `siyuan-db.ts` 重复 `sql` 导入 |
| RF-005 | 2026-08-15 | 2026-08-15 | `npm test`；`npm run build` | pass（14 suites / 66 tests） | `docs/project-structure.md` | 删除无用空目录 `src/components/SiyuanTheme/` |
| RF-006 | 2026-08-15 | 2026-08-15 | `npm test`；`npm run build` | pass（14 suites / 66 tests） | `docs/project-structure.md`、`README.md`、`README_zh_CN.md` | 刷新全部架构文档、开发指南、测试用例清单与中英文 README |

## 5. 决策与确认

- 用户批准的条目：RF-001, RF-002, RF-003, RF-004, RF-005, RF-006（全部批准并实施完成）
- 延后的条目：无
- 阻塞条目及原因：无

## 6. 文档刷新

- `docs/project-structure.md`：已刷新，包含最新顶层目录、运行时代码、组件、新增 `asset-workflow.ts` 服务层及 14 个测试套件映射。
- `README.md`：已刷新，同步最新功能特性、代码结构概览、开发命令与测试验证状态。
- `README_zh_CN.md`：已刷新，补充开发测试章节与代码结构概览。
- 最终同步检查：全部获批条目状态与代码库实际实现完全一致。

## 7. 下一步

1. 已完成全部获批条目 RF-001 至 RF-006。
2. 保持持续自动化测试验证。


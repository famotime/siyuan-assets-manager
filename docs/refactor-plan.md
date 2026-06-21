# 重构计划

## 1. 项目快照

- 生成日期：2026-06-21
- 范围：`siyuan-assets-manager` 主插件代码，不包含 `plugin-sample-vite-vue/` 模板副本与 `developer_docs/` 参考文档
- 目标：在不改变插件可见行为的前提下，降低资源扫描、引用替换、全局弹窗编排和图片编辑器集成的耦合度，并补齐可重复运行的自动化测试入口
- 文档刷新目标：`docs/project-structure.md`、`README.md`
- 当前基线验证：`npm run build` 通过；存在依赖侧 Rollup 注释警告和 `tui-image-editor` CSS `backbround-color` 警告
- 当前工作区状态：`src/components/ImageEditorDialog.vue` 在计划生成前已有未提交改动，重构实施时需先确认该文件的现有改动边界，避免覆盖用户修改

## 2. 架构与模块分析

| 模块 | 关键文件 | 当前职责 | 主要痛点 | 测试覆盖情况 |
| --- | --- | --- | --- | --- |
| 插件入口与生命周期 | `src/index.ts`、`src/main.ts` | 注册图标、识别运行平台、挂载/卸载 Vue 应用、注册图片右键菜单 | `init/destroy` 使用 `this.name`，但以普通函数调用时 `this` 不稳定；入口内包含资源名解析私有逻辑，难以独立测试；全局窗口函数与 Vue 状态耦合 | 无测试；仅有 `npm run build` 可验证编译与打包 |
| 应用编排与全局弹窗 | `src/App.vue` | 顶栏开关、全局图片编辑、全局重命名、保存编辑后写入新文件并更新引用 | 单文件同时承担 UI、文件名校验、保存/重命名流程、全局 API 暴露；行为分支多且依赖 window、confirm、Siyuan API，回归风险高 | 无测试；文件名校验、扩展名处理、保存后刷新事件未覆盖 |
| 资源列表与列表交互 | `src/components/AssetsManager.vue`、`src/components/VirtualAssetList.vue` | 扫描资源、搜索过滤、排序、预览定位、打开引用文档、删除与清理未引用资源 | 过滤/排序/格式化/预览定位混在组件内部；`formatSize`、扩展名拆分等重复；清理资源是高风险破坏性操作但缺少测试保护 | 无测试；过滤排序、清理统计、预览边界定位未覆盖 |
| 图片编辑器集成 | `src/components/ImageEditorDialog.vue` | 加载 TUI Image Editor、按图片尺寸调整弹窗、注入序号标注菜单、导出保存 | 568 行单组件集成第三方实例、DOM 注入、标注状态、下载保存；存在定时器和 DOM 监听清理边界；当前文件已有未提交改动 | 无测试；可先抽出标注配置、尺寸计算、菜单状态同步等纯逻辑测试 |
| 资源数据库聚合 | `src/utils/siyuan-db.ts` | 读取 `/data/assets`、补齐文件大小、查询 blocks、从 markdown 提取资源引用、生成 `AssetInfo` | `extractAssetsFromMarkdown` 为私有函数但承载关键解析；资源名未统一 URL 解码/查询参数处理；桌面 fs、HEAD 并发、SQL 查询混在一个函数中 | 无测试；资源引用解析、去重、docCount、size fallback 未覆盖 |
| 文件系统操作 | `src/utils/file-system.ts` | 保存、读取、删除、重命名资源文件 | `deleteAsset` 与 `deleteAssetFile` 职责重复；重命名通过复制后删除，缺少新旧文件名合法性与失败补偿策略 | 无测试；读取失败、保存成功但删除失败等路径未覆盖 |
| 块引用更新 | `src/utils/siyuan-block.ts` | 替换或移除 blocks 中的资源引用 | `replaceAssetInBlocks` 直接把旧资源名拼进正则，未转义正则特殊字符；SQL 字符串直接拼接 block id；移除逻辑对链接、图片、纯路径的边界行为需固定 | 无测试；这是高风险核心逻辑，必须先覆盖 |
| API 包装与类型边界 | `src/api.ts`、`src/types/*.d.ts` | 包装 Siyuan kernel API，声明常用类型 | `api.ts` 体积大且模板遗留接口多；类型以全局声明为主，模块边界弱；部分 payload 字段疑似模板遗留，如 `renameDoc` 使用 `doc: notebook` | 无测试；本轮建议只做低风险整理，不优先改 API 行为 |

## 3. 按优先级排序的重构待办

| ID | 优先级 | 模块/场景 | 涉及文件 | 重构目标 | 风险等级 | 重构前测试清单 | 文档影响 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RF-001 | P0 | 测试基础设施与核心纯函数保护 | `package.json`、`package-lock.json`、`tests/`、`src/utils/asset-markdown.ts`、`src/utils/asset-list.ts` | 增加可运行的单元测试入口，先覆盖资源名解析、markdown 资源提取、文件名/扩展名处理、资源引用替换的纯逻辑 | 中 | - [x] 新增 `npm test` 脚本；- [x] 建立 `tests/*.test.ts`；- [x] 定向测试可运行并通过；- [x] 最终阶段统一确认 `npm run build` | `docs/project-structure.md`：记录测试目录；`README.md`：补充测试命令 | done |
| RF-002 | P0 | 块引用替换与移除逻辑 | `src/utils/siyuan-block.ts`、`src/utils/asset-markdown.ts`、`tests/siyuan-block.test.ts` | 抽出纯函数处理资源路径正则转义、替换、移除和空块判定；保留现有 Siyuan API 调用行为 | 高 | - [x] 资源名包含 `+ . ( ) [ ] ?` 时替换正确；- [x] 图片 markdown 被移除；- [x] 链接 markdown 被移除；- [x] 纯路径被移除；- [x] 非空块调用 update，空块调用 delete | `docs/project-structure.md`：记录 markdown 工具职责；`README.md`：通常无用户可见变化 | done |
| RF-003 | P0 | 资源扫描与引用聚合 | `src/utils/siyuan-db.ts`、`src/utils/asset-markdown.ts`、`tests/siyuan-db.test.ts` | 将 markdown 资源提取、`AssetInfo` 聚合、size fallback 分层；让解析和聚合无需 Siyuan 环境即可测试 | 高 | - [x] 同一 block 多次引用同一资源时引用去重符合现有行为；- [x] 多文档 `docCount` 计算正确；- [x] 文件列表不含目录；- [x] 未找到文件时返回空数组；- [x] HEAD size fallback 只补齐 size 为 0 的资源 | `docs/project-structure.md`：记录资源聚合层；`README.md`：通常无用户可见变化 | done |
| RF-004 | P1 | 应用全局动作编排 | `src/App.vue`、`src/utils/asset-actions.ts`、`tests/asset-actions.test.ts` | 把保存编辑、重命名校验、扩展名处理拆到可测试工具，组件保留状态与模板 | 中 | - [x] 新文件名为空时拒绝；- [x] 非法字符拒绝；- [x] 无扩展名时按现有逻辑补齐；- [x] 修改扩展名时遵循 confirm 结果；- [x] 保存编辑生成新文件名 | `docs/project-structure.md`：记录服务层；`README.md`：可补充右键编辑/重命名能力说明 | done |
| RF-005 | P1 | 资源列表过滤排序与危险操作保护 | `src/components/AssetsManager.vue`、`src/components/VirtualAssetList.vue`、`src/utils/asset-list.ts`、`tests/asset-list.test.ts` | 抽出过滤、排序、大小格式化、扩展名拆分、清理统计；降低列表组件体积 | 中 | - [x] 名称搜索大小写不敏感；- [x] 图片/未引用/大文件过滤正确；- [x] 名称、扩展名、大小、引用文档数排序正确；- [x] 清理未引用资源统计数量与大小正确 | `docs/project-structure.md`：记录列表工具；`README.md`：补充清理孤儿资源风险说明 | done |
| RF-006 | P1 | 图片编辑器 DOM 注入与尺寸计算 | `src/components/ImageEditorDialog.vue`、`src/utils/image-editor.ts`、`tests/image-editor.test.ts` | 抽出弹窗尺寸计算、标注尺寸/位置计算辅助逻辑；减少单组件不可测代码 | 中 | - [x] 小图、超大图、窄视口尺寸计算符合 min/max；- [x] 三角形文字 Y 轴补偿符合现有行为；- [ ] 关闭编辑器时销毁实例；- [ ] 切换原生菜单退出标注模式 | `docs/project-structure.md`：记录图片编辑器辅助工具；`README.md`：补充序号标注能力说明 | done |
| RF-007 | P2 | 插件生命周期与入口清理 | `src/index.ts`、`src/main.ts`、`src/utils/plugin-entry.ts`、`tests/plugin-entry.test.ts` | 修正挂载 DOM id 获取方式，抽出 `getAssetNameFromElement` 为可测试函数，明确卸载清理目标 | 中 | - [x] `src`、`data-src`、子级 `img`、最近 `data-src` 均可解析资源名；- [x] 查询参数和 hash 被去除；- [x] unload 时按插件名清理 DOM | `docs/project-structure.md`：记录入口职责；`README.md`：通常无用户可见变化 | done |
| RF-008 | P2 | API 与模板遗留整理 | `plugin.json`、`src/i18n/*`、`src/index.ts`、`src/main.ts`、`src/types/index.d.ts`、删除未引用模板文件 | 清理模板命名和未引用工具/组件，减少维护噪音；保留 `src/api.ts` 公开包装行为不变 | 低 | - [x] `rg` 确认无引用后再删除或迁移；- [x] 构建通过；- [x] 保留公开 API 包装行为不变 | `docs/project-structure.md`：记录保留/删除原因；`README.md`：通常无用户可见变化 | done |

优先级说明：
- `P0`：价值和风险都最高，优先执行，尤其是测试基础、块引用修改、资源聚合。
- `P1`：价值或风险中等，放在 `P0` 之后，主要压缩组件复杂度。
- `P2`：低风险清理项，最后执行，避免先动模板遗留代码造成无关回归。

状态说明：
- `pending`
- `in_progress`
- `done`
- `blocked`

## 4. 执行日志

| ID | 开始日期 | 结束日期 | 验证命令 | 结果 | 已刷新文档 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| PLAN | 2026-06-21 | 2026-06-21 | `npm run build` | pass | 无 | 构建通过；记录依赖警告；未执行重构 |
| RF-001 | 2026-06-21 | 2026-06-21 | `npm test -- tests/asset-markdown.test.ts tests/asset-list.test.ts` | pass，6 tests | `docs/project-structure.md`、`README.md` | 安装 `vitest` 时初次遇到既有 peer 冲突，改用 `--legacy-peer-deps`；新增测试脚本和两组纯函数测试 |
| RF-002 | 2026-06-21 | 2026-06-21 | `npm test -- tests/siyuan-block.test.ts tests/asset-markdown.test.ts`；`npm test` | pass，完整测试 9 tests | `docs/project-structure.md`、`README.md` | 修复资源名正则特殊字符替换问题，块更新逻辑复用 `asset-markdown` |
| RF-003 | 2026-06-21 | 2026-06-21 | `npm test -- tests/asset-markdown.test.ts tests/siyuan-db.test.ts`；`npm test` | pass，完整测试 12 tests | `docs/project-structure.md`、`README.md` | `siyuan-db` 复用统一资源解析，抽出 `createAssetInfoMap`、`attachBlockReferences`、`updateAssetDocCounts` |
| RF-004 | 2026-06-21 | 2026-06-21 | `npm test -- tests/asset-actions.test.ts`；`npm test` | pass，完整测试 16 tests | `docs/project-structure.md`、`README.md` | 新增 `asset-actions`，`App.vue` 复用命名和重命名校验逻辑 |
| RF-005 | 2026-06-21 | 2026-06-21 | `npm test -- tests/asset-list.test.ts`；`npm test`；`npm run build` | pass，完整测试 17 tests；构建通过，有既有依赖警告 | `docs/project-structure.md`、`README.md` | 列表组件复用 `asset-list`，新增清理统计工具 |
| RF-006 | 2026-06-21 | 2026-06-21 | `npm test -- tests/image-editor.test.ts`；`npm test`；`npm run build` | pass，完整测试 20 tests；构建通过，有既有依赖警告 | `docs/project-structure.md`、`README.md` | 抽出图片编辑尺寸和标注定位纯函数；保留既有按钮文案改动 |
| RF-007 | 2026-06-21 | 2026-06-21 | `npm test -- tests/plugin-entry.test.ts`；`npm test`；`npm run build` | pass，完整测试 23 tests；构建通过，有既有依赖警告 | `docs/project-structure.md`、`README.md` | 新增 `plugin-entry`，修正挂载/卸载 DOM id 不再依赖普通函数中的 `this.name` |
| RF-008 | 2026-06-21 | 2026-06-21 | `npm test -- tests/project-metadata.test.ts`；`npm test`；`npm run build` | pass，完整测试 24 tests；构建通过，有既有依赖警告 | `docs/project-structure.md`、`README.md` | 清理模板 URL/i18n/class/global 类型，删除未引用 `SiyuanTheme`、`utils/index.ts`、`plugin-bridge.ts` |

## 5. 决策与确认

- 用户批准的条目：RF-001、RF-002、RF-003、RF-004、RF-005、RF-006、RF-007、RF-008
- 延后的条目：无
- 阻塞条目及原因：
  - 无。RF-001 已补齐测试入口，RF-006 已在保留既有按钮文案改动的前提下完成局部抽取。

## 6. 文档刷新

- `docs/project-structure.md`：已创建，记录最新目录结构、模块职责、测试目录与新增工具边界。
- `README.md`：已刷新，补充开发/构建/测试命令、清理资源风险提示、当前验证状态和结构入口。
- 最终同步检查：`npm test` 通过，8 个测试文件、24 个测试；`npm run build` 通过并生成 `dist/` 与 `package.zip`。构建仍有既有依赖侧 Rollup 注释警告和 `tui-image-editor` CSS `backbround-color` 警告，未阻塞构建。

## 7. 下一步

1. 已完成全部获批条目 RF-001 至 RF-008。
2. 已刷新 `docs/project-structure.md` 与 `README.md`。
3. 已完成最终验证：`npm test` 与 `npm run build` 均通过。

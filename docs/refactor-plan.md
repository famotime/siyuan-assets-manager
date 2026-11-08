# 重构计划

## 1. 项目快照

- 生成日期：2026-11-08
- 范围：`siyuan-assets-manager`（思源笔记资源管家插件）v1.2.3 全代码库
- 背景：上一轮重构（2026-09-22，RF-001~006）已全部完成并随 v1.2.2 发布。此后代码演进了引用校验、i18n 英文化、体积补全性能、快照秒开与三路增量校验等多个版本，需基于当前代码做新一轮分析与重构。
- 目标：在不改变任何用户可见行为的前提下——① 打破 utils 层三角循环依赖；② 为核心数据一致性逻辑（定向更新）补齐零覆盖测试；③ 消除组件间与模块内的逐行级重复；④ 刷新架构文档。
- 文档刷新目标：`docs/project-structure.md`、`README.md`、`README.zh_CN.md`
- 当前基线验证：`pnpm test` → **49 套件 / 454 测试全部通过**（2026-11-08）。
- 仓库现状备注：工作区存在用户先前的未提交改动（3 个中文 docs 已删除、新增 `docs/reference/`、`.zcode/`），与本轮重构无关，不触碰。

## 2. 架构与模块分析

### 2.1 utils 层

| 模块 | 行数 | 当前职责 | 主要痛点 | 测试覆盖情况 |
| --- | --- | --- | --- | --- |
| `siyuan-db.ts` | 607 | 依赖根：领域类型 + 纯装配（L25–355）+ 高层 API 编排（L393–607） | **循环依赖 3 个顶点**（⇄asset-catalog、⇄siyuan-block、⇄attribute-view）；`isIgnoredSystemAsset` 与 asset-catalog 逐字重复；`getAssetInfoByName` 128 行单函数 5 件事 | `siyuan-db.test.ts` 约 24 例，纯装配部分覆盖良好 |
| `asset-catalog.ts` | 1060 | 目录扫描 6 类职责：枚举过滤 / 纯装配流水线 / 两阶段扫描编排 / 增量校验 / 内存缓存 / stat 补全 | 纯装配（约 400 行）与 I/O 编排混居；`resolveCatalogPipelineFromEntries` 253 行内 3 段同构循环；分批 ID 核查与 siyuan-block 三处同构；被 AssetsManager.vue 14 符号大 import 绑死 | 装配管线 8 例 + cache + incremental；`fetchCatalogFiles` 降级分支与 `fetchCatalogSupportData` 迁移写路径零覆盖 |
| `attribute-view.ts` | 832 | 纯解析 / 引用解析 / 写联动 / 单元格快照与两套回退 | "列目录→读→blobToText" 样板 ×5 重复；`cellsByView` 分组 ×2；两个 restore 合计 208 行近半复制粘贴 | `attribute-view.test.ts` 19 例覆盖最好；`extractValueFields` 疑似漏采 url 字段（行为疑点，见 RF-005） |
| `siyuan-block.ts` | 703 | 引用查询 / 替换删除写编排 / re-edit 属性 CRUD / 批量核查 | `replaceAssetInBlocks` 140 行单函数 6 件事；`hasAssetIn` 闭包 ×3；kramdown 兜底 ×2；flushTransaction try/catch ×4 | replace/remove 共 11 例；replace 的 kramdown 兜底分支未测 |
| `asset-list.ts` | 660 | 类型 + 媒体判定 + 格式化 + 过滤排序 + 清理统计 + 文档分组（5 类职责） | 文档分组约 256 行自成一体；"未引用资产"条件 ×3 重复 | `asset-list.test.ts` + 4 个分组测试文件，保护最全 |
| `canvas-asset.ts` / `image-editor.ts` | 606/701 | 画布扫描/删除 + UI 集成；编辑器几何/位图管线 | `openCanvasInTab` UI 耦合混在 utils；image-editor 的 host-isolation 转发层冗余 | canvas 覆盖良好；image-editor 异步位图管线无直接单测 |

### 2.2 组件层

| 组件 | 行数 | 主要痛点 | 测试覆盖情况 |
| --- | --- | --- | --- |
| `AssetsManager.vue` | 2087 | `applyTargetedAssetUpdate` 146 行（全仓最长函数、分支矩阵最大、**直接测试为零**）；canvas 路径解析片段 ×3 重复 | toolbar/doc-sort/video-preview 3 个挂载测试；定向更新逻辑零覆盖 |
| `VirtualAssetList.vue` + `DocumentAssetGroupList.vue` | 737+1118 | **缩略图 Blob URL 缓存约 62 行逐行级重复 ×2**；行点击三态选择（Shift 区间/Ctrl 切换/单选）逻辑重复 ×2；asset 行模板结构重复 | `document-asset-group-list.test.ts` 10 例 + `doc-group-rows.test.ts` 15 例，保护完备 |
| `AssetsManager.vue` / `DeduplicateDialog.vue` / `DeletionHistoryDialog.vue` | — | **文档跳转逻辑三份拷贝**（画布判定→openCanvasInTab、伪引用判定、`filterExistingBlockIds` 失效预检、openTab action 契约），承载高危 UX 路径 | dialog 侧有跳转用例；三处契约靠各自测试分散保护 |
| `DeduplicateDialog.vue` | 1646 | `import { usePlugin } from '../main'` 违反既有边界规则先例（utils 层已被 `module-boundaries.test.ts` 禁止，组件层漏网）；批量合并确认文案拼接不可测 | 无组件级挂载测试 |

## 3. 按优先级排序的重构待办

| ID | 优先级 | 模块/场景 | 涉及文件 | 重构目标 | 风险等级 | 重构前测试清单 | 文档影响 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RF-001 | P0 | 打破 utils 三角循环：抽离 `siyuan-db.ts` 纯函数/类型层 | `src/utils/siyuan-db.ts`、`src/utils/asset-model.ts`（新增）、`src/utils/asset-catalog.ts`、`src/utils/siyuan-block.ts`、`src/utils/attribute-view.ts`、`tests/module-boundaries.test.ts` | 将 `siyuan-db.ts` L25–355（类型 + 纯装配）移入新 `asset-model.ts`；`siyuan-db.ts` re-export 保持 100% 接口兼容；catalog/block/attribute-view 的类型与纯函数引用改指 asset-model，消除 3 条循环边；`isIgnoredSystemAsset` 收敛为单一实现 | 高 | - [x] 基线 `pnpm test` 49/454 全绿；<br>- [x] 现有 `siyuan-db.test.ts`（24 例）经门面 re-export 随迁通过；<br>- [x] `module-boundaries.test.ts` 新增断言：asset-model 零上层依赖、catalog/block/attribute-view 不再 import siyuan-db；<br>- [x] `asset-catalog.test.ts` + `asset-catalog-incremental.test.ts` 全过 | `docs/project-structure.md`：新增 asset-model 职责条目 | done |
| RF-002 | P0 | 抽离全仓最长函数 `applyTargetedAssetUpdate` 为纯函数并补齐分支矩阵测试 | `src/components/AssetsManager.vue`、`src/utils/asset-targeted-update.ts`（新增）、`tests/asset-targeted-update.test.ts`（新增） | 将 146 行定向更新编排抽为 `applyTargetedAssetUpdate(list, selectedNames, detail, { onInvalidateThumbnail }) → { list, selectedNames }`（deps 注入风格，同 `asset-workflow.ts` 先例）；组件保留薄壳调用；先按当前行为编写表驱动测试再实施 | 高 | - [x] 表驱动测试覆盖（14 例）：rename×旧名存在/缺失、edit 更新、deletedOld 双态、原图引用联动、selectedNames 迁移矩阵、缩略图失效回调（canvas 路径解析归入 RF-004 doc-jump）；<br>- [x] `asset-manager-doc-sort.test.ts`（edit 后重排路径）全过；<br>- [x] 抽离前后组件级测试行为等价 | `docs/project-structure.md`：记录 asset-targeted-update | done |
| RF-003 | P1 | 消除两个列表组件逐行重复：缩略图缓存与行选择 | `src/components/VirtualAssetList.vue`、`src/components/DocumentAssetGroupList.vue`、`src/utils/asset-thumbnail.ts`（新增）、`src/utils/asset-selection.ts`（新增）、`tests/asset-thumbnail.test.ts`（新增）、`tests/asset-selection.test.ts`（新增） | 抽 `createThumbnailCache` 工厂（deps 注入 `readOriginalImage`/`defaultStorage.read`，覆盖 ObjectURL 创建/释放、Loading 去重、失效释放、getThumbnailSrc 分支）与 `applyRowSelection` 纯函数（Shift 区间/Ctrl 切换/单选） | 中 | - [x] ObjectURL 创建与卸载释放配对、Loading 去重、失效释放无泄漏（11 例）；<br>- [x] getThumbnailSrc 三分支（原图/canvas/普通）；<br>- [x] Shift 区间、Ctrl/Cmd 切换、单选、去重、稀疏窗口条目（12 例）；<br>- [x] `document-asset-group-list.test.ts` 10 例 + `doc-group-rows.test.ts` 15 例全过 | `docs/project-structure.md`：记录两个新模块 | done |
| RF-004 | P1 | 三组件文档跳转收敛为 `doc-jump.ts` | `src/components/AssetsManager.vue`、`src/components/DeduplicateDialog.vue`、`src/components/DeletionHistoryDialog.vue`、`src/utils/doc-jump.ts`（新增）、`tests/doc-jump.test.ts`（新增） | 抽公共跳转服务：canvas 判定→openCanvasInTab、独立数据库判定、`filterExistingBlockIds` 失效预检与兜底提示、openTab action 契约（`['cb-get-hl','cb-get-focus','cb-get-context']` + `keepCursor`）；i18n 文案与通知时机参数化 | 中 | - [x] canvas 引用走 openCanvasInTab（带/不带标题两种口径，17 例）；<br>- [x] 失效块：提示且不跳转（含多 id 任一存活语义）；<br>- [x] 正常块：openTab 参数契约正确（action 常量防污染）；<br>- [x] `deletion-history-dialog.test.ts` 跳转用例 + `asset-manager-*.test.ts` 全过 | `docs/project-structure.md`：记录 doc-jump | done |
| RF-005 | P1 | `attribute-view.ts` 读写样板收敛 | `src/utils/attribute-view.ts`、`tests/attribute-view.test.ts` | 抽 `forEachAvJson` 目录迭代器收敛 5 处"列目录→读→blobToText"样板；收敛 `cellsByView` 分组 ×2 与单元格定位 ×2；两个 restore 差异收敛到策略函数；**行为 100% 保持**（含 `extractValueFields` 现状——url 字段疑点仅记录，不在本轮改动） | 中 | - [x] 现有 `attribute-view.test.ts` 19 例全过（格式保真、skip 计数、坏 JSON 容错）；<br>- [x] 新增 2 例：`queryAllAttributeViewBlocks` SQL 成功/失败降级/非数组容错（原为零覆盖） | `docs/project-structure.md`：模块职责描述更新 | done |
| RF-006 | P1 | `asset-catalog.ts` 装配/编排分层 | `src/utils/asset-catalog.ts`、`src/utils/catalog-resolve.ts`（新增）、`tests/asset-catalog.test.ts` | 将约 400 行纯装配流水线（`resolveCatalogPipelineFromEntries` 等）移入 `catalog-resolve.ts`；`asset-catalog.ts` 作门面 re-export，AssetsManager.vue import 不变；收敛 `resolveCatalogPipelineFromEntries` 内 3 段同构循环与 3 处分批 ID 核查（实施时先核对语义是否完全一致，不一致则抽公共 chunk 辅助而非强行复用） | 中 | - [x] `asset-catalog.test.ts` + cache + incremental + stat-fill + missing-assets + canvas-asset + module-boundaries 共 7 文件 51 例全过；<br>- [x] 2.1/2.2/2.3 三段同构循环收敛为 mergeRenderedAssetRefs 公共尾部（源侧守卫保留原位），sidecar/AV/`.pdf.sya` 等现有用例锁定等价；<br>- [x] 3 处分批 ID 核查**未强行复用**：enrichAnnotationDocPaths（id+hpath 列、静默容错）与 fetchCatalogBlockDelta（id 列、错误上抛）与 siyuan-block.filterExistingBlockIds（保守兜底）语义各异，按计划保留各自实现 | `docs/project-structure.md`：记录 catalog-resolve | done |
| RF-007 | P2 | 一致性小清理 | `src/components/DeduplicateDialog.vue`、`src/utils/image-editor.ts`、消费组件、`tests/` | ① `usePlugin` 改从 `plugin-context` 导入（对齐边界规则）；② 批量合并确认文案抽 `buildBatchMergeConfirmMessage` 纯函数 + 测试（同 cleanup-workflow 风格）；③ 删除 `image-editor.ts` 对 host-isolation 的冗余转发层，组件直接 import | 低 | - [x] `plugin-context.test.ts` + `plugin-entry.test.ts` 全过；<br>- [x] `image-editor.test.ts` + `tui-bridge.test.ts` 全过（host-isolation 断言改为直接导入）；<br>- [x] buildBatchMergeConfirmMessage 新增 2 例单测（跨组文档去重统计口径 + 相似模式文案切换） | `docs/project-structure.md`：同步说明 | done |
| RF-008 | P2 | 刷新仓库文档 | `docs/project-structure.md`、`README.md`、`README.zh_CN.md` | 在最后一个获批条目 `done` 后统一刷新：模块清单与职责映射对齐最新目录结构；README 用户可见能力、开发命令核对（`pnpm test` / `pnpm run build`）；不改动用户未提交的 docs 删除/新增 | 低 | - [x] 文档所列文件路径与实际目录 100% 对齐（脚本核对：src/utils 40 文件、tests 54 套件、组件 9 个全部在列，无虚构条目；storage 4 个适配器以汇总行覆盖）；<br>- [x] `pnpm test` 全绿（54 suites / 514 tests）+ `pnpm run build` 产物校验通过后收尾；<br>- [x] README 核对结论：双语 README 为纯功能介绍文档（无开发命令/测试计数章节），本轮重构未改变任何用户可见能力 → 内容无需改动 | 两个文档全部刷新 | done |

优先级说明：
- `P0`：价值高且风险高——架构健康（循环依赖）与核心数据一致性（零覆盖最长函数），优先执行并强化测试
- `P1`：中等风险或中等价值——重复消除与职责分层，在 P0 之后执行
- `P2`：低风险清理与文档刷新，最后执行

状态说明：`pending` / `in_progress` / `done` / `blocked`

## 4. 执行日志

| ID | 开始日期 | 结束日期 | 验证命令 | 结果 | 已刷新文档 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| 基线验证 | 2026-11-08 | 2026-11-08 | `pnpm test` | pass（49 suites / 454 tests） | 无 | 基线全绿 |
| RF-001 | 2026-11-08 | 2026-11-08 | `npx vitest run`（10 个定向测试文件）；`npx tsc --noEmit`；`pnpm test`；`pnpm run build` | pass（定向 123 tests；全量 49 suites / 456 tests；构建成功） | 无（project-structure.md 待 RF-008 统一刷新） | 新增 `asset-model.ts`（约 380 行纯模型层）；`siyuan-db.ts` 转为门面+高层查询；catalog/block/attribute-view/canvas-asset/asset-list 改线，3 条循环边斩断；`isIgnoredSystemAsset` 收敛为单一实现；tsc 21 个错误全部为存量（与本次改动无关） |
| RF-002 | 2026-11-08 | 2026-11-08 | `npx vitest run tests/asset-targeted-update.test.ts`（14 例）；组件测试 4 文件 29 例；`pnpm test` | pass（全量 50 suites / 470 tests） | 无（待 RF-008） | 新增 `asset-targeted-update.ts`（189 行纯函数）；AssetsManager.vue 2087→1950 行；**顺带修复 rename 分支 TDZ 缺陷**：原实现中 `updatedItem` 仅在旧名命中分支声明，重命名"列表中不存在的资产"时会触发 ReferenceError，抽离后统一改用分支内条目变量（该路径原本必崩溃、无既有行为可保，属缺陷修复而非行为变更） |
| RF-003 | 2026-11-08 | 2026-11-08 | `npx vitest run`（asset-selection/asset-thumbnail/document-asset-group-list/doc-group-rows/asset-manager-doc-sort）；`pnpm test` | pass（全量 52 suites / 493 tests） | 无（待 RF-008） | 新增 `asset-thumbnail.ts`（deps 注入工厂，删除 vue 直接依赖顾虑——utils 层已有 confirm.ts 先例）与 `asset-selection.ts`（纯状态机）；两列表组件缩略图块 62 行 ×2 与行点击三态机 ×2 收敛为单一实现；行为差异点（DAGL 勾选框不移动锚点）逐一保持 |
| RF-004 | 2026-11-08 | 2026-11-08 | `npx vitest run tests/doc-jump.test.ts`（17 例）；dialog/组件测试 5 文件 42 例；`pnpm test` | pass（全量 53 suites / 510 tests） | 无（待 RF-008） | 新增 `doc-jump.ts`（127 行内核：resolveCanvasPath 统一口径 + openBlockRefInTab 单引用跳转 + buildOpenTabOptions 循环多开契约）；AssetsManager 1927 行（-23）、DeduplicateDialog 1615 行（-31）；**两处角落口径统一（更准确的既有 AM 行为）**：① dedup 对 "canvas: 前缀 id 且无 path" 的引用不再误用 root_id 作画布路径；② AM 单文档入口对独立数据库伪引用现在给出明确"虚拟来源"提示而非假成功（对齐 7376859 提交意图） |
| RF-005 | 2026-11-08 | 2026-11-08 | `npx vitest run tests/attribute-view.test.ts`（21 例）；`pnpm test` | pass（全量 53 suites / 512 tests） | 无（待 RF-008） | 收敛 5 类重复：list+filter ×4→1（listAttributeViewJsonFiles）、read+blobToText ×6→1（readAttributeViewText）、serialize+write 收尾 ×3→1（writeAttributeViewJson）、cellsByView 分组 ×2→1（groupCellsByView）、单元格定位 ×2→1（findViewCellValue）；**未采用计划中的单一 forEachAvJson 迭代器**——5 处循环的失败语义（warn 文案/skip 计数/整体 try 范围）各不相同，强行统一参数表会比重复本身更复杂，改为按助手函数粒度收敛；`extractValueFields` url 字段疑点保持现状（见第 7 节） |
| RF-006 | 2026-11-08 | 2026-11-08 | `npx vitest run`（catalog 相关 7 文件 51 例）；`pnpm test` | pass（全量 53 suites / 512 tests） | 无（待 RF-008） | 新增 `catalog-resolve.ts`（445 行零 I/O 纯装配层：类型契约 + 流水线 + resolve/inventory/merge）；`asset-catalog.ts` 1010→645 行转为纯编排门面，全量 re-export 保持 100% 接口兼容（AssetsManager.vue 等 14 符号消费方零改动）；扫描契约类型族随装配层下沉，仅类型引用 canvas-asset（运行时零边） |
| RF-007 | 2026-11-08 | 2026-11-08 | `npx vitest run`（dedup-batch-confirm/deduplicate/image-editor/tui-bridge/plugin-context/plugin-entry）；`pnpm test` | pass（全量 54 suites / 514 tests） | 无（RF-008 统一刷新） | ① DeduplicateDialog `usePlugin` 改从 `plugin-context` 导入，补齐组件层边界规则缺口；② `buildBatchMergeConfirmMessage` 抽入 deduplicate.ts（同 cleanup-workflow 风格）+2 例单测，组件只读结果；③ 删除 image-editor.ts 对 host-isolation 的冗余转发层（零消费方），image-editor.test.ts 的 host-isolation 断言改为直接导入 |
| RF-008 | 2026-11-08 | 2026-11-08 | 脚本核对文档↔目录对齐；`pnpm test`；`pnpm run build` | pass（54 suites / 514 tests；构建成功） | `docs/project-structure.md`（全面重写：新增模型/装配/分层小节、依赖方向约定、54 套件分类索引、pnpm 命令）；README 双语核对后无需改动 | 用户先前未提交的 docs 删除/`docs/reference/` 新增未触碰 |
| 遗留-1 | 2026-11-08 | 2026-11-08 | 内核源码核对（assets_test.go URL 列用例）；`npx vitest run tests/attribute-view.test.ts`（25 例，4 红→绿）；`pnpm test` | pass（55 suites / 526 tests） | `docs/refactor-plan.md`、`docs/project-structure.md` | url 字段疑点确认为缺陷并修复：extractValueFields 采集 +url、去重回退还原 +url、skip 计数 +url，与内核"URL 列计引用"规则及删除链路全对齐 |
| 遗留-2 | 2026-11-08 | 2026-11-08 | `npx vitest run tests/asset-catalog-fetch.test.ts`（8 例新增）；`pnpm test` | pass | `docs/project-structure.md` | fetchCatalogFiles 三级降级链与 fetchCatalogSupportData Sidecar 迁移写路径补齐测试，degraded 标记锁定 |
| 遗留-3 | 2026-11-08 | 2026-11-08 | `npx tsc --noEmit`（22→0）；`pnpm test`；`pnpm run build` | pass（构建成功） | `docs/project-structure.md`（shims-vue.d.ts 条目、计数 55/526） | 17 处机械类型修复 + 1 个真实缺陷：storage 门面补 deleteToTrash，画布资产回收站删除恢复生效 |

## 5. 决策与确认

- 用户批准的条目：全部批准（RF-001 ~ RF-008），2026-11-08
- 延后的条目：无
- 阻塞条目及原因：无
- 实施中的计划修正（均有日志记录）：
  - RF-005 未采用单一 forEachAvJson 迭代器（5 处循环失败语义各异，改为助手函数粒度收敛）
  - RF-006 3 处分批 ID 核查未强行复用（列/错误语义各异，按计划预案保留）
  - RF-002 顺带修复 rename 分支 TDZ 缺陷（原路径必崩溃，无既有行为可保）
  - RF-004 统一两处角落口径（dedup 画布路径解析、AM 单文档入口伪引用提示），对齐更准确的既有行为

## 6. 文档刷新

- [x] `docs/project-structure.md`：全面重写——按"领域模型/扫描编排/业务工作流/去重/审计回退/块读写/UI 支撑"分层记录全部 40 个 utils 模块与 9 个组件，新增依赖方向约定小节，测试索引更新至 54 套件 / 514 测试，命令统一为 pnpm；脚本核对与实际目录 100% 对齐
- [x] `README.md` / `README.zh_CN.md`：核对后确认无需改动（纯功能介绍文档，本轮无用户可见能力变化）
- [x] 最终同步检查：全量测试 54 suites / 514 tests 全绿，`pnpm run build` 产物校验通过

## 7. 交付成果总结

1. **RF-001**：新增 `asset-model.ts` 领域模型层，斩断 siyuan-db ⇄ asset-catalog / siyuan-block / attribute-view 三条循环依赖，`isIgnoredSystemAsset` 收敛单一实现；siyuan-db 转为门面，30 个消费方零改动。
2. **RF-002**：`applyTargetedAssetUpdate`（全仓最长 146 行函数）抽为纯函数 + 14 例表驱动测试，AssetsManager.vue 瘦身至 1927 行；顺带修复 rename 分支 TDZ 崩溃缺陷。
3. **RF-003**：新增 `asset-thumbnail.ts` 与 `asset-selection.ts`，消除两个列表组件 62 行 ×2 逐行重复；23 例新测试。
4. **RF-004**：新增 `doc-jump.ts` 跳转内核，收敛三组件共约 250 行重复跳转实现；17 例新测试，统一画布路径解析口径。
5. **RF-005**：attribute-view.ts 读写样板 5 类重复收敛（×4→1、×6→1、×3→1、×2→1、×2→1），19 例存量测试全过 + 2 例新增。
6. **RF-006**：新增 `catalog-resolve.ts` 零 I/O 纯装配层，asset-catalog.ts 1010→645 行转纯编排，门面 100% 兼容。
7. **RF-007**：DeduplicateDialog 边界规则对齐、批量合并确认文案抽纯函数 +2 例、删除 image-editor 冗余转发层。
8. **RF-008**：`docs/project-structure.md` 全面重写并与实际目录脚本核对对齐；双语 README 核对无需改动。

净效果：+10 个新模块（全部有独立单测）、54 套件 / 514 测试（基线 49/454）、utils 最大单文件 1060→645 行、三条循环依赖清零；行为契约经 454 存量测试 + 60 新增测试双重锁定。

## 8. 遗留事项处理结果（2026-11-08 第二批，全部闭环）

1. **url 字段疑点 → 确认为缺陷并已修复**（4 例红转绿测试锁定）：
   - 依据内核源码 `kernel/model/assets_test.go` TestGetAttributeViewAssetsLinkDestsFiltersItems：官方将 URL 列 `value.URL.Content` 计入资产引用；插件引用计数口径 `extractAssetsFromAttributeViewJson` 1.3 分支早已解析 url——但快照采集 `extractValueFields` 只看 content/mAsset，去重回退 `restoreAttributeViewAssetCells` 不还原 url，`countRestorableFields` 漏数 url。
   - 且去重合并经 `replaceAssetInAttributeViews` 文本级替换**确实会改写** url.content，构成"url 被改写却无快照、不可回退"的完整缺口（删除链路同理：removeAsset 清理 url 但 capture 漏采 url-only 单元格）。
   - 修复：三处对齐（采集 +url 字段、去重回退 +url 还原、skip 计数 +url），url 匹配沿用与引用计数同一 `extractAssetNamesFromMarkdown` 口径，采集语义 ⊇ 引用计数语义。
2. **Sidecar 迁移写路径零覆盖 → 已补测试**（`tests/asset-catalog-fetch.test.ts` 8 例）：fetchCatalogFiles 三级降级链（local-fs → 内核递归 → dirAvailable=false）、IAL→Sidecar 迁移写（落盘合入/已存在不写/写失败容错）、degraded 标记（属性视图失败/画布失败）。
3. **tsc 存量告警 → 22→0 清零**：17 处机械修复（unused 导入/死绑定、`*.vue` shims、`in` 收窄替代非 strict 下失效的布尔判别式收窄、SerializedStatCacheV1 投入使用、SettingsHostPlugin 类型化、TProtyleAction 契约类型、orphanOriginals 补 path 可选字段）；**顺带修复 1 个真实运行时缺陷**：storage 门面缺 `deleteToTrash` 方法导致画布资产"移入回收站"从未生效、静默走永久删除——补通用 `deleteToTrash(absolutePath)` 门面方法（适配器不支持时回退永久删除，与原意图一致）。

## 9. 下一步建议

1. （已闭环）fetchCatalogFiles 降级分支与 Sidecar 迁移写路径测试 → `tests/asset-catalog-fetch.test.ts`。
2. （已闭环）extractValueFields url 字段对齐 → 采集/两套回退/skip 计数全链路一致。
3. （已闭环）tsc 存量告警清零 → `npx tsc --noEmit` 0 错误。
4. 后续可选：`removeAssetFromAttributeViews` 对 http 前缀完整 URL 的 `includes` 判定偏宽（会清理形如 `https://cdn.example.com/assets/x.png` 的外链 url），与引用计数口径（extract 不提取带协议前缀的引用）不一致——影响面小，记录待议。

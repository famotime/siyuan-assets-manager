# 项目结构

生成日期：2026-06-21

## 顶层目录

| 路径 | 职责 |
| --- | --- |
| `src/` | 插件源码，包含 Siyuan 插件入口、Vue 应用、组件、工具函数和类型声明 |
| `tests/` | Vitest 单元测试，覆盖资源解析、块引用更新、列表逻辑、入口工具、图片编辑辅助逻辑和元数据 |
| `docs/` | 项目维护文档，包含本结构说明与重构计划 |
| `developer_docs/` | Siyuan 插件和 API 参考资料，不参与运行时代码 |
| `plugin-sample-vite-vue/` | 原始模板副本，作为参考保留，不参与主插件构建 |
| `dist/` | 构建输出目录，由 `npm run build` 生成 |

## 运行时代码

| 路径 | 职责 |
| --- | --- |
| `src/index.ts` | Siyuan 插件类入口；注册图标、平台信息、顶层生命周期和图片右键菜单 |
| `src/main.ts` | Vue 应用挂载、卸载和插件实例绑定 |
| `src/App.vue` | 顶层应用编排；管理主面板显示、全局图片编辑弹窗和全局重命名弹窗 |
| `src/api.ts` | Siyuan kernel API 包装；保留模板中常用接口，当前重构未改变公开行为 |
| `src/index.scss` | 全局样式入口 |
| `src/i18n/*.json` | 插件国际化文案 |

## Vue 组件

| 路径 | 职责 |
| --- | --- |
| `src/components/AssetsManager.vue` | 资源管理主面板；加载资源、筛选排序、预览定位、打开引用、删除和清理孤儿资源 |
| `src/components/VirtualAssetList.vue` | 虚拟滚动资源列表；负责列表展示和行级操作事件 |
| `src/components/ImageEditorDialog.vue` | TUI Image Editor 弹窗；负责图片加载、编辑器实例、序号标注菜单、下载和保存事件 |

## 工具模块

| 路径 | 职责 |
| --- | --- |
| `src/utils/asset-actions.ts` | 编辑后文件名生成、重命名输入校验和扩展名决策 |
| `src/utils/asset-list.ts` | 资源过滤、排序、扩展名拆分、大小格式化、孤儿资源清理统计 |
| `src/utils/asset-markdown.ts` | Markdown 中 assets 引用解析、替换、移除和正则转义 |
| `src/utils/file-system.ts` | 资源文件读取、保存、删除和重命名 |
| `src/utils/image-editor.ts` | 图片编辑器弹窗尺寸和序号标注定位计算 |
| `src/utils/plugin-entry.ts` | 插件入口相关纯函数；资源名解析和根容器 id 生成 |
| `src/utils/siyuan-block.ts` | 对引用资源的 blocks 执行替换、移除、更新或删除 |
| `src/utils/siyuan-db.ts` | 读取 assets 文件、查询 blocks、聚合 `AssetInfo`、补齐文件大小 |

## 类型

| 路径 | 职责 |
| --- | --- |
| `src/types/index.d.ts` | Siyuan 常用全局类型、窗口扩展和前端平台枚举 |
| `src/types/api.d.ts` | Siyuan API 返回结构补充声明 |

## 测试

| 路径 | 覆盖范围 |
| --- | --- |
| `tests/asset-actions.test.ts` | 编辑命名、重命名校验和扩展名确认 |
| `tests/asset-list.test.ts` | 过滤、排序、扩展名、大小格式化、孤儿资源统计 |
| `tests/asset-markdown.test.ts` | assets 引用提取、正则特殊字符替换、图片/链接/纯路径移除 |
| `tests/image-editor.test.ts` | 图片编辑器尺寸和序号标注定位计算 |
| `tests/plugin-entry.test.ts` | 入口资源名解析和根容器 id |
| `tests/project-metadata.test.ts` | 插件元数据和 i18n 文案不再暴露模板名称 |
| `tests/siyuan-block.test.ts` | 块引用替换、移除、空块删除和非空块更新 |
| `tests/siyuan-db.test.ts` | 资源文件聚合、目录过滤、引用统计、文件大小 fallback |

## 构建与验证

| 命令 | 说明 |
| --- | --- |
| `npm test` | 运行全部 Vitest 单元测试 |
| `npm run build` | 生产构建，输出 `dist/` 并生成 `package.zip` |
| `npm run dev` | Vite watch 构建到配置的 Siyuan 工作空间插件目录 |

## 清理说明

- 已删除未引用的模板辅助文件：`src/utils/index.ts`、`src/utils/plugin-bridge.ts`。
- 已删除未引用的模板主题组件目录：`src/components/SiyuanTheme/*`。
- `src/api.ts` 仍保留较多模板 API 包装，因为多个运行时模块依赖其中函数，且本轮重构不改变其公开行为。

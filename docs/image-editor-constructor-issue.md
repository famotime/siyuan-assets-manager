# 图片编辑器构造函数问题复盘

## 1. 问题背景

- 记录日期：2026-07-11
- 涉及项目：`siyuan-assets-manager`
- 关联依赖：`tui-image-editor`
- 依赖来源：`file:../tui.image-editor/apps/image-editor`
- 触发场景：在插件中打开图片编辑弹窗，初始化 TUI Image Editor 实例时失败

## 2. 问题现象

编辑图片时无法正常加载图片，控制台出现如下关键报错：

```text
[AssetsManager] Resolved constructor dynamically: Module {Symbol(Symbol.toStringTag): 'Module'}
Uncaught (in promise) TypeError: ImageEditorConstructor is not a constructor
    at initEditor (plugin:siyuan-assets-manager:59432:24)
    at img.onload (plugin:siyuan-assets-manager:59410:13)
```

同一控制台中还出现了另一个插件的热更新连接失败：

```text
GET http://127.0.0.1:35730/livereload.js?snipver=1 net::ERR_CONNECTION_REFUSED
```

该 `livereload.js` 报错来源是 `siyuan-doc-assist`，属于开发热更新脚本连接失败，不是本插件图片编辑器无法初始化的根因。

## 3. 根因分析

本次根因集中在 `tui-image-editor` 的模块导入和 Vite 构建转换边界：

1. `tui-image-editor` 的包入口是 UMD/CommonJS 产物：

   ```json
   {
     "main": "dist/tui-image-editor.js"
   }
   ```

2. 该 UMD 文件通过 `module.exports = factory()` 输出构造函数。

3. 本项目使用的是本地 file 依赖：

   ```json
   "tui-image-editor": "file:../tui.image-editor/apps/image-editor"
   ```

4. 由于实际依赖路径解析到仓库外部的 `D:\MyCodingProjects\tui.image-editor\apps\image-editor`，不完全落在 Vite 默认 CommonJS 转换覆盖范围内。

5. 之前的桥接代码使用 `import * as ImageEditorModule from 'tui-image-editor'`，生产构建后被处理成类似空模块命名空间对象：

   ```js
   Object.freeze(Object.defineProperty({ __proto__: null }, Symbol.toStringTag, { value: 'Module' }))
   ```

6. `getImageEditor()` 返回的是模块命名空间对象而不是构造函数，最终执行：

   ```ts
   new ImageEditorConstructor(...)
   ```

   时触发 `ImageEditorConstructor is not a constructor`。

## 4. 修复方案

### 4.1 新增桥接解析层

新增 `src/utils/tui-image-editor-bridge.ts`，统一解析不同打包器/CommonJS 互操作形态下的构造函数：

```ts
import ImageEditorModule from 'tui-image-editor';

export function resolveImageEditorConstructor(moduleValue: any): any {
  let candidate = moduleValue;

  while (candidate?.default && candidate.default !== candidate) {
    candidate = candidate.default;
  }

  if (typeof candidate !== 'function') {
    throw new TypeError('无法解析 tui-image-editor 构造函数');
  }

  return candidate;
}

export function getImageEditor(): any {
  return resolveImageEditorConstructor(ImageEditorModule);
}
```

该逻辑兼容以下几类常见互操作形态：

- 直接构造函数：`ImageEditor`
- 默认导出包装：`{ default: ImageEditor }`
- 嵌套默认导出包装：`{ default: { default: ImageEditor } }`

同时，解析失败时抛出明确错误，避免后续只看到模糊的 `is not a constructor`。

### 4.2 调整 Vite CommonJS 转换范围

在 `vite.config.ts` 的 `build` 配置中加入：

```ts
commonjsOptions: {
  include: [/node_modules/, /tui\.image-editor/],
},
```

目的：

- 让仓库外部的本地 `tui.image-editor` file 依赖也进入 CommonJS 转换范围；
- 确保 `tui-image-editor` 被正确打包进插件产物；
- 避免发布包运行时残留 `require("tui-image-editor")`，否则插件环境中可能找不到该依赖。

### 4.3 图片编辑器初始化调用方式

`ImageEditorDialog.vue` 通过桥接函数获取构造函数：

```ts
const ImageEditorConstructor = getImageEditor();
editorInstance = new ImageEditorConstructor(tuiEditorContainer.value, {
  // ...
});
```

这样组件不再直接依赖具体模块包装形态。

## 5. 回归测试

在 `tests/image-editor.test.ts` 中新增构造函数解析测试：

```ts
it('resolves image editor constructor from default interop shapes', () => {
  class ImageEditorMock {}

  expect(resolveImageEditorConstructor(ImageEditorMock)).toBe(ImageEditorMock)
  expect(resolveImageEditorConstructor({ default: ImageEditorMock })).toBe(ImageEditorMock)
  expect(resolveImageEditorConstructor({ default: { default: ImageEditorMock } })).toBe(ImageEditorMock)
})
```

测试目标：

- 固定桥接函数行为；
- 防止后续再次把模块命名空间对象误当构造函数；
- 覆盖常见 CommonJS/ESM default interop 包装形态。

## 6. 验证结果

已执行并确认：

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `npm test -- tests/image-editor.test.ts` | 通过，4/4 | 图片编辑器相关定向测试通过 |
| `npm run build` | 通过 | 生产构建成功，并生成 `dist/` 与 `package.zip` |
| 检查 `dist/index.js` 是否残留 `require("tui-image-editor")` | 0 处 | 图像编辑器已被内联进构建产物 |

补充说明：

- `npm test` 全量测试当前仍有 3 个失败，集中在 `tests/asset-actions.test.ts`。
- 失败原因是测试以同步方式断言当前已返回 `Promise` 的 `resolveRenameAssetName`。
- 该问题与本次图片编辑器构造函数修复无关，但建议后续单独修正测试或函数签名一致性。

## 7. 经验与注意事项

- 对本地 `file:` 依赖不能默认假设它会和普通 `node_modules` 依赖一样被 Vite/Rollup 完整转换。
- UMD/CommonJS 包在 ESM 项目中集成时，应避免直接把 `import * as` 的结果作为构造函数使用。
- 桥接第三方构造函数时，应集中处理 default interop，而不是在组件中散落 `mod.default || mod`。
- 构建验证不能只看 `npm run build` 是否成功，还应检查产物是否残留运行时不可用的外部 `require(...)`。
- 控制台同时出现多个插件报错时，应先按堆栈归属区分来源，避免把旁路噪音当作主问题。

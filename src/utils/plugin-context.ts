import type { Plugin } from "siyuan";

let plugin: Plugin | null = null;

/**
 * 插件实例的全局持有者。
 *
 * 刻意独立成模块而不是放在 src/main.ts：main.ts 会挂载 App.vue，
 * 从而牵入整套 Vue 组件与 tui-image-editor。像 logger、deduplicate 这样的
 * 工具模块只需要读取插件设置，一旦从 main 导入，就会把整个 UI 运行时
 * 拖进纯逻辑单元测试的依赖图（单测因此被迫依赖图像编辑器）。
 */
export function usePlugin(pluginProps?: Plugin): Plugin {
  if (pluginProps) {
    plugin = pluginProps;
  }
  return plugin as Plugin;
}

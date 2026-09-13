import {
  Plugin,
} from "siyuan";
import { createApp } from 'vue'
import App from './App.vue'
import { getPluginAppElementId } from './utils/plugin-entry'
let plugin = null
export function usePlugin(pluginProps?: Plugin): Plugin {
  if (pluginProps) {
    plugin = pluginProps
  }
  return plugin;
}


let app = null
export function init(plugin: Plugin) {
  // bind plugin hook
  usePlugin(plugin);

  const div = document.createElement('div')
  div.classList.add('siyuan-assets-manager-app')
  div.id = getPluginAppElementId(plugin.name)
  // 强制设置内联物理脱标与零尺寸样式，确保无论全局 CSS 何时加载，该容器在思源宿主 body (flex-column) 中永远不占用任何布局高度
  div.style.cssText = 'position: fixed !important; top: 0 !important; left: 0 !important; width: 0 !important; height: 0 !important; margin: 0 !important; padding: 0 !important; border: none !important; overflow: visible !important; pointer-events: none !important; z-index: 200 !important;'
  app = createApp(App)
  app.mount(div)
  document.body.appendChild(div)
}

export function destroy(pluginName?: string) {
  app?.unmount()
  const div = pluginName ? document.getElementById(getPluginAppElementId(pluginName)) : null
  if (div) {
    document.body.removeChild(div)
  }
}

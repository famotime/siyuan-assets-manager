import {
  Plugin,
} from "siyuan";
import { createApp } from 'vue'
import App from './App.vue'
import { getPluginAppElementId } from './utils/plugin-entry'
import { log } from './utils/logger'

let plugin = null
export function usePlugin(pluginProps?: Plugin): Plugin {
  if (pluginProps) {
    plugin = pluginProps
  }
  // 先完成绑定再记录日志，避免 log 函数内部间接调用 usePlugin() 导致循环调用以及提示 "need bind plugin" 错误
  log('usePlugin', pluginProps, plugin)
  return plugin;
}


let app = null
export function init(plugin: Plugin) {
  // bind plugin hook
  usePlugin(plugin);

  const div = document.createElement('div')
  div.classList.toggle('siyuan-assets-manager-app')
  div.id = getPluginAppElementId(plugin.name)
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

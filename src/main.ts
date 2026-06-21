import {
  Plugin,
} from "siyuan";
import { createApp } from 'vue'
import App from './App.vue'
import { getPluginAppElementId } from './utils/plugin-entry'

let plugin = null
export function usePlugin(pluginProps?: Plugin): Plugin {
  console.log('usePlugin', pluginProps, plugin)
  if (pluginProps) {
    plugin = pluginProps
  }
  if (!plugin && !pluginProps) {
    console.error('need bind plugin')
  }
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

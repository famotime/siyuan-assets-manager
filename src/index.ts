import {
  Plugin,
  getFrontend,
  IMenuBaseDetail,
  Setting,
} from "siyuan";
import "@/index.scss";
import PluginInfoString from '@/../plugin.json'
import { destroy, init, usePlugin } from '@/main'
import { getAssetNameFromElement } from '@/utils/plugin-entry'
import { log } from '@/utils/logger'

let PluginInfo = {
  version: '',
}
try {
  PluginInfo = PluginInfoString
} catch (err) {
  log('Plugin info parse error: ', err)
}
const {
  version,
} = PluginInfo

export default class AssetsManagerPlugin extends Plugin {
  // Run as mobile
  public isMobile: boolean
  // Run in browser
  public isBrowser: boolean
  // Run as local
  public isLocal: boolean
  // Run in Electron
  public isElectron: boolean
  // Run in window
  public isInWindow: boolean
  public platform: SyFrontendTypes
  public readonly version = version
  public settings = {
    promptOnDeleteOriginal: true,
    enableLogging: false
  }

  async onload() {
    usePlugin(this);
    this.addIcons(`
<symbol id="iconAssetsManager" viewBox="0 0 24 24">
  <g fill="none" stroke="currentColor" stroke-width="1.5">
    <path d="M2.384 13.793c-.447-3.164-.67-4.745.278-5.77C3.61 7 5.298 7 8.672 7h6.656c3.374 0 5.062 0 6.01 1.024c.947 1.024.724 2.605.278 5.769l-.422 3c-.35 2.48-.525 3.721-1.422 4.464c-.897.743-2.22.743-4.867.743h-5.81c-2.646 0-3.97 0-4.867-.743c-.897-.743-1.072-1.983-1.422-4.464zM19.562 7a2.132 2.132 0 0 0-2.1-2.5H6.538a2.132 2.132 0 0 0-2.1 2.5M17.5 4.5c.028-.26.043-.389.043-.496a2 2 0 0 0-1.787-1.993C15.65 2 15.52 2 15.26 2H8.74c-.26 0-.391 0-.497.011a2 2 0 0 0-1.787 1.993c0 .107.014.237.043.496"/>
    <circle cx="16.5" cy="11.5" r="1.5"/>
    <path stroke-linecap="round" d="m20 20l-2.884-2.149c-.93-.692-2.316-.761-3.34-.166l-.266.155c-.712.414-1.68.345-2.294-.164l-3.839-3.177c-.766-.634-1.995-.668-2.81-.078l-1.324.96"/>
  </g>
</symbol>
`);

    const frontEnd = getFrontend();
    this.platform = frontEnd as SyFrontendTypes
    this.isMobile = frontEnd === "mobile" || frontEnd === "browser-mobile"
    this.isBrowser = frontEnd.includes('browser')
    this.isLocal =
      location.href.includes('127.0.0.1')
      || location.href.includes('localhost')
    this.isInWindow = location.href.includes('window.html')

    try {
      require("@electron/remote")
        .require("@electron/remote/main")
      this.isElectron = true
    } catch (err) {
      this.isElectron = false
    }

    log('Plugin loaded, the plugin is ', this)

    // 加载设置项
    const loaded = await this.loadData("config.json");
    if (loaded) {
      this.settings = Object.assign({}, this.settings, loaded);
    }

    init(this)

    this.eventBus.on("open-menu-image", (event: CustomEvent<IMenuBaseDetail>) => {
      const detail = event.detail;
      const assetName = getAssetNameFromElement(detail.element);
      if (!assetName) return;

      detail.menu.addItem({
        label: "资源管家",
        icon: "iconAssetsManager",
        type: "submenu",
        submenu: [
          {
            label: "编辑",
            click: () => {
              if ((window as any)._siyuan_assets_manager_open_editor) {
                (window as any)._siyuan_assets_manager_open_editor(assetName);
              }
            }
          },
          {
            label: "重命名",
            click: () => {
              if ((window as any)._siyuan_assets_manager_open_rename) {
                (window as any)._siyuan_assets_manager_open_rename(assetName);
              }
            }
          }
        ]
      });
    });
  }

  onunload() {
    destroy(this.name)
  }

  openSetting() {
    const setting = new Setting({
      confirmCallback: () => {
        this.saveData("config.json", this.settings);
      }
    });

    setting.addItem({
      title: this.i18n.promptOnDeleteOriginalTitle || "删除原文件提示",
      description: this.i18n.promptOnDeleteOriginalDesc || "重命名和修改文件保存后，是否弹窗提示将原文件放入回收站",
      createActionElement: () => {
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "b3-switch";
        checkbox.checked = this.settings.promptOnDeleteOriginal;
        checkbox.addEventListener("change", (e) => {
          this.settings.promptOnDeleteOriginal = (e.target as HTMLInputElement).checked;
        });
        return checkbox;
      }
    });

    setting.addItem({
      title: this.i18n.enableLoggingTitle || "开启日志打印",
      description: this.i18n.enableLoggingDesc || "是否在控制台打印插件运行日志",
      createActionElement: () => {
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "b3-switch";
        checkbox.checked = this.settings.enableLogging;
        checkbox.addEventListener("change", (e) => {
          this.settings.enableLogging = (e.target as HTMLInputElement).checked;
        });
        return checkbox;
      }
    });

    setting.open(this.name);
  }
}

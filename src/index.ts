import {
  Plugin,
  getFrontend,
  IMenuBaseDetail,
} from "siyuan";
import "@/index.scss";
import PluginInfoString from '@/../plugin.json'
import { destroy, init } from '@/main'

let PluginInfo = {
  version: '',
}
try {
  PluginInfo = PluginInfoString
} catch (err) {
  console.log('Plugin info parse error: ', err)
}
const {
  version,
} = PluginInfo

export default class PluginSample extends Plugin {
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

  async onload() {
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

    console.log('Plugin loaded, the plugin is ', this)

    init(this)

    this.eventBus.on("open-menu-image", (event: CustomEvent<IMenuBaseDetail>) => {
      const detail = event.detail;
      const assetName = this.getAssetNameFromElement(detail.element);
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

  private getAssetNameFromElement(element: HTMLElement): string | null {
    if (!element) return null;
    let src = element.getAttribute("src") || element.getAttribute("data-src");
    
    if (!src) {
      const img = element.querySelector("img");
      if (img) {
        src = img.getAttribute("src") || img.getAttribute("data-src");
      }
    }
    
    if (!src) {
      src = element.closest("[data-src]")?.getAttribute("data-src") || null;
    }
    
    if (!src) return null;
    
    const match = src.match(/assets\/([^\s"'()\]\?#]+)/);
    if (match) {
      return match[1];
    }
    
    if (src.includes("assets/")) {
      const parts = src.split("assets/");
      return parts[parts.length - 1].split("?")[0].split("#")[0];
    }
    
    return null;
  }

  onunload() {
    destroy()
  }

  openSetting() {
    window._sy_plugin_sample.openSetting()
  }
}

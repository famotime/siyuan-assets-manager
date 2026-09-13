import {
  Plugin,
  getFrontend,
  IMenuBaseDetail,
  Setting,
} from "siyuan";
import "@/index.scss";
import PluginInfoString from '@/../plugin.json'
import { destroy, init, usePlugin } from '@/main'
import { getAssetNameFromElement, getBlockIdFromElement } from '@/utils/plugin-entry'
import { log } from '@/utils/logger'
import { createApp } from 'vue'
import AssetsManager from '@/components/AssetsManager.vue'

export const ASSETS_MANAGER_TAB_TYPE = "assets_manager_tab";

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

export const tabAppMap = new WeakMap<object, ReturnType<typeof createApp>>();

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
    enableLogging: false,
    openInTab: false,
  }

  async onload() {
    usePlugin(this);

    this.addTab({
      type: ASSETS_MANAGER_TAB_TYPE,
      init(this: any) {
        const custom = this;
        // 防御性移除遗留属性，确保 custom.data 永远保持纯净可 JSON 序列化
        if (custom?.data && 'tabApp' in custom.data) {
          delete custom.data.tabApp;
        }

        if (custom?.element) {
          custom.element.style.height = "100%";
          custom.element.style.width = "100%";
          custom.element.style.overflow = "hidden";
          custom.element.style.display = "flex";
          custom.element.style.flexDirection = "column";

          const tabDiv = document.createElement("div");
          tabDiv.className = "am-tab-container";
          tabDiv.style.height = "100%";
          tabDiv.style.width = "100%";
          tabDiv.style.overflow = "hidden";
          tabDiv.style.display = "flex";
          tabDiv.style.flexDirection = "column";
          custom.element.appendChild(tabDiv);

          const tabApp = createApp(AssetsManager, {
            isTabMode: true,
          });
          tabApp.mount(tabDiv);

          // 绝不能将 tabApp 存入 custom.data，因为思源会将 tab.data 进行 JSON.stringify 序列化保存工作区布局。
          // 存入 Vue 根实例会导致循环引用异常并使页签无法关闭。
          if (custom && typeof custom === 'object') {
            tabAppMap.set(custom, tabApp);
          }
          (tabDiv as any).__am_tab_app__ = tabApp;
        }
      },
      beforeDestroy(this: any) {
        if (this?.data && 'tabApp' in this.data) {
          delete this.data.tabApp;
        }
      },
      destroy(this: any) {
        if (this?.data && 'tabApp' in this.data) {
          delete this.data.tabApp;
        }
        let tabApp = (this && typeof this === 'object') ? tabAppMap.get(this) : null;
        if (!tabApp && this?.element) {
          const tabDiv = this.element.querySelector?.('.am-tab-container') || this.element.firstElementChild;
          tabApp = (tabDiv as any)?.__am_tab_app__;
        }
        if (tabApp) {
          tabApp.unmount();
          if (this && typeof this === 'object') {
            tabAppMap.delete(this);
          }
        }
      },
    });

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
      if (!detail) return;

      const assetName = getAssetNameFromElement(detail.element);
      if (!assetName) {
        log("[open-menu-image] 忽略无有效资源的图片元素", detail.element);
        return;
      }

      let blockId = getBlockIdFromElement(detail.element);
      if (!blockId && (detail as any).data?.id) {
        blockId = (detail as any).data.id;
      }
      if (!blockId && (detail as any).nodeElement) {
        blockId = getBlockIdFromElement((detail as any).nodeElement);
      }

      const menu = detail.menu || (window as any).siyuan?.menus?.menu;
      if (!menu) return;

      // 同步判断 DOM 属性是否存在二次编辑标记
      const blockEl = detail.element?.closest('[data-node-id]') || ((detail as any).nodeElement ? (detail as any).nodeElement.closest('[data-node-id]') : null);
      const hasReEditAttr = Boolean(
        blockEl?.getAttribute('custom-asset-reedit') ||
        blockEl?.getAttribute('data-custom-asset-reedit')
      );

      menu.addItem({
        label: "资源管家",
        icon: "iconAssetsManager",
        type: "submenu",
        submenu: [
          {
            label: hasReEditAttr ? "编辑标注（已含历史标注）" : "编辑标注",
            click: () => {
              if ((window as any)._siyuan_assets_manager_open_editor) {
                (window as any)._siyuan_assets_manager_open_editor(assetName, blockId || undefined);
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
      width: "680px",
    });

    const createSettingCardOption = (options: {
      checked: boolean;
      description: string;
      onChange: (checked: boolean) => void;
    }): HTMLElement => {
      const card = document.createElement("label");
      card.className = `am-setting-card${options.checked ? " is-checked" : ""}`;

      const desc = document.createElement("span");
      desc.className = "am-setting-card__desc";
      desc.textContent = options.description;

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "b3-switch fn__flex-center";
      checkbox.checked = options.checked;

      checkbox.addEventListener("change", (e) => {
        const isChecked = (e.target as HTMLInputElement).checked;
        card.classList.toggle("is-checked", isChecked);
        options.onChange(isChecked);
      });

      card.append(desc, checkbox);
      return card;
    };

    setting.addItem({
      title: this.i18n.openInTabTitle || "页签中打开资源管家",
      description: "",
      direction: "row",
      createActionElement: () => {
        return createSettingCardOption({
          checked: this.settings.openInTab,
          description: this.i18n.openInTabDesc || "开启时，将资源管理窗口在页签打开，而不是弹窗打开",
          onChange: (checked) => {
            this.settings.openInTab = checked;
            this.saveData("config.json", this.settings);
          },
        });
      },
    });

    setting.addItem({
      title: this.i18n.promptOnDeleteOriginalTitle || "删除原文件提示",
      description: "",
      direction: "row",
      createActionElement: () => {
        return createSettingCardOption({
          checked: this.settings.promptOnDeleteOriginal,
          description: this.i18n.promptOnDeleteOriginalDesc || "重命名和修改文件保存后，是否弹窗提示将原文件放入回收站",
          onChange: (checked) => {
            this.settings.promptOnDeleteOriginal = checked;
            this.saveData("config.json", this.settings);
          },
        });
      },
    });

    setting.addItem({
      title: this.i18n.enableLoggingTitle || "开启日志打印",
      description: "",
      direction: "row",
      createActionElement: () => {
        return createSettingCardOption({
          checked: this.settings.enableLogging,
          description: this.i18n.enableLoggingDesc || "是否在控制台打印插件运行日志",
          onChange: (checked) => {
            this.settings.enableLogging = checked;
            this.saveData("config.json", this.settings);
          },
        });
      },
    });

    setting.open(this.name);
  }
}

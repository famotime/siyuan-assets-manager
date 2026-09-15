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

export const ALL_IMAGE_EDITOR_TOOLS = [
  {
    key: 'resize',
    label: '调整大小',
    icon: `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" d="M15 3h6v6 M9 21H3v-6 M21 3l-7 7 M3 21l7-7"/></svg>`,
  },
  {
    key: 'crop',
    label: '裁剪',
    icon: `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" d="M6 2v14a2 2 0 0 0 2 2h14 M2 6h14a2 2 0 0 1 2 2v14"/></svg>`,
  },
  {
    key: 'flip',
    label: '翻转',
    icon: `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" stroke="none" d="M11 0h1v24h-1zM19 21v-1h2v-2h1v2a1 1 0 0 1-1 1h-2zm-2 0h-3v-1h3v1zm5-5h-1v-3h1v3zm0-5h-1V8h1v3zm0-5h-1V4h-2V3h2a1 1 0 0 1 1 1v2zm-5-3v1h-3V3h3zM9 3v1H2v16h7v1H2a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h7z"/></svg>`,
  },
  {
    key: 'rotate',
    label: '旋转',
    icon: `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="none" d="M0 0h24v24H0z"/><path fill="currentColor" stroke="none" d="M8.349 22.254a10.002 10.002 0 0 1-2.778-1.719l.65-.76a9.002 9.002 0 0 0 2.495 1.548l-.367.931zm2.873.704l.078-.997a9 9 0 1 0-.557-17.852l-.14-.99A10.076 10.076 0 0 1 12.145 3c5.523 0 10 4.477 10 10s-4.477 10-10 10c-.312 0-.62-.014-.924-.042zm-7.556-4.655a9.942 9.942 0 0 1-1.253-2.996l.973-.234a8.948 8.948 0 0 0 1.124 2.693l-.844.537zm-1.502-5.91A9.949 9.949 0 0 1 2.88 9.23l.925.382a8.954 8.954 0 0 0-.644 2.844l-.998-.062zm2.21-5.686c.687-.848 1.51-1.58 2.436-2.166l.523.852a9.048 9.048 0 0 0-2.188 1.95l-.771-.636z"/><path stroke="currentColor" fill="none" stroke-linecap="square" d="M13 1l-2.5 2.5L13 6"/></svg>`,
  },
  {
    key: 'draw',
    label: '自由绘制',
    icon: `<svg viewBox="0 0 32 32" width="16" height="16"><path fill="currentColor" stroke="none" d="M29.502 3.415a3.559 3.559 0 0 0-4.974-.09L11.043 16.032l-.014-.002l-2.129 2.1a1.997 1.997 0 0 0-.389.538a3.976 3.976 0 0 0-2.365.683A4.909 4.909 0 0 0 3.7 23.559a2.668 2.668 0 0 1-.7 1.925l-.789.739l-.059.324a1.473 1.473 0 0 0 1.023 1.677l2.579.783l.5.1a7.015 7.015 0 0 0 6.647-2.412c.574-.684.9-1.539.93-2.426c.25-.095.486-.244.69-.444l.798-.788l.015.03L29.527 8.39a3.559 3.559 0 0 0-.025-4.974m-14.608 17.23l-2.81-2.846L25.9 4.78a1.559 1.559 0 0 1 2.19 2.218zm-8.28 6.496l-.33-.061L4.7 26.6a4.91 4.91 0 0 0 .988-2.813a2.985 2.985 0 0 1 1.546-2.758a2 2 0 0 1 2.559.232l1.454 1.459a2 2 0 0 1 .117 2.694a5.016 5.016 0 0 1-4.75 1.727"/></svg>`,
  },
  {
    key: 'eraser',
    label: '橡皮擦',
    icon: `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" d="M20 20H7L3 16c-1-1-1-2.5 0-3.5L13.5 2c1-1 2.5-1 3.5 0l4 4c1 1 1 2.5 0 3.5L11 19.5z M16 5.5L7.5 14 M2 20h20"/></svg>`,
  },
  {
    key: 'lasso',
    label: '套索',
    icon: `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M9.703 2.265A10.026 10.026 0 0 1 12 2c.79 0 1.559.092 2.297.265a.75.75 0 1 1-.343 1.46A8.527 8.527 0 0 0 12 3.5c-.673 0-1.327.078-1.954.225a.75.75 0 1 1-.343-1.46z" fill="currentColor" stroke="none"/><path d="M7.773 3.736a.75.75 0 0 1-.242 1.032 8.548 8.548 0 0 0-2.763 2.763.75.75 0 1 1-1.275-.79 10.048 10.048 0 0 1 3.248-3.248.75.75 0 0 1 1.032.243z" fill="currentColor" stroke="none"/><path d="M16.227 3.736a.75.75 0 0 1 1.032-.243 10.048 10.048 0 0 1 3.248 3.248.75.75 0 1 1-1.275.79 8.55 8.55 0 0 0-2.763-2.763.75.75 0 0 1-.242-1.032z" fill="currentColor" stroke="none"/><path d="M3.167 9.144a.75.75 0 0 1 .558.902A8.527 8.527 0 0 0 3.5 12c0 .673.078 1.327.225 1.954a.75.75 0 1 1-1.46.343A10.026 10.026 0 0 1 2 12c0-.79.092-1.559.265-2.297a.75.75 0 0 1 .902-.559z" fill="currentColor" stroke="none"/><path d="M20.833 9.144a.75.75 0 0 1 .902.559C21.908 10.44 22 11.21 22 12c0 .79-.092 1.559-.265 2.297a.75.75 0 1 1-1.46-.343c.147-.627.225-1.28.225-1.954 0-.673-.078-1.327-.226-1.954a.75.75 0 0 1 .559-.902z" fill="currentColor" stroke="none"/><path d="M3.736 16.227a.75.75 0 0 1 1.032.242 8.548 8.548 0 0 0 2.763 2.763.75.75 0 0 1-.79 1.275 10.048 10.048 0 0 1-3.248-3.248.75.75 0 0 1 .243-1.032z" fill="currentColor" stroke="none"/><path d="M20.42 17.085a.75.75 0 1 0-1.34-.67l-.003.004-.015.029a8.004 8.004 0 0 1-.358.59 9.58 9.58 0 0 1-.965 1.218c-1.17-1.073-2.756-2.006-4.74-2.006-2.347 0-3.99 1.203-3.99 2.875S10.653 22 13 22c1.942 0 3.495-.75 4.658-1.645a11.73 11.73 0 0 1 1.315 2.01c.033.065.058.116.073.149l.017.035.004.009a.75.75 0 0 0 1.368-.615c-.087-.183 0-.001 0-.001v-.002l-.003-.004-.007-.015a11.874 11.874 0 0 0-.464-.87 13.199 13.199 0 0 0-1.189-1.703 11.057 11.057 0 0 0 1.525-2.032l.09-.162.024-.047.007-.014.002-.005.002-.003zM13 17.75c1.433 0 2.644.652 3.616 1.512-.95.7-2.155 1.238-3.616 1.238-1.973 0-2.49-.922-2.49-1.375 0-.453.517-1.375 2.49-1.375z" fill="currentColor" stroke="none"/></svg>`,
  },
  {
    key: 'shape',
    label: '形状',
    icon: `<svg viewBox="0 0 24 24" width="16" height="16"><path stroke="none" fill="currentColor" d="M14.706 8H21a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-4h1v4h12V9h-5.706l-.588-1z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" d="M8.5 1.5l7.5 13H1z"/></svg>`,
  },
  {
    key: 'icon',
    label: '图标',
    icon: `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" d="M11.923 19.136L5.424 22l.715-7.065-4.731-5.296 6.94-1.503L11.923 2l3.574 6.136 6.94 1.503-4.731 5.296L18.42 22z"/></svg>`,
  },
  {
    key: 'text',
    label: '文字',
    icon: `<svg viewBox="0 0 24 24" width="16" height="16"><path stroke="none" fill="currentColor" d="M4 3h15a1 1 0 0 1 1 1H3a1 1 0 0 1 1-1zM3 4h1v1H3zM19 4h1v1h-1z"/><path stroke="none" fill="currentColor" d="M11 3h1v18h-1z"/><path stroke="none" fill="currentColor" d="M10 20h3v1h-3z"/></svg>`,
  },
  {
    key: 'mask',
    label: '蒙版',
    icon: `<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="4.5" stroke="currentColor" fill="none"/><path stroke="none" fill="currentColor" d="M2 1h20a1 1 0 0 1 1 1v20a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zm0 1v20h20V2H2z"/></svg>`,
  },
  {
    key: 'filter',
    label: '滤镜',
    icon: `<svg viewBox="0 0 24 24" width="16" height="16"><path stroke="none" fill="currentColor" d="M12 7v1H2V7h10zm6 0h4v1h-4V7zM12 16v1h10v-1H12zm-6 0H2v1h4v-1z"/><path stroke="none" fill="currentColor" d="M8.5 20a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7zm0-1a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM15.5 11a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7zm0-1a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"/></svg>`,
  },
  {
    key: 'mosaic',
    label: '马赛克',
    icon: `<svg viewBox="0 0 24 24" width="16" height="16"><path stroke="none" fill="currentColor" d="M3 3h5v5H3zm7 0h5v5h-5zm7 0h5v5h-5zM3 10h5v5H3zm7 0h5v5h-5zm7 0h5v5h-5zM3 17h5v5H3zm7 0h5v5h-5zm7 0h5v5h-5z"/></svg>`,
  },
  {
    key: 'annotation',
    label: '标注',
    icon: `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M10 4.5H21 M10 9.5H21 M10 14.5H21 M10 19.5H21"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M3 14.5H6V16L3 19V19.5H6"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M3.5 5.5L4.5 4.5V9.5 M4.5 9.5H3.5 M4.5 9.5H5.5"/></svg>`,
  },
];

export const DEFAULT_IMAGE_EDITOR_TOOLS = [
  'resize',
  'crop',
  'flip',
  'rotate',
  'draw',
  'eraser',
  'lasso',
  'shape',
  'icon',
  'text',
  'mosaic',
  'annotation',
];

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
  public settings: {
    promptOnDeleteOriginal: boolean;
    enableLogging: boolean;
    openInTab: boolean;
    imageEditorTools: string[];
  } = {
    promptOnDeleteOriginal: true,
    enableLogging: false,
    openInTab: true,
    imageEditorTools: [...DEFAULT_IMAGE_EDITOR_TOOLS],
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
      if (!Array.isArray(this.settings.imageEditorTools)) {
        this.settings.imageEditorTools = [...DEFAULT_IMAGE_EDITOR_TOOLS];
      }
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

  onDataChanged() {
    log('[AssetsManager] Data changed event received');
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

    setting.addItem({
      title: this.i18n.imageEditorToolsTitle || "图片编辑器工具栏",
      description: this.i18n.imageEditorToolsDesc || "控制在图片编辑器中显示的工具（默认不启用蒙版与滤镜）",
      direction: "column",
      createActionElement: () => {
        const container = document.createElement("div");
        container.className = "am-setting-tools-container";

        const grid = document.createElement("div");
        grid.className = "am-setting-tools-grid";

        const currentTools = new Set(this.settings.imageEditorTools || DEFAULT_IMAGE_EDITOR_TOOLS);

        ALL_IMAGE_EDITOR_TOOLS.forEach((tool) => {
          const chip = document.createElement("label");
          const isChecked = currentTools.has(tool.key);
          chip.className = `am-setting-tool-chip${isChecked ? " is-checked" : ""}`;

          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.checked = isChecked;

          const iconSpan = document.createElement("span");
          iconSpan.className = "am-setting-tool-icon";
          iconSpan.innerHTML = tool.icon;

          const labelSpan = document.createElement("span");
          labelSpan.textContent = tool.label;

          checkbox.addEventListener("change", (e) => {
            const checked = (e.target as HTMLInputElement).checked;
            chip.classList.toggle("is-checked", checked);
            if (checked) {
              currentTools.add(tool.key);
            } else {
              currentTools.delete(tool.key);
            }
            this.settings.imageEditorTools = ALL_IMAGE_EDITOR_TOOLS
              .map((t) => t.key)
              .filter((k) => currentTools.has(k));
            this.saveData("config.json", this.settings);
          });

          chip.append(checkbox, iconSpan, labelSpan);
          grid.appendChild(chip);
        });

        container.appendChild(grid);
        return container;
      },
    });

    setting.open(this.name);
  }
}

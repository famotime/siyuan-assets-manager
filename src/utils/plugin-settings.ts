import { Setting } from 'siyuan';
import { ALL_IMAGE_EDITOR_TOOLS, DEFAULT_IMAGE_EDITOR_TOOLS } from './editor-tools';
import { DEFAULT_HASH_CONCURRENCY, DEFAULT_DECODE_CONCURRENCY } from './deduplicate';

export interface PluginSettingsData {
  promptOnDeleteOriginal: boolean;
  enableLogging: boolean;
  openInTab: boolean;
  imageEditorTools: string[];
  deletionHistoryLimit: number;
  dedupHashConcurrency: number;
  dedupDecodeConcurrency: number;
}

export interface SettingsHostPlugin {
  name: string;
  i18n: Record<string, string>;
  settings: PluginSettingsData;
  saveData(file: string, data: any): Promise<any>;
}

/**
 * 创建通用开关卡片选项元素
 */
export function createSettingCardOption(options: {
  checked: boolean;
  description: string;
  onChange: (checked: boolean) => void;
}): HTMLElement {
  const card = document.createElement('label');
  card.className = `am-setting-card${options.checked ? ' is-checked' : ''}`;

  const desc = document.createElement('span');
  desc.className = 'am-setting-card__desc';
  desc.textContent = options.description;

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'b3-switch fn__flex-center';
  checkbox.checked = options.checked;

  checkbox.addEventListener('change', (e) => {
    const isChecked = (e.target as HTMLInputElement).checked;
    card.classList.toggle('is-checked', isChecked);
    options.onChange(isChecked);
  });

  card.append(desc, checkbox);
  return card;
}

/**
 * 组装思源原生设置面板各项卡片与输入控件
 */
export function buildPluginSettings(plugin: SettingsHostPlugin): Setting {
  const setting = new Setting({
    width: '680px',
  });

  // 1. 页签中打开资源管家
  setting.addItem({
    title: plugin.i18n.openInTabTitle || '页签中打开资源管家',
    description: '',
    direction: 'row',
    createActionElement: () => {
      return createSettingCardOption({
        checked: plugin.settings.openInTab,
        description: plugin.i18n.openInTabDesc || '开启时，将资源管理窗口在页签打开，而不是弹窗打开',
        onChange: (checked) => {
          plugin.settings.openInTab = checked;
          plugin.saveData('config.json', plugin.settings);
        },
      });
    },
  });

  // 2. 删除原文件提示
  setting.addItem({
    title: plugin.i18n.promptOnDeleteOriginalTitle || '删除原文件提示',
    description: '',
    direction: 'row',
    createActionElement: () => {
      return createSettingCardOption({
        checked: plugin.settings.promptOnDeleteOriginal,
        description: plugin.i18n.promptOnDeleteOriginalDesc || '重命名和修改文件保存后，是否弹窗提示将原文件放入回收站',
        onChange: (checked) => {
          plugin.settings.promptOnDeleteOriginal = checked;
          plugin.saveData('config.json', plugin.settings);
        },
      });
    },
  });

  // 3. 开启日志打印
  setting.addItem({
    title: plugin.i18n.enableLoggingTitle || '开启日志打印',
    description: '',
    direction: 'row',
    createActionElement: () => {
      return createSettingCardOption({
        checked: plugin.settings.enableLogging,
        description: plugin.i18n.enableLoggingDesc || '是否在控制台打印插件运行日志',
        onChange: (checked) => {
          plugin.settings.enableLogging = checked;
          plugin.saveData('config.json', plugin.settings);
        },
      });
    },
  });

  // 4. 删除历史保留上限
  setting.addItem({
    title: plugin.i18n.deletionHistoryLimitTitle || '删除历史保留上限',
    description: plugin.i18n.deletionHistoryLimitDesc || '保留最近执行的删除操作批次数（范围 0~100，默认 10，设为 0 则不记录日志）',
    direction: 'row',
    createActionElement: () => {
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.max = '100';
      input.className = 'b3-text-field fn__flex-center';
      input.style.width = '72px';
      input.value = (plugin.settings.deletionHistoryLimit ?? 10).toString();

      input.addEventListener('change', (e) => {
        let val = parseInt((e.target as HTMLInputElement).value, 10);
        if (isNaN(val) || val < 0) val = 0;
        if (val > 100) val = 100;
        input.value = val.toString();
        plugin.settings.deletionHistoryLimit = val;
        plugin.saveData('config.json', plugin.settings);
      });

      return input;
    },
  });

  // 5. 图片编辑器工具栏配置
  setting.addItem({
    title: plugin.i18n.imageEditorToolsTitle || '图片编辑器工具栏',
    description: plugin.i18n.imageEditorToolsDesc || '控制在图片编辑器中显示的工具（默认不启用蒙版与滤镜）',
    direction: 'column',
    createActionElement: () => {
      const container = document.createElement('div');
      container.className = 'am-setting-tools-container';

      const grid = document.createElement('div');
      grid.className = 'am-setting-tools-grid';

      const currentTools = new Set(plugin.settings.imageEditorTools || DEFAULT_IMAGE_EDITOR_TOOLS);

      ALL_IMAGE_EDITOR_TOOLS.forEach((tool) => {
        const chip = document.createElement('label');
        const isChecked = currentTools.has(tool.key);
        chip.className = `am-setting-tool-chip${isChecked ? ' is-checked' : ''}`;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = isChecked;

        const iconSpan = document.createElement('span');
        iconSpan.className = 'am-setting-tool-icon';
        iconSpan.innerHTML = tool.icon;

        const labelSpan = document.createElement('span');
        labelSpan.textContent = tool.label;

        checkbox.addEventListener('change', (e) => {
          const checked = (e.target as HTMLInputElement).checked;
          chip.classList.toggle('is-checked', checked);
          if (checked) {
            currentTools.add(tool.key);
          } else {
            currentTools.delete(tool.key);
          }
          plugin.settings.imageEditorTools = ALL_IMAGE_EDITOR_TOOLS
            .map((t) => t.key)
            .filter((k) => currentTools.has(k));
          plugin.saveData('config.json', plugin.settings);
        });

        chip.append(checkbox, iconSpan, labelSpan);
        grid.appendChild(chip);
      });

      container.appendChild(grid);
      return container;
    },
  });

  // 6. 去重扫描：哈希并发度
  setting.addItem({
    title: plugin.i18n.dedupHashConcurrencyTitle || '去重扫描：哈希并发度',
    description: plugin.i18n.dedupHashConcurrencyDesc || '精确哈希阶段的并行文件数（范围 1~16，默认 8）',
    direction: 'row',
    createActionElement: () => {
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '1';
      input.max = '16';
      input.className = 'b3-text-field fn__flex-center';
      input.style.width = '72px';
      input.value = (plugin.settings.dedupHashConcurrency ?? DEFAULT_HASH_CONCURRENCY).toString();

      input.addEventListener('change', (e) => {
        let val = parseInt((e.target as HTMLInputElement).value, 10);
        if (isNaN(val) || val < 1) val = 1;
        if (val > 16) val = 16;
        input.value = val.toString();
        plugin.settings.dedupHashConcurrency = val;
        plugin.saveData('config.json', plugin.settings);
      });

      return input;
    },
  });

  // 7. 去重扫描：解码并发度
  setting.addItem({
    title: plugin.i18n.dedupDecodeConcurrencyTitle || '去重扫描：解码并发度',
    description: plugin.i18n.dedupDecodeConcurrencyDesc || '图片感知哈希阶段的并行解码数（范围 1~8，默认 3）',
    direction: 'row',
    createActionElement: () => {
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '1';
      input.max = '8';
      input.className = 'b3-text-field fn__flex-center';
      input.style.width = '72px';
      input.value = (plugin.settings.dedupDecodeConcurrency ?? DEFAULT_DECODE_CONCURRENCY).toString();

      input.addEventListener('change', (e) => {
        let val = parseInt((e.target as HTMLInputElement).value, 10);
        if (isNaN(val) || val < 1) val = 1;
        if (val > 8) val = 8;
        input.value = val.toString();
        plugin.settings.dedupDecodeConcurrency = val;
        plugin.saveData('config.json', plugin.settings);
      });

      return input;
    },
  });

  return setting;
}

/**
 * 打开插件设置对话框并根据插件名称激活
 */
export function openPluginSettingsDialog(plugin: SettingsHostPlugin): Setting {
  const setting = buildPluginSettings(plugin);
  setting.open(plugin.name);
  return setting;
}

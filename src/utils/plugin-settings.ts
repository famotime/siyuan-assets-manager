import { Setting } from 'siyuan';
import { t } from '@/i18n';
import { ALL_IMAGE_EDITOR_TOOLS, DEFAULT_IMAGE_EDITOR_TOOLS, getEditorToolLabel } from './editor-tools';
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
    title: t('settings.openInTabTitle'),
    description: '',
    direction: 'row',
    createActionElement: () => {
      return createSettingCardOption({
        checked: plugin.settings.openInTab,
        description: t('settings.openInTabDesc'),
        onChange: (checked) => {
          plugin.settings.openInTab = checked;
          plugin.saveData('config.json', plugin.settings);
        },
      });
    },
  });

  // 2. 删除原文件提示
  setting.addItem({
    title: t('settings.promptOnDeleteOriginalTitle'),
    description: '',
    direction: 'row',
    createActionElement: () => {
      return createSettingCardOption({
        checked: plugin.settings.promptOnDeleteOriginal,
        description: t('settings.promptOnDeleteOriginalDesc'),
        onChange: (checked) => {
          plugin.settings.promptOnDeleteOriginal = checked;
          plugin.saveData('config.json', plugin.settings);
        },
      });
    },
  });

  // 3. 开启日志打印
  setting.addItem({
    title: t('settings.enableLoggingTitle'),
    description: '',
    direction: 'row',
    createActionElement: () => {
      return createSettingCardOption({
        checked: plugin.settings.enableLogging,
        description: t('settings.enableLoggingDesc'),
        onChange: (checked) => {
          plugin.settings.enableLogging = checked;
          plugin.saveData('config.json', plugin.settings);
        },
      });
    },
  });

  // 4. 删除历史保留上限
  setting.addItem({
    title: t('settings.deletionHistoryLimitTitle'),
    description: t('settings.deletionHistoryLimitDesc'),
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
    title: t('settings.imageEditorToolsTitle'),
    description: t('settings.imageEditorToolsDesc'),
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
        labelSpan.textContent = getEditorToolLabel(tool.key);

        checkbox.addEventListener('change', (e) => {
          const checked = (e.target as HTMLInputElement).checked;
          chip.classList.toggle('is-checked', checked);
          if (checked) {
            currentTools.add(tool.key);
          } else {
            currentTools.delete(tool.key);
          }
          plugin.settings.imageEditorTools = ALL_IMAGE_EDITOR_TOOLS
            .map((tool) => tool.key)
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
    title: t('settings.dedupHashConcurrencyTitle'),
    description: t('settings.dedupHashConcurrencyDesc'),
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
    title: t('settings.dedupDecodeConcurrencyTitle'),
    description: t('settings.dedupDecodeConcurrencyDesc'),
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

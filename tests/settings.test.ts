import { describe, expect, it, vi } from 'vitest';
import * as siyuan from 'siyuan';
import AssetsManagerPlugin, { DEFAULT_IMAGE_EDITOR_TOOLS, ALL_IMAGE_EDITOR_TOOLS, tabAppMap } from '../src/index';

describe('setting auto save behavior and layout', () => {
  it('instantiates Setting with 680px width, renders interactive cards, and auto-saves on change', () => {
    let settingOptions: any;
    const addedItems: any[] = [];

    const mockSettingInstance = {
      addItem: vi.fn((item) => {
        addedItems.push(item);
      }),
      open: vi.fn(),
    };

    const settingSpy = vi.spyOn(siyuan, 'Setting').mockImplementation(function (this: any, opts: any) {
      settingOptions = opts;
      Object.assign(this, mockSettingInstance);
      return mockSettingInstance as any;
    });

    const plugin = new AssetsManagerPlugin();
    plugin.saveData = vi.fn().mockResolvedValue(undefined);

    // 验证 openInTab 默认开启，默认图片编辑器工具不包含 mask 和 filter
    expect(plugin.settings.openInTab).toBe(true);
    expect(plugin.settings.imageEditorTools).toEqual(DEFAULT_IMAGE_EDITOR_TOOLS);
    expect(plugin.settings.imageEditorTools.includes('mask')).toBe(false);
    expect(plugin.settings.imageEditorTools.includes('filter')).toBe(false);

    plugin.openSetting();

    // 验证宽屏 680px 设置，且未传递 confirmCallback
    expect(settingSpy).toHaveBeenCalled();
    expect(settingOptions).toBeDefined();
    expect(settingOptions.width).toBe('680px');
    expect(settingOptions.confirmCallback).toBeUndefined();

    // 验证 5 个设置项：页签打开、删除提示、开启日志、删除历史保留上限、图片编辑器工具栏
    expect(addedItems.length).toBe(5);

    // 前 3 项为开关卡片
    for (let i = 0; i < 3; i++) {
      const item = addedItems[i];
      expect(item.direction).toBe('row');

      const card = item.createActionElement() as HTMLElement;
      expect(card.classList.contains('am-setting-card')).toBe(true);

      const checkbox = card.querySelector<HTMLInputElement>('input.b3-switch');
      expect(checkbox).not.toBeNull();
      expect(checkbox!.type).toBe('checkbox');

      // 模拟点击切换开关
      const wasChecked = checkbox!.checked;
      checkbox!.checked = !wasChecked;
      checkbox!.dispatchEvent(new Event('change'));

      // 验证选中态样式类联动
      expect(card.classList.contains('is-checked')).toBe(!wasChecked);
    }

    // 第 4 项为删除历史保留上限输入框 (0~100)
    const limitItem = addedItems[3];
    expect(limitItem.direction).toBe('row');
    const limitInput = limitItem.createActionElement() as HTMLInputElement;
    expect(limitInput.tagName.toLowerCase()).toBe('input');
    expect(limitInput.type).toBe('number');
    expect(limitInput.value).toBe('10');

    // 模拟输入新的有效上限
    limitInput.value = '25';
    limitInput.dispatchEvent(new Event('change'));
    expect(plugin.settings.deletionHistoryLimit).toBe(25);

    // 第 5 项为图片编辑器工具栏配置
    const toolsItem = addedItems[4];
    expect(toolsItem.direction).toBe('column');
    const toolsContainer = toolsItem.createActionElement() as HTMLElement;
    expect(toolsContainer.classList.contains('am-setting-tools-container')).toBe(true);

    const toolChips = toolsContainer.querySelectorAll('.am-setting-tool-chip');
    expect(toolChips.length).toBe(ALL_IMAGE_EDITOR_TOOLS.length);

    // 验证 mask 和 filter 对应的 chip 默认没有 is-checked
    const maskChip = Array.from(toolChips).find(c => c.textContent?.includes('蒙版'));
    expect(maskChip).toBeDefined();
    expect(maskChip!.classList.contains('is-checked')).toBe(false);

    // 模拟勾选 mask
    const maskCheckbox = maskChip!.querySelector('input')!;
    maskCheckbox.checked = true;
    maskCheckbox.dispatchEvent(new Event('change'));
    expect(maskChip!.classList.contains('is-checked')).toBe(true);
    expect(plugin.settings.imageEditorTools.includes('mask')).toBe(true);

    expect(plugin.saveData).toHaveBeenCalledTimes(5);
    expect(plugin.saveData).toHaveBeenLastCalledWith("config.json", plugin.settings);
    expect(plugin.settings.openInTab).toBe(false);
  });

  it('registers custom tab in onload and handles init / destroy correctly without contaminating custom.data', async () => {
    let tabOptions: any;
    const plugin = new AssetsManagerPlugin();
    plugin.addTab = vi.fn((opts) => {
      tabOptions = opts;
      return () => ({} as any);
    });
    plugin.addTopBar = vi.fn();
    plugin.loadData = vi.fn().mockResolvedValue(null);

    await plugin.onload();

    expect(plugin.addTab).toHaveBeenCalled();
    expect(tabOptions.type).toBe('assets_manager_tab');
    expect(typeof tabOptions.init).toBe('function');
    expect(typeof tabOptions.destroy).toBe('function');
    expect(typeof tabOptions.beforeDestroy).toBe('function');

    const dummyElement = document.createElement('div');
    const dummyCustom = {
      element: dummyElement,
      data: {
        tabApp: { fake: 'legacy-circular-object' },
      } as any,
    };
    tabOptions.init.call(dummyCustom);

    // 核心验证：custom.data 绝不能包含 tabApp，且必须可以被安全地 JSON.stringify
    expect(dummyCustom.data.tabApp).toBeUndefined();
    expect(() => JSON.stringify(dummyCustom.data)).not.toThrow();

    // 验证挂载成功并被记录在 tabAppMap 中
    const app = tabAppMap.get(dummyCustom);
    expect(app).toBeDefined();

    // 验证 DOM 挂载
    const containerDiv = dummyElement.querySelector('.am-tab-container');
    expect(containerDiv).not.toBeNull();

    // 验证 beforeDestroy 会防御性清理
    dummyCustom.data.tabApp = { fake: 're-injected' };
    tabOptions.beforeDestroy.call(dummyCustom);
    expect(dummyCustom.data.tabApp).toBeUndefined();

    // 验证 destroy 正确卸载
    tabOptions.destroy.call(dummyCustom);
    expect(tabAppMap.get(dummyCustom)).toBeUndefined();
  });

  it('toggles dialog when openInTab is false, and calls openTab when openInTab is true', async () => {
    const plugin = new AssetsManagerPlugin();
    plugin.addTab = vi.fn(() => ({} as any));
    plugin.addTopBar = vi.fn();
    plugin.loadData = vi.fn().mockResolvedValue(null);

    const openTabSpy = vi.spyOn(siyuan, 'openTab').mockResolvedValue({} as any);

    await plugin.onload();

    // 此时 openInTab 默认为 true
    expect(plugin.settings.openInTab).toBe(true);
    (window as any)._siyuan_assets_manager_toggle();
    expect(openTabSpy).toHaveBeenCalledTimes(1);
    expect(openTabSpy).toHaveBeenCalledWith(expect.objectContaining({
      custom: expect.objectContaining({
        id: plugin.name + 'assets_manager_tab'
      })
    }));

    // 关闭 openInTab 后，触发 toggle 将开启弹窗而不是页签
    openTabSpy.mockClear();
    plugin.settings.openInTab = false;
    (window as any)._siyuan_assets_manager_toggle();
    expect(openTabSpy).not.toHaveBeenCalled();
  });
});

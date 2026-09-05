import { describe, expect, it, vi } from 'vitest';
import * as siyuan from 'siyuan';
import AssetsManagerPlugin from '../src/index';

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

    // 验证 openInTab 默认关闭
    expect(plugin.settings.openInTab).toBe(false);

    plugin.openSetting();

    // 验证宽屏 680px 设置，且未传递 confirmCallback
    expect(settingSpy).toHaveBeenCalled();
    expect(settingOptions).toBeDefined();
    expect(settingOptions.width).toBe('680px');
    expect(settingOptions.confirmCallback).toBeUndefined();

    // 验证 3 个设置项：页签打开、删除提示、开启日志
    expect(addedItems.length).toBe(3);

    for (const item of addedItems) {
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

    expect(plugin.saveData).toHaveBeenCalledTimes(3);
    expect(plugin.saveData).toHaveBeenLastCalledWith("config.json", plugin.settings);
    expect(plugin.settings.openInTab).toBe(true);
  });

  it('registers custom tab in onload and handles init / destroy correctly', async () => {
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

    const dummyElement = document.createElement('div');
    const dummyCustom = {
      element: dummyElement,
      data: {} as any,
    };
    tabOptions.init.call(dummyCustom);
    expect(dummyCustom.data.tabApp).toBeDefined();

    tabOptions.destroy.call(dummyCustom);
  });

  it('toggles dialog when openInTab is false, and calls openTab when openInTab is true', async () => {
    const plugin = new AssetsManagerPlugin();
    plugin.addTab = vi.fn(() => ({} as any));
    plugin.addTopBar = vi.fn();
    plugin.loadData = vi.fn().mockResolvedValue(null);

    const openTabSpy = vi.spyOn(siyuan, 'openTab').mockResolvedValue({} as any);

    await plugin.onload();

    // 此时 openInTab 默认为 false
    expect(plugin.settings.openInTab).toBe(false);
    (window as any)._siyuan_assets_manager_toggle();
    expect(openTabSpy).not.toHaveBeenCalled();

    // 开启 openInTab
    plugin.settings.openInTab = true;
    (window as any)._siyuan_assets_manager_toggle();
    expect(openTabSpy).toHaveBeenCalledTimes(1);
    expect(openTabSpy).toHaveBeenCalledWith(expect.objectContaining({
      custom: expect.objectContaining({
        id: plugin.name + 'assets_manager_tab'
      })
    }));
  });
});

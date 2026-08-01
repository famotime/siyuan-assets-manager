import { describe, expect, it, vi } from 'vitest';
import * as siyuan from 'siyuan';
import AssetsManagerPlugin from '../src/index';

describe('setting auto save behavior', () => {
  it('instantiates Setting without confirmCallback and auto-saves on change', () => {
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

    plugin.openSetting();

    // Verify confirmCallback is not passed to Setting
    expect(settingSpy).toHaveBeenCalled();
    expect(settingOptions).toBeDefined();
    expect(settingOptions.confirmCallback).toBeUndefined();

    // Verify change handlers call saveData automatically
    expect(addedItems.length).toBe(2);

    for (const item of addedItems) {
      const element = item.createActionElement();
      element.checked = !element.checked;
      element.dispatchEvent(new Event('change'));
    }

    expect(plugin.saveData).toHaveBeenCalledTimes(2);
    expect(plugin.saveData).toHaveBeenLastCalledWith("config.json", plugin.settings);
  });
});

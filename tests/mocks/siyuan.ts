export class Plugin {
  name = 'siyuan-assets-manager';
  i18n = {};
  eventBus = { on: () => {}, off: () => {} };
  addIcons() {}
  loadData() { return Promise.resolve(null); }
  saveData() { return Promise.resolve(); }
}
export function getFrontend() { return 'desktop'; }
export class Setting {
  constructor() {}
  addItem() {}
  open() {}
}
export function openTab() { return Promise.resolve(); }
export function showMessage() {}

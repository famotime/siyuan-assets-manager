/**
 * 资源列表行选择的纯状态机（从 VirtualAssetList.vue / DocumentAssetGroupList.vue
 * 的 handleRowClick 抽离，两者行为逐字等价，仅条目来源不同——
 * 全局列表传入 assets，分组视图传入所属分组的 groupAssets）。
 *
 * 行为契约：
 * - Shift：从锚点（上一次点击行，无则当前行）到当前行的区间全部选中；
 *   未同时按 Ctrl/Cmd 时先清空原集合；lastIndex 不变（Shift 不重设锚点）；
 * - Ctrl/Cmd：切换当前行选中态，lastIndex 移动到当前行；
 * - 普通点击：清空并仅选中当前行，lastIndex 移动到当前行；
 * - 输入集合不被原地修改，始终返回新 Set。
 */

export interface RowSelectionModifiers {
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}

export interface RowSelectionState {
  selectedNames: Set<string>
  lastIndex: number
}

export interface RowSelectionItem {
  name: string
}

export function applyRowClickSelection(
  currentSelected: Set<string>,
  lastIndex: number,
  event: RowSelectionModifiers,
  assetName: string,
  items: ReadonlyArray<RowSelectionItem | undefined>,
  index: number,
): RowSelectionState {
  const nextSet = new Set(currentSelected);

  if (event.shiftKey) {
    // Shift 键连续多选
    const anchor = lastIndex >= 0 ? lastIndex : index;
    const start = Math.min(anchor, index);
    const end = Math.max(anchor, index);

    // 如果未同时按 Ctrl/Cmd，则以本次范围为唯一选中集合
    if (!event.ctrlKey && !event.metaKey) {
      nextSet.clear();
    }

    for (let i = start; i <= end; i++) {
      const item = items[i];
      if (item) {
        nextSet.add(item.name);
      }
    }
    return { selectedNames: nextSet, lastIndex };
  }

  if (event.ctrlKey || event.metaKey) {
    // Ctrl / Cmd 键多选反转
    if (nextSet.has(assetName)) {
      nextSet.delete(assetName);
    } else {
      nextSet.add(assetName);
    }
    return { selectedNames: nextSet, lastIndex: index };
  }

  // 普通点击整行切换单选
  nextSet.clear();
  nextSet.add(assetName);
  return { selectedNames: nextSet, lastIndex: index };
}

/**
 * 勾选框切换单个资源选中态（两列表的 handleRowCheckboxChange 共用）
 */
export function toggleAssetSelection(currentSelected: Set<string>, assetName: string): Set<string> {
  const nextSet = new Set(currentSelected);
  if (nextSet.has(assetName)) {
    nextSet.delete(assetName);
  } else {
    nextSet.add(assetName);
  }
  return nextSet;
}

import type { AssetInfo } from './asset-model'
import { countReferencedDocs } from './asset-model'
import { normalizeOriginalStoragePath } from './storage'

/**
 * 定向更新列表变换（从 AssetsManager.vue 抽离的纯函数）。
 *
 * 行为契约（与原组件内实现逐字等价）：
 * - rename 且旧资产在列表中：原位替换，保留旧条目的其余字段；
 * - rename 且旧资产不在列表中：头部插入新条目；
 * - edit 且 deletedOld：原位替换（零跳动）；deletedOld 为 false 时旧条目转为
 *   未引用并在其前方插入新条目；旧条目不在列表中则头部插入；
 * - 选中集迁移：仅当旧名在选中集中且（rename 或 edit+deletedOld）时迁移到新名，
 *   否则原样返回同一个 Set；
 * - 关联原始底图同步：新条目持有 originalStoragePath 时，按规范化路径找到
 *   底图条目并同步其引用数据。
 *
 * 唯一副作用通过 deps.onInvalidateThumbnail 注入（先后收到 oldName 与 newName）。
 */

export interface AssetTargetedUpdateDetail {
  action: 'rename' | 'edit';
  oldName: string;
  newName: string;
  references?: any[];
  updated?: number;
  size?: number;
  isReEditable?: boolean;
  reEditBlockId?: string;
  originalStoragePath?: string;
  deletedOld?: boolean;
}

export interface TargetedUpdateDeps {
  onInvalidateThumbnail?: (name: string) => void
}

export interface TargetedUpdateListState {
  list: AssetInfo[]
  selectedNames: Set<string>
}

export function applyTargetedAssetUpdate(
  list: AssetInfo[],
  selectedNames: Set<string>,
  detail: AssetTargetedUpdateDetail,
  deps: TargetedUpdateDeps = {},
): TargetedUpdateListState {
  const {
    action,
    oldName,
    newName,
    references = [],
    updated = Date.now(),
    size,
    isReEditable,
    reEditBlockId,
    originalStoragePath,
    deletedOld = true,
  } = detail;

  // 释放并失效旧的缩略图缓存
  deps.onInvalidateThumbnail?.(oldName);
  deps.onInvalidateThumbnail?.(newName);

  const docCount = countReferencedDocs(references);
  const nextList = [...list];
  const oldIndex = nextList.findIndex(a => a.name === oldName);

  if (action === 'rename') {
    let renamedItem: AssetInfo;
    if (oldIndex !== -1) {
      const oldItem = nextList[oldIndex];
      renamedItem = {
        ...oldItem,
        name: newName,
        updated,
        references,
        refCount: references.length,
        docCount,
        ...(size !== undefined && size > 0 ? { size } : {}),
        ...(isReEditable !== undefined ? { isReEditable } : {}),
        ...(reEditBlockId !== undefined ? { reEditBlockId } : {}),
        ...(originalStoragePath !== undefined ? { originalStoragePath } : {}),
      };
      nextList[oldIndex] = renamedItem;
    } else {
      renamedItem = {
        name: newName,
        size: size || 0,
        updated,
        isDir: false,
        references,
        refCount: references.length,
        docCount,
        isReEditable: Boolean(isReEditable),
        reEditBlockId,
        originalStoragePath,
        isOriginal: false,
      };
      nextList.unshift(renamedItem);
    }

    let nextSelected = selectedNames;
    if (selectedNames.has(oldName)) {
      nextSelected = new Set(selectedNames);
      nextSelected.delete(oldName);
      nextSelected.add(newName);
    }

    // 同步更新关联的原始底图引用状态
    const finalOrigPath = renamedItem.originalStoragePath;
    if (finalOrigPath) {
      const normOrig = normalizeOriginalStoragePath(finalOrigPath);
      const origIndex = nextList.findIndex(
        (a) => a.isOriginal && normalizeOriginalStoragePath(a.originalStoragePath || a.name) === normOrig
      );
      if (origIndex !== -1) {
        nextList[origIndex] = {
          ...nextList[origIndex],
          references: [...references],
          refCount: references.length,
          docCount,
        };
      }
    }

    return { list: nextList, selectedNames: nextSelected };
  }

  // action === 'edit'
  const newItem: AssetInfo = {
    name: newName,
    size: size || (oldIndex !== -1 ? nextList[oldIndex].size : 0),
    updated,
    isDir: false,
    references,
    refCount: references.length,
    docCount,
    isReEditable: isReEditable !== undefined ? isReEditable : true,
    reEditBlockId,
    originalStoragePath: originalStoragePath || (oldIndex !== -1 ? nextList[oldIndex].originalStoragePath : undefined),
    isOriginal: false,
  };

  if (oldIndex !== -1) {
    if (deletedOld) {
      // 就地替换：在原有列表位置直接更新为新编辑图片，零跳动零闪烁
      nextList[oldIndex] = newItem;
    } else {
      // 未删除旧文件时：旧文件的文档引用已转移给新图片，旧文件转为未引用
      nextList[oldIndex] = {
        ...nextList[oldIndex],
        references: [],
        refCount: 0,
        docCount: 0,
      };
      nextList.splice(oldIndex, 0, newItem);
    }
  } else {
    nextList.unshift(newItem);
  }

  let nextSelected = selectedNames;
  if (deletedOld && selectedNames.has(oldName)) {
    nextSelected = new Set(selectedNames);
    nextSelected.delete(oldName);
    nextSelected.add(newName);
  }

  // 同步更新关联的原始底图引用状态
  const finalOrigPath = newItem.originalStoragePath;
  if (finalOrigPath) {
    const normOrig = normalizeOriginalStoragePath(finalOrigPath);
    const origIndex = nextList.findIndex(
      (a) => a.isOriginal && normalizeOriginalStoragePath(a.originalStoragePath || a.name) === normOrig
    );
    if (origIndex !== -1) {
      nextList[origIndex] = {
        ...nextList[origIndex],
        references: [...references],
        refCount: references.length,
        docCount,
      };
    }
  }

  return { list: nextList, selectedNames: nextSelected };
}

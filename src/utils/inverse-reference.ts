import {
  countAssetOccurrences,
  replaceAssetInMarkdown,
  replaceAssetInMarkdownLimited,
} from './asset-markdown';

/**
 * 引用逆向还原的决策层。
 *
 * 去重合并是**多对一**变换（dup1、dup2 … 全部改写成 keep），按名字做全局反替换
 * 在数学上不唯一：同一个"keep"引用可能来自 dup1、来自 dup2，也可能本来就是 keep。
 * 因此逆向必须借助合并前的快照，并区分三种情形：
 *
 * - `exact`：`正向变换(快照) === 当前值` ⇒ 合并后从未被编辑，可整段写回快照，
 *   零误伤（块内原本就存在的同名引用保持不变，同组多冗余的先后顺序也无关）。
 * - `approximate`：当前值被编辑过 ⇒ 只按快照中该冗余图出现过的处数限量改回，
 *   把改动范围限制在"合并确实改过的引用数"以内。
 * - `skip`：当前值已不含主图引用，或快照中根本没有该冗余图 ⇒ 一律不动，
 *   由调用方如实上报跳过原因，绝不猜测。
 */

export type RestoreMode = 'exact' | 'approximate' | 'skip';

export interface IRestoreResult {
  /** 还原后的文本；`skip` 时与传入的 current 完全一致 */
  text: string;
  mode: RestoreMode;
}

/**
 * 把一个文本值（块 markdown / 块属性值 / 数据库单元格内容）中的资源引用逆向还原
 *
 * @param current 当前文本
 * @param original 合并前的原始快照；老日志可能缺失
 * @param redundantName 被合并掉的冗余资源名（还原目标）
 * @param canonicalName 合并后保留的主资源名（当前文本中出现的名字）
 */
export function restoreAssetReference(params: {
  current: string;
  original?: string;
  redundantName: string;
  canonicalName: string;
}): IRestoreResult {
  const { current, original, redundantName, canonicalName } = params;

  if (!current || !redundantName || !canonicalName || redundantName === canonicalName) {
    return { text: current, mode: 'skip' };
  }

  // 当前值已不含主图引用 ⇒ 用户已改走别的图或删掉，安全跳过
  if (0 === countAssetOccurrences(current, canonicalName)) {
    return { text: current, mode: 'skip' };
  }

  if (typeof original !== 'string' || !original) {
    // 旧日志（无快照）：保持历史行为按名全局替换，但如实标记为近似还原
    return { text: replaceAssetInMarkdown(current, canonicalName, redundantName), mode: 'approximate' };
  }

  // 快照里没有这个冗余图 ⇒ 本次合并根本没改过这处 markdown（例如引用只落在块属性里），
  // 本次回退与它无关，必须跳过而不是记成"精确还原"
  const limit = countAssetOccurrences(original, redundantName);
  if (limit <= 0) {
    return { text: current, mode: 'skip' };
  }

  // 快照经正向变换后与当前值一致 ⇒ 合并后未被编辑，可整段精确还原
  if (current === replaceAssetInMarkdown(original, redundantName, canonicalName)) {
    return { text: original, mode: 'exact' };
  }

  // 已被编辑过 ⇒ 按快照中该冗余图的出现处数限量改回
  return { text: replaceAssetInMarkdownLimited(current, canonicalName, redundantName, limit), mode: 'approximate' };
}

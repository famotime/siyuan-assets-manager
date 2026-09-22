import { getChildBlocks, type IChildBlock } from '../api';
import { warn } from './logger';

/**
 * 引用回退的位置锚点。
 *
 * 为什么不用 SQL 推导兄弟位置：`blocks` 表的 `sort` 列是内核的「块类型权重」
 * （标题 5 / 段落·代码·表格 10 / 列表·列表项·引述 20 / 超级块·数据库 30，
 * 见内核 `kernel/sql/database.go` 的 `nSort` 与唯一写入口 `Sort: nSort(n)`），
 * 它不携带任何顺序信息 —— 同级全是段落的文档里 `WHERE sort < ?` / `sort > ?`
 * 必然查不到任何兄弟。
 *
 * 后果：锚点丢失后回退只能退化为 `parentID` 定位，而内核在 `parentID` 定位且
 * 容器块时执行的是 `PrependChild`（内核 `kernel/model/transaction.go` 的
 * `doInsert0`，文档块属于容器块），于是"回退的引用跑到文档开头"。
 *
 * 正确做法：兄弟顺序只从内核 AST 取。`/api/block/getChildBlocks` 返回直接子块、
 * 严格文档序、仅块节点，且自 v2.10.0 起提供，覆盖插件 minAppVersion 2.10.14。
 */

/** 受影响块在删除前的位置锚点（随删除日志持久化） */
export interface IBlockAnchor {
  id: string;
  root_id?: string;
  parent_id?: string;
  /** 真实的前一个兄弟块 ID */
  previous_id?: string;
  /** 真实的后一个兄弟块 ID */
  next_id?: string;
  /** 在父块直接子块列表中的序号 */
  child_index?: number;
  /** 在文档根块直接子块列表中的序号（父块被级联清理后用于再锚定） */
  root_index?: number;
}

/** 一次回退插入的候选锚点；`degraded` 表示未能按原始相邻块精确还原 */
export interface IInsertAnchorPlan {
  previousID?: string;
  nextID?: string;
  parentID?: string;
  degraded: boolean;
}

/** 容器子块查询缓存：同一批删除/回退中相同容器只查一次内核 */
export type ChildBlocksCache = Map<string, IChildBlock[] | null>;

export function createChildBlocksCache(): ChildBlocksCache {
  return new Map();
}

async function loadChildBlocks(
  containerId: string | undefined,
  cache: ChildBlocksCache
): Promise<IChildBlock[] | null> {
  if (!containerId) return null;
  if (cache.has(containerId)) {
    return cache.get(containerId) as IChildBlock[] | null;
  }

  let children: IChildBlock[] | null = null;
  try {
    children = await getChildBlocks(containerId);
  } catch (e) {
    warn(`[rollback-anchor] 查询容器 [${containerId}] 直接子块失败:`, e);
    children = null;
  }

  cache.set(containerId, children);
  return children;
}

/**
 * 采集受影响块的位置锚点，供删除日志持久化、回退时精准定位。
 * 内核接口不可用时仅保留 `id / root_id / parent_id`，由回退期的降级链兜底。
 */
export async function captureBlockAnchors(
  blocks: ReadonlyArray<{ id: string; root_id?: string; parent_id?: string }>,
  cache: ChildBlocksCache = createChildBlocksCache()
): Promise<IBlockAnchor[]> {
  const anchors: IBlockAnchor[] = [];

  for (const block of blocks) {
    if (!block || !block.id) continue;

    const anchor: IBlockAnchor = {
      id: block.id,
      root_id: block.root_id,
      parent_id: block.parent_id,
    };

    const parentChildren = await loadChildBlocks(block.parent_id, cache);
    if (parentChildren) {
      const index = parentChildren.findIndex((child) => child.id === block.id);
      if (0 <= index) {
        anchor.child_index = index;
        if (0 < index) {
          anchor.previous_id = parentChildren[index - 1].id;
        }
        if (index + 1 < parentChildren.length) {
          anchor.next_id = parentChildren[index + 1].id;
        }
      }
    }

    if (block.root_id && block.root_id !== block.parent_id) {
      const rootChildren = await loadChildBlocks(block.root_id, cache);
      if (rootChildren) {
        const rootIndex = rootChildren.findIndex((child) => child.id === block.id);
        if (0 <= rootIndex) {
          anchor.root_index = rootIndex;
        }
      }
    } else if (typeof anchor.child_index === 'number') {
      // 父块即文档根块：两级序号一致，避免重复请求内核
      anchor.root_index = anchor.child_index;
    }

    anchors.push(anchor);
  }

  return anchors;
}

/**
 * 在已知的有序子块列表中定位：命中原始相邻块则精确还原，否则按序号近似再锚定。
 * @param membershipDegraded 命中相邻块时是否仍算降级（父块已消失、层级已变化时为 true）
 */
function planWithinChildren(
  children: IChildBlock[],
  anchor: IBlockAnchor,
  index: number | undefined,
  parentID: string | undefined,
  membershipDegraded: boolean
): IInsertAnchorPlan[] {
  const childIds = new Set(children.map((child) => child.id));

  if (anchor.previous_id && childIds.has(anchor.previous_id)) {
    return [{ previousID: anchor.previous_id, parentID, degraded: membershipDegraded }];
  }
  if (anchor.next_id && childIds.has(anchor.next_id)) {
    return [{ nextID: anchor.next_id, parentID, degraded: membershipDegraded }];
  }

  // 序号仍在范围内则插到该子块之前；越界（兄弟变少）则追加到容器末尾，
  // 绝不使用裸 parentID —— 那会被内核 PrependChild 到容器首位。
  if (typeof index === 'number' && 0 <= index && index < children.length) {
    return [{ nextID: children[index].id, parentID, degraded: true }];
  }
  return [{ previousID: children[children.length - 1].id, parentID, degraded: true }];
}

/**
 * 解析回退插入的候选锚点（按优先级排序，由调用方逐个尝试直到插入成功）。
 *
 * 优先级：父容器内相邻块 → 父容器内按序号再锚定 → 文档层再锚定 → 旧候选链兜底。
 * 返回空数组表示既无容器信息也无任何锚点，无法定位。
 *
 * 注意：内核在容器**不存在**时同样返回空子块数组（`GetChildBlocksInBox` 在加载
 * 树失败时返回空切片而非报错），因此"空容器"与"容器已被物理移除"不可区分，
 * 父容器候选之后必须保留文档层候选作为后备，由调用方按顺序重试。
 */
export async function planInsertAnchors(
  anchor: IBlockAnchor,
  cache: ChildBlocksCache = createChildBlocksCache()
): Promise<IInsertAnchorPlan[]> {
  const parentId = anchor.parent_id;
  const rootId = anchor.root_id;
  const plans: IInsertAnchorPlan[] = [];

  // 1. 原父容器仍可查：优先按真实相邻块精确还原
  const parentChildren = await loadChildBlocks(parentId, cache);
  if (parentChildren) {
    if (0 === parentChildren.length) {
      // 容器为空 ⇒ 回退块就是它唯一的子块，parentID 定位即原位置
      plans.push({ parentID: parentId, degraded: false });
    } else {
      plans.push(...planWithinChildren(parentChildren, anchor, anchor.child_index, parentId, false));
    }
  }

  // 2. 文档层后备：父容器被内核级联清理（列表项/引述/超级块整块消失）时按文档序号再锚定。
  //    嵌套块记录的是父块内序号，此处只能作为近似落点，故一律标记降级。
  if (rootId && rootId !== parentId) {
    const rootChildren = await loadChildBlocks(rootId, cache);
    if (rootChildren && 0 < rootChildren.length) {
      const index = typeof anchor.root_index === 'number' ? anchor.root_index : anchor.child_index;
      plans.push(...planWithinChildren(rootChildren, anchor, index, rootId, true));
    } else if (rootChildren && 0 === plans.length) {
      plans.push({ parentID: rootId, degraded: false });
    }
  }

  // 3. 内核接口完全不可用：沿用旧候选链逐个尝试，全部标记降级以便报告明示
  if (0 === plans.length) {
    if (anchor.previous_id) {
      plans.push({ previousID: anchor.previous_id, parentID: parentId, degraded: true });
    }
    if (anchor.next_id) {
      plans.push({ nextID: anchor.next_id, parentID: parentId, degraded: true });
    }
    const containerId = parentId || rootId;
    if (containerId) {
      plans.push({ parentID: containerId, degraded: true });
    }
  }

  return plans;
}

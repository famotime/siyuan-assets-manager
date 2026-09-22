import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/api', () => ({
  getChildBlocks: vi.fn(),
}));

import { getChildBlocks } from '../src/api';
import {
  captureBlockAnchors,
  planInsertAnchors,
  createChildBlocksCache,
} from '../src/utils/rollback-anchor';

const child = (id: string) => ({ id, type: 'p' });

describe('rollback-anchor unit tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('captureBlockAnchors', () => {
    it('从内核子块顺序采集真实前后兄弟与父块序号', async () => {
      vi.mocked(getChildBlocks).mockResolvedValue([
        child('block-a'),
        child('block-b'),
        child('block-c'),
      ] as any);

      const anchors = await captureBlockAnchors([
        { id: 'block-b', root_id: 'doc-id', parent_id: 'doc-id' },
      ]);

      expect(anchors).toHaveLength(1);
      expect(anchors[0].previous_id).toBe('block-a');
      expect(anchors[0].next_id).toBe('block-c');
      expect(anchors[0].child_index).toBe(1);
      // 父块即文档根块时文档序号与父块序号一致，且不重复请求内核
      expect(anchors[0].root_index).toBe(1);
      expect(getChildBlocks).toHaveBeenCalledTimes(1);
    });

    it('首块与唯一子块不会越界取到无关兄弟', async () => {
      vi.mocked(getChildBlocks).mockResolvedValueOnce([child('first'), child('second')] as any);
      const head = await captureBlockAnchors([
        { id: 'first', root_id: 'doc-id', parent_id: 'doc-id' },
      ]);
      expect(head[0].previous_id).toBeUndefined();
      expect(head[0].next_id).toBe('second');
      expect(head[0].child_index).toBe(0);

      vi.mocked(getChildBlocks).mockResolvedValueOnce([child('only')] as any);
      const only = await captureBlockAnchors([
        { id: 'only', root_id: 'doc-id', parent_id: 'doc-id' },
      ]);
      expect(only[0].previous_id).toBeUndefined();
      expect(only[0].next_id).toBeUndefined();
      expect(only[0].child_index).toBe(0);
    });

    it('嵌套块只记录父块序号，不误记文档序号', async () => {
      vi.mocked(getChildBlocks).mockImplementation(async (id: string) => {
        if (id === 'list-item') return [child('p1'), child('p2')] as any;
        if (id === 'doc-id') return [child('x'), child('list-item'), child('y')] as any;
        return [] as any;
      });

      const anchors = await captureBlockAnchors([
        { id: 'p2', root_id: 'doc-id', parent_id: 'list-item' },
      ]);

      expect(anchors[0].previous_id).toBe('p1');
      expect(anchors[0].next_id).toBeUndefined();
      expect(anchors[0].child_index).toBe(1);
      // p2 是列表项的子块而非文档直接子块，文档序号无意义
      expect(anchors[0].root_index).toBeUndefined();
    });

    it('SQL 行缺失（引用快照过期）时仍能从文档层恢复序号', async () => {
      vi.mocked(getChildBlocks).mockResolvedValue([
        child('x'),
        child('block-b'),
        child('y'),
      ] as any);

      const anchors = await captureBlockAnchors([{ id: 'block-b', root_id: 'doc-id' }]);

      expect(anchors[0].root_index).toBe(1);
      expect(getChildBlocks).toHaveBeenCalledWith('doc-id');
    });

    it('同一容器只向内核查询一次（同一批次多个块共享缓存）', async () => {
      vi.mocked(getChildBlocks).mockResolvedValue([
        child('block-a'),
        child('block-b'),
        child('block-c'),
      ] as any);

      const anchors = await captureBlockAnchors(
        [
          { id: 'block-a', root_id: 'doc-id', parent_id: 'doc-id' },
          { id: 'block-c', root_id: 'doc-id', parent_id: 'doc-id' },
        ],
        createChildBlocksCache()
      );

      expect(getChildBlocks).toHaveBeenCalledTimes(1);
      expect(anchors[0].next_id).toBe('block-b');
      expect(anchors[1].previous_id).toBe('block-b');
    });

    it('内核接口不可用时保留基础信息且不抛异常', async () => {
      vi.mocked(getChildBlocks).mockResolvedValue(null);

      const anchors = await captureBlockAnchors([
        { id: 'block-b', root_id: 'doc-id', parent_id: 'doc-id' },
      ]);

      expect(anchors[0]).toMatchObject({ id: 'block-b', root_id: 'doc-id', parent_id: 'doc-id' });
      expect(anchors[0].previous_id).toBeUndefined();
      expect(anchors[0].child_index).toBeUndefined();
    });

    it('块已不在容器子块列表中时不写入任何位置字段', async () => {
      vi.mocked(getChildBlocks).mockResolvedValue([child('other')] as any);

      const anchors = await captureBlockAnchors([
        { id: 'av-20240101-abcdefg', root_id: 'doc-id', parent_id: 'doc-id' },
      ]);

      expect(anchors[0].child_index).toBeUndefined();
      expect(anchors[0].root_index).toBeUndefined();
      expect(anchors[0].previous_id).toBeUndefined();
    });
  });

  describe('planInsertAnchors', () => {
    it('原始相邻块仍在时精确锚定且不标记降级', async () => {
      vi.mocked(getChildBlocks).mockResolvedValue([
        child('block-a'),
        child('block-c'),
      ] as any);

      const plans = await planInsertAnchors({
        id: 'block-b',
        root_id: 'doc-id',
        parent_id: 'doc-id',
        previous_id: 'block-a',
        next_id: 'block-c',
        child_index: 1,
      });

      expect(plans).toHaveLength(1);
      expect(plans[0]).toMatchObject({ previousID: 'block-a', parentID: 'doc-id', degraded: false });
      expect(plans[0].nextID).toBeUndefined();
    });

    it('前块已被删除时改用后块精确锚定', async () => {
      vi.mocked(getChildBlocks).mockResolvedValue([child('block-c'), child('block-d')] as any);

      const plans = await planInsertAnchors({
        id: 'block-b',
        root_id: 'doc-id',
        parent_id: 'doc-id',
        previous_id: 'block-a',
        next_id: 'block-c',
        child_index: 1,
      });

      expect(plans).toHaveLength(1);
      expect(plans[0]).toMatchObject({ nextID: 'block-c', degraded: false });
    });

    it('原始相邻块全部漂移时按父块序号再锚定并标记降级', async () => {
      vi.mocked(getChildBlocks).mockResolvedValue([
        child('block-c'),
        child('block-d'),
        child('block-e'),
      ] as any);

      const plans = await planInsertAnchors({
        id: 'block-b',
        root_id: 'doc-id',
        parent_id: 'doc-id',
        previous_id: 'block-a',
        next_id: 'block-z',
        child_index: 1,
      });

      expect(plans).toHaveLength(1);
      expect(plans[0]).toMatchObject({ nextID: 'block-d', parentID: 'doc-id', degraded: true });
    });

    it('序号越界时追加到父块末尾而非父块首位', async () => {
      vi.mocked(getChildBlocks).mockResolvedValue([child('block-c')] as any);

      const plans = await planInsertAnchors({
        id: 'block-b',
        root_id: 'doc-id',
        parent_id: 'doc-id',
        child_index: 5,
      });

      expect(plans[0]).toMatchObject({ previousID: 'block-c', degraded: true });
      expect(plans[0].nextID).toBeUndefined();
    });

    it('父容器为空时以 parentID 定位，位置唯一故不标记降级', async () => {
      vi.mocked(getChildBlocks).mockResolvedValue([] as any);

      const plans = await planInsertAnchors({
        id: 'block-b',
        root_id: 'doc-id',
        parent_id: 'doc-id',
        previous_id: 'block-a',
      });

      expect(plans).toEqual([{ parentID: 'doc-id', degraded: false }]);
    });

    it('父容器已被级联清理时保留文档层候选并标记降级', async () => {
      vi.mocked(getChildBlocks).mockImplementation(async (id: string) => {
        // 内核在容器不存在时也返回空数组，与"空容器"不可区分
        if (id === 'list-item') return [] as any;
        if (id === 'doc-id') return [child('x'), child('y'), child('z')] as any;
        return [] as any;
      });

      const plans = await planInsertAnchors({
        id: 'p1',
        root_id: 'doc-id',
        parent_id: 'list-item',
        child_index: 0,
        root_index: 1,
      });

      // 先试父容器，父容器已消失时由文档层候选兜底（文档层已无原始相邻块，按序号插到第 1 个子块之前）
      expect(plans).toHaveLength(2);
      expect(plans[0]).toMatchObject({ parentID: 'list-item', degraded: false });
      expect(plans[1]).toMatchObject({ nextID: 'y', parentID: 'doc-id', degraded: true });
    });

    it('父容器已存在且非空时文档层候选排在精确锚点之后', async () => {
      vi.mocked(getChildBlocks).mockImplementation(async (id: string) => {
        if (id === 'list-item') return [child('p1'), child('p2')] as any;
        if (id === 'doc-id') return [child('x'), child('list-item'), child('y')] as any;
        return [] as any;
      });

      const plans = await planInsertAnchors({
        id: 'p2',
        root_id: 'doc-id',
        parent_id: 'list-item',
        previous_id: 'p1',
        child_index: 1,
      });

      expect(plans[0]).toMatchObject({ previousID: 'p1', parentID: 'list-item', degraded: false });
    });

    it('内核完全不可用时回落到旧候选链，全部标记降级', async () => {
      vi.mocked(getChildBlocks).mockResolvedValue(null);

      const plans = await planInsertAnchors({
        id: 'block-b',
        root_id: 'doc-id',
        parent_id: 'doc-id',
        previous_id: 'block-a',
        next_id: 'block-c',
      });

      expect(plans.map((p) => p.degraded)).toEqual([true, true, true]);
      expect(plans[0]).toMatchObject({ previousID: 'block-a' });
      expect(plans[1]).toMatchObject({ nextID: 'block-c' });
      expect(plans[2]).toMatchObject({ parentID: 'doc-id' });
    });

    it('无任何可用信息时不产生插入计划', async () => {
      vi.mocked(getChildBlocks).mockResolvedValue(null);

      const plans = await planInsertAnchors({ id: 'block-b' });

      expect(plans).toEqual([]);
    });

    it('回归：有子块的容器绝不使用裸 parentID 兜底（内核会插到容器首位）', async () => {
      vi.mocked(getChildBlocks).mockResolvedValue([
        child('block-a'),
        child('block-b'),
        child('block-c'),
      ] as any);

      const plans = await planInsertAnchors({
        id: 'block-x',
        root_id: 'doc-id',
        parent_id: 'doc-id',
      });

      expect(plans).toHaveLength(1);
      expect(plans[0].previousID ?? plans[0].nextID).toBeTruthy();
      expect(plans[0].degraded).toBe(true);
      // 追加到文档末尾（previousID = 最后一个子块），而不是插到文档开头
      expect(plans[0]).toMatchObject({ previousID: 'block-c' });
    });
  });
});

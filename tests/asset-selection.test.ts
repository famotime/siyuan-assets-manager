import { describe, expect, it } from 'vitest';
import { applyRowClickSelection, toggleAssetSelection } from '../src/utils/asset-selection';

const items = (count: number) => Array.from({ length: count }, (_, i) => ({ name: `a${i}.png` }))

describe('applyRowClickSelection · Shift 区间选择', () => {
  it('无 Ctrl 时清空原集合并选中锚点到当前行区间', () => {
    const current = new Set(['a9.png'])
    const { selectedNames, lastIndex } = applyRowClickSelection(
      current, 1,
      { shiftKey: true, ctrlKey: false, metaKey: false },
      'a4.png', items(10), 4,
    )

    expect(Array.from(selectedNames)).toEqual(['a1.png', 'a2.png', 'a3.png', 'a4.png'])
    expect(lastIndex).toBe(1)
    expect(selectedNames.has('a9.png')).toBe(false)
  })

  it('同时按 Ctrl 时保留原集合并追加区间', () => {
    const current = new Set(['a9.png'])
    const { selectedNames } = applyRowClickSelection(
      current, 1,
      { shiftKey: true, ctrlKey: true, metaKey: false },
      'a3.png', items(10), 3,
    )

    expect(selectedNames.has('a9.png')).toBe(true)
    expect(selectedNames.has('a1.png')).toBe(true)
    expect(selectedNames.has('a2.png')).toBe(true)
    expect(selectedNames.has('a3.png')).toBe(true)
  })

  it('同时按 Cmd（macOS）时同样追加区间', () => {
    const current = new Set(['a9.png'])
    const { selectedNames } = applyRowClickSelection(
      current, 2,
      { shiftKey: true, ctrlKey: false, metaKey: true },
      'a3.png', items(10), 3,
    )

    expect(selectedNames.has('a9.png')).toBe(true)
    expect(selectedNames.has('a3.png')).toBe(true)
  })

  it('无锚点（lastIndex = -1）时以当前行为锚点，仅选中当前行', () => {
    const { selectedNames } = applyRowClickSelection(
      new Set<string>(), -1,
      { shiftKey: true, ctrlKey: false, metaKey: false },
      'a5.png', items(10), 5,
    )

    expect(Array.from(selectedNames)).toEqual(['a5.png'])
  })

  it('反向区间（当前行在锚点之前）正确收敛', () => {
    const { selectedNames } = applyRowClickSelection(
      new Set<string>(), 6,
      { shiftKey: true, ctrlKey: false, metaKey: false },
      'a4.png', items(10), 4,
    )

    expect(selectedNames.size).toBe(3)
    expect(selectedNames.has('a4.png')).toBe(true)
    expect(selectedNames.has('a5.png')).toBe(true)
    expect(selectedNames.has('a6.png')).toBe(true)
  })

  it('虚拟窗口条目缺失（undefined 洞）被安全跳过', () => {
    const sparse: Array<{ name: string } | undefined> = [{ name: 'x.png' }, undefined, { name: 'y.png' }]
    const { selectedNames } = applyRowClickSelection(
      new Set<string>(), 0,
      { shiftKey: true, ctrlKey: false, metaKey: false },
      'y.png', sparse, 2,
    )

    expect(selectedNames.has('x.png')).toBe(true)
    expect(selectedNames.has('y.png')).toBe(true)
  })
})

describe('applyRowClickSelection · Ctrl/Cmd 切换与普通点击', () => {
  it('Ctrl 点击未选中行：加入并移动锚点', () => {
    const { selectedNames, lastIndex } = applyRowClickSelection(
      new Set(['a1.png']), 0,
      { shiftKey: false, ctrlKey: true, metaKey: false },
      'a3.png', items(10), 3,
    )

    expect(selectedNames.has('a1.png')).toBe(true)
    expect(selectedNames.has('a3.png')).toBe(true)
    expect(lastIndex).toBe(3)
  })

  it('Ctrl 点击已选中行：移除并移动锚点', () => {
    const { selectedNames, lastIndex } = applyRowClickSelection(
      new Set(['a3.png']), 3,
      { shiftKey: false, ctrlKey: true, metaKey: false },
      'a3.png', items(10), 3,
    )

    expect(selectedNames.has('a3.png')).toBe(false)
    expect(lastIndex).toBe(3)
  })

  it('Cmd 点击行为与 Ctrl 一致', () => {
    const { selectedNames, lastIndex } = applyRowClickSelection(
      new Set<string>(), -1,
      { shiftKey: false, ctrlKey: false, metaKey: true },
      'a2.png', items(10), 2,
    )

    expect(Array.from(selectedNames)).toEqual(['a2.png'])
    expect(lastIndex).toBe(2)
  })

  it('普通点击：清空并仅选中当前行', () => {
    const { selectedNames, lastIndex } = applyRowClickSelection(
      new Set(['a1.png', 'a2.png']), 4,
      { shiftKey: false, ctrlKey: false, metaKey: false },
      'a5.png', items(10), 5,
    )

    expect(Array.from(selectedNames)).toEqual(['a5.png'])
    expect(lastIndex).toBe(5)
  })

  it('输入集合不被原地修改', () => {
    const current = new Set(['a1.png'])
    applyRowClickSelection(
      current, 0,
      { shiftKey: false, ctrlKey: false, metaKey: false },
      'a2.png', items(5), 2,
    )

    expect(Array.from(current)).toEqual(['a1.png'])
  })
})

describe('toggleAssetSelection', () => {
  it('未选中时加入，已选中时移除，均返回新 Set', () => {
    const a = new Set(['x.png'])
    const afterAdd = toggleAssetSelection(a, 'y.png')
    expect(afterAdd.has('y.png')).toBe(true)
    expect(a.has('y.png')).toBe(false)

    const afterRemove = toggleAssetSelection(afterAdd, 'y.png')
    expect(afterRemove.has('y.png')).toBe(false)
    expect(afterRemove.has('x.png')).toBe(true)
  })
})

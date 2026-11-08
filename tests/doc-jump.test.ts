import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlockRef } from '../src/utils/asset-model';
import {
  OPEN_DOC_TAB_ACTIONS,
  buildOpenTabOptions,
  openBlockRefInTab,
  resolveCanvasPath,
} from '../src/utils/doc-jump';

const { openCanvasInTabMock, filterExistingMock, usePluginMock, openTabMock } = vi.hoisted(() => ({
  openCanvasInTabMock: vi.fn(),
  filterExistingMock: vi.fn(),
  usePluginMock: vi.fn(),
  openTabMock: vi.fn(),
}));

vi.mock('../src/utils/canvas-asset', () => ({
  openCanvasInTab: openCanvasInTabMock,
}));
vi.mock('../src/utils/siyuan-block', () => ({
  filterExistingBlockIds: filterExistingMock,
}));
vi.mock('../src/utils/plugin-context', () => ({
  usePlugin: usePluginMock,
}));
vi.mock('siyuan', () => ({
  openTab: openTabMock,
}));

function makeRef(overrides: Partial<BlockRef> = {}): BlockRef {
  return {
    id: '20240101010101-abcdef',
    root_id: '20240101010101-root01',
    box: 'box',
    content: 'c',
    markdown: 'm',
    path: '/note/doc/20240101010101-root01.md',
    readablePath: '笔记本/文档',
    ...overrides,
  }
}

const baseOptions = {
  notify: vi.fn(),
  docOpenedText: 'DOC_OPENED',
  canvasOpenedText: (title: string) => `CANVAS_OPENED:${title}`,
  canvasPluginMissingText: 'CANVAS_PLUGIN_MISSING',
  refVirtualSourceText: (source: string) => `VIRTUAL:${source}`,
  refBlockMissingText: (source: string) => `MISSING:${source}`,
  openDocFailedText: 'OPEN_FAILED',
}

beforeEach(() => {
  vi.clearAllMocks()
  usePluginMock.mockReturnValue({ app: { appId: 'app-1' } })
  openTabMock.mockResolvedValue(undefined)
})

describe('resolveCanvasPath · 统一画布路径口径', () => {
  it('显式 path 优先', () => {
    expect(resolveCanvasPath({ id: 'canvas:/a/b.canvas', root_id: '/a/b.canvas', path: '/real.canvas' })).toBe('/real.canvas')
  })

  it('.canvas 结尾的 root_id 次之', () => {
    expect(resolveCanvasPath({ id: '2024-x', root_id: '/storage/petal/siyuan-canvas/a.canvas' })).toBe('/storage/petal/siyuan-canvas/a.canvas')
  })

  it('canvas: 前缀 id 携带的路径再次之', () => {
    expect(resolveCanvasPath({ id: 'canvas:/data/storage/petal/siyuan-canvas/a.canvas', root_id: '2024-root' })).toBe('/data/storage/petal/siyuan-canvas/a.canvas')
  })

  it('兜底 root_id', () => {
    expect(resolveCanvasPath({ id: '2024-x', root_id: '2024-root' })).toBe('2024-root')
  })
})

describe('buildOpenTabOptions · openTab 契约', () => {
  it('固定的 action 数组与 keepCursor', () => {
    expect(buildOpenTabOptions({ appId: 'a' }, 'blk-1')).toEqual({
      app: { appId: 'a' },
      doc: { id: 'blk-1', action: ['cb-get-hl', 'cb-get-focus', 'cb-get-context'] },
      keepCursor: true,
    })
    expect(OPEN_DOC_TAB_ACTIONS).toEqual(['cb-get-hl', 'cb-get-focus', 'cb-get-context'])
  })

  it('action 数组是副本，外部修改不污染契约常量', () => {
    const opts = buildOpenTabOptions({}, 'x')
    opts.doc.action.push('mutated')
    expect(OPEN_DOC_TAB_ACTIONS).toHaveLength(3)
  })
})

describe('openBlockRefInTab · 空引用与伪引用', () => {
  it('空引用直接返回，不触发任何打开动作', async () => {
    await openBlockRefInTab(undefined as unknown as BlockRef, baseOptions)
    await openBlockRefInTab({ ...makeRef(), id: '' }, baseOptions)
    expect(openTabMock).not.toHaveBeenCalled()
    expect(openCanvasInTabMock).not.toHaveBeenCalled()
    expect(baseOptions.notify).not.toHaveBeenCalled()
  })

  it('独立数据库伪引用：提示来源且不打开', async () => {
    const ref = makeRef({ id: 'av-20240101', root_id: 'av-20240101' })

    await openBlockRefInTab(ref, baseOptions)

    expect(baseOptions.notify).toHaveBeenCalledWith('VIRTUAL:笔记本/文档')
    expect(openTabMock).not.toHaveBeenCalled()
  })
})

describe('openBlockRefInTab · 画布引用', () => {
  it('传入 canvasTitle 时：带标题打开画布，成功提示含标题', async () => {
    const ref = makeRef({ id: 'canvas:/data/x.canvas', root_id: '/data/x.canvas', path: undefined })
    openCanvasInTabMock.mockResolvedValue(true)

    await openBlockRefInTab(ref, { ...baseOptions, canvasTitle: '画布A' })

    expect(openCanvasInTabMock).toHaveBeenCalledWith('/data/x.canvas', '画布A')
    expect(baseOptions.notify).toHaveBeenCalledWith('CANVAS_OPENED:画布A')
    expect(openTabMock).not.toHaveBeenCalled()
  })

  it('不传 canvasTitle 时：不带标题打开（保持单文档入口行为），成功文案工厂收到 docLabel', async () => {
    const ref = makeRef({ root_id: '/data/x.canvas', path: undefined })
    openCanvasInTabMock.mockResolvedValue(true)

    await openBlockRefInTab(ref, baseOptions)

    expect(openCanvasInTabMock).toHaveBeenCalledWith('/data/x.canvas')
    expect(baseOptions.notify).toHaveBeenCalledWith('CANVAS_OPENED:笔记本/文档')
  })

  it('画布插件缺失：提示 canvasPluginMissingText', async () => {
    const ref = makeRef({ root_id: '/data/x.canvas', path: undefined })
    openCanvasInTabMock.mockResolvedValue(false)

    await openBlockRefInTab(ref, baseOptions)

    expect(baseOptions.notify).toHaveBeenCalledWith('CANVAS_PLUGIN_MISSING')
  })
})

describe('openBlockRefInTab · 普通文档引用', () => {
  it('引用有效：以统一契约 openTab 并提示成功', async () => {
    filterExistingMock.mockResolvedValue(new Set(['20240101010101-abcdef']))
    const ref = makeRef()

    await openBlockRefInTab(ref, baseOptions)

    expect(filterExistingMock).toHaveBeenCalledWith(['20240101010101-abcdef'])
    expect(openTabMock).toHaveBeenCalledWith({
      app: { appId: 'app-1' },
      doc: { id: '20240101010101-abcdef', action: ['cb-get-hl', 'cb-get-focus', 'cb-get-context'] },
      keepCursor: true,
    })
    expect(baseOptions.notify).toHaveBeenCalledWith('DOC_OPENED')
  })

  it('引用失效：提示 MISSING 且不打开', async () => {
    filterExistingMock.mockResolvedValue(new Set())
    const ref = makeRef()

    await openBlockRefInTab(ref, baseOptions)

    expect(baseOptions.notify).toHaveBeenCalledWith('MISSING:笔记本/文档')
    expect(openTabMock).not.toHaveBeenCalled()
  })

  it('validityIds 多 id：任一存活即打开（块 id 失效但文档根存活）', async () => {
    filterExistingMock.mockResolvedValue(new Set(['20240101010101-root01']))
    const ref = makeRef({ id: '20240101010101-dead01' })

    await openBlockRefInTab(ref, { ...baseOptions, validityIds: ['20240101010101-dead01', '20240101010101-root01'] })

    expect(openTabMock).toHaveBeenCalledWith(
      expect.objectContaining({ doc: expect.objectContaining({ id: '20240101010101-dead01' }) }),
    )
    expect(baseOptions.notify).toHaveBeenCalledWith('DOC_OPENED')
  })

  it('validityIds 全部失效：以 missingSource 提示', async () => {
    filterExistingMock.mockResolvedValue(new Set())
    const ref = makeRef()

    await openBlockRefInTab(ref, { ...baseOptions, validityIds: ['a', 'b'], missingSource: '来源X' })

    expect(baseOptions.notify).toHaveBeenCalledWith('MISSING:来源X')
  })

  it('openTab 抛错：调用 onOpenError 并提示 openDocFailedText', async () => {
    filterExistingMock.mockResolvedValue(new Set(['20240101010101-abcdef']))
    openTabMock.mockRejectedValue(new Error('boom'))
    const onOpenError = vi.fn()

    await openBlockRefInTab(makeRef(), { ...baseOptions, onOpenError })

    expect(onOpenError).toHaveBeenCalledWith(expect.any(Error))
    expect(baseOptions.notify).toHaveBeenCalledWith('OPEN_FAILED')
  })

  it('插件未就绪：不打开也不报错', async () => {
    filterExistingMock.mockResolvedValue(new Set(['20240101010101-abcdef']))
    usePluginMock.mockReturnValue(null)

    await openBlockRefInTab(makeRef(), baseOptions)

    expect(openTabMock).not.toHaveBeenCalled()
    expect(baseOptions.notify).not.toHaveBeenCalled()
  })
})

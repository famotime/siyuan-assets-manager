import { openTab } from 'siyuan'
import type { TProtyleAction } from 'siyuan'
import { isCanvasRef, isStandaloneDatabaseRef, type BlockRef } from './asset-model'
import { openCanvasInTab } from './canvas-asset'
import { usePlugin } from './plugin-context'
import { filterExistingBlockIds } from './siyuan-block'

/**
 * 文档跳转内核（从 AssetsManager.vue / DeduplicateDialog.vue / DeletionHistoryDialog.vue
 * 的三份跳转实现收敛而来）。
 *
 * 统一契约：
 * - 画布判定 → openCanvasInTab（成功/插件缺失分别提示）；
 * - 独立数据库伪引用（av-<avId>）→ 提示来源而非假成功打开；
 * - 普通引用跳转前 filterExistingBlockIds 失效预检（引用是扫描时刻缓存，块可能已删；
 *   openTab 对失效 id 不抛错，直接打开只会得到"已在后台打开"的假成功提示）；
 * - openTab 的 action 契约固定为 OPEN_DOC_TAB_ACTIONS + keepCursor。
 *
 * 通知函数与全部 i18n 文案由调用方注入（三个组件的 key/时机各不相同）。
 */

/** 后台打开文档并高亮引用块的统一 action 契约 */
export const OPEN_DOC_TAB_ACTIONS: TProtyleAction[] = ['cb-get-hl', 'cb-get-focus', 'cb-get-context']

export interface OpenTabOptions {
  app: any
  doc: { id: string, action: TProtyleAction[] }
  keepCursor: boolean
}

/** 组装后台打开文档的 openTab 参数（DeletionHistoryDialog 循环多开变体共用） */
export function buildOpenTabOptions(app: any, docId: string): OpenTabOptions {
  return {
    app,
    doc: {
      id: docId,
      action: [...OPEN_DOC_TAB_ACTIONS],
    },
    keepCursor: true,
  }
}

/**
 * 统一三处画布路径解析口径：
 * 显式 path → .canvas 结尾的 root_id → canvas: 前缀 id 携带的路径 → root_id 兜底。
 * （此前 DeduplicateDialog 对 "canvas: 前缀 id + root_id 非画布" 的引用会误用 root_id
 * 作为画布路径，统一后与 AssetsManager 的更准确口径一致。）
 */
export function resolveCanvasPath(ref: { id: string, root_id: string, path?: string }): string {
  if (ref.path) return ref.path
  if (ref.root_id?.endsWith('.canvas')) return ref.root_id
  if (ref.id?.startsWith('canvas:')) {
    const path = ref.id.split(':')[1]
    if (path) return path
  }
  return ref.root_id
}

export interface OpenBlockRefOptions {
  /** 通知函数（pushMsg / showMessage 由组件注入） */
  notify: (msg: string) => void
  /** 打开普通文档成功的文案；工厂形态用于携带 docLabel（如 dedup.docOpenedMsg） */
  docOpenedText: string | ((docLabel: string) => string)
  /** 打开画布成功的文案工厂（参数为画布展示标题） */
  canvasOpenedText: (title: string) => string
  /** 画布插件缺失文案 */
  canvasPluginMissingText: string
  /** 独立数据库伪引用文案工厂 */
  refVirtualSourceText: (source: string) => string
  /** 引用失效文案工厂 */
  refBlockMissingText: (source: string) => string
  /** openTab 失败文案 */
  openDocFailedText: string
  /** 画布展示标题；不传时 openCanvasInTab 使用其内部默认标题（保持 AssetsManager 单文档入口行为） */
  canvasTitle?: string
  /** 失效预检 id 集合（默认 [ref.id]；传入多个时全部缺失才判定失效） */
  validityIds?: string[]
  /** 失效/伪引用提示中的来源标签（默认 docLabel） */
  missingSource?: string
  /** openTab 抛错时的额外错误处理（组件日志等） */
  onOpenError?: (e: unknown) => void
}

/**
 * 单引用跳转内核。
 * docLabel 展示口径：readablePath → hpath → id。
 */
export async function openBlockRefInTab(ref: BlockRef, options: OpenBlockRefOptions): Promise<void> {
  if (!ref || !ref.id) return
  const docLabel = ref.readablePath || ref.hpath || ref.id

  // 独立数据库伪引用：av-<avId> 不是真实块 id，无法作为文档打开
  if (isStandaloneDatabaseRef(ref)) {
    options.notify(options.refVirtualSourceText(options.missingSource ?? docLabel))
    return
  }

  // 画布引用：交给画布插件打开
  if (isCanvasRef(ref)) {
    const canvasPath = resolveCanvasPath(ref)
    const ok = options.canvasTitle !== undefined
      ? await openCanvasInTab(canvasPath, options.canvasTitle)
      : await openCanvasInTab(canvasPath)
    options.notify(ok ? options.canvasOpenedText(options.canvasTitle ?? docLabel) : options.canvasPluginMissingText)
    return
  }

  try {
    // 跳转前校验引用有效性
    const ids = options.validityIds ?? [ref.id]
    const existingIds = await filterExistingBlockIds(ids)
    const alive = ids.some((id) => existingIds.has(id))
    if (!alive) {
      const source = options.missingSource ?? docLabel
      options.notify(options.refBlockMissingText(source))
      return
    }

    const plugin = usePlugin()
    if (plugin && plugin.app) {
      await openTab(buildOpenTabOptions(plugin.app, ref.id))
      options.notify(typeof options.docOpenedText === 'function' ? options.docOpenedText(docLabel) : options.docOpenedText)
    }
  } catch (e) {
    options.onOpenError?.(e)
    options.notify(options.openDocFailedText)
  }
}

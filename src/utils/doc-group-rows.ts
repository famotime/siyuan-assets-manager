import type { DocAssetGroup } from './asset-list'
import type { AssetInfo } from './siyuan-db'

/**
 * 文档归类视图的行高常量。
 *
 * 组件把这里的数值作为内联 height 绑定到每一行，使「虚拟滚动的测量值」与
 * 「CSS 实际渲染高度」共用同一个来源，避免两边各自维护后悄悄漂移。
 * 改高度请改这里，不要只改样式表。
 *
 * 注意这里只保证「行外框高度」。行内内容必须自己塞得下，否则会被 overflow: hidden
 * 裁掉：
 * - header 58 = 上下 1px 边框 + 16px 内边距 + 40px 内容，内容实测 19px 标题行
 *   + 1px + 17px 路径行 = 37px。徽章也在这个标题行里，因此徽章的 line-height
 *   必须钉住（见 .doc-unref-badge/.doc-match-badge），否则会撑高标题行。
 * - subheader 32 = 1px 边框 + 12px 内边距 + 19px 内容，列名行 line-height 18px。
 * - asset 53 = 1px 边框 + 52px 内容。
 */
export const DOC_ROW_HEIGHTS = {
  /** 分组卡片头部（含边框；展开时它是卡片顶边，折叠时它同时是卡片底边） */
  header: 58,
  /** 卡片内的列名行 */
  subheader: 32,
  /** 单条资源行 */
  asset: 53,
  /** 卡片之间的间距 */
  gap: 14,
} as const

export type DocRowKind = keyof typeof DOC_ROW_HEIGHTS

interface DocRowBase {
  /** v-for 的 key，跨分组全局唯一 */
  key: string
  kind: DocRowKind
  height: number
  groupId: string
  /**
   * 所属分组本身。行携带 group 而不是只带 id，是为了让视图不必按 id 回查当前 props：
   * 回查到的数组可能与扁平化时的下标不同代，从而让 Shift 连续多选选中错误的区间。
   */
  group: DocAssetGroup
}

export interface DocHeaderRow extends DocRowBase {
  kind: 'header'
  /** 该卡片当前是否折叠（搜索期间恒为 false） */
  collapsed: boolean
}

export interface DocSubheaderRow extends DocRowBase {
  kind: 'subheader'
}

export interface DocAssetRow extends DocRowBase {
  kind: 'asset'
  asset: AssetInfo
  /** 该资源在所属文档分组内的下标，供 Shift 连续多选定位使用 */
  indexInGroup: number
  /** 是否为所属卡片的最后一行，用于绘制卡片底边与圆角 */
  isLastInGroup: boolean
}

export interface DocGapRow extends DocRowBase {
  kind: 'gap'
}

export type DocRow = DocHeaderRow | DocSubheaderRow | DocAssetRow | DocGapRow

export interface BuildDocRowsOptions {
  collapsedDocIds?: Set<string>
  /** 非空搜索词会强制展开所有卡片，以便看到命中结果 */
  searchQuery?: string
}

/**
 * 把「按文档归类」的分组摊平成一维行序列，交给虚拟滚动只渲染视口内的行。
 *
 * 折叠状态直接体现在行序列里（折叠卡片不产生资源行），因此折叠一个万级资源
 * 的文档不是「隐藏一堆已渲染的节点」，而是真的不渲染它们。
 */
export function buildDocRows(
  groups: DocAssetGroup[],
  options: BuildDocRowsOptions = {},
): DocRow[] {
  const {
    collapsedDocIds,
    searchQuery = '',
  } = options
  const forceExpand = Boolean(searchQuery.trim())
  const rows: DocRow[] = []

  for (const group of groups) {
    const collapsed = !forceExpand && Boolean(collapsedDocIds?.has(group.id))

    rows.push({
      key: `h:${group.id}`,
      kind: 'header',
      height: DOC_ROW_HEIGHTS.header,
      groupId: group.id,
      group,
      collapsed,
    })

    if (collapsed) {
      rows.push({
        key: `g:${group.id}`,
        kind: 'gap',
        height: DOC_ROW_HEIGHTS.gap,
        groupId: group.id,
        group,
      })
      continue
    }

    if (group.assets.length > 0) {
      rows.push({
        key: `s:${group.id}`,
        kind: 'subheader',
        height: DOC_ROW_HEIGHTS.subheader,
        groupId: group.id,
        group,
      })
    }

    for (let i = 0; i < group.assets.length; i++) {
      rows.push({
        key: `a:${group.id}:${group.assets[i].name}`,
        kind: 'asset',
        height: DOC_ROW_HEIGHTS.asset,
        groupId: group.id,
        group,
        asset: group.assets[i],
        indexInGroup: i,
        isLastInGroup: i === group.assets.length - 1,
      })
    }

    rows.push({
      key: `g:${group.id}`,
      kind: 'gap',
      height: DOC_ROW_HEIGHTS.gap,
      groupId: group.id,
      group,
    })
  }

  return rows
}

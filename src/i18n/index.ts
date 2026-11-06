import zhCN from './zh_CN.json'
import { usePlugin } from '@/utils/plugin-context'

/**
 * 插件级 i18n 访问器。
 *
 * 思源内核（kernel/model/plugin.go）按用户语言设置读取 dist/i18n/<lang>.json，
 * 将唯一一份语言词条注入 plugin.i18n；因此本模块无需自行检测语言：
 * - 取值顺序：plugin.i18n[key]（内核解析后的当前语言）→ 内置 zh_CN.json（兜底，
 *   保证单测/未初始化场景返回现有中文文案）→ key 本身；任何情况下不抛错。
 * - 插值：{name} 占位符；英文复数词条值可为 { one, other } 对象（n===1 取 one）。
 *
 * 注意：不要把本模块并入 src/main.ts —— main 会挂载 App.vue 并拖入整个 UI
 * 运行时（见 plugin-context.ts 头注释）；本模块仅依赖 plugin-context，
 * 供 logger/deduplicate 等纯逻辑模块安全引用。
 *
 * 依赖约定：t() 必须在「使用时」调用（渲染、弹窗构造、抛错现场），
 * 不要在模块顶层求值 —— 模块加载早于 usePlugin()，会恒定落到中文兜底。
 */

export type I18nParams = Record<string, string | number>

/** 词条值：普通文案为字符串；英文需要复数区分时为 { one, other } */
export type I18nValue = string | { one: string; other: string }

const zhDict = zhCN as unknown as Record<string, I18nValue>

function pick(value: I18nValue, params?: I18nParams): string {
  if (typeof value === 'string') {
    return value
  }
  return params && params.n === 1 ? value.one : value.other
}

function interpolate(text: string, params?: I18nParams): string {
  if (!params) {
    return text
  }
  return text.replace(/\{(\w+)\}/g, (match, name: string) => {
    return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  })
}

export function t(key: string, params?: I18nParams): string {
  const plugin = usePlugin() as unknown as { i18n?: Record<string, unknown> } | null
  const remote = plugin?.i18n?.[key]
  const raw: unknown = typeof remote === 'string' || (remote && typeof remote === 'object')
    ? remote
    : zhDict[key] ?? key
  return interpolate(pick(raw as I18nValue, params), params)
}

/**
 * 宿主界面语言（BCP 47，如 zh-CN / en-US），取自思源全局配置。
 * 仅供无法走 plugin.i18n 词条表的第三方组件（如 tui-image-editor locale 选择）使用。
 */
export function getUiLang(): string {
  const lang = typeof window !== 'undefined'
    ? (window as unknown as { siyuan?: { config?: { lang?: string } } }).siyuan?.config?.lang
    : undefined
  return lang || 'zh-CN'
}

/** 宿主界面是否为中文（zh-CN / zh_TW 等均视为中文） */
export function isZhUi(): boolean {
  return getUiLang().startsWith('zh')
}

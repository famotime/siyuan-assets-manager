import { beforeEach, describe, expect, it } from 'vitest'
import enUS from '../src/i18n/en_US.json'
import zhCN from '../src/i18n/zh_CN.json'
import { t, getUiLang, isZhUi } from '../src/i18n'
import { usePlugin } from '../src/utils/plugin-context'

/** 与 src/i18n/index.ts 内部一致的词条值类型（zh 全为字符串） */
type I18nValue = string | { one: string; other: string }

const zhDict = zhCN as unknown as Record<string, I18nValue>
const enDict = enUS as unknown as Record<string, I18nValue>

/** 提取词条文本中的 {placeholder} 占位符集合 */
function placeholdersOf(value: I18nValue): Set<string> {
  const text = typeof value === 'string' ? value : `${value.one}\n${value.other}`
  return new Set(Array.from(text.matchAll(/\{(\w+)\}/g), m => m[1]))
}

describe('i18n dictionaries', () => {
  it('en_US and zh_CN expose exactly the same key set', () => {
    expect(Object.keys(enDict).sort()).toEqual(Object.keys(zhDict).sort())
  })

  it('zh_CN values are plain strings (no plural objects)', () => {
    for (const [key, value] of Object.entries(zhDict)) {
      expect(value, `zh_CN["${key}"]`).toBeTypeOf('string')
    }
  })

  it('en_US values are strings or {one, other} plural objects', () => {
    for (const [key, value] of Object.entries(enDict)) {
      const ok = typeof value === 'string'
        || (typeof value === 'object' && value !== null
          && typeof value.one === 'string' && typeof value.other === 'string')
      expect(ok, `en_US["${key}"]`).toBe(true)
    }
  })

  it('en_US placeholders match zh_CN placeholders for the same key', () => {
    for (const key of Object.keys(zhDict)) {
      expect(
        [...placeholdersOf(enDict[key])].sort(),
        `placeholder mismatch on "${key}"`,
      ).toEqual([...placeholdersOf(zhDict[key])].sort())
    }
  })
})

describe('t()', () => {
  beforeEach(() => {
    // 空词条表模拟单测环境（内核未注入语言包）→ 全部落到内置中文兜底
    usePlugin({ i18n: {} } as any)
  })

  it('falls back to bundled zh_CN text when plugin.i18n has no entry', () => {
    expect(t('common.delete')).toBe('删除')
  })

  it('prefers plugin.i18n (kernel-resolved language) over the fallback', () => {
    usePlugin({ i18n: { 'common.delete': 'Delete' } } as any)
    expect(t('common.delete')).toBe('Delete')
  })

  it('returns the key itself when both dictionaries miss', () => {
    expect(t('nope.missingKey')).toBe('nope.missingKey')
  })

  it('interpolates {name} placeholders from params', () => {
    usePlugin({ i18n: { 'x.greet': 'Hello {name}, {n} files' } } as any)
    expect(t('x.greet', { name: 'a.png', n: 3 })).toBe('Hello a.png, 3 files')
  })

  it('leaves unknown placeholders untouched', () => {
    usePlugin({ i18n: { 'x.greet': 'Hello {name}' } } as any)
    expect(t('x.greet')).toBe('Hello {name}')
  })

  it('supports {one, other} plural objects picked by params.n', () => {
    usePlugin({ i18n: { 'x.count': { one: '{n} file', other: '{n} files' } } } as any)
    expect(t('x.count', { n: 1 })).toBe('1 file')
    expect(t('x.count', { n: 5 })).toBe('5 files')
  })

  it('never throws when no plugin was ever registered', () => {
    // 本测试文件之前从未注册过插件时也必须安全（模块级 plugin 为 null）
    expect(() => t('common.delete')).not.toThrow()
  })
})

describe('language detection', () => {
  const originalLang = (window as any).siyuan?.config?.lang

  function setLang(lang: string | undefined) {
    ;(window as any).siyuan = (window as any).siyuan || {}
    ;(window as any).siyuan.config = (window as any).siyuan.config || {}
    ;(window as any).siyuan.config.lang = lang
  }

  it('maps en-US host language to non-Chinese UI', () => {
    setLang('en-US')
    expect(getUiLang()).toBe('en-US')
    expect(isZhUi()).toBe(false)
  })

  it('maps zh-CN host language to Chinese UI', () => {
    setLang('zh-CN')
    expect(isZhUi()).toBe(true)
  })
})

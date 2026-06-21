import { describe, expect, it } from 'vitest'
import pluginInfo from '../plugin.json'
import enUS from '../src/i18n/en_US.json'
import zhCN from '../src/i18n/zh_CN.json'

describe('project metadata', () => {
  it('does not expose template sample names in user-facing metadata', () => {
    expect(pluginInfo.url).toContain('siyuan-assets-manager')
    expect(enUS.addTopBarIcon).toBe('Assets Manager')
    expect(zhCN.addTopBarIcon).toBe('资源管家')
  })
})

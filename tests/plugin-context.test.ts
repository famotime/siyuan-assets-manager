import { describe, expect, it } from 'vitest'
import { usePlugin } from '../src/utils/plugin-context'

describe('plugin context', () => {
  it('stores the plugin instance and returns it on later reads', () => {
    const fakePlugin = { name: 'siyuan-assets-manager' } as any

    expect(usePlugin(fakePlugin)).toBe(fakePlugin)
    expect(usePlugin()).toBe(fakePlugin)
  })
})

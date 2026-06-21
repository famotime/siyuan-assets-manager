import { describe, expect, it } from 'vitest'
import {
  getAssetNameFromElement,
  getPluginAppElementId,
} from '../src/utils/plugin-entry'

describe('plugin entry helpers', () => {
  it('extracts asset names from src, child image, and closest data-src', () => {
    const direct = document.createElement('img')
    direct.setAttribute('src', '/assets/a.png?x=1#hash')
    expect(getAssetNameFromElement(direct)).toBe('a.png')

    const wrapper = document.createElement('span')
    const child = document.createElement('img')
    child.setAttribute('data-src', 'assets/nested.jpg')
    wrapper.appendChild(child)
    expect(getAssetNameFromElement(wrapper)).toBe('nested.jpg')

    const parent = document.createElement('div')
    parent.setAttribute('data-src', 'assets/parent.svg')
    const inner = document.createElement('span')
    parent.appendChild(inner)
    expect(getAssetNameFromElement(inner)).toBe('parent.svg')
  })

  it('returns null when an element has no asset source', () => {
    expect(getAssetNameFromElement(document.createElement('div'))).toBeNull()
  })

  it('builds stable plugin app element ids', () => {
    expect(getPluginAppElementId('siyuan-assets-manager')).toBe('siyuan-assets-manager-app')
  })
})

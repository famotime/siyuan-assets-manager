import { describe, expect, it } from 'vitest'
import {
  getAssetNameFromElement,
  getBlockIdFromElement,
  getPluginAppElementId,
} from '../src/utils/plugin-entry'

describe('plugin entry helpers', () => {
  it('extracts asset names from src, child image, closest data-src, and protyle img wrappers', () => {
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

    // Protyle 图像结构测试
    const protyleSpan = document.createElement('span')
    protyleSpan.setAttribute('data-type', 'img')
    protyleSpan.className = 'img'
    const protyleImg = document.createElement('img')
    protyleImg.setAttribute('data-src', 'assets/protyle%20image.png')
    protyleSpan.appendChild(protyleImg)
    expect(getAssetNameFromElement(protyleSpan)).toBe('protyle image.png')
  })

  it('returns null when an element has no asset source', () => {
    expect(getAssetNameFromElement(document.createElement('div'))).toBeNull()
  })

  it('extracts block ID from closest data-node-id', () => {
    const block = document.createElement('div')
    block.setAttribute('data-node-id', '20260815123456-abcdefg')
    const img = document.createElement('img')
    block.appendChild(img)

    expect(getBlockIdFromElement(img)).toBe('20260815123456-abcdefg')
    expect(getBlockIdFromElement(block)).toBe('20260815123456-abcdefg')
    expect(getBlockIdFromElement(document.createElement('span'))).toBeNull()
    expect(getBlockIdFromElement(null)).toBeNull()
  })

  it('builds stable plugin app element ids', () => {
    expect(getPluginAppElementId('siyuan-assets-manager')).toBe('siyuan-assets-manager-app')
  })
})

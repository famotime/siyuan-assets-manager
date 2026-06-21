import { describe, expect, it } from 'vitest'
import {
  buildEditedAssetName,
  resolveRenameAssetName,
} from '../src/utils/asset-actions'

describe('asset action helpers', () => {
  it('builds edited asset names from original extension and timestamp', () => {
    expect(buildEditedAssetName('image.png', 123)).toBe('image_edited_123.png')
    expect(buildEditedAssetName('noext', 123)).toBe('_edited_123.noext')
  })

  it('rejects empty and invalid rename values', () => {
    expect(resolveRenameAssetName('old.png', '   ', () => true)).toEqual({
      ok: false,
      reason: 'empty',
    })
    expect(resolveRenameAssetName('old.png', 'bad/name.png', () => true)).toEqual({
      ok: false,
      reason: 'invalidChars',
    })
  })

  it('keeps unchanged names and appends the old extension when omitted', () => {
    expect(resolveRenameAssetName('old.png', 'old.png', () => true)).toEqual({
      ok: true,
      changed: false,
      name: 'old.png',
    })
    expect(resolveRenameAssetName('old.png', 'new', () => true)).toEqual({
      ok: true,
      changed: true,
      name: 'new.png',
    })
  })

  it('requires confirmation when changing an existing extension', () => {
    expect(resolveRenameAssetName('old.png', 'new.jpg', () => false)).toEqual({
      ok: false,
      reason: 'extensionChangeCanceled',
    })
    expect(resolveRenameAssetName('old.png', 'new.jpg', () => true)).toEqual({
      ok: true,
      changed: true,
      name: 'new.jpg',
    })
  })
})

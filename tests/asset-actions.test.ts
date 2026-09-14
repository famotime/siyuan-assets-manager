import { describe, expect, it } from 'vitest'
import {
  buildEditedAssetName,
  resolveRenameAssetName,
} from '../src/utils/asset-actions'

describe('asset action helpers', () => {
  it('builds edited asset names from original extension and timestamp', () => {
    expect(buildEditedAssetName('image.png', 123)).toBe('image_edited_123.png')
    expect(buildEditedAssetName('image_edited_123.png', 456)).toBe('image_edited_456.png')
    expect(buildEditedAssetName('noext', 123)).toBe('_edited_123.noext')
  })

  it('rejects empty and invalid rename values', async () => {
    expect(await resolveRenameAssetName('old.png', '   ', async () => true)).toEqual({
      ok: false,
      reason: 'empty',
    })
    expect(await resolveRenameAssetName('old.png', 'bad/name.png', async () => true)).toEqual({
      ok: false,
      reason: 'invalidChars',
    })
  })

  it('keeps unchanged names and appends the old extension when omitted', async () => {
    expect(await resolveRenameAssetName('old.png', 'old.png', async () => true)).toEqual({
      ok: true,
      changed: false,
      name: 'old.png',
    })
    expect(await resolveRenameAssetName('old.png', 'new', async () => true)).toEqual({
      ok: true,
      changed: true,
      name: 'new.png',
    })
  })

  it('requires confirmation when changing an existing extension', async () => {
    expect(await resolveRenameAssetName('old.png', 'new.jpg', async () => false)).toEqual({
      ok: false,
      reason: 'extensionChangeCanceled',
    })
    expect(await resolveRenameAssetName('old.png', 'new.jpg', async () => true)).toEqual({
      ok: true,
      changed: true,
      name: 'new.jpg',
    })
  })
})

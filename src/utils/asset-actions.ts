export type RenameAssetNameResult =
  | {
    ok: true
    changed: boolean
    name: string
  }
  | {
    ok: false
    reason: 'empty' | 'invalidChars' | 'extensionChangeCanceled'
  }

export function buildEditedAssetName(oldName: string, timestamp: number = Date.now()): string {
  const ext = oldName.split('.').pop()
  const baseName = oldName.substring(0, oldName.lastIndexOf('.'))

  return `${baseName}_edited_${timestamp}.${ext || 'png'}`
}

export function resolveRenameAssetName(
  oldName: string,
  inputName: string,
  confirmExtensionChange: (oldExt: string, newExt: string) => boolean,
): RenameAssetNameResult {
  const oldExtIdx = oldName.lastIndexOf('.')
  const oldExt = oldExtIdx <= 0 ? '' : oldName.slice(oldExtIdx)

  let newName = inputName.trim()
  if (newName === oldName) {
    return {
      ok: true,
      changed: false,
      name: oldName,
    }
  }
  if (!newName) {
    return {
      ok: false,
      reason: 'empty',
    }
  }

  const invalidChars = /[\\/:*?"<>|]/
  if (invalidChars.test(newName)) {
    return {
      ok: false,
      reason: 'invalidChars',
    }
  }

  const newExtIdx = newName.lastIndexOf('.')
  const newExt = newExtIdx <= 0 ? '' : newName.slice(newExtIdx)

  if (newExt !== oldExt) {
    if (newExt) {
      const confirmed = confirmExtensionChange(oldExt, newExt)
      if (!confirmed) {
        return {
          ok: false,
          reason: 'extensionChangeCanceled',
        }
      }
    } else {
      newName = newName + oldExt
    }
  }

  return {
    ok: true,
    changed: true,
    name: newName,
  }
}

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
  let baseName = oldName.substring(0, oldName.lastIndexOf('.'))

  // 清除所有已存在的 _edited_\d+ 标记，防止多次编辑造成文件名套娃，始终仅体现最后一次编辑时间
  baseName = baseName.replace(/(_edited_\d+)+/g, '')

  return `${baseName}_edited_${timestamp}.${ext || 'png'}`
}

export async function resolveRenameAssetName(
  oldName: string,
  inputName: string,
  confirmExtensionChange: (oldExt: string, newExt: string) => Promise<boolean>,
): Promise<RenameAssetNameResult> {
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
      const confirmed = await confirmExtensionChange(oldExt, newExt)
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

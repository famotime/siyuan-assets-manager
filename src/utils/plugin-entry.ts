export function getPluginAppElementId(pluginName: string): string {
  return `${pluginName}-app`
}

export function getAssetNameFromElement(element: HTMLElement | null): string | null {
  if (!element) return null

  let src = element.getAttribute('src') || element.getAttribute('data-src')

  if (!src) {
    const img = element.querySelector('img')
    if (img) {
      src = img.getAttribute('src') || img.getAttribute('data-src')
    }
  }

  if (!src) {
    src = element.closest('[data-src]')?.getAttribute('data-src') || null
  }

  if (!src) return null

  const match = src.match(/assets\/([^\s"'()\]\?#]+)/)
  if (match) {
    return match[1]
  }

  if (src.includes('assets/')) {
    const parts = src.split('assets/')
    return parts[parts.length - 1].split('?')[0].split('#')[0]
  }

  return null
}

export function getPluginAppElementId(pluginName: string): string {
  return `${pluginName}-app`
}

export function getAssetNameFromElement(element: HTMLElement | null): string | null {
  if (!element) return null

  // 1. 直接读取属性
  let src =
    element.getAttribute('data-src') ||
    element.getAttribute('src') ||
    (element as any).dataset?.src

  // 2. 子元素 img 读取
  if (!src) {
    const img = element.querySelector('img')
    if (img) {
      src =
        img.getAttribute('data-src') ||
        img.getAttribute('src') ||
        (img as any).dataset?.src
    }
  }

  // 3. 父级或最近包裹元素读取
  if (!src) {
    const parentWithSrc =
      element.closest('[data-src]') ||
      element.closest('[src]') ||
      element.closest('.img') ||
      element.closest('[data-type="img"]')

    if (parentWithSrc) {
      src =
        parentWithSrc.getAttribute('data-src') ||
        parentWithSrc.getAttribute('src') ||
        parentWithSrc.querySelector('img')?.getAttribute('data-src') ||
        parentWithSrc.querySelector('img')?.getAttribute('src') ||
        null
    }
  }

  if (!src) return null

  // 尝试 URL 解码
  try {
    src = decodeURIComponent(src)
  } catch (e) {}

  if (src.includes('assets/')) {
    const parts = src.split('assets/')
    const after = parts[parts.length - 1]
    const clean = after.split('?')[0].split('#')[0].trim()
    const result = clean.replace(/^["']|["']$/g, '').replace(/\)$/, '')
    return result || null
  }

  return null
}

export function getBlockIdFromElement(element: HTMLElement | null): string | null {
  if (!element) return null

  // 1. 尝试直接从自身或最近的包含 data-node-id 的节点获取
  const blockEl =
    element.closest('[data-node-id]') ||
    element.closest('div[data-type="NodeParagraph"]') ||
    element.closest('.p') ||
    element.closest('.li')

  if (blockEl) {
    const id = blockEl.getAttribute('data-node-id')
    if (id) return id
  }

  // 2. 尝试从 dataset 读取
  if ((element as any).dataset?.nodeId) {
    return (element as any).dataset.nodeId
  }

  return null
}

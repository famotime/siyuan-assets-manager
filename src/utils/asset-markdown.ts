export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function extractAssetNamesFromMarkdown(markdown: string): string[] {
  const assets: string[] = []

  assets.push(...extractMarkdownLinkAssets(markdown))

  const barePathRegex = /(?:^|[\s"'])assets\/([^\s"'\]\?#]+)/g
  let bareMatch: RegExpExecArray | null
  while ((bareMatch = barePathRegex.exec(markdown)) !== null) {
    const assetName = bareMatch[1].replace(/[),.;:]+$/, '')
    assets.push(assetName)
  }

  return [...new Set(assets)]
}

function extractMarkdownLinkAssets(markdown: string): string[] {
  const assets: string[] = []
  const prefix = '](assets/'
  let searchFrom = 0

  while (searchFrom < markdown.length) {
    const start = markdown.indexOf(prefix, searchFrom)
    if (start === -1) break

    const assetStart = start + prefix.length
    const end = findMarkdownLinkTargetEnd(markdown, assetStart)
    if (end !== -1) {
      assets.push(stripAssetUrlSuffix(markdown.slice(assetStart, end)))
      searchFrom = end + 1
    } else {
      searchFrom = assetStart
    }
  }

  return assets
}

function findMarkdownLinkTargetEnd(markdown: string, assetStart: number): number {
  for (let i = assetStart; i < markdown.length; i++) {
    if (markdown[i] !== ')') continue

    const next = markdown[i + 1]
    if (!next || /\s/.test(next) || next === '{') {
      return i
    }
  }

  return -1
}

function stripAssetUrlSuffix(assetPath: string): string {
  return assetPath.split('?')[0].split('#')[0]
}

export function replaceAssetInMarkdown(markdown: string, oldAssetName: string, newAssetName: string): string {
  const regex = new RegExp(`assets/${escapeRegExp(oldAssetName)}`, 'g')
  return markdown.replace(regex, `assets/${newAssetName}`)
}

export function removeAssetFromMarkdown(markdown: string, assetName: string): string {
  const escapedName = escapeRegExp(assetName)
  const imgRegex = new RegExp(`!\\[.*?\\]\\(assets/${escapedName}\\)(\\{.*?\\})?`, 'g')
  const linkRegex = new RegExp(`\\[.*?\\]\\(assets/${escapedName}\\)(\\{.*?\\})?`, 'g')
  const pathRegex = new RegExp(`assets/${escapedName}`, 'g')

  return markdown
    .replace(imgRegex, '')
    .replace(linkRegex, '')
    .replace(pathRegex, '')
}

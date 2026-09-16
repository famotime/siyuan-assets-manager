export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function extractAssetNamesFromMarkdown(markdown: string): string[] {
  const assets: string[] = []

  for (const raw of extractMarkdownLinkAssets(markdown)) {
    assets.push(...cleanAndDecodeAssetName(raw))
  }

  const barePathRegex = /(?:^|[\s"'])assets\/([^\s"'\]\?#]+)/g
  let bareMatch: RegExpExecArray | null
  while ((bareMatch = barePathRegex.exec(markdown)) !== null) {
    assets.push(...cleanAndDecodeAssetName(bareMatch[1]))
  }

  return [...new Set(assets.filter(Boolean))]
}

function cleanAndDecodeAssetName(rawPath: string): string[] {
  if (!rawPath) return []
  // 截断空格及后续可能的 title（例如 "image.png" 或 'title'）
  let clean = rawPath.trim().split(/\s+/)[0] || ''
  // 剥离 query 与 hash 参数
  clean = clean.split('?')[0].split('#')[0]
  // 剥离两端可能包裹的引号及尾部标点
  clean = clean.replace(/^['"]+|['"]+$/g, '').replace(/[),.;:]+$/, '')
  if (!clean) return []

  const names = [clean]
  try {
    const decoded = decodeURIComponent(clean)
    if (decoded && decoded !== clean) {
      names.push(decoded)
    }
  } catch (e) {}

  return names
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
      assets.push(markdown.slice(assetStart, end))
      searchFrom = end + 1
    } else {
      searchFrom = assetStart
    }
  }

  return assets
}

/**
 * 定位 Markdown 链接目标的结束位置（即 `](assets/` 之后第一个"未被括号配平"的 `)`）。
 *
 * 不能简单地取"后一个字符是空白/`{`/结尾"的 `)`：思源导出的 Markdown 里，
 * 行内图片后面可以直接跟文字、标点或另一张图片（如 `这是![图](assets/x.png)文字`、`![a](assets/x.png)![b](assets/y.png)`），
 * 这类引用会被整条漏掉。
 *
 * 改为按 CommonMark 规则配平括号：文件名本身可以包含 `)`（如 `a(1).png`），
 * 只有深度归零的那个 `)` 才是目标结束符；目标中不允许出现空白，遇到空白同样视为结束。
 */
function findMarkdownLinkTargetEnd(markdown: string, assetStart: number): number {
  let depth = 0

  for (let i = assetStart; i < markdown.length; i++) {
    const char = markdown[i]

    if (char === '(') {
      depth++
    } else if (char === ')') {
      if (depth === 0) {
        return i
      }
      depth--
    } else if (/\s/.test(char)) {
      return i
    }
  }

  return -1
}

export function replaceAssetInMarkdown(markdown: string, oldAssetName: string, newAssetName: string): string {
  let res = markdown
  // 若包含中文或特殊字符，同步支持被 URI 编码过的旧名称替换
  try {
    const encodedOld = encodeURIComponent(oldAssetName)
    if (encodedOld !== oldAssetName) {
      const encRegex = new RegExp(`assets/${escapeRegExp(encodedOld)}`, 'g')
      res = res.replace(encRegex, `assets/${newAssetName}`)
    }
  } catch (e) {}

  const regex = new RegExp(`assets/${escapeRegExp(oldAssetName)}`, 'g')
  return res.replace(regex, `assets/${newAssetName}`)
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

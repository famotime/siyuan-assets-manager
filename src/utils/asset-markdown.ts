export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function extractAssetNamesFromMarkdown(markdown: string): string[] {
  const assets: string[] = []

  for (const raw of extractMarkdownLinkAssets(markdown)) {
    assets.push(...cleanAndDecodeAssetName(raw))
  }

  // 引号包裹的路径（HTML 属性形式，如 src="assets/x.png"）按配对的引号收尾。
  // 思源对视频/音频/HTML 块导出的就是这种形式，文件名里的单引号、方括号
  // 不能被当成终止符，否则会截出一个并不存在的名字，把资源误判成孤儿。
  const quotedPathRegex = /(["'])assets\/(.*?)\1/g
  let quotedMatch: RegExpExecArray | null
  while ((quotedMatch = quotedPathRegex.exec(markdown)) !== null) {
    assets.push(...cleanAndDecodeAssetName(quotedMatch[2]))
  }

  // 裸路径只认行首/空白分隔的情形；引号包裹的已经由上面的 quotedPathRegex 处理，
  // 交叠匹配会因字符集把 it's.png 这类名字截成 "it"，产生指向不存在文件的假名字
  const barePathRegex = /(?:^|\s)assets\/([^\s"'\]\?#]+)/g
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

/**
 * 资源路径合法终止符断言：必须紧跟闭合括号、引号、空白、URL 参数/哈希、属性块、HTML 标签结束、中英文标点或文本结尾。
 * 避免如 `pic.png` 误替换 `pic.png.bak` 或 `pic.png_thumb.jpg` 等具有相同前缀的文件名。
 */
const ASSET_PATH_TERMINATOR = '(?=[)"\'\\s?#{}\\]>，。、；：！？,!;:|]|$)'

export function replaceAssetInMarkdown(markdown: string, oldAssetName: string, newAssetName: string): string {
  let res = markdown
  // 若包含中文或特殊字符，同步支持被 URI 编码过的旧名称替换
  try {
    const encodedOld = encodeURIComponent(oldAssetName)
    if (encodedOld !== oldAssetName) {
      const encRegex = new RegExp(`assets/${escapeRegExp(encodedOld)}${ASSET_PATH_TERMINATOR}`, 'g')
      res = res.replace(encRegex, `assets/${newAssetName}`)
    }
  } catch (e) {}

  const regex = new RegExp(`assets/${escapeRegExp(oldAssetName)}${ASSET_PATH_TERMINATOR}`, 'g')
  return res.replace(regex, `assets/${newAssetName}`)
}

export function removeAssetFromMarkdown(markdown: string, assetName: string): string {
  const escapedName = escapeRegExp(assetName)

  // 思源把视频/音频/HTML 块导出为 <video src="assets/x.mp4"></video> 这类标签，
  // 只靠 pathRegex 抹路径会在正文里留下 <video src=""></video> 这样的空播放器。
  // 这里在 src 命中资源时整段移除元素；data-src 只是思源记录的原始文件名，
  // 用 (?<![-\w]) 把它排除在外，删掉原始底图时不应连播放器一起删。
  // 成对标签内部允许存在 fallback 说明文字（如“浏览器不支持播放”）或子元素，整段移除。
  const htmlSrcAttr = `(?<![-\\w])src=["']assets/${escapedName}["']`
  const htmlPairedRegex = new RegExp(
    `<([a-zA-Z][\\w-]*)\\b[^>]*?${htmlSrcAttr}[^>]*>[\\s\\S]*?</\\1>`,
    'g',
  )
  const htmlVoidRegex = new RegExp(`<[a-zA-Z][\\w-]*\\b[^>]*?${htmlSrcAttr}[^>]*/?>`, 'g')

  const imgRegex = new RegExp(`!\\[.*?\\]\\(assets/${escapedName}\\)(\\{.*?\\})?`, 'g')
  const linkRegex = new RegExp(`\\[.*?\\]\\(assets/${escapedName}\\)(\\{.*?\\})?`, 'g')
  const pathRegex = new RegExp(`assets/${escapedName}`, 'g')

  return markdown
    .replace(htmlPairedRegex, '')
    .replace(htmlVoidRegex, '')
    .replace(imgRegex, '')
    .replace(linkRegex, '')
    .replace(pathRegex, '')
}

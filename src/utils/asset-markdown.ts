export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function unescapeHtmlEntities(str: string): string {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/**
 * 规范化资源扫描链接目标，对齐思源官方 Go `normalizeAssetScanLinkDest`:
 * 按编辑器的根路径解析本地引用，保留 URL 后缀和文件名编码，安全排除逃逸与外部链接。
 */
export function normalizeAssetScanLinkDest(dest: string): string {
  dest = (dest || '').trim()
  if (!dest || dest.startsWith('//') || dest.includes('\\')) {
    return ''
  }

  // 排除外部协议 (http:, https:, data:, ftp:, etc.)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(dest)) {
    return ''
  }

  // 保留历史数据中按字面量存储的百分号文件名，解析仅用于排除外部主机。
  try {
    const testUrl = new URL(dest.replace(/%/g, '%25'), 'http://virtual-local-origin')
    if (testUrl.origin !== 'http://virtual-local-origin' || (testUrl.host && testUrl.host !== 'virtual-local-origin')) {
      return ''
    }
  } catch {
    return ''
  }

  let suffix = ''
  const queryHashIdx = dest.search(/[?#]/)
  if (queryHashIdx >= 0) {
    suffix = dest.slice(queryHashIdx)
    dest = dest.slice(0, queryHashIdx)
  }

  // 浏览器将编码的点路径段视为导航，其他编码留给资源查找处理。
  const parts = dest.split('/')
  for (let i = 0; i < parts.length; i++) {
    try {
      const decoded = decodeURIComponent(parts[i])
      if (decoded === '.' || decoded === '..') {
        parts[i] = decoded
      }
    } catch {}
  }
  dest = parts.join('/')
  const isDirectory = dest.endsWith('/') || dest.endsWith('/.') || dest.endsWith('/..')

  // 对齐 Go 的 path.Clean("/" + dest)，以 "/" 为虚拟根目录进行规范化
  const cleanSegments: string[] = []
  const rawSegments = ('/' + dest).split('/')
  for (const seg of rawSegments) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      if (cleanSegments.length > 0) {
        cleanSegments.pop()
      }
    } else {
      cleanSegments.push(seg)
    }
  }
  dest = cleanSegments.join('/')
  if (isDirectory) {
    dest += '/'
  }

  if (!dest.startsWith('assets/')) {
    return ''
  }
  return dest + suffix
}

/**
 * 分离 PDF 标注引用的母体 PDF 地址与标注 ID，对齐思源官方 Go `util.SplitFileAnnotationRef`:
 * 保留母体资源地址的查询参数及片段，不改变已有引用的编码。
 */
export function splitFileAnnotationRef(reference: string): { assetLink: string; annotationId: string } | null {
  reference = (reference || '').trim()
  const pathEnd = reference.search(/[?#]/)
  const end = pathEnd < 0 ? reference.length : pathEnd
  const path = reference.slice(0, end)
  const separator = path.lastIndexOf('/')
  if (separator < 0) return null

  const parentPath = path.slice(0, separator)
  const annotationId = path.slice(separator + 1)

  if (!parentPath.toLowerCase().endsWith('.pdf')) {
    return null
  }
  // 思源节点 ID 规范 (ast.IsNodeIDPattern): 14位数字时间戳-7位字母数字 (如 20260912000000-abcdefg)
  if (!/^\d{14}-[a-z0-9]{7}$/i.test(annotationId)) {
    return null
  }

  return {
    assetLink: parentPath + reference.slice(end),
    annotationId,
  }
}

/** 匹配本地 assets 链接的前缀（支持根路径、当前相对路径、上级相对路径、URL 编码点路径） */
const ASSET_PREFIX_REGEX_STR = '(?:(?:\\.\\.\\/|\\.\\/|\\/|%2e%2e\\/|%2E%2E\\/)+)?'

export function extractAssetNamesFromMarkdown(markdown: string): string[] {
  if (!markdown) return []
  const assets: string[] = []

  // 1. 常规 Markdown 括号链接：](...)，支持相对前缀、点路径导航与参数
  for (const raw of extractMarkdownLinkAssets(markdown)) {
    assets.push(...cleanAndDecodeAssetName(raw))
  }

  // 解码 HTML 实体（针对 IAL 属性中的 title-img、inline-memo 等）
  const normalized = unescapeHtmlEntities(markdown)

  // 2. 引号包裹的路径（HTML 属性形式，如 src="...assets/x.png", poster="...", data-assets="..."）
  // 允许文件名包含另一种引号（如双引号包裹中含单引号 "assets/it's.png"）
  const quotedPathRegex = new RegExp(`(["'])(${ASSET_PREFIX_REGEX_STR}assets\\/(?:(?!\\1)[^\\r\\n])+?)\\1`, 'gi')
  let quotedMatch: RegExpExecArray | null
  while ((quotedMatch = quotedPathRegex.exec(normalized)) !== null) {
    assets.push(...cleanAndDecodeAssetName(quotedMatch[2]))
  }

  // 3. CSS url(...) 形式（如 background-image: url("...assets/x.png") 或 url(/data/assets/x.png)）
  const cssUrlRegex = new RegExp(`url\\(\\s*(?:['"]?)((?:${ASSET_PREFIX_REGEX_STR}|(?:\\/data\\/))assets\\/[^'")]+?)(?:['"]?)\\s*\\)`, 'gi')
  let urlMatch: RegExpExecArray | null
  while ((urlMatch = cssUrlRegex.exec(normalized)) !== null) {
    assets.push(...cleanAndDecodeAssetName(urlMatch[1]))
  }

  // 4. 思源标注形如 <<...assets/doc.pdf/... "anchor">>
  const annotSyntaxRegex = new RegExp(`<<\\s*(${ASSET_PREFIX_REGEX_STR}assets\\/[^\\s"]+?)(?:\\s+"[^"]*")?\\s*>>`, 'gi')
  let annotMatch: RegExpExecArray | null
  while ((annotMatch = annotSyntaxRegex.exec(normalized)) !== null) {
    assets.push(...cleanAndDecodeAssetName(annotMatch[1]))
  }

  // 5. 裸路径：认行首/空白/思源标注分隔的情形
  const barePathRegex = new RegExp(`(?:^|[\\s<])(${ASSET_PREFIX_REGEX_STR}assets\\/[^\\s"'\\]\\?#>]+)`, 'gi')
  let bareMatch: RegExpExecArray | null
  while ((bareMatch = barePathRegex.exec(normalized)) !== null) {
    let rawVal = bareMatch[1]
    if (rawVal.startsWith('<')) {
      rawVal = rawVal.replace(/^<+/, '')
    }
    assets.push(...cleanAndDecodeAssetName(rawVal))
  }

  return [...new Set(assets.filter(Boolean))]
}

function cleanAndDecodeAssetName(rawPath: string): string[] {
  if (!rawPath) return []
  let clean = rawPath.trim()

  // 剥离两端可能包裹的引号
  clean = clean.replace(/^['"]+|['"]+$/g, '')

  // 截断空格及后续可能的 title（例如 "image.png" 或 'title'）
  clean = clean.split(/\s+/)[0] || ''

  // 先通过官方归一化处理（若包含相对前缀，归一化为以 assets/ 开头）
  const norm = normalizeAssetScanLinkDest(clean)
  if (norm) {
    clean = norm
  }

  // 检查是否为 PDF 标注锚点引用，提取出真实的母体 PDF 文件名
  const annotRef = splitFileAnnotationRef(clean)
  if (annotRef) {
    clean = annotRef.assetLink
  } else {
    const pdfAnnotationMatch = clean.match(/^(.+?\.pdf)\/(\d{14}-[a-z0-9]{7}|[a-zA-Z0-9_-]+)(?:[?#].*)?$/i)
    if (pdfAnnotationMatch) {
      clean = pdfAnnotationMatch[1]
    }
  }

  // 剥离 query 与 hash 参数
  const isDirectory = clean.endsWith('/')
  clean = clean.split('?')[0].split('#')[0]

  // 剥离开头的 assets/ 或 /data/assets/ 或相对前缀
  clean = clean.replace(/^(?:(?:\.\.\/|\.\/|\/|%2e%2e\/|%2E%2E\/)+|(?:\/data\/))?assets\//i, '')

  // 剥离尾部标点（保留目录的尾斜杠）
  if (!isDirectory) {
    clean = clean.replace(/[),.;:]+$/, '')
  }
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
  let searchFrom = 0

  while (searchFrom < markdown.length) {
    const start = markdown.indexOf('](', searchFrom)
    if (start === -1) break

    const assetStart = start + 2
    const end = findMarkdownLinkTargetEnd(markdown, assetStart)
    if (end !== -1) {
      const rawTarget = markdown.slice(assetStart, end).trim()
      const norm = normalizeAssetScanLinkDest(rawTarget)
      if (norm) {
        assets.push(norm)
      } else if (rawTarget.includes('assets/')) {
        assets.push(rawTarget)
      }
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
const ASSET_PATH_TERMINATOR = '(?=[)"\'\\s?#{}\\]>，。、；：！？,!;:|/]|$)'

/** 构造资源路径匹配正则；替换、计数、限量替换必须共用同一套匹配语义 */
function buildAssetPathRegex(assetName: string): RegExp {
  return new RegExp(`assets/${escapeRegExp(assetName)}${ASSET_PATH_TERMINATOR}`, 'g')
}

export function safeEncodeURIComponent(value: string): string {
  try {
    return encodeURIComponent(value)
  } catch (e) {
    return value
  }
}

export function replaceAssetInMarkdown(markdown: string, oldAssetName: string, newAssetName: string): string {
  let res = markdown
  // 若包含中文或特殊字符，同步支持被 URI 编码过的旧名称替换
  const encodedOld = safeEncodeURIComponent(oldAssetName)
  if (encodedOld !== oldAssetName) {
    res = res.replace(buildAssetPathRegex(encodedOld), `assets/${newAssetName}`)
  }
  return res.replace(buildAssetPathRegex(oldAssetName), `assets/${newAssetName}`)
}

/**
 * 统计文本中某资源的引用处数（原始名 + URI 编码名，与 {@link replaceAssetInMarkdown} 同语义）
 */
export function countAssetOccurrences(text: string, assetName: string): number {
  if (!text || !assetName) return 0

  let count = 0
  const encoded = safeEncodeURIComponent(assetName)
  if (encoded !== assetName) {
    count += (text.match(buildAssetPathRegex(encoded)) || []).length
  }
  count += (text.match(buildAssetPathRegex(assetName)) || []).length
  return count
}

/**
 * 限量替换：只替换前 `limit` 处引用。
 *
 * 用于"目标文本已被用户改动过"时的近似逆向还原：逆向只能按原文中的引用处数
 * 逐个改回，避免把文本里本来就存在的同名引用一并改错（过还原）。
 */
export function replaceAssetInMarkdownLimited(
  markdown: string,
  oldAssetName: string,
  newAssetName: string,
  limit: number,
): string {
  if (!markdown || !oldAssetName || limit <= 0) return markdown

  let remaining = limit
  const replaceUpTo = (text: string, name: string): string => {
    if (remaining <= 0) return text
    return text.replace(buildAssetPathRegex(name), (match) => {
      if (remaining <= 0) return match
      remaining--
      return `assets/${newAssetName}`
    })
  }

  let res = markdown
  const encodedOld = safeEncodeURIComponent(oldAssetName)
  if (encodedOld !== oldAssetName) {
    res = replaceUpTo(res, encodedOld)
  }
  return replaceUpTo(res, oldAssetName)
}

function removeAssetFromMarkdownSingle(markdown: string, assetName: string): string {
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

export function removeAssetFromMarkdown(markdown: string, assetName: string): string {
  let res = removeAssetFromMarkdownSingle(markdown, assetName)
  const encoded = safeEncodeURIComponent(assetName)
  if (encoded !== assetName) {
    res = removeAssetFromMarkdownSingle(res, encoded)
  }
  return res
}

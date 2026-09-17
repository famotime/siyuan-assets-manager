import { sql } from '../api';
import { defaultStorage, blobToText } from './storage';
import { extractAssetNamesFromMarkdown, escapeRegExp } from './asset-markdown';
import { type BlockRef, formatReadableDocPath } from './siyuan-db';
import { log, warn, error } from './logger';

/** 思源数据库（属性视图）文件存储目录 */
export const ATTRIBUTE_VIEW_STORAGE_DIR = '/data/storage/av';

export interface AttributeViewAssetRef {
  assetName: string;
  avId: string;
  avName?: string;
  keyId?: string;
  keyName?: string;
  blockId?: string;
}

/**
 * 从数据库块的 markdown 或 ial 中提取所关联的 avID
 */
export function extractAvIdFromBlock(block: { markdown?: string; ial?: string; id?: string }): string | null {
  if (!block) return null;

  // 1. 优先从 markdown 的 <div data-type="NodeAttributeView" data-av-id="..." 提取
  if (block.markdown) {
    const match = block.markdown.match(/data-av-id=["']([^"']+)["']/);
    if (match && match[1]) {
      return match[1];
    }
  }

  // 2. 尝试从 ial 中提取 (支持 data-av-id, custom-av-id, av-id 等形式)
  if (block.ial) {
    const ialMatch = block.ial.match(/(?:data-av-id|custom-av-id|av-id)=["']([^"']+)["']/);
    if (ialMatch && ialMatch[1]) {
      return ialMatch[1];
    }
  }

  return null;
}

/**
 * 从属性视图 JSON 文本中提取所有引用的资产信息
 * 既进行结构化解析以提取列名、视图名等富语义信息，
 * 也对整个 JSON 进行保底正则全量扫描，防止任何字段遗漏。
 */
export function extractAssetsFromAttributeViewJson(jsonContent: string): {
  assetNames: string[];
  detailedRefs: AttributeViewAssetRef[];
  avId?: string;
  avName?: string;
} {
  const assetSet = new Set<string>();
  const detailedRefs: AttributeViewAssetRef[] = [];
  let avId: string | undefined;
  let avName: string | undefined;

  if (!jsonContent || typeof jsonContent !== 'string') {
    return { assetNames: [], detailedRefs };
  }

  // 1. 结构化解析
  try {
    const parsed = JSON.parse(jsonContent);
    if (parsed && typeof parsed === 'object') {
      avId = parsed.id;
      avName = parsed.name;

      if (Array.isArray(parsed.keyValues)) {
        for (const kv of parsed.keyValues) {
          const keyInfo = kv?.key || {};
          const keyId = keyInfo.id;
          const keyName = keyInfo.name;
          const values = Array.isArray(kv?.values) ? kv.values : [];

          for (const val of values) {
            const rowBlockId = val?.blockID || val?.itemID || val?.id;

            // 1.1 处理 mAsset 资源列表
            if (Array.isArray(val?.mAsset)) {
              for (const assetItem of val.mAsset) {
                const rawContent = assetItem?.content;
                if (typeof rawContent === 'string') {
                  const names = extractAssetNamesFromMarkdown(rawContent);
                  for (const name of names) {
                    assetSet.add(name);
                    detailedRefs.push({
                      assetName: name,
                      avId: avId || '',
                      avName,
                      keyId,
                      keyName,
                      blockId: rowBlockId,
                    });
                  }
                }
              }
            }

            // 1.2 处理普通文本或富文本单元格里的 assets 引用
            if (typeof val?.content === 'string') {
              const names = extractAssetNamesFromMarkdown(val.content);
              for (const name of names) {
                assetSet.add(name);
                detailedRefs.push({
                  assetName: name,
                  avId: avId || '',
                  avName,
                  keyId,
                  keyName,
                  blockId: rowBlockId,
                });
              }
            }
          }
        }
      }
    }
  } catch (parseErr) {
    warn('[attribute-view] JSON 结构化解析失败，将使用保底正则扫描:', parseErr);
  }

  // 2. 全文保底正则扫描：保证 JSON 中无论哪个未知属性或自定义视图包含 assets/ 都不漏扫
  const fallbackNames = extractAssetNamesFromMarkdown(jsonContent);
  for (const name of fallbackNames) {
    if (!assetSet.has(name)) {
      assetSet.add(name);
      detailedRefs.push({
        assetName: name,
        avId: avId || '',
        avName,
      });
    }
  }

  return {
    assetNames: Array.from(assetSet),
    detailedRefs,
    avId,
    avName,
  };
}

/**
 * 获取思源中所有嵌入了数据库的块 (type = 'av')
 */
export async function queryAllAttributeViewBlocks(): Promise<any[]> {
  try {
    const blocks: any[] = await sql(
      `SELECT id, root_id, box, content, markdown, path, hpath, ial FROM blocks WHERE type = 'av' LIMIT 10000`
    );
    return Array.isArray(blocks) ? blocks : [];
  } catch (err) {
    warn('[attribute-view] 查询数据库块 (type = av) 失败:', err);
    return [];
  }
}

/**
 * 扫描并解析工作空间内所有的属性视图文件，构建 资产名 -> BlockRef[] 的映射
 */
export async function resolveAttributeViewReferences(
  notebookMap: Map<string, string> = new Map()
): Promise<Map<string, BlockRef[]>> {
  const assetToRefsMap = new Map<string, BlockRef[]>();

  try {
    // 1. 列出并读取所有的属性视图 JSON 文件
    const entries = await defaultStorage.list(ATTRIBUTE_VIEW_STORAGE_DIR);
    const jsonFiles = entries.filter((e) => !e.isDir && e.name.endsWith('.json'));
    if (jsonFiles.length === 0) {
      return assetToRefsMap;
    }

    // 2. 查询所有的数据库嵌入块 (type = 'av') 并按 avID 建立映射
    const avBlocks = await queryAllAttributeViewBlocks();
    const avIdToBlocksMap = new Map<string, any[]>();

    for (const block of avBlocks) {
      const avId = extractAvIdFromBlock(block);
      if (avId) {
        let list = avIdToBlocksMap.get(avId);
        if (!list) {
          list = [];
          avIdToBlocksMap.set(avId, list);
        }
        list.push(block);
      }
    }

    // 3. 逐一读取并解析每个数据库文件
    for (const file of jsonFiles) {
      const filePath = `${ATTRIBUTE_VIEW_STORAGE_DIR}/${file.name}`;
      const blob = await defaultStorage.read(filePath);
      if (!blob) continue;

      const text = await blobToText(blob);
      if (!text) continue;

      const parsed = extractAssetsFromAttributeViewJson(text);
      const avIdFromFile = file.name.replace(/\.json$/, '');
      const currentAvId = parsed.avId || avIdFromFile;
      const hostBlocks = avIdToBlocksMap.get(currentAvId) || [];

      // 4. 将提取出的每个资产关联到其所在的宿主文档块或独立数据库
      for (const assetName of parsed.assetNames) {
        let refs = assetToRefsMap.get(assetName);
        if (!refs) {
          refs = [];
          assetToRefsMap.set(assetName, refs);
        }

        // 查找此资产关联的列信息（用于在引用详情中显示友好的列名提示）
        const matchedDetail = parsed.detailedRefs.find((r) => r.assetName === assetName);
        const colSuffix = matchedDetail?.keyName ? ` (${matchedDetail.keyName})` : '';
        const avTitle = parsed.avName ? `[数据库] ${parsed.avName}${colSuffix}` : `[数据库] ${currentAvId}${colSuffix}`;

        if (hostBlocks.length > 0) {
          // 如果该数据库被一个或多个文档块嵌入，为每个嵌入块生成引用
          for (const block of hostBlocks) {
            const boxName = notebookMap.get(block.box) || '';
            const readablePath = formatReadableDocPath(boxName, block.hpath, block.path);

            if (!refs.some((r) => r.id === block.id)) {
              refs.push({
                id: block.id,
                root_id: block.root_id,
                box: block.box,
                content: avTitle,
                markdown: block.markdown || '',
                path: block.path,
                hpath: block.hpath,
                boxName,
                readablePath,
              });
            }
          }
        } else {
          // 独立数据库（未嵌入文档，或文档载体被移除但数据库定义仍存）：
          // 生成独立数据库专用 BlockRef，确保引用数 > 0，杜绝误判孤儿！
          const fakeRefId = `av-${currentAvId}`;
          if (!refs.some((r) => r.id === fakeRefId)) {
            refs.push({
              id: fakeRefId,
              root_id: fakeRefId,
              box: '',
              content: parsed.avName ? `[独立数据库] ${parsed.avName}${colSuffix}` : `[独立数据库] ${currentAvId}${colSuffix}`,
              markdown: '',
              path: '',
              boxName: '数据库',
              readablePath: `数据库 / ${parsed.avName || currentAvId}`,
            });
          }
        }
      }
    }
  } catch (err) {
    error('[attribute-view] 解析属性视图引用失败:', err);
  }

  return assetToRefsMap;
}

/**
 * 当资产被重命名时，原子更新所有属性视图 JSON 文件中包含该资产的路径
 * @param oldAssetName 旧资源文件名 (如 "foo.png")
 * @param newAssetName 新资源文件名 (如 "foo_new.png")
 * @returns 成功更新的属性视图文件数量
 */
export async function replaceAssetInAttributeViews(oldAssetName: string, newAssetName: string): Promise<number> {
  if (!oldAssetName || !newAssetName || oldAssetName === newAssetName) {
    return 0;
  }

  let updatedCount = 0;

  try {
    const entries = await defaultStorage.list(ATTRIBUTE_VIEW_STORAGE_DIR);
    const jsonFiles = entries.filter((e) => !e.isDir && e.name.endsWith('.json'));

    const oldEscaped = escapeRegExp(oldAssetName);
    let oldEncoded = '';
    try {
      oldEncoded = escapeRegExp(encodeURIComponent(oldAssetName));
    } catch (e) {}

    // 匹配 assets/foo.png 及其可能的 URI 编码格式
    const regexOld = new RegExp(`assets/${oldEscaped}(?=[)"'\\s?#{}\\]>,;!]|\$)`, 'g');
    const regexEncoded = oldEncoded && oldEncoded !== oldEscaped
      ? new RegExp(`assets/${oldEncoded}(?=[)"'\\s?#{}\\]>,;!]|\$)`, 'g')
      : null;

    for (const file of jsonFiles) {
      const filePath = `${ATTRIBUTE_VIEW_STORAGE_DIR}/${file.name}`;
      const blob = await defaultStorage.read(filePath);
      if (!blob) continue;

      const text = await blobToText(blob);
      if (!text) continue;

      let replacedText = text;
      let matched = false;

      if (regexOld.test(replacedText)) {
        replacedText = replacedText.replace(regexOld, `assets/${newAssetName}`);
        matched = true;
      }
      if (regexEncoded && regexEncoded.test(replacedText)) {
        replacedText = replacedText.replace(regexEncoded, `assets/${newAssetName}`);
        matched = true;
      }

      if (matched) {
        const newBlob = new Blob([replacedText], { type: 'application/json' });
        await defaultStorage.write(filePath, newBlob);
        updatedCount++;
        log(`[attribute-view] 成功更新数据库文件中的资源路径: ${file.name} (${oldAssetName} -> ${newAssetName})`);
      }
    }
  } catch (err) {
    error('[attribute-view] 更新数据库资源引用失败:', err);
  }

  return updatedCount;
}

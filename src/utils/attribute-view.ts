import { t } from '@/i18n';
import { sql } from '../api';
import { defaultStorage, blobToText } from './storage';
import { extractAssetNamesFromMarkdown, escapeRegExp, removeAssetFromMarkdown } from './asset-markdown';
import { restoreAssetReference } from './inverse-reference';
import { type BlockRef, formatReadableDocPath } from './asset-model';
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

            // 1.3 处理 URL 列中的 assets 引用（对齐思源官方 getAttributeViewValueAssetsLinkDests 中的 value.URL）
            if (val?.url && typeof val.url.content === 'string') {
              const names = extractAssetNamesFromMarkdown(val.url.content);
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
 * 列出属性视图存储目录下的全部 JSON 文件条目
 * （收敛原先在 5 个函数中逐字重复的 list + filter 样板）
 */
async function listAttributeViewJsonFiles(): Promise<Array<{ name: string, isDir: boolean }>> {
  const entries = await defaultStorage.list(ATTRIBUTE_VIEW_STORAGE_DIR);
  return entries.filter((e) => !e.isDir && e.name.endsWith('.json'));
}

/**
 * 读取单个属性视图文件文本；文件缺失或内容为空时返回 null
 * （收敛 read → blobToText → 空值跳过样板）
 */
async function readAttributeViewText(filePath: string): Promise<string | null> {
  const blob = await defaultStorage.read(filePath);
  if (!blob) return null;
  const text = await blobToText(blob);
  return text || null;
}

/** 按原文件缩进风格序列化并写回属性视图文件（收敛 fileChanged 收尾样板） */
async function writeAttributeViewJson(filePath: string, parsed: any, originalText: string): Promise<void> {
  const nextText = serializeLikeOriginal(parsed, originalText);
  await defaultStorage.write(filePath, new Blob([nextText], { type: 'application/json' }));
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
    const jsonFiles = await listAttributeViewJsonFiles();
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
      const text = await readAttributeViewText(filePath);
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
        const avTitle = parsed.avName ? t('av.dbRefTitle', { name: `${parsed.avName}${colSuffix}` }) : t('av.dbRefTitle', { name: `${currentAvId}${colSuffix}` });

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
              content: parsed.avName ? t('av.standaloneDbRefTitle', { name: `${parsed.avName}${colSuffix}` }) : t('av.standaloneDbRefTitle', { name: `${currentAvId}${colSuffix}` }),
              markdown: '',
              path: '',
              boxName: t('av.databaseBoxName'),
              readablePath: t('av.standaloneReadablePath', { name: parsed.avName || currentAvId }),
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
    const jsonFiles = await listAttributeViewJsonFiles();

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
      const text = await readAttributeViewText(filePath);
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

/**
 * 从所有属性视图 JSON 文件中移除指定资产的引用（删除资源场景，与重命名的
 * replaceAssetInAttributeViews 对偶）。
 *
 * - 文本/URL 单元格：仅抹除资源引用片段，保留其余内容；
 * - mAsset 资源项：整项内容就是资源引用，清理后为空则移除该项。
 *
 * @returns 成功更新的属性视图文件数量
 */
export async function removeAssetFromAttributeViews(assetName: string): Promise<number> {
  if (!assetName) {
    return 0;
  }

  let updatedCount = 0;

  try {
    const jsonFiles = await listAttributeViewJsonFiles();

    let encodedName = '';
    try {
      encodedName = encodeURIComponent(assetName);
    } catch (e) {}
    const hasAssetIn = (text: string) =>
      text.includes(`assets/${assetName}`) || (encodedName !== assetName && text.includes(`assets/${encodedName}`));

    for (const file of jsonFiles) {
      const filePath = `${ATTRIBUTE_VIEW_STORAGE_DIR}/${file.name}`;
      const text = await readAttributeViewText(filePath);
      if (!text) continue;

      let parsed: any = null;
      try {
        parsed = JSON.parse(text);
      } catch (parseErr) {
        warn(`[attribute-view] 数据库文件 ${file.name} 解析失败，跳过资源引用移除:`, parseErr);
        continue;
      }
      if (!Array.isArray(parsed?.keyValues)) continue;

      let fileChanged = false;

      for (const keyValue of parsed.keyValues) {
        if (!Array.isArray(keyValue?.values)) continue;

        for (const value of keyValue.values) {
          if (!value) continue;

          if (typeof value.content === 'string' && value.content && hasAssetIn(value.content)) {
            const cleaned = removeAssetFromMarkdown(value.content, assetName);
            if (cleaned !== value.content) {
              value.content = cleaned;
              fileChanged = true;
            }
          }

          if (value.url && typeof value.url.content === 'string' && value.url.content && hasAssetIn(value.url.content)) {
            const cleaned = removeAssetFromMarkdown(value.url.content, assetName);
            if (cleaned !== value.url.content) {
              value.url.content = cleaned;
              fileChanged = true;
            }
          }

          if (Array.isArray(value.mAsset)) {
            const keptItems: any[] = [];
            for (const item of value.mAsset) {
              if (item && typeof item.content === 'string' && item.content && hasAssetIn(item.content)) {
                const cleaned = removeAssetFromMarkdown(item.content, assetName).trim();
                if (cleaned) {
                  item.content = cleaned;
                  keptItems.push(item);
                }
                // 清理后为空：该资源项整体移除
                fileChanged = true;
              } else {
                keptItems.push(item);
              }
            }
            if (keptItems.length !== value.mAsset.length) {
              value.mAsset = keptItems;
            }
          }
        }
      }

      if (fileChanged) {
        await writeAttributeViewJson(filePath, parsed, text);
        updatedCount++;
        log(`[attribute-view] 已从数据库文件移除资源引用: ${file.name} (${assetName})`);
      }
    }
  } catch (err) {
    error('[attribute-view] 移除数据库资源引用失败:', err);
  }

  return updatedCount;
}

/**
 * 数据库中被合并改写过的单元格快照。
 *
 * 去重合并是"多对一"变换，按名字对整份 JSON 做全局反替换会把所有单元格
 * （含来自其它冗余图的、以及本来就是主图的）一起改错。因此合并前按
 * (viewId, keyId, rowId) 记录被改单元格的内容快照，回退时只改这些单元格。
 */
export interface IAffectedViewCell {
  /** 属性视图 JSON 文件名（不含扩展名，即 avId） */
  viewId: string;
  /** 列 key id */
  keyId: string;
  /** 行 id（行块 id / itemID） */
  rowId: string;
  /** 该行文本字段 `content` 的合并前快照 */
  originalContent?: string;
  /** 该行 URL 字段 `url.content` 的删除前快照 */
  originalUrlContent?: string;
  /** 该行资源字段 `mAsset[].content` 的合并前快照（按下标对应） */
  originalAssetContents?: string[];
  /** 该行资源字段 `mAsset` 的删除前完整快照（含 type/name/content，供删除回退整组还原） */
  originalMAssetItems?: Array<{ type?: string; name?: string; content: string }>;
}

export interface IViewCellRestoreStats {
  /** 实际改回的字段处数（精确 + 近似） */
  restoredCount: number;
  /** 其中属于近似还原（值已被用户改动）的处数 */
  approximateCount: number;
  /** 未改动的处数：单元格已消失、或已不再引用主图 */
  skippedCount: number;
}

interface IViewValueField {
  kind: 'content' | 'url' | 'asset';
  index?: number;
  text: string;
}

/** 提取一个数据库行值节点中可能承载资源引用的字段 */
function extractValueFields(value: any): IViewValueField[] {
  const fields: IViewValueField[] = [];
  if (!value) return fields;

  if (typeof value.content === 'string' && value.content) {
    fields.push({ kind: 'content', text: value.content });
  }
  // url 列单元格同样承载资产引用（对齐思源官方 getAttributeViewValueAssetsLinkDests
  // 的 value.URL 规则；引用计数口径 extractAssetsFromAttributeViewJson 早已解析 url，
  // 此处若漏采会造成"url-only 引用被清理/改写却无快照、无法回退"的缺口）
  if (value.url && typeof value.url.content === 'string' && value.url.content) {
    fields.push({ kind: 'url', text: value.url.content });
  }
  if (Array.isArray(value.mAsset)) {
    value.mAsset.forEach((item: any, index: number) => {
      if (typeof item?.content === 'string' && item.content) {
        fields.push({ kind: 'asset', index, text: item.content });
      }
    });
  }
  return fields;
}

/**
 * 采集指定资源在各数据库文件中被引用的单元格快照（供删除日志持久化）
 * @returns assetName -> 单元格快照列表
 */
export async function captureAttributeViewAssetCells(
  assetNames: string[]
): Promise<Map<string, IAffectedViewCell[]>> {
  const result = new Map<string, IAffectedViewCell[]>();
  const targets = Array.from(new Set((assetNames || []).filter(Boolean)));
  if (targets.length === 0) return result;

  try {
    const jsonFiles = await listAttributeViewJsonFiles();

    for (const file of jsonFiles) {
      const filePath = `${ATTRIBUTE_VIEW_STORAGE_DIR}/${file.name}`;
      const text = await readAttributeViewText(filePath);
      if (!text) continue;

      let parsed: any = null;
      try {
        parsed = JSON.parse(text);
      } catch (parseErr) {
        // 解析失败（格式异常）时不记录单元格：回退侧会退回按名替换的兜底逻辑
        continue;
      }
      if (!Array.isArray(parsed?.keyValues)) continue;

      const viewId = String(parsed?.id || file.name.replace(/\.json$/, ''));

      for (const keyValue of parsed.keyValues) {
        const keyId = keyValue?.key?.id;
        if (!keyId || !Array.isArray(keyValue.values)) continue;

        for (const value of keyValue.values) {
          const rowId = value?.blockID || value?.itemID || value?.id;
          if (!rowId) continue;

          const fields = extractValueFields(value);
          if (fields.length === 0) continue;

          const matchedNames = targets.filter((name) =>
            fields.some((field) => extractAssetNamesFromMarkdown(field.text).includes(name))
          );
          if (matchedNames.length === 0) continue;

          for (const name of matchedNames) {
            let list = result.get(name);
            if (!list) {
              list = [];
              result.set(name, list);
            }
            list.push({
              viewId,
              keyId: String(keyId),
              rowId: String(rowId),
              originalContent: typeof value.content === 'string' ? value.content : undefined,
              originalUrlContent: value.url && typeof value.url.content === 'string' ? value.url.content : undefined,
              originalAssetContents: Array.isArray(value.mAsset)
                ? value.mAsset.map((item: any) => (typeof item?.content === 'string' ? item.content : ''))
                : undefined,
              originalMAssetItems: Array.isArray(value.mAsset)
                ? JSON.parse(JSON.stringify(value.mAsset))
                : undefined,
            });
          }
        }
      }
    }
  } catch (err) {
    warn('[attribute-view] 采集数据库单元格快照失败:', err);
  }

  return result;
}

/** 按原文件缩进风格序列化，尽量不产生无关的格式 diff */
function serializeLikeOriginal(parsed: any, originalText: string): string {
  const isPretty = /^\s*\{\s*\n/.test(originalText);
  return JSON.stringify(parsed, null, isPretty ? '\t' : undefined);
}

/** 将单元格快照按 viewId 分组（两个还原流程共用的逐字等价逻辑） */
function groupCellsByView(cells: IAffectedViewCell[]): Map<string, IAffectedViewCell[]> {
  const cellsByView = new Map<string, IAffectedViewCell[]>();
  for (const cell of cells) {
    if (!cell?.viewId || !cell.keyId || !cell.rowId) continue;
    let list = cellsByView.get(cell.viewId);
    if (!list) {
      list = [];
      cellsByView.set(cell.viewId, list);
    }
    list.push(cell);
  }
  return cellsByView;
}

/** 在解析后的属性视图 JSON 中定位单元格快照对应的行值节点 */
function findViewCellValue(parsed: any, cell: { keyId: string, rowId: string }): any {
  const keyValue = parsed.keyValues.find((kv: any) => String(kv?.key?.id) === cell.keyId);
  return Array.isArray(keyValue?.values)
    ? keyValue.values.find(
        (v: any) => String(v?.blockID || v?.itemID || v?.id) === cell.rowId
      )
    : null;
}

/**
 * 按单元格快照精确逆向还原数据库引用
 *
 * 每个字段独立判断：与"合并后应有形态"一致则写回快照（精确），
 * 已被用户改动则按原快照中的出现处数限量改回（近似），
 * 已不再引用主图或单元格已消失则跳过并如实计入 skip。
 */
export async function restoreAttributeViewAssetCells(
  cells: IAffectedViewCell[],
  canonicalName: string,
  redundantName: string
): Promise<IViewCellRestoreStats> {
  const stats: IViewCellRestoreStats = { restoredCount: 0, approximateCount: 0, skippedCount: 0 };
  if (!Array.isArray(cells) || cells.length === 0 || !canonicalName || !redundantName) {
    return stats;
  }

  const cellsByView = groupCellsByView(cells);

  for (const [viewId, viewCells] of cellsByView) {
    const filePath = `${ATTRIBUTE_VIEW_STORAGE_DIR}/${viewId}.json`;
    try {
      const text = await readAttributeViewText(filePath);
      if (!text) {
        stats.skippedCount += countRestorableFields(viewCells);
        continue;
      }
      let parsed: any = null;
      try {
        parsed = JSON.parse(text);
      } catch (parseErr) {
        warn(`[attribute-view] 数据库文件 ${viewId}.json 解析失败，跳过单元格级还原:`, parseErr);
        stats.skippedCount += countRestorableFields(viewCells);
        continue;
      }
      if (!Array.isArray(parsed?.keyValues)) {
        stats.skippedCount += countRestorableFields(viewCells);
        continue;
      }

      let fileChanged = false;

      for (const cell of viewCells) {
        const value = findViewCellValue(parsed, cell);

        if (!value) {
          stats.skippedCount += countRestorableFields([cell]);
          continue;
        }

        const applyField = (
          currentText: string,
          originalText: string | undefined,
          write: (next: string) => void
        ) => {
          const restored = restoreAssetReference({
            current: currentText,
            original: originalText,
            redundantName,
            canonicalName,
          });
          if (restored.mode === 'skip') {
            stats.skippedCount++;
            return;
          }
          if (restored.mode === 'approximate') {
            stats.approximateCount++;
          }
          stats.restoredCount++;
          write(restored.text);
          fileChanged = true;
        };

        if (typeof value.content === 'string' && value.content) {
          applyField(value.content, cell.originalContent, (next) => {
            value.content = next;
          });
        }

        // url 字段与 content 同机制还原（合并的文本级替换同样会改写 url.content）
        if (value.url && typeof value.url.content === 'string' && value.url.content) {
          applyField(value.url.content, cell.originalUrlContent, (next) => {
            value.url.content = next;
          });
        }

        if (Array.isArray(value.mAsset)) {
          value.mAsset.forEach((item: any, index: number) => {
            if (!item || typeof item.content !== 'string' || !item.content) return;
            applyField(item.content, cell.originalAssetContents?.[index], (next) => {
              item.content = next;
            });
          });
        }
      }

      if (fileChanged) {
        await writeAttributeViewJson(filePath, parsed, text);
        log(`[attribute-view] 已按单元格快照还原数据库文件: ${viewId}.json`);
      }
    } catch (err) {
      error(`[attribute-view] 还原数据库文件 ${viewId}.json 单元格失败:`, err);
      stats.skippedCount += countRestorableFields(viewCells);
    }
  }

  return stats;
}

/** 统计一组单元格中可承载资源引用的字段数（用于异常路径下的 skip 计数） */
function countRestorableFields(cells: IAffectedViewCell[]): number {
  let count = 0;
  for (const cell of cells) {
    if (typeof cell.originalContent === 'string') count++;
    if (typeof cell.originalUrlContent === 'string') count++;
    if (Array.isArray(cell.originalAssetContents)) count += cell.originalAssetContents.length;
  }
  return count;
}

export interface IDeletionViewCellRestoreStats {
  restoredCount: number;
  skippedCount: number;
}

/**
 * 删除资源后按单元格快照整值还原数据库引用（删除回退专用）。
 *
 * 与去重回退的 restoreAttributeViewAssetCells 不同：删除场景 resource 名不变，
 * 语义是"恢复到删除前"，因此对快照覆盖的字段做整值还原——
 * 当前值与快照一致（未清理过）则跳过，不一致则整字段写回快照。
 */
export async function restoreAttributeViewCellsAfterDeletion(
  cells: IAffectedViewCell[]
): Promise<IDeletionViewCellRestoreStats> {
  const stats: IDeletionViewCellRestoreStats = { restoredCount: 0, skippedCount: 0 };
  if (!Array.isArray(cells) || cells.length === 0) return stats;

  const cellsByView = groupCellsByView(cells);

  for (const [viewId, viewCells] of cellsByView) {
    const filePath = `${ATTRIBUTE_VIEW_STORAGE_DIR}/${viewId}.json`;
    try {
      const text = await readAttributeViewText(filePath);
      if (!text) {
        stats.skippedCount += viewCells.length;
        continue;
      }
      let parsed: any = null;
      try {
        parsed = JSON.parse(text);
      } catch (parseErr) {
        warn(`[attribute-view] 数据库文件 ${viewId}.json 解析失败，跳过删除回退:`, parseErr);
        stats.skippedCount += viewCells.length;
        continue;
      }
      if (!Array.isArray(parsed?.keyValues)) {
        stats.skippedCount += viewCells.length;
        continue;
      }

      let fileChanged = false;

      for (const cell of viewCells) {
        const value = findViewCellValue(parsed, cell);

        if (!value) {
          stats.skippedCount++;
          continue;
        }

        let cellRestored = false;

        if (typeof cell.originalContent === 'string' && value.content !== cell.originalContent) {
          value.content = cell.originalContent;
          fileChanged = true;
          cellRestored = true;
        }

        if (
          typeof cell.originalUrlContent === 'string'
          && value.url
          && typeof value.url.content === 'string'
          && value.url.content !== cell.originalUrlContent
        ) {
          value.url.content = cell.originalUrlContent;
          fileChanged = true;
          cellRestored = true;
        }

        if (
          Array.isArray(cell.originalMAssetItems)
          && JSON.stringify(value.mAsset ?? null) !== JSON.stringify(cell.originalMAssetItems)
        ) {
          value.mAsset = JSON.parse(JSON.stringify(cell.originalMAssetItems));
          fileChanged = true;
          cellRestored = true;
        }

        if (cellRestored) {
          stats.restoredCount++;
        } else {
          stats.skippedCount++;
        }
      }

      if (fileChanged) {
        await writeAttributeViewJson(filePath, parsed, text);
        log(`[attribute-view] 已按单元格快照整值还原数据库文件: ${viewId}.json`);
      }
    } catch (err) {
      error(`[attribute-view] 删除回退还原数据库文件 ${viewId}.json 失败:`, err);
      stats.skippedCount += viewCells.length;
    }
  }

  return stats;
}

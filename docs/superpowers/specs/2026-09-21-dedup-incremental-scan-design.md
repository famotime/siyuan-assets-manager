# 去重比对扫描增量更新与并发化设计方案

更新日期：2026-09-21
状态：设计已确认，待编写实施计划
关联文档：[deduplicate-safety-optimization-plan.md](../../deduplicate-safety-optimization-plan.md)、[project-structure.md](../../project-structure.md)

---

## 一、问题定性

### 1.1 现状

`scanDuplicates`（[`src/utils/deduplicate.ts`](../../../src/utils/deduplicate.ts)）是三阶段全量流水线，**每次扫描都从头重算，无任何指纹复用**：

| 阶段 | 位置 | 代价 |
|---|---|---|
| 一、按 size 分桶 | `groupBySize` `:66` | 纯内存，便宜。已天然增量友好——仅 size 冲突者（≥2 个）进入候选池 |
| 二、候选 SHA-256 | `:392-419` | 逐文件 `readAssetFile` + `crypto.subtle.digest`，IO 密集 |
| 三、图片 dHash | `:482-513` | 逐图读文件 → `new Image()` 解码 → canvas 取灰度。**主要瓶颈** |

两个额外成本：

1. **阶段二/三为严格串行 `await`**：单张图必须等解码完成才处理下一张，无并发。
2. **聚类为 O(n²) 双重循环**（`:530-537`）：10000 张图约 5000 万次比较。

### 1.2 为什么"有缓存却不增量"

`IDeduplicateCache`（`:807`）只持久化 `exactGroups` / `similarGroups` / `lastScanTime` / `similarityThreshold`——即**分组结果**，不含任何 per-file 指纹。因此持久化缓存的作用仅限于"打开弹窗时若有缓存则直接展示，跳过扫描"（`DeduplicateDialog.vue:529`）。一旦触发扫描（`startScan(true)`），三阶段全部重跑，此前算过的哈希全部丢弃。相似度滑块调整（`:640`）亦然——尽管指纹与阈值毫无关系。

### 1.3 目标

面向 10000+ 图片资源：

- **重复扫描近乎瞬时**：未变更文件零读取、零解码。
- **首次扫描显著加速**：并发化解码瓶颈。
- **不引入错误去重结论**：陈旧指纹导致误判重复是本项目最不可接受的失败模式（参见 deduplicate-safety-optimization-plan.md）。

**本次不做**：聚类算法优化（O(n²) 保留）。已评估为独立收益项，改动与测试成本明显更大，留待后续。

---

## 二、数据模型与持久化

### 2.1 指纹存储独立成文件

新增 `deduplicate-fingerprints.json`，与现有 `deduplicate-cache.json` **分离**：

```jsonc
{
  "version": 1,
  "entries": {
    "<assetName>": {
      "size": 123456,
      "updated": 1700000000000,
      "sha256": "…",          // 仅 size 冲突候选需要
      "dHash": "0101…",       // 仅图片，64 位
      "width": 1920,
      "height": 1080
    }
  }
}
```

**为何分离**：指纹规模是 O(全部资源)，10000 条约 1.5–3MB；分组结果只含重复项，体积小得多。现有 `saveDeduplicateCache` 带 localStorage 兜底（`DEDUP_LOCAL_STORAGE_KEY`，上限约 5MB），指纹并入会顶爆配额并连带破坏分组缓存的持久化。

**存储策略**：指纹**仅走 `plugin.saveData`**。`usePlugin()` 不可用（或 `saveData` 缺失）时退化为纯内存，本次会话内有效，**不写 localStorage**。宁可无持久化，也不接受写爆配额。

### 2.2 新增模块

`src/utils/dedup-fingerprint-store.ts`，职责单一（读写 + 校验 + 裁剪），不感知扫描流水线：

```ts
export const FINGERPRINT_STORE_FILE = 'deduplicate-fingerprints.json';
export const FINGERPRINT_STORE_VERSION = 1;

export interface IAssetFingerprint {
  size: number;
  updated: number;
  sha256?: string;
  dHash?: string;
  width?: number;
  height?: number;
}

export interface IFingerprintStore {
  version: number;
  entries: Record<string, IAssetFingerprint>;
}

export function createEmptyFingerprintStore(): IFingerprintStore;
export function isFingerprintValid(entry: IAssetFingerprint | undefined, asset: AssetInfo): boolean;
export function pruneFingerprintStore(store: IFingerprintStore, liveAssetNames: Set<string>): number;
export function countFingerprintEntries(store: IFingerprintStore): number;
export async function loadFingerprintStore(): Promise<IFingerprintStore>;
export async function saveFingerprintStore(store: IFingerprintStore): Promise<boolean>;
export async function clearFingerprintStore(): Promise<boolean>;
```

独立成模块而非并入 `deduplicate.ts`：后者已 902 行，且指纹存储的生命周期（加载/校验/裁剪/落盘）与扫描算法正交，可独立测试。

---

## 三、失效策略

### 3.1 判据

条目有效当且仅当同时满足：

1. `entry.size === asset.size`
2. `entry.updated === asset.updated`
3. `entry.updated > 0`
4. 本次所需字段存在（阶段二需 `sha256`，阶段三需 `dHash`）

任一不符 → 重算该文件指纹并回写条目。

**为何取 `size + updated` 双判**：内容变更的代理信号。单看 `size` 会漏掉"同字节数的重新编辑图"（可能被误判为重复 → 误删），单看 `updated` 会在 mtime 不可信时全线失效。双判偏保守，失败方向安全（多算一次，不会少算）。

### 3.2 修复 `updated` 被伪造成当前时间

[`src/utils/storage/http-adapter.ts:18`](../../../src/utils/storage/http-adapter.ts) 在响应缺 `last-modified` 时返回 `updated: Date.now()`。

**影响验算**：该谎**不会造成错误去重结论**——每次扫描 `Date.now()` 都不同，必然失配 → 条目自动作废 → 改走重算，方向安全。真实危害是**增量静默退化为全量且无从排查**（用户看到"复用 0 个指纹"，却没有任何线索指向 HEAD 响应缺 header）。

**修复**：改为返回 `updated: 0`，语义 = "未知"。配合 §3.1 判据第 3 条即为确定性行为。

**为何安全**：`updated = 0` 的既有消费点均已自洽——[`siyuan-db.ts:258`](../../../src/utils/siyuan-db.ts) 仅在 `statAsset` 成功时覆盖；[`asset-catalog.ts:354`](../../../src/utils/asset-catalog.ts) 的 `if (!asset.updated)` 保留 0 而非写入；[`scoreAssetCandidate`](../../../src/utils/deduplicate.ts) 已有 `if (asset.updated)` 守卫。此改动独立可测。

### 3.3 规则：`score` 必须每次重算

`scoreAssetCandidate`（`:286`）依赖 `isReEditable`、`refCount`、`docCount`——**这些会在文件字节完全不变的情况下变化**（新建引用、删除引用、打上二次编辑元数据）。

因此：`sha256` / `dHash` / `width` / `height` 是文件字节的纯函数，可安全复用；**`score` 绝不复用**，每次扫描对全部条目重新计算。

**这是本设计中最易写错之处**：若误将 `score` 一并缓存，去重界面会持续推荐过期的"保留项"，用户据此合并将丢失引用数更多的那个文件。必须由测试锁死（见 §7 关键用例）。

---

## 四、扫描流水线改造

### 4.1 三阶段骨架不变，仅改"指纹来源"

| 阶段 | 变化 |
|---|---|
| 一、`groupBySize` | **不变** |
| 二、候选 SHA-256 | 有效期命中 → 复用 `entry.sha256`，**不读文件**；否则读 + 算 + 回写条目 |
| 三、图片 dHash | 同上，复用 `entry.dHash` / `width` / `height`。已进入精确重复组的图仍按现有逻辑跳过 |
| 聚类 O(n²) | **不变** |
| 构建分组 | 对全部条目**重算 score**（§3.3），再选 canonical |

### 4.2 接口变更

`scanDuplicates` 的 options 增加：

```ts
{
  minSimilarity?: number;
  onProgress?: (progress: IDeduplicateScanProgress) => void;
  abortSignal?: { aborted: boolean };
  fingerprints?: IFingerprintStore;   // 新增：入参指纹存储
  forceRehash?: boolean;              // 新增：true 时忽略全部条目，全量重算
  concurrency?: { hash?: number; decode?: number };  // 新增：并发度覆盖（§4.3.1）
}
```

返回值增加：

```ts
{
  exactGroups: IDuplicateGroup[];
  similarGroups: IDuplicateGroup[];
  fingerprints: IFingerprintStore;    // 新增：含本次新增/回写的条目，由调用方落盘
  stats: { reused: number; computed: number };  // 新增：供进度文案与自检
}
```

`fingerprints` 以**返回值**而非原地修改传出：调用方（弹窗）负责落盘，扫描函数保持"输入 → 输出"的可测形态。

**中止路径的返回契约**：与现有行为一致，`exactGroups` / `similarGroups` 返回空数组（弹窗本就以 `if (!aborted)` 守卫，不会采用部分分组）；但 `fingerprints` **返回已合并本次新增条目的 store**——每条目在写入时都独立通过了 §3.1 校验，部分完成的结果依然有效，丢弃纯属浪费。

`IDeduplicateScanProgress.phase` **不新增取值**：复用计数在阶段二/三的起始消息中上报（§6.1），无需独立阶段。

### 4.3 并发化

新增 `src/utils/concurrency.ts`：

```ts
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  options?: {
    abortSignal?: { aborted: boolean };
    onProgress?: (done: number, total: number) => void;
  }
): Promise<R[]>;
```

契约：

- **保序返回**：结果数组顺序与 `items` 一致（调用方按下标回填 `exactClusters` / `imageFeatures`，顺序须确定以免分组输出抖动）
- **在飞 worker 数不超过 `limit`**
- **每项开始前检查 `abortSignal.aborted`**，已中止则不再启动新任务，已启动的等待收敛
- **进度从共享计数器上报**，保证单调递增

**两个阶段使用不同的 `limit`**——它们的瓶颈性质不同，共用一个值必然对一方不合适：

| 阶段 | 主要开销 | 每项内存 | `crypto.subtle` | 默认 |
|---|---|---|---|---|
| 二、SHA-256 | IO + `crypto.subtle.digest` | 一个文件 Blob | 真异步，**不占主线程** | `8` |
| 三、dHash | `Image` 解码 + canvas | **解码后完整位图** | — | `3` |

阶段三的内存才是硬约束：`computeImageDHash` 虽只往 9×8 canvas 画图，但 `<img>` + `drawImage` 路径下浏览器仍会将**源图全分辨率解码**进内存再缩放（不可依赖浏览器的降采样优化）。一张 4000×3000 截图解码后约 48MB RGBA，并发一高便是数百 MB 瞬时峰值——而思源里截图与大图恰恰常见。

### 4.3.1 并发度可配置

数值只能靠实测确定，故暴露给运行时，三层次递进：

```ts
// deduplicate.ts —— 默认值，导出以便测试与设置项引用
export const DEFAULT_HASH_CONCURRENCY = 8;
export const DEFAULT_DECODE_CONCURRENCY = 3;
```

1. **常量默认**：未指定时用上述值
2. **options 覆盖**：`scanDuplicates` 接受 `concurrency?: { hash?: number; decode?: number }`。**单元测试靠这一层注入**（如 `{ hash: 2, decode: 2 }` 以断言在飞数上限），因此测试不依赖也不受默认值变动影响
3. **设置项**：`src/index.ts` 的 `openSetting()` 暴露两个数字输入（§6.2）

**`deduplicate.ts` 不得直接读设置**：它经 `plugin-context` 取 `usePlugin()` 在技术上可行，但会把纯逻辑模块耦合到插件实例，正是 `plugin-context.ts:5-12` 注释所警示的依赖污染。设置由**调用方（弹窗）读取后经 options 传入**，`deduplicate.ts` 只认入参。

仓库现无并发工具（[`asset-catalog.ts:344`](../../../src/utils/asset-catalog.ts) 仅有手写 50 一批的 `Promise.all` 分块，**不**复用——分块会阻塞在批次最慢项上，与池化语义不同）。**不**顺手改造 asset-catalog，避免无关变更扩大爆炸半径。

**默认值未经实测**：8 / 3 是依据上表性质推断的保守起点，非测量结果。可配置化正是为了让用户按自身资源特征（大图占比、内存）自行调整，而不必等一次完整的基准测试。

### 4.4 指纹 GC

**裁剪在 `scanDuplicates` 内部执行**，调用方只负责落盘——使"何时裁剪"的规则可被单元测试直接锁定。

规则：

- **仅完整扫描（未中止）结束后**，以当前资源名集合调用 `pruneFingerprintStore`，丢弃已删除/已重命名文件的条目，防止缓存无界增长
- **中止的扫描不得裁剪**：中止时资源集合可能不完整（`assets` 入参本身是完整的，但中止语义下不应做删除性操作），避免误删有效条目
- **落盘在中止路径同样执行**：中止只是不做裁剪，不放弃本次已得到的有效条目。危险的是"按不完整集合删除"，不是"写入新条目"

### 4.5 阈值调整自动变便宜

`handleThresholdChange`（`DeduplicateDialog.vue:640`）当前走全量重扫。改造后指纹与阈值无关，滑块调整只重跑聚类，无需任何文件读取——此收益是增量的自然结果，无需额外代码。

---

## 五、分组身份

### 5.1 问题

组 `id` 现为位置生成：`exact_${idx++}`（`:442`）、`similar_${idx++}`（`:550`）。增量之后分组每次扫描都会重算，位置 id 随之漂移——用户本次忽略了 `exact_3`，下次扫描 `exact_3` 可能是完全无关的另一组。**「已忽略/已处理」实际上不可靠**。

### 5.2 方案

```ts
export function deriveGroupId(mode: DeduplicateMode, items: IDuplicateItem[]): string;
```

由 `mode` + **排序后的成员文件名集合**派生稳定哈希，输出形如 `exact_7f3a91c2`。与扫描顺序、分桶顺序、聚类遍历顺序均无关；成员不变则 id 不变。

哈希实现：对 `mode + '\x00' + names.sort().join('\x1f')` 取 **FNV-1a 32 位**，转 8 位十六进制。选 FNV-1a 而非已有的 `computeFileHash`——后者是 `async` 且面向 `Blob`，此处只需同步纯函数；分隔符用 `\x00` / `\x1f` 而非逗号，避免文件名本身含分隔符时产生歧义（与 `asset-markdown.ts` 的正则转义同属一类防御）。

**副作用（正向）**：修掉现有的位置 id 漂移。

**已确认接受的代价**：组员变动（又混入一张重复图）时，该组 id 变化，重新变为待处理。语义上可辩护——成员的引用关系确实变了，值得重新过目。

### 5.3 缓存版本

- `IDeduplicateCache.version` 由 `1` 升至 `2`；`loadDeduplicateCache` 对 `version !== 2` 直接返回 `null`
- **两处 version 属独立命名空间，勿混用**：分组缓存 → `2`（本次升版）；指纹文件 → `FINGERPRINT_STORE_VERSION = 1`（新引入，故从 1 起）。二者存于不同文件，各自独立判废
- 指纹文件**不**随分组缓存一同作废：分组缓存作废只影响展示，指纹仍然有效
- 升级后首次打开：无分组缓存 + 无指纹文件 → 一次真实全量扫描，随后建立指纹

**已确认的策略**：旧缓存**直接丢弃**，不迁移 `isIgnored` / `isProcessed`。用户此前手动忽略的组会在升级后"复活"一次。选择此路以避免引入组身份映射逻辑，迁移收益不抵复杂度。

---

## 六、UI 触发语义

| 入口 | 位置 | 改动 |
|---|---|---|
| 顶部「扫描」 | `:53` `handleManualRefresh` | 增量（标签不变，用户无感，但变秒级） |
| footer「重新扫描」 | `:343` | 增量 |
| 空状态「重新全量扫描」 | `:109` | 全量重建（该位置本名"全量"，语义自洽） |
| footer 新增「重建索引」 | 新增 | 全量重建（`forceRehash: true`），带 `ConfirmDialog` 二次确认 |

「重建索引」是指纹疑似陈旧时的逃生入口。**必须放在有分组时也可见的位置**（footer），否则空状态那个按钮在正常有重复项时不可达。

### 6.1 进度文案区分复用与重算

进度消息需让"增量是否生效"肉眼可见，例如：

- 阶段二：`复用 9820 个指纹，重算 180 个精确哈希 (180/180)…`
- 阶段三：`复用 9750 张图片特征，重算 42 张…`

`stats.reused` / `stats.computed` 同时用于扫描完成后的日志与自检。

### 6.2 设置项：并发度

在 `src/index.ts` 的 `openSetting()` 中新增两个数字输入，**完全复用 `deletionHistoryLimit`（`:385-409`）的既有模式**：`input.type = "number"` + `min` / `max` + `change` 事件内 clamp + `this.saveData("config.json", this.settings)`。

`settings` 定义（`:132`）新增两个字段：

```ts
dedupHashConcurrency: number;    // 默认 8，范围 1~16
dedupDecodeConcurrency: number;  // 默认 3，范围 1~8
```

范围上界取 16 / 8 而非更高：再高对这两类负载都无收益，且阶段三上界受内存约束，给出过大的可选项等于提供"把插件搞崩"的旋钮。

**载入时须兜底**：`:242` 的 `Object.assign({}, this.settings, loaded)` 之后要按 `imageEditorTools`（`:243`）的既有做法补默认值，否则老用户 `config.json` 中无此字段，读出来是 `undefined`，传进 `mapWithConcurrency` 会导致池大小为 `undefined`。**两侧都做**：设置载入侧补默认，`scanDuplicates` 侧对非法值（`undefined` / `NaN` / `< 1`）再回退一次——单侧的遗漏足以让整个池失效。

弹窗读取路径：`const plugin = usePlugin(); plugin?.settings?.dedupDecodeConcurrency`，随后经 `options.concurrency` 传入（`main.ts:10` 转出的即 `plugin-context` 的同一实例，直接可用）。

### 6.3 i18n

新增文案同步维护于 `src/i18n/zh_CN.json` 与 `src/i18n/en_US.json`（项目规约）。本次新增 4 条设置项文案（两个设置项各需 title + desc）。

---

## 七、测试计划

遵循项目 Test-First 规约：**先写失败测试，再改实现**。

### 7.1 新增 `tests/concurrency.test.ts`

- 保序：worker 乱序 resolve 时结果仍按输入顺序
- 在飞数不超过 `limit`（用计数器记录峰值）
- 中止：`abortSignal.aborted` 置位后不再启动新项
- 进度单调递增且终值为 `items.length`
- **非法 `limit`**（`0` / 负数 / `undefined` / `NaN`）不得导致死锁或零并发——回退到 `1`

### 7.2 新增 `tests/dedup-fingerprint-store.test.ts`

- `size` 变 / `updated` 变 / `updated === 0` / 所需字段缺失 → 逐一判为失效
- `pruneFingerprintStore` 丢弃非活跃名，返回裁剪条数
- 存取往返一致；`version` 不符 → 返回空 store
- `plugin` 不可用时不写 localStorage（断言 `localStorage.setItem` 未被调用）

### 7.3 扩展 `tests/deduplicate.test.ts`

**增量正确性（核心）**

- 二次扫描，资源全未变更 → `readAssetFile` 调用数为 **0**，且 `exactGroups` / `similarGroups` 与首次一致
- 仅 bump 单个资源的 `updated` → 恰好重算 1 个（`readAssetFile` 调用数 == 1）
- `forceRehash: true` → 全部重算
- `stats.reused` / `stats.computed` 与实际调用数吻合

**score 必须重算（§3.3，最高风险）**

- 指纹全命中，但某资源 `refCount` 提高 → canonical 正确切换到该资源。此用例若失败，说明 `score` 被误缓存

**分组身份（§5）**

- 同成员不同顺序 → `deriveGroupId` 结果相同
- 成员变动 → id 变化

**缓存版本（§5.3）**

- 写入 `version: 1` 的缓存 → `loadDeduplicateCache` 返回 `null`

**并发度配置（§4.3.1 / §6.2）**

- `concurrency: { hash: 2, decode: 2 }` 生效：在飞数峰值不超过 2（注入 `limit` 而非依赖默认常量，故默认值调整不会打破此用例）
- `concurrency` 传 `undefined` / 部分字段缺失 → 回退到默认常量，不抛错

### 7.4 `tests/` 现有 mock 补充

`tests/deduplicate.test.ts` 已 mock `file-system` / `siyuan-block` / `attribute-view`。需补充 `dedup-fingerprint-store` 与 `plugin-context` 的 mock，使增量用例能注入预设指纹存储。

---

## 八、文件清单

| 类型 | 路径 |
|---|---|
| 新增 | `src/utils/concurrency.ts` |
| 新增 | `src/utils/dedup-fingerprint-store.ts` |
| 修改 | `src/utils/deduplicate.ts`（`scanDuplicates` 增量+并发、`deriveGroupId`、缓存 version 2） |
| 修改 | `src/utils/storage/http-adapter.ts`（`updated` 伪值 → `0`） |
| 修改 | `src/components/DeduplicateDialog.vue`（增量默认、重建索引入口、进度文案、读取设置并传 options） |
| 修改 | `src/index.ts`（`settings` 两个并发度字段 + 载入兜底 + `openSetting()` 两个数字输入） |
| 修改 | `src/i18n/zh_CN.json`、`src/i18n/en_US.json`（4 条设置项文案） |
| 测试 | `tests/concurrency.test.ts`（新）、`tests/dedup-fingerprint-store.test.ts`（新）、`tests/deduplicate.test.ts`（扩展） |
| 文档 | `docs/project-structure.md`（按 CLAUDE.md 规约同步） |

---

## 九、风险与对策

| 风险 | 对策 |
|---|---|
| `score` 被误缓存 → 推荐错误的保留项 → 用户据此合并即丢失引用更多的文件 | §3.3 明文规定 + §7.3 专项测试先行 |
| 陈旧指纹造成"假命中"（同 size+updated 不同内容）→ 误判重复 | 双判保守策略（§3.1）；`forceRehash` 逃生入口（§6）；裁剪仅在完整扫描后执行（§4.4） |
| `deriveGroupId` 变更用户可见的忽略行为 | §5 已确认；测试锁定顺序无关性 |
| 1.5–3MB 指纹落盘开销 | 每轮扫描仅写一次；独立文件不牵连分组缓存；无 plugin 时退化为纯内存 |
| 升级后首次全量扫描（旧缓存丢弃） | §5.3 已确认接受；一次性成本 |
| `http-adapter` 改动波及他人 | 影响面已逐一验算（§3.2）；独立测试 |
| 老用户 `config.json` 无并发度字段 → `undefined` 传入池 → 死锁或零并发 | 设置载入侧补默认 + `scanDuplicates` 侧二次回退（§6.2）；`mapWithConcurrency` 对非法值回退 `1`（§7.1） |
| 用户把解码并发调得过高 → 大图批量解码耗尽内存 | 设置项上界钳制为 8（§6.2）；描述文案写明该项影响内存占用 |

/**
 * 图像块二次编辑元数据结构定义
 */
export interface IAssetReEditMetadata {
  /** 元数据协议版本号，默认 1 */
  version: number;
  /** 插件专属存储目录中的原始底图相对路径，如 originals/foo-original.png */
  originalStoragePath: string;
  /** 原始底图的 Hash 校验（可选，用于一致性校验） */
  originalHash?: string;
  /** 当前渲染输出并插入文档的 assets 文件名（如 foo-edited-20260815.png） */
  renderedAssetName: string;
  /** 标注所在的原始画布/图片尺寸 */
  canvasSize: {
    width: number;
    height: number;
  };
  /** 是否使用了 lz-string 压缩 */
  compressed: boolean;
  /**
   * 矢量图层数据
   * 若 compressed 为 false，为 { objects: any[], version?: string }
   * 若 compressed 为 true，为经过 lz-string 编码的紧凑字符串
   * 严禁在 vectorData 中塞入底图 Base64，仅包含矢量元素
   */
  vectorData: any | string;
  /** 最后更新时间戳 (毫秒) */
  updatedAt: number;
}

/**
 * 矢量图层载荷结构
 */
export interface IVectorLayerData {
  objects: any[];
  version?: string;
}

/**
 * 二次编辑保存载荷
 */
export interface IReEditSavePayload {
  oldName: string;
  dataUrl: string;
  blockId?: string;
  vectorData?: IVectorLayerData | null;
  isReEditMode?: boolean;
  originalStoragePath?: string;
}

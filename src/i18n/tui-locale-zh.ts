/**
 * TUI Image Editor 中文本地化配置
 * 覆盖编辑器所有菜单、子菜单、按钮的英文标签
 */
const localeZhCN: Record<string, string> = {
  // 主菜单
  'Crop': '裁剪',
  'Draw': '画笔',
  'Shape': '形状',
  'Icon': '图标',
  'Text': '文字',
  'Mask': '水印',
  'Filter': '滤镜',

  // 通用操作
  'Apply': '应用',
  'Cancel': '取消',
  'Delete': '删除',
  'DeleteAll': '全部删除',
  'Reset': '重置',
  'Undo': '撤销',
  'Redo': '重做',
  'Load': '加载',
  'Download': '下载',

  // 裁剪
  'Custom': '自定义',
  'Square': '正方形',
  'Free': '自由裁剪',
  'Lock Aspect Ratio': '锁定比例',

  // 翻转与旋转
  'Flip': '翻转',
  'Flip X': '水平翻转',
  'Flip Y': '垂直翻转',
  'Rotate': '旋转',

  // 画笔
  'Straight': '直线',
  'Color': '颜色',
  'Range': '粗细',

  // 形状
  'Rectangle': '矩形',
  'Circle': '圆形',
  'Triangle': '三角形',
  'Fill': '填充',
  'Stroke': '描边',

  // 图标
  'Arrow-1': '箭头1',
  'Arrow-2': '箭头2',
  'Arrow-3': '箭头3',
  'Star-1': '星形1',
  'Star-2': '星形2',
  'Polygon': '多边形',
  'Location': '定位',
  'Heart': '心形',
  'Bubble': '气泡',
  'Custom icon': '自定义图标',

  // 文字
  'Bold': '加粗',
  'Italic': '斜体',
  'Underline': '下划线',
  'Left': '居左',
  'Center': '居中',
  'Right': '居右',
  'Text size': '字体大小',

  // 水印
  'Load Mask Image': '加载水印图片',

  // 滤镜
  'Grayscale': '灰度',
  'Invert': '反色',
  'Sepia': '深褐色',
  'Sepia2': '深褐色2',
  'Blur': '模糊',
  'Sharpen': '锐化',
  'Emboss': '浮雕',
  'Remove White': '去除白色',
  'Distance': '边距',
  'Brightness': '亮度',
  'Noise': '噪点',
  'Pixelate': '像素化',
  'Color Filter': '颜色过滤',
  'Threshold': '阈值',
  'Tint': '色调',
  'Multiply': '正片叠底',
  'Blend': '混合',

  // 缩放
  'Zoom In': '放大',
  'Zoom Out': '缩小',
  'ZoomIn': '放大',
  'ZoomOut': '缩小',
  'Hand': '拖动',

  // 尺寸
  'Width': '宽',
  'Height': '高',
  'Resize': '调整尺寸',

  // 历史
  'History': '历史记录',
};

export default localeZhCN;

/**
 * TUI Image Editor 中文本地化配置
 * 覆盖编辑器所有菜单、子菜单、按钮的英文标签
 */
const localeZhCN: Record<string, string> = {
  // 主菜单
  'Crop': '裁剪',
  'Draw': '画笔',
  'Eraser': '橡皮',
  'Lasso': '套索',
  'Shape': '形状',
  'Icon': '图标',
  'Text': '文字',
  'Mask': '蒙版',
  'Filter': '滤镜',
  'Mosaic': '马赛克',
  'Annotation': '序号标注',
  'Resize': '调整尺寸',
  'Flip': '翻转',
  'Rotate': '旋转',
  'Zoom': '缩放',

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
  'ViewOriginal': '查看原图',
  'viewOriginal': '查看原图',
  'History': '历史记录',

  // 裁剪
  'Custom': '自定义',
  'Square': '正方形',
  'Free': '自由',
  'Lock Aspect Ratio': '锁定比例',

  // 翻转与旋转
  'Flip X': '水平翻转',
  'Flip Y': '垂直翻转',
  'Angle': '角度',
  'angle': '角度',

  // 画笔
  'Straight': '直线',
  'Color': '颜色',
  'Range': '粗细',
  'Opacity': '不透明度',
  'opacity': '不透明度',
  'NoArrow': '无箭头',
  'SingleArrow': '单箭头',
  'DoubleArrow': '双箭头',

  // 形状
  'Rectangle': '矩形',
  'Circle': '圆形',
  'Triangle': '三角形',
  'Fill': '填充',
  'Stroke': '描边',

  // 图标
  'Arrow': '箭头1',
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

  // 蒙版
  'Load Mask Image': '加载蒙版图片',

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

  // 马赛克
  'Mosaic size': '颗粒大小',
  'Brush size': '画笔粗细',
  'Box Selection': '框选',
  'Brush Stroke': '画笔',

  // 套索
  'Rectangular': '矩形选择',
  'Freehand': '自由选择',

  // 缩放
  'Zoom In': '放大',
  'Zoom Out': '缩小',
  'ZoomIn': '放大',
  'ZoomOut': '缩小',
  'Hand': '拖动',

  // 尺寸
  'Width': '宽',
  'Height': '高',

  // 序号标注
  'Text Color': '文字色',
  'Background Color': '背景色',
  'TextColor': '文字色',
  'BgColor': '背景色',
  'NextStep': '下次序号',
  'ResetStep': '重置为 1',
  'Custom Color': '自定义颜色',
};

export default localeZhCN;

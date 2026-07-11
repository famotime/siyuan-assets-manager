import ImageEditorModule from 'tui-image-editor';

/**
 * 解析不同打包器/CommonJS 互操作形态下的 ImageEditor 构造函数。
 */
export function resolveImageEditorConstructor(moduleValue: any): any {
  let candidate = moduleValue;

  while (candidate?.default && candidate.default !== candidate) {
    candidate = candidate.default;
  }

  if (typeof candidate !== 'function') {
    throw new TypeError('无法解析 tui-image-editor 构造函数');
  }

  return candidate;
}

/**
 * 动态获取真正的 ImageEditor 构造函数。
 */
export function getImageEditor(): any {
  return resolveImageEditorConstructor(ImageEditorModule);
}

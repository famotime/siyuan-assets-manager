import ImageEditorModule from 'tui-image-editor';
import type { IVectorLayerData } from '../types/reedit';
import { log, warn, error } from './logger';

/**
 * 序列化 Fabric Canvas 对象时需要完整保留的自定义与关键交互属性清单
 */
export const SERIALIZE_PROPERTIES = [
  'id',
  'name',
  'selectable',
  'evented',
  'stroke',
  'strokeWidth',
  'strokeDashArray',
  'strokeLineCap',
  'strokeLineJoin',
  'fill',
  'fontSize',
  'fontFamily',
  'fontWeight',
  'fontStyle',
  'text',
  'textAlign',
  'textDecoration',
  'left',
  'top',
  'width',
  'height',
  'scaleX',
  'scaleY',
  'angle',
  'arrowType',
  'markerNumber',
  'opacity',
  'rx',
  'ry',
  'points',
  'x1',
  'y1',
  'x2',
  'y2',
  'path',
  'originX',
  'originY',
  'annotationId',
  'relatedId',
  'hasControls',
  'hasBorders',
  'transparentCorners',
  'borderColor',
  'cornerColor',
  'cornerSize',
];

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

/**
 * 从 TUI Image Editor 实例中安全获取底层的 Fabric Canvas 实例
 */
export function getFabricCanvasFromTui(editorInstance: any): any {
  if (!editorInstance) return null;

  if (typeof editorInstance.getCanvas === 'function') {
    return editorInstance.getCanvas();
  }
  if (editorInstance._graphics) {
    if (typeof editorInstance._graphics.getCanvas === 'function') {
      return editorInstance._graphics.getCanvas();
    }
    if (editorInstance._graphics._canvas) {
      return editorInstance._graphics._canvas;
    }
  }
  return null;
}

/**
 * 从 TUI Image Editor 实例中抽取纯矢量标注图层（彻底排除底图与临时裁剪框）
 */
export function extractVectorDataFromTui(editorInstance: any): IVectorLayerData | null {
  const fabricCanvas = getFabricCanvasFromTui(editorInstance);
  if (!fabricCanvas) {
    warn('[tui-bridge] 无法从编辑器实例中获取 Fabric Canvas');
    return null;
  }

  try {
    const bgImage =
      fabricCanvas.backgroundImage ||
      (fabricCanvas.getObjects ? fabricCanvas.getObjects().find((obj: any) => obj.type === 'image' && obj === fabricCanvas.backgroundImage) : null);

    const allObjects: any[] = fabricCanvas.getObjects ? fabricCanvas.getObjects() : [];

    // 为 Annotation 关联对标记全局唯一的 annotationId，方便反序列化时重建联动关系
    allObjects.forEach((obj, idx) => {
      if (obj.relatedObj && !obj.annotationId) {
        const id = `ann_${Date.now()}_${idx}`;
        obj.annotationId = id;
        if (obj.relatedObj) {
          obj.relatedObj.annotationId = id;
        }
      }
    });

    // 过滤排除背景底图和裁剪框
    const vectorObjects = allObjects.filter((obj) => {
      if (obj === bgImage) return false;
      if (obj?.type === 'cropzone') return false;
      // 如果某 image 对象不是背景底图（如用户贴的 sticker/icon），保留
      return true;
    });

    const serializedObjects = vectorObjects.map((obj) => {
      if (typeof obj.toObject === 'function') {
        return obj.toObject(SERIALIZE_PROPERTIES);
      }
      return obj;
    });

    log(`[tui-bridge] 成功抽取 ${serializedObjects.length} 个矢量标注元素`);

    return {
      objects: serializedObjects,
      version: fabricCanvas.version || '4.6.0',
    };
  } catch (err) {
    error('[tui-bridge] 抽取矢量图层数据失败:', err);
    return null;
  }
}

/**
 * 将矢量标注图层恢复注入到 TUI Canvas 中并恢复可编辑交互状态
 */
export async function applyVectorDataToTui(
  editorInstance: any,
  vectorData: IVectorLayerData | null,
): Promise<boolean> {
  if (!editorInstance || !vectorData || !Array.isArray(vectorData.objects)) {
    return false;
  }

  const fabricCanvas = getFabricCanvasFromTui(editorInstance);
  if (!fabricCanvas) {
    warn('[tui-bridge] 恢复矢量图层时无法获取 Fabric Canvas');
    return false;
  }

  try {
    // 1. 清空除 background 以外的历史矢量对象
    const existingObjects = fabricCanvas.getObjects ? fabricCanvas.getObjects().slice() : [];
    for (const obj of existingObjects) {
      if (obj !== fabricCanvas.backgroundImage && obj?.type !== 'cropzone') {
        fabricCanvas.remove(obj);
      }
    }

    if (vectorData.objects.length === 0) {
      fabricCanvas.renderAll();
      return true;
    }

    // 2. 获取 fabric 全局对象或通过 editor 实例获取
    const fabricLib =
      (window as any).fabric ||
      editorInstance._graphics?.fabric ||
      (editorInstance.constructor as any)?.fabric;

    if (!fabricLib || !fabricLib.util || typeof fabricLib.util.enlivenObjects !== 'function') {
      warn('[tui-bridge] 未找到 fabric.util.enlivenObjects 方法');
      return false;
    }

    // 动态注册缺失的扩展类与 fromObject 工厂函数（保证对 icon、arrowLine、arrow 等完整兼容）
    if (!fabricLib.Icon && fabricLib.Path) {
      const IconKlass = fabricLib.util.createClass(fabricLib.Path, {
        type: 'icon',
      });
      IconKlass.fromObject = function (object: any, callback: Function) {
        return fabricLib.Path.fromObject(object, (pathObj: any, isError: boolean) => {
          if (pathObj) {
            pathObj.set({ type: 'icon' });
          }
          if (typeof callback === 'function') {
            callback(pathObj, isError);
          }
        });
      };
      fabricLib.Icon = IconKlass;
    } else if (fabricLib.Icon && !fabricLib.Icon.fromObject && fabricLib.Path?.fromObject) {
      fabricLib.Icon.fromObject = function (object: any, callback: Function) {
        return fabricLib.Path.fromObject(object, (pathObj: any, isError: boolean) => {
          if (pathObj) {
            pathObj.set({ type: 'icon' });
          }
          if (typeof callback === 'function') {
            callback(pathObj, isError);
          }
        });
      };
    }

    if (!fabricLib.ArrowLine && fabricLib.Line) {
      fabricLib.ArrowLine = fabricLib.Line;
    }
    if (fabricLib.ArrowLine && !fabricLib.ArrowLine.fromObject && fabricLib.Line?.fromObject) {
      fabricLib.ArrowLine.fromObject = fabricLib.Line.fromObject;
    }
    if (!fabricLib.Arrow && fabricLib.Line) {
      fabricLib.Arrow = fabricLib.ArrowLine || fabricLib.Line;
    }

    // 预处理待反序列化的对象列表，确保所有对象的 type 在 fabric 命名空间中均有合法的构造工厂
    const safeObjects = vectorData.objects.map((rawObj) => {
      const obj = { ...rawObj };
      if (obj.type === 'icon' && !fabricLib.Icon) {
        obj.type = 'path';
      }
      return obj;
    });

    // 3. 批量实例化并注入画布
    return await new Promise<boolean>((resolve) => {
      fabricLib.util.enlivenObjects(
        safeObjects,
        (enlivenedObjects: any[]) => {
          const annotationMap = new Map<string, any[]>();

          enlivenedObjects.forEach((obj) => {
            // 确保恢复关键交互与样式属性
            obj.set({
              selectable: true,
              evented: true,
              hasControls: true,
              hasBorders: true,
              transparentCorners: false,
              cornerSize: 8,
              borderColor: '#007aff',
              cornerColor: '#007aff',
              hoverCursor: 'move',
              lockMovementX: false,
              lockMovementY: false,
              lockRotation: false,
              lockScalingX: false,
              lockScalingY: false,
            });

            if (obj.type === 'i-text' || obj.type === 'text') {
              obj.set({
                editable: true,
              });
            }

            fabricCanvas.add(obj);

            // 关键：必须调用 setCoords 计算 Fabric 点击测试与控制器包围盒
            if (typeof obj.setCoords === 'function') {
              obj.setCoords();
            }

            // 注册到 TUI 的内部 graphics 管理器中
            if (editorInstance._graphics && typeof editorInstance._graphics._addFabricObject === 'function') {
              editorInstance._graphics._addFabricObject(obj);
            }

            // 收集具备 annotationId 的对象以便配对联动
            if (obj.annotationId) {
              if (!annotationMap.has(obj.annotationId)) {
                annotationMap.set(obj.annotationId, []);
              }
              annotationMap.get(obj.annotationId)!.push(obj);
            }
          });

          // 恢复 Annotation 序号与形状的双向关联
          annotationMap.forEach((pair) => {
            if (pair.length === 2) {
              pair[0].relatedObj = pair[1];
              pair[1].relatedObj = pair[0];
            }
          });

          // 确保所有对象的碰撞包围盒均已重新校准
          enlivenedObjects.forEach((obj) => {
            if (typeof obj.setCoords === 'function') {
              obj.setCoords();
            }
          });

          // 确保停止任何阻碍选取的绘制模式，使 Canvas 进入自由选中与交互状态
          if (typeof editorInstance.stopDrawingMode === 'function') {
            editorInstance.stopDrawingMode();
          }

          fabricCanvas.selection = true;
          fabricCanvas.skipTargetFind = false;

          if (typeof fabricCanvas.discardActiveObject === 'function') {
            fabricCanvas.discardActiveObject();
          }
          fabricCanvas.renderAll();
          log(`[tui-bridge] 成功还原 ${enlivenedObjects.length} 个矢量对象并重绘画布`);
          resolve(true);
        },
        null,
      );
    });
  } catch (err) {
    error('[tui-bridge] 还原矢量图层数据失败:', err);
    return false;
  }
}

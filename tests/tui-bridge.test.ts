import { describe, it, expect, vi } from 'vitest';
import {
  resolveImageEditorConstructor,
  getFabricCanvasFromTui,
  extractVectorDataFromTui,
  applyVectorDataToTui,
} from '../src/utils/tui-image-editor-bridge';

describe('tui-image-editor-bridge tests', () => {
  it('should resolve constructor correctly', () => {
    const dummyCtor = function () {};
    expect(resolveImageEditorConstructor(dummyCtor)).toBe(dummyCtor);
    expect(resolveImageEditorConstructor({ default: dummyCtor })).toBe(dummyCtor);
    expect(resolveImageEditorConstructor({ default: { default: dummyCtor } })).toBe(dummyCtor);
    expect(() => resolveImageEditorConstructor({})).toThrow(TypeError);
  });

  it('should extract fabric canvas instance from editor', () => {
    const canvasObj = { id: 'canvas1' };

    expect(getFabricCanvasFromTui(null)).toBeNull();
    expect(getFabricCanvasFromTui({ getCanvas: () => canvasObj })).toBe(canvasObj);
    expect(getFabricCanvasFromTui({ _graphics: { getCanvas: () => canvasObj } })).toBe(canvasObj);
    expect(getFabricCanvasFromTui({ _graphics: { _canvas: canvasObj } })).toBe(canvasObj);
  });

  it('should extract vector data excluding background and cropzone', () => {
    const bgImage = { type: 'image', id: 'bg' };
    const cropzone = { type: 'cropzone', id: 'crop' };

    const rectObj = {
      type: 'rect',
      id: 'rect1',
      left: 10,
      top: 20,
      width: 100,
      height: 50,
      toObject: vi.fn((props: string[]) => ({
        type: 'rect',
        id: 'rect1',
        left: 10,
        top: 20,
        width: 100,
        height: 50,
      })),
    };

    const textObj = {
      type: 'text',
      id: 'text1',
      left: 30,
      top: 40,
      text: '1',
      relatedObj: rectObj,
      toObject: vi.fn((props: string[]) => ({
        type: 'text',
        id: 'text1',
        left: 30,
        top: 40,
        text: '1',
      })),
    };
    (rectObj as any).relatedObj = textObj;

    const mockCanvas = {
      backgroundImage: bgImage,
      version: '4.6.0',
      getObjects: () => [bgImage, cropzone, rectObj, textObj],
    };

    const editor = {
      getCanvas: () => mockCanvas,
    };

    const extracted = extractVectorDataFromTui(editor);
    expect(extracted).not.toBeNull();
    expect(extracted?.objects.length).toBe(2);
    expect(extracted?.objects[0].type).toBe('rect');
    expect(extracted?.objects[1].type).toBe('text');
    expect(rectObj.toObject).toHaveBeenCalled();
    expect(textObj.toObject).toHaveBeenCalled();
  });

  it('should apply vector data to canvas and restore annotation relationships', async () => {
    const bgImage = { type: 'image', id: 'bg' };
    const oldRect = { type: 'rect', id: 'oldRect' };
    const addedObjects: any[] = [];
    const removedObjects: any[] = [];

    const mockCanvas = {
      backgroundImage: bgImage,
      getObjects: () => [bgImage, oldRect],
      remove: vi.fn((obj: any) => removedObjects.push(obj)),
      add: vi.fn((obj: any) => addedObjects.push(obj)),
      discardActiveObject: vi.fn(),
      renderAll: vi.fn(),
    };

    const shapeObj: any = {
      type: 'circle',
      annotationId: 'ann_pair_1',
      set: vi.fn(),
    };
    const textObj: any = {
      type: 'text',
      annotationId: 'ann_pair_1',
      set: vi.fn(),
    };

    // 注入全局 fabric mock
    (window as any).fabric = {
      util: {
        enlivenObjects: (objects: any[], cb: (objs: any[]) => void) => {
          cb([shapeObj, textObj]);
        },
      },
    };

    const editor = {
      getCanvas: () => mockCanvas,
    };

    const vectorData = {
      objects: [
        { type: 'circle', annotationId: 'ann_pair_1' },
        { type: 'text', annotationId: 'ann_pair_1' },
      ],
      version: '4.6.0',
    };

    const result = await applyVectorDataToTui(editor, vectorData);
    expect(result).toBe(true);
    expect(mockCanvas.remove).toHaveBeenCalledWith(oldRect);
    expect(mockCanvas.remove).not.toHaveBeenCalledWith(bgImage);
    expect(shapeObj.set).toHaveBeenCalled();
    expect(textObj.set).toHaveBeenCalled();
    expect(shapeObj.relatedObj).toBe(textObj);
    expect(textObj.relatedObj).toBe(shapeObj);
    expect(mockCanvas.renderAll).toHaveBeenCalled();
  });
});

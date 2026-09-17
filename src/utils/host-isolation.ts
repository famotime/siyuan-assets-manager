/**
 * 宿主环境视口与 DOM 污染防御隔离模块
 * 负责思源笔记宿主滚动锁定、视口复位与 TUI 隐式 SVG 图标库隔离。
 */

export function resetHostViewport(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  try {
    if (document.body && (document.body.scrollTop !== 0 || document.body.scrollLeft !== 0)) {
      document.body.scrollTop = 0;
      document.body.scrollLeft = 0;
    }
    if (document.documentElement && (document.documentElement.scrollTop !== 0 || document.documentElement.scrollLeft !== 0)) {
      document.documentElement.scrollTop = 0;
      document.documentElement.scrollLeft = 0;
    }
    if (typeof window.scrollTo === 'function') {
      window.scrollTo(0, 0);
    }
  } catch (e) {
    // 忽略在受限环境下的滚动异常
  }
}

let originalBodyOverflow: string | null = null;
let originalHtmlOverflow: string | null = null;
let hostScrollLockCount = 0;
let isHostScrollListenerAttached = false;

function onHostScrollTriggered(): void {
  resetHostViewport();
}

/**
 * 锁定宿主环境滚动（设置 overflow: hidden 并绑定防滚拦截器），
 * 确保在进入图片编辑器以及整个编辑生命周期中，思源笔记 body 绝不会因聚焦、尺寸变动或滚轮发生纵向滚动。
 */
export function lockHostScroll(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  hostScrollLockCount += 1;
  if (hostScrollLockCount === 1) {
    if (document.body) {
      originalBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    if (document.documentElement) {
      originalHtmlOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
    }

    resetHostViewport();

    if (!isHostScrollListenerAttached) {
      window.addEventListener('scroll', onHostScrollTriggered, { passive: true });
      document.addEventListener('scroll', onHostScrollTriggered, { passive: true, capture: true });
      isHostScrollListenerAttached = true;
    }
  }
}

/**
 * 解锁宿主环境滚动，恢复宿主原有的 overflow 样式并解绑滚动拦截器。
 */
export function unlockHostScroll(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  hostScrollLockCount = Math.max(0, hostScrollLockCount - 1);
  if (hostScrollLockCount === 0) {
    if (document.body && originalBodyOverflow !== null) {
      document.body.style.overflow = originalBodyOverflow;
      originalBodyOverflow = null;
    }
    if (document.documentElement && originalHtmlOverflow !== null) {
      document.documentElement.style.overflow = originalHtmlOverflow;
      originalHtmlOverflow = null;
    }

    if (isHostScrollListenerAttached) {
      window.removeEventListener('scroll', onHostScrollTriggered);
      document.removeEventListener('scroll', onHostScrollTriggered, { capture: true });
      isHostScrollListenerAttached = false;
    }

    resetHostViewport();
  }
}

/**
 * 严格清理/隔离 TUI Image Editor 在 document.body 注入的 SVG 隐藏节点。
 * TUI 默认在 Theme 构造中通过 document.body.appendChild 挂载默认 SVG 图标库，
 * 该 SVG 缺少物理脱标定位样式，在思源笔记 Flex 垂直列流中可能被误计算高度（或因 CSS 覆盖占用 150px 高度），
 * 本函数确保其绝对定位于视口外且宽高物理归零。
 */
export function cleanTuiSvgArtifacts(): void {
  if (typeof document === 'undefined') {
    return;
  }

  const defs = document.getElementById('tui-image-editor-svg-default-icons');
  if (defs?.parentElement) {
    const svgEl = defs.parentElement as HTMLElement;
    svgEl.style.cssText =
      'display: none !important; position: absolute !important; top: -9999px !important; left: -9999px !important; width: 0 !important; height: 0 !important; overflow: hidden !important; pointer-events: none !important; visibility: hidden !important;';
  }

  // 兜底扫描挂载在 document.body 下的所有无类名隐藏 SVG 标签
  if (document.body) {
    const bodySvgs = document.body.querySelectorAll(':scope > svg');
    bodySvgs.forEach((el) => {
      const svg = el as HTMLElement;
      if (svg.getAttribute('display') === 'none' || svg.querySelector('#tui-image-editor-svg-default-icons')) {
        svg.style.cssText =
          'display: none !important; position: absolute !important; top: -9999px !important; left: -9999px !important; width: 0 !important; height: 0 !important; overflow: hidden !important; pointer-events: none !important; visibility: hidden !important;';
      }
    });
  }
}

/**
 * 在编辑器彻底退出或卸载时，移除挂载在 document.body 上的 TUI SVG 残留节点。
 */
export function removeTuiSvgArtifacts(): void {
  if (typeof document === 'undefined') {
    return;
  }

  const defs = document.getElementById('tui-image-editor-svg-default-icons');
  if (defs?.parentElement && defs.parentElement.parentElement === document.body) {
    try {
      document.body.removeChild(defs.parentElement);
    } catch (e) {
      // 节点若已被移除则忽略
    }
  }
}

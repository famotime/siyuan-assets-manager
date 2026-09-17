import { describe, expect, it } from 'vitest';
import {
  lockHostScroll,
  unlockHostScroll,
  resetHostViewport,
  cleanTuiSvgArtifacts,
  removeTuiSvgArtifacts,
} from '../src/utils/host-isolation';

describe('Host Isolation Module', () => {
  describe('resetHostViewport', () => {
    it('safely handles environments with or without window/document', () => {
      document.body.scrollTop = 0;
      document.documentElement.scrollTop = 0;
      expect(() => resetHostViewport()).not.toThrow();
    });
  });

  describe('lockHostScroll and unlockHostScroll', () => {
    it('locks body and html overflow to hidden and restores original overflow upon unlock', () => {
      document.body.style.overflow = 'auto';
      document.documentElement.style.overflow = 'visible';

      lockHostScroll();
      expect(document.body.style.overflow).toBe('hidden');
      expect(document.documentElement.style.overflow).toBe('hidden');

      unlockHostScroll();
      expect(document.body.style.overflow).toBe('auto');
      expect(document.documentElement.style.overflow).toBe('visible');
    });

    it('supports nested lock and unlock calls safely', () => {
      document.body.style.overflow = 'scroll';

      lockHostScroll();
      lockHostScroll();
      expect(document.body.style.overflow).toBe('hidden');

      unlockHostScroll();
      expect(document.body.style.overflow).toBe('hidden');

      unlockHostScroll();
      expect(document.body.style.overflow).toBe('scroll');
    });
  });

  describe('cleanTuiSvgArtifacts and removeTuiSvgArtifacts', () => {
    it('isolates injected TUI SVG to out-of-flow zero dimensions', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('display', 'none');
      const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      defs.id = 'tui-image-editor-svg-default-icons';
      svg.appendChild(defs);
      document.body.appendChild(svg);

      try {
        cleanTuiSvgArtifacts();
        expect(svg.style.position).toBe('absolute');
        expect(svg.style.width).toBe('0px');
        expect(svg.style.height).toBe('0px');
      } finally {
        removeTuiSvgArtifacts();
        expect(document.getElementById('tui-image-editor-svg-default-icons')).toBeNull();
      }
    });
  });
});

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createApp, type App } from 'vue';
import AssetMediaPreview from '../src/components/AssetMediaPreview.vue';

describe('AssetMediaPreview component', () => {
  let app: App | null = null;
  let mountContainer: HTMLDivElement;

  beforeEach(() => {
    mountContainer = document.createElement('div');
    document.body.appendChild(mountContainer);

    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();
    window.HTMLMediaElement.prototype.load = vi.fn();
  });

  afterEach(() => {
    app?.unmount();
    mountContainer.remove();
    vi.restoreAllMocks();
  });

  it('renders image preview correctly', () => {
    const Wrapper = {
      components: { AssetMediaPreview },
      template: `
        <AssetMediaPreview
          previewUrl="/assets/test.png"
          previewType="image"
          :previewStyle="{ top: '10px', left: '10px' }"
        />
      `,
    };

    app = createApp(Wrapper);
    app.mount(mountContainer);

    const img = mountContainer.querySelector<HTMLImageElement>('img');
    expect(img).not.toBeNull();
    expect(img!.src).toContain('/assets/test.png');
  });

  it('renders video preview with default muted and interactive controls', async () => {
    const Wrapper = {
      components: { AssetMediaPreview },
      template: `
        <AssetMediaPreview
          previewUrl="/assets/video.mp4"
          previewType="video"
          :previewStyle="{ top: '20px', left: '20px' }"
        />
      `,
    };

    app = createApp(Wrapper);
    app.mount(mountContainer);

    const video = mountContainer.querySelector<HTMLVideoElement>('video');
    expect(video).not.toBeNull();
    expect(video!.muted).toBe(true);

    const controls = mountContainer.querySelector('.video-controls-overlay');
    expect(controls).not.toBeNull();

    const playBtn = mountContainer.querySelector<HTMLButtonElement>('.play-pause-btn');
    expect(playBtn).not.toBeNull();

    const muteBtn = mountContainer.querySelector<HTMLButtonElement>('.mute-btn');
    expect(muteBtn).not.toBeNull();

    // 触发点击静音按钮切换
    muteBtn!.click();
    expect(video!.muted).toBe(false);
  });

  it('renders audio preview and controls correctly', () => {
    const Wrapper = {
      components: { AssetMediaPreview },
      template: `
        <AssetMediaPreview
          previewUrl="/assets/audio.mp3"
          previewType="audio"
          :previewAsset="{ name: 'audio.mp3' }"
          :previewStyle="{ top: '30px', left: '30px' }"
        />
      `,
    };

    app = createApp(Wrapper);
    app.mount(mountContainer);

    const audio = mountContainer.querySelector<HTMLAudioElement>('audio');
    expect(audio).not.toBeNull();

    const audioTitle = mountContainer.querySelector('.audio-title');
    expect(audioTitle?.textContent).toContain('audio');

    const waveform = mountContainer.querySelector('.audio-waveform-bars');
    expect(waveform).not.toBeNull();
  });
});

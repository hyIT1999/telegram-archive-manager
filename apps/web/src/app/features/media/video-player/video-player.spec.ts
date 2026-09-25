import { Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MemoryStorage } from '../../../../testing/memory-storage';
import { PLAYBACK_STORAGE } from '../playback-memory';
import { VideoPlayer } from './video-player';

@Component({
  template: `<app-video-player
    [src]="src()"
    kind="video"
    title="Lesson 3"
    mediaId="media-3"
    messageId="message-3"
    [durationHint]="600"
    saveUrl="/api/media/media-3/content?download=1"
  />`,
  imports: [VideoPlayer],
})
class Host {
  readonly src = signal('/api/media/media-3/content');
}

/** jsdom queues media events as tasks. */
const nextTask = () => new Promise((resolve) => setTimeout(resolve));

describe('VideoPlayer', () => {
  let fixture: ComponentFixture<Host>;
  let storage: MemoryStorage;

  beforeEach(async () => {
    // jsdom has no media playback: play and pause flip `paused` and fire the events.
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      Object.defineProperty(this, 'paused', { configurable: true, value: false });
      this.dispatchEvent(new Event('play'));
      return Promise.resolve();
    });
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      Object.defineProperty(this, 'paused', { configurable: true, value: true });
      this.dispatchEvent(new Event('pause'));
    });
    storage = new MemoryStorage();
    TestBed.configureTestingModule({
      providers: [
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: PLAYBACK_STORAGE, useValue: storage },
      ],
    });
  });

  afterEach(() => vi.restoreAllMocks());

  async function render(): Promise<{ element: HTMLElement; video: HTMLVideoElement }> {
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    return { element, video: element.querySelector('video') as HTMLVideoElement };
  }

  /** What the browser reports once it read the start of the file. */
  async function loadMetadata(video: HTMLVideoElement, duration = 600): Promise<void> {
    Object.defineProperty(video, 'duration', { configurable: true, value: duration });
    video.dispatchEvent(new Event('loadedmetadata'));
    await fixture.whenStable();
  }

  const control = (element: HTMLElement, label: string) =>
    element.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

  it('streams the file with its preview and plays and pauses', async () => {
    const { element, video } = await render();
    expect(video.getAttribute('src')).toBe('/api/media/media-3/content');
    expect(video.getAttribute('preload')).toBe('metadata');
    await loadMetadata(video);
    expect(element.textContent).toContain('0:00 / 10:00');

    control(element, 'Play')?.click();
    await fixture.whenStable();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(control(element, 'Pause')).not.toBeNull();

    control(element, 'Pause')?.click();
    await fixture.whenStable();
    expect(control(element, 'Play')).not.toBeNull();
  });

  it('seeks with the slider, the buttons and the keys', async () => {
    const { element, video } = await render();
    await loadMetadata(video);
    const slider = element.querySelector<HTMLInputElement>('input.seek');
    if (slider) {
      slider.value = '120';
      slider.dispatchEvent(new Event('input'));
    }
    expect(video.currentTime).toBe(120);

    control(element, 'Forward 10 seconds')?.click();
    expect(video.currentTime).toBe(130);

    const frame = element.querySelector('.frame') as HTMLElement;
    frame.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(video.currentTime).toBe(125);
    frame.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
    expect(video.currentTime).toBe(115);
    frame.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(video.currentTime).toBe(0);
    frame.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('changes speed and volume, and remembers them for the next file', async () => {
    const { element, video } = await render();
    await loadMetadata(video);

    control(element, 'Playback speed 1×')?.click();
    await fixture.whenStable();
    const option = Array.from(document.querySelectorAll<HTMLButtonElement>('[mat-menu-item]')).find(
      (item) => item.textContent?.trim() === '1.5×',
    );
    option?.click();
    await nextTask();
    await fixture.whenStable();
    expect(video.playbackRate).toBe(1.5);
    expect(control(element, 'Playback speed 1.5×')).not.toBeNull();

    const frame = element.querySelector('.frame') as HTMLElement;
    frame.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    frame.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
    await nextTask();
    await fixture.whenStable();
    expect(video.volume).toBeCloseTo(0.9);
    expect(video.muted).toBe(true);
    expect(JSON.parse(storage.getItem('tam.player.preferences') ?? '{}')).toEqual({
      volume: 0.9,
      muted: true,
      rate: 1.5,
    });
  });

  it('resumes where the file was left and remembers the new place', async () => {
    storage.setItem(
      'tam.player.progress',
      JSON.stringify([
        {
          mediaId: 'media-3',
          messageId: 'message-3',
          title: 'Lesson 3',
          kind: 'video',
          position: 200,
          duration: 600,
          updatedAt: 1,
        },
      ]),
    );
    const { element, video } = await render();
    await loadMetadata(video);
    expect(video.currentTime).toBe(200);
    expect(element.textContent).toContain('Resumed at 3:20');

    video.currentTime = 250;
    video.dispatchEvent(new Event('timeupdate'));
    video.dispatchEvent(new Event('pause'));
    const saved = JSON.parse(storage.getItem('tam.player.progress') ?? '[]') as {
      position: number;
    }[];
    expect(saved[0]?.position).toBe(250);

    Array.from(element.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Start over'))
      ?.click();
    await fixture.whenStable();
    expect(video.currentTime).toBe(0);
    expect(element.textContent).not.toContain('Resumed at');
  });

  it('goes full screen and offers the file when the browser cannot play it', async () => {
    const { element, video } = await render();
    const frame = element.querySelector('.frame') as HTMLElement;
    const requestFullscreen = vi.fn(() => Promise.resolve());
    Object.defineProperty(frame, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    });
    control(element, 'Full screen')?.click();
    expect(requestFullscreen).toHaveBeenCalled();

    Object.defineProperty(video, 'error', { configurable: true, value: { code: 4 } });
    video.dispatchEvent(new Event('error'));
    await fixture.whenStable();
    const failure = element.querySelector('.failure');
    expect(failure?.textContent).toContain('This browser cannot play the file.');
    expect(failure?.querySelector('a')?.getAttribute('href')).toBe(
      '/api/media/media-3/content?download=1',
    );
  });
});

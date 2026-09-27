import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter } from '@angular/router';
import { makeMediaSummary } from '../../../../testing/fixtures';
import { MEDIA_ENDPOINTS } from '../media-api';
import { ImageViewer } from './image-viewer';
import type { ViewerImage } from './viewer-image';

describe('ImageViewer', () => {
  let viewer: ImageViewer;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    viewer = TestBed.inject(ImageViewer);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const images: ViewerImage[] = [
    {
      messageId: 'message-1',
      title: 'Board, page 1',
      media: makeMediaSummary({
        type: 'PHOTO',
        mimeType: 'image/jpeg',
        downloadStatus: 'DOWNLOADED',
      }),
    },
    {
      messageId: 'message-2',
      title: 'Board, page 2',
      media: makeMediaSummary({ type: 'PHOTO', mimeType: 'image/jpeg' }),
    },
  ];

  const pane = () => document.querySelector('app-image-viewer') as HTMLElement;
  const tool = (label: string) =>
    pane().querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
  const image = () => pane().querySelector<HTMLImageElement>('img.image');

  async function openAt(index: number) {
    const ref = viewer.open(images, index);
    await vi.waitFor(() => expect(pane()).not.toBeNull());
    TestBed.tick();
    return ref;
  }

  it('shows the downloaded file full size and moves to the next image', async () => {
    const ref = await openAt(0);
    expect(pane().querySelector('h2')?.textContent).toContain('Board, page 1');
    expect(pane().textContent).toContain('1 / 2');
    expect(image()?.getAttribute('src')).toBe(MEDIA_ENDPOINTS.content(images[0]?.media.id ?? ''));
    expect(tool('Previous image')).toBeNull();
    expect(pane().querySelector(`a[href="/messages/message-1"]`)).not.toBeNull();

    tool('Next image')?.click();
    TestBed.tick();
    expect(pane().textContent).toContain('2 / 2');
    // Not downloaded: Telegram's preview, and a way to get the full file.
    expect(image()?.getAttribute('src')).toBe(MEDIA_ENDPOINTS.thumbnail(images[1]?.media.id ?? ''));
    expect(pane().textContent).toContain('A small preview');
    expect(pane().querySelector('app-media-download-control button')?.textContent).toContain(
      'Download',
    );
    ref.close();
  });

  it('zooms with the buttons and the keys, and every image starts at normal size', async () => {
    const ref = await openAt(0);
    expect(tool('Zoom out')?.disabled).toBe(true);

    tool('Zoom in')?.click();
    TestBed.tick();
    expect(image()?.style.transform).toContain('scale(1.5)');
    pane().dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }));
    TestBed.tick();
    expect(image()?.style.transform).toContain('scale(2.25)');
    pane().dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true }));
    TestBed.tick();
    expect(image()?.style.transform).toContain('scale(1)');

    tool('Zoom in')?.click();
    pane().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    TestBed.tick();
    expect(pane().textContent).toContain('2 / 2');
    expect(image()?.style.transform).toContain('scale(1)');
    pane().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    TestBed.tick();
    expect(pane().textContent).toContain('1 / 2');
    ref.close();
  });

  describe('with the mouse, fingers and full screen', () => {
    const stage = () => pane().querySelector<HTMLElement>('.stage') as HTMLElement;

    /** A pointer event (jsdom has no PointerEvent: a MouseEvent carrying a pointer id). */
    function pointer(type: string, pointerId: number, clientX: number, clientY = 100): void {
      const event = new MouseEvent(type, { clientX, clientY, bubbles: true, cancelable: true });
      Object.defineProperty(event, 'pointerId', { value: pointerId });
      stage().dispatchEvent(event);
      TestBed.tick();
    }

    it('zooms with a double click or the wheel', async () => {
      const ref = await openAt(0);
      stage().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      TestBed.tick();
      expect(image()?.style.transform).toContain('scale(2.5)');
      expect(image()?.classList).toContain('zoomed');
      stage().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      TestBed.tick();
      expect(image()?.style.transform).toContain('scale(1)');

      stage().dispatchEvent(
        new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }),
      );
      TestBed.tick();
      expect(image()?.style.transform).toContain('scale(1.2)');
      stage().dispatchEvent(
        new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }),
      );
      TestBed.tick();
      expect(image()?.style.transform).toContain('scale(1)');
      ref.close();
    });

    it('moves between images with a swipe at normal size, not with a short or upward drag', async () => {
      const ref = await openAt(0);
      pointer('pointerdown', 1, 300);
      pointer('pointerup', 1, 280);
      expect(pane().textContent).toContain('1 / 2');
      pointer('pointerdown', 1, 300, 100);
      pointer('pointerup', 1, 220, 300);
      expect(pane().textContent).toContain('1 / 2');

      pointer('pointerdown', 1, 300);
      pointer('pointerup', 1, 150);
      expect(pane().textContent).toContain('2 / 2');
      pointer('pointerdown', 1, 150);
      pointer('pointerup', 1, 300);
      expect(pane().textContent).toContain('1 / 2');
      ref.close();
    });

    it('zooms with two fingers, and a zoomed image does not swipe', async () => {
      const ref = await openAt(0);
      pointer('pointerdown', 1, 100);
      pointer('pointerdown', 2, 200);
      pointer('pointermove', 2, 300);
      expect(image()?.style.transform).toContain('scale(2)');
      pointer('pointerup', 2, 300);
      pointer('pointerup', 1, 100);

      pointer('pointerdown', 1, 300);
      pointer('pointermove', 1, 200);
      pointer('pointerup', 1, 100);
      expect(pane().textContent).toContain('1 / 2');
      ref.close();
    });

    it('goes full screen with its button or F, and says so', async () => {
      const ref = await openAt(0);
      const host = pane();
      let fullscreenElement: Element | null = null;
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        get: () => fullscreenElement,
      });
      host.requestFullscreen = vi.fn(async () => {
        fullscreenElement = host;
        document.dispatchEvent(new Event('fullscreenchange'));
      });
      document.exitFullscreen = vi.fn(async () => {
        fullscreenElement = null;
        document.dispatchEvent(new Event('fullscreenchange'));
      });

      tool('Full screen')?.click();
      await vi.waitFor(() => {
        TestBed.tick();
        expect(tool('Leave full screen')).not.toBeNull();
      });
      host.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
      await vi.waitFor(() => {
        TestBed.tick();
        expect(tool('Full screen')).not.toBeNull();
      });
      expect(document.exitFullscreen).toHaveBeenCalled();
      delete (document as { fullscreenElement?: unknown }).fullscreenElement;
      ref.close();
    });
  });

  it('closes with its button', async () => {
    const ref = await openAt(1);
    const closed = vi.fn();
    ref.afterClosed().subscribe(closed);
    tool('Close')?.click();
    await vi.waitFor(() => expect(closed).toHaveBeenCalled());
  });
});

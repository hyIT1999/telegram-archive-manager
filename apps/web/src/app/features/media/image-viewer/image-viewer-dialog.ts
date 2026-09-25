import {
  Component,
  DOCUMENT,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogClose, MatDialogRef } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import type { MediaDto } from '../../../shared/models';
import { MEDIA_ENDPOINTS } from '../media-api';
import { MediaDownloadControl } from '../media-download-control';
import {
  MAX_SCALE,
  ZOOM_RESET,
  ZOOM_STEP,
  type ZoomBounds,
  type ZoomState,
  panBy,
  zoomAt,
  zoomTransform,
} from '../zoom';
import type { ViewerImage } from './viewer-image';

export interface ImageViewerData {
  readonly images: readonly ViewerImage[];
  readonly index: number;
}

/** A horizontal drag this long (px) at normal size moves to the next or previous image. */
const SWIPE_DISTANCE = 60;

/**
 * Full-screen image viewer: zoom with the buttons, keys (+ − 0), the wheel, a double click or two
 * fingers; drag to move a zoomed image; previous/next with the arrows, keys or a swipe.
 */
@Component({
  selector: 'app-image-viewer',
  imports: [MatDialogClose, MatIcon, MatIconButton, MatTooltip, MediaDownloadControl, RouterLink],
  templateUrl: './image-viewer-dialog.html',
  styleUrl: './image-viewer-dialog.scss',
  host: {
    '(keydown)': 'key($event)',
    '(document:fullscreenchange)': 'fullscreenChanged()',
  },
})
export class ImageViewerDialog {
  private readonly data = inject<ImageViewerData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<ImageViewerDialog>>(MatDialogRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);
  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');
  private readonly image = viewChild<ElementRef<HTMLImageElement>>('image');

  protected readonly images = signal<readonly ViewerImage[]>(this.data.images);
  protected readonly index = signal(
    Math.min(Math.max(0, this.data.index), Math.max(0, this.data.images.length - 1)),
  );
  protected readonly current = computed(() => this.images()[this.index()] as ViewerImage);
  protected readonly downloaded = computed(
    () => this.current().media.downloadStatus === 'DOWNLOADED',
  );
  protected readonly src = computed(() => {
    const media = this.current().media;
    if (media.downloadStatus === 'DOWNLOADED') {
      return MEDIA_ENDPOINTS.content(media.id);
    }
    return media.hasThumbnail ? MEDIA_ENDPOINTS.thumbnail(media.id) : null;
  });
  protected readonly saveUrl = computed(() =>
    MEDIA_ENDPOINTS.content(this.current().media.id, true),
  );
  protected readonly zoom = signal<ZoomState>(ZOOM_RESET);
  protected readonly transform = computed(() => zoomTransform(this.zoom()));
  protected readonly fullscreen = signal(false);
  protected readonly maxScale = MAX_SCALE;

  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch: { distance: number; start: ZoomState } | null = null;
  private swipeFrom: { x: number; y: number } | null = null;

  constructor() {
    // Every image starts at normal size.
    effect(() => {
      this.index();
      this.zoom.set(ZOOM_RESET);
    });
  }

  protected previous(): void {
    this.index.update((index) => Math.max(0, index - 1));
  }

  protected next(): void {
    this.index.update((index) => Math.min(this.images().length - 1, index + 1));
  }

  protected zoomIn(): void {
    this.zoom.update((state) => zoomAt(state, ZOOM_STEP, this.bounds()));
  }

  protected zoomOut(): void {
    this.zoom.update((state) => zoomAt(state, 1 / ZOOM_STEP, this.bounds()));
  }

  protected resetZoom(): void {
    this.zoom.set(ZOOM_RESET);
  }

  protected close(): void {
    this.dialogRef.close();
  }

  protected toggleFullscreen(): void {
    if (this.document.fullscreenElement) {
      void this.document.exitFullscreen?.().catch(() => undefined);
    } else {
      void this.host.nativeElement.requestFullscreen?.().catch(() => undefined);
    }
  }

  protected fullscreenChanged(): void {
    this.fullscreen.set(this.document.fullscreenElement === this.host.nativeElement);
  }

  /** The file finished downloading (or changed state) in the control below the image. */
  protected mediaChanged(media: MediaDto): void {
    const index = this.index();
    this.images.update((images) =>
      images.map((image, position) => (position === index ? { ...image, media } : image)),
    );
  }

  protected key(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowLeft':
        this.previous();
        break;
      case 'ArrowRight':
        this.next();
        break;
      case '+':
      case '=':
        this.zoomIn();
        break;
      case '-':
        this.zoomOut();
        break;
      case '0':
        this.resetZoom();
        break;
      case 'f':
      case 'F':
        this.toggleFullscreen();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  protected wheel(event: WheelEvent): void {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.2 : 1 / 1.2;
    this.zoom.update((state) => zoomAt(state, factor, this.bounds(), this.pointFrom(event)));
  }

  protected doubleClick(event: MouseEvent): void {
    const state = this.zoom();
    this.zoom.set(
      state.scale > 1 ? ZOOM_RESET : zoomAt(state, 2.5, this.bounds(), this.pointFrom(event)),
    );
  }

  protected pointerDown(event: PointerEvent): void {
    this.stage().nativeElement.setPointerCapture?.(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 2) {
      this.pinch = { distance: this.pointerDistance(), start: this.zoom() };
      this.swipeFrom = null;
    } else if (this.pointers.size === 1) {
      this.swipeFrom = { x: event.clientX, y: event.clientY };
    }
  }

  protected pointerMove(event: PointerEvent): void {
    const before = this.pointers.get(event.pointerId);
    if (!before) {
      return;
    }
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pinch && this.pointers.size === 2) {
      const factor = this.pointerDistance() / Math.max(1, this.pinch.distance);
      this.zoom.set(zoomAt(this.pinch.start, factor, this.bounds(), this.pinchCentre()));
    } else if (this.pointers.size === 1 && this.zoom().scale > 1) {
      this.zoom.update((state) =>
        panBy(state, event.clientX - before.x, event.clientY - before.y, this.bounds()),
      );
    }
  }

  protected pointerUp(event: PointerEvent): void {
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) {
      this.pinch = null;
    }
    const from = this.swipeFrom;
    if (from && this.pointers.size === 0 && this.zoom().scale === 1) {
      const dx = event.clientX - from.x;
      const dy = event.clientY - from.y;
      if (Math.abs(dx) > SWIPE_DISTANCE && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (dx < 0) {
          this.next();
        } else {
          this.previous();
        }
      }
    }
    if (this.pointers.size === 0) {
      this.swipeFrom = null;
    }
  }

  /** The image's size at normal zoom (the stage's, before it loaded). */
  private bounds(): ZoomBounds {
    const element = this.image()?.nativeElement ?? this.stage().nativeElement;
    return { width: element.clientWidth, height: element.clientHeight };
  }

  /** Where an event happened, from the stage's centre. */
  private pointFrom(event: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.stage().nativeElement.getBoundingClientRect();
    return {
      x: event.clientX - (rect.left + rect.width / 2),
      y: event.clientY - (rect.top + rect.height / 2),
    };
  }

  private pointerDistance(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 1;
  }

  private pinchCentre(): { x: number; y: number } {
    const [a, b] = [...this.pointers.values()];
    return a && b
      ? this.pointFrom({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 })
      : { x: 0, y: 0 };
  }
}

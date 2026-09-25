import { DatePipe, DecimalPipe, Location } from '@angular/common';
import { Component, computed, inject, input, linkedSignal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { Router, RouterLink } from '@angular/router';
import { ImageViewer } from '../../features/media/image-viewer/image-viewer';
import { viewerImages } from '../../features/media/image-viewer/viewer-image';
import { MEDIA_ENDPOINTS } from '../../features/media/media-api';
import { MediaDownloadControl } from '../../features/media/media-download-control';
import { durationLabel, fileKind, viewerKind } from '../../features/media/media-labels';
import { PdfPreview } from '../../features/media/pdf-preview';
import { VideoPlayer } from '../../features/media/video-player/video-player';
import {
  CATEGORY_TYPES,
  mediaStatusLabel,
  messageTitle,
  serviceActionLabel,
  typeIcon,
  typeLabel,
} from '../../features/messages/message-labels';
import { MessageText } from '../../features/messages/message-text';
import { MessagesApi } from '../../features/messages/messages-api';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { ErrorState } from '../../shared/components/error-state/error-state';
import { Notice } from '../../shared/components/notice/notice';
import { PageHeader } from '../../shared/components/page-header/page-header';
import { Skeleton } from '../../shared/components/skeleton/skeleton';
import {
  type MediaDto,
  type MessageDto,
  type MessageSummaryDto,
  isNotFoundError,
  toApiError,
} from '../../shared/models';
import { BytesPipe } from '../../shared/pipes/bytes-pipe';

const MEDIA_TYPES = new Set([
  ...CATEGORY_TYPES.videos,
  ...CATEGORY_TYPES.images,
  ...CATEGORY_TYPES.documents,
  ...CATEGORY_TYPES.audio,
]);

/**
 * One message: its file in the right viewer (video and audio player, image viewer, PDF preview,
 * file card), or a Download button while the file is not in the archive yet; its album, formatted
 * text, where it sits in Telegram, and the previous and next message of the same topic and kind.
 */
@Component({
  selector: 'app-message-detail-page',
  imports: [
    BytesPipe,
    DatePipe,
    DecimalPipe,
    EmptyState,
    ErrorState,
    MatButton,
    MatIcon,
    MediaDownloadControl,
    MessageText,
    Notice,
    PageHeader,
    PdfPreview,
    RouterLink,
    Skeleton,
    VideoPlayer,
  ],
  templateUrl: './message-detail-page.html',
  styleUrl: './message-detail-page.scss',
})
export class MessageDetailPage {
  /** Route parameter `:id`, bound by the router. */
  readonly id = input.required<string>();

  private readonly api = inject(MessagesApi);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly viewer = inject(ImageViewer);

  private readonly messageId = computed(() => this.id());
  protected readonly message = rxResource({
    params: () => this.messageId(),
    stream: ({ params }) => this.api.get(params),
  });
  protected readonly data = computed<MessageDto | undefined>(() =>
    this.message.hasValue() ? this.message.value() : undefined,
  );
  protected readonly notFound = computed(() => isNotFoundError(this.message.error()));
  protected readonly errorMessage = computed(() => toApiError(this.message.error()).message);

  /** The file as last seen; the download control keeps it current. */
  protected readonly media = linkedSignal<MediaDto | null>(() => this.data()?.media ?? null);
  protected readonly title = computed(() => {
    const data = this.data();
    return data ? messageTitle(data) : 'Message';
  });
  protected readonly subtitle = computed(() => {
    const data = this.data();
    return data ? typeLabel(data.type) : '';
  });
  protected readonly kind = computed(() => viewerKind(this.media()?.mimeType));
  protected readonly downloaded = computed(() => this.media()?.downloadStatus === 'DOWNLOADED');
  protected readonly contentUrl = computed(() => {
    const media = this.media();
    return media ? MEDIA_ENDPOINTS.content(media.id) : '';
  });
  protected readonly saveUrl = computed(() => {
    const media = this.media();
    return media ? MEDIA_ENDPOINTS.content(media.id, true) : null;
  });
  protected readonly thumbnailUrl = computed(() => {
    const media = this.media();
    return media?.hasThumbnail ? MEDIA_ENDPOINTS.thumbnail(media.id) : null;
  });
  protected readonly fileInfo = computed(() => {
    const media = this.media();
    return fileKind(media?.mimeType, media?.fileName);
  });
  protected readonly length = computed(() => durationLabel(this.media()?.duration));
  protected readonly dimensions = computed(() => {
    const media = this.media();
    return media?.width && media.height ? `${media.width} × ${media.height}` : null;
  });
  protected readonly status = computed(() => {
    const media = this.media();
    return media ? mediaStatusLabel(media) : null;
  });
  /** What the file lets the reader do once downloaded. */
  protected readonly goal = computed(() => {
    switch (this.kind()) {
      case 'video':
        return 'watch it here';
      case 'audio':
        return 'listen to it here';
      case 'pdf':
        return 'read it here';
      case 'image':
        return 'see it in full size';
      default:
        return 'save it to this device';
    }
  });
  /** A file message whose file was never archived (self-destructing media is not kept). */
  protected readonly missingFile = computed(() => {
    const data = this.data();
    return data !== undefined && data.media === null && MEDIA_TYPES.has(data.type);
  });
  protected readonly text = computed(() => {
    const data = this.data();
    return data ? (data.text ?? data.caption) : null;
  });
  /** An album's caption sits on one of its messages; the others show it too. */
  protected readonly albumCaption = computed(() => {
    const data = this.data();
    if (!data || this.text() || data.album.length < 2) {
      return null;
    }
    return data.album.find((item) => item.excerpt !== null)?.excerpt ?? null;
  });
  protected readonly albumPosition = computed(() => {
    const data = this.data();
    return data ? data.album.findIndex((item) => item.id === data.id) + 1 : 0;
  });
  protected readonly serviceLabel = computed(() => {
    const data = this.data();
    return data?.type === 'SERVICE' ? serviceActionLabel(data.serviceAction) : null;
  });

  protected mediaChanged(media: MediaDto): void {
    this.media.set(media);
  }

  protected albumThumbnail(item: MessageSummaryDto): string | null {
    return item.media?.hasThumbnail ? MEDIA_ENDPOINTS.thumbnail(item.media.id) : null;
  }

  protected albumIcon(item: MessageSummaryDto): string {
    return typeIcon(item.type);
  }

  protected albumLength(item: MessageSummaryDto): string | null {
    return durationLabel(item.media?.duration);
  }

  /** The image full screen, among the other images of its album. */
  protected openImage(): void {
    const data = this.data();
    const media = this.media();
    if (!data || !media) {
      return;
    }
    const items = data.album.length > 0 ? data.album : [data];
    const images = viewerImages(
      items.map((item) => (item.id === data.id ? { ...item, media } : item)),
    );
    const index = images.findIndex((image) => image.messageId === data.id);
    this.viewer.open(images, Math.max(0, index));
  }

  /** Back to where the reader came from, or to all messages when they arrived by link. */
  protected back(): void {
    if (this.router.lastSuccessfulNavigation()?.previousNavigation) {
      this.location.back();
    } else {
      void this.router.navigate(['/messages']);
    }
  }
}

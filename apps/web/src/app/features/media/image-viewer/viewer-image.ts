import type { MediaSummaryDto, MessageSummaryDto } from '../../../shared/models';
import { messageTitle } from '../../messages/message-labels';
import { viewerKind } from '../media-labels';

/** One image the viewer can show: its file and the message it belongs to. */
export interface ViewerImage {
  readonly messageId: string;
  readonly title: string;
  readonly media: MediaSummaryDto;
}

/** The images among messages (photos, and images sent as files), in the same order. */
export function viewerImages(items: readonly MessageSummaryDto[]): ViewerImage[] {
  return items.flatMap((item) =>
    item.media && viewerKind(item.media.mimeType) === 'image'
      ? [{ messageId: item.id, title: messageTitle(item), media: item.media }]
      : [],
  );
}

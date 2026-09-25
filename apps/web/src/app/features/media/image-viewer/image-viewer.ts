import { Injectable, inject } from '@angular/core';
import { MatDialog, type MatDialogRef } from '@angular/material/dialog';
import { type ImageViewerData, ImageViewerDialog } from './image-viewer-dialog';
import type { ViewerImage } from './viewer-image';

/** Opens images full screen, with zoom and previous/next among the images given. */
@Injectable({ providedIn: 'root' })
export class ImageViewer {
  private readonly dialog = inject(MatDialog);

  open(images: readonly ViewerImage[], index = 0): MatDialogRef<ImageViewerDialog> {
    const data: ImageViewerData = { images, index };
    return this.dialog.open(ImageViewerDialog, {
      data,
      panelClass: 'image-viewer-panel',
      width: '100vw',
      height: '100dvh',
      maxWidth: '100vw',
      maxHeight: '100dvh',
      autoFocus: 'dialog',
      restoreFocus: true,
      ariaLabel: 'Image viewer',
    });
  }
}

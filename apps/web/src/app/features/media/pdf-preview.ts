import { Component, computed, inject, input } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { MEDIA_ENDPOINTS } from './media-api';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A downloaded PDF in the browser's own viewer. The frame only ever loads this api's file route
 * for a media id, so trusting that URL is safe.
 */
@Component({
  selector: 'app-pdf-preview',
  imports: [MatButton, MatIcon],
  template: `
    @if (frameUrl(); as url) {
      <iframe class="frame" [src]="url" [title]="'Preview of ' + title()"></iframe>
    }
    <div class="actions">
      <a matButton="tonal" [href]="openUrl()" target="_blank" rel="noopener">
        <mat-icon>open_in_new</mat-icon>
        Open in a new tab
      </a>
      <a matButton [href]="saveUrl()" download>
        <mat-icon>file_download</mat-icon>
        Save file
      </a>
    </div>
  `,
  styles: `
    :host {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 12px;
    }

    .frame {
      width: 100%;
      height: min(80dvh, 1100px);
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: var(--mat-sys-corner-medium);
      background: var(--mat-sys-surface-container);
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }
  `,
})
export class PdfPreview {
  readonly mediaId = input.required<string>();
  readonly title = input('');

  private readonly sanitizer = inject(DomSanitizer);

  protected readonly openUrl = computed(() => MEDIA_ENDPOINTS.content(this.mediaId()));
  protected readonly saveUrl = computed(() => MEDIA_ENDPOINTS.content(this.mediaId(), true));
  protected readonly frameUrl = computed<SafeResourceUrl | null>(() => {
    const id = this.mediaId();
    return UUID.test(id)
      ? this.sanitizer.bypassSecurityTrustResourceUrl(MEDIA_ENDPOINTS.content(id))
      : null;
  });
}

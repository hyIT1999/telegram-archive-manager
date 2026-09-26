import {
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { finalize } from 'rxjs';
import { NotifyService } from '../../core/services/notify-service';
import { toApiError } from '../../shared/models';
import { MessageChanges, favoriteChanged } from '../messages/message-changes';
import { FavoritesApi } from './favorites-api';

/**
 * The heart that makes a message a favorite. It changes at once and tells every list about it;
 * when the server refuses, it goes back and says why. `overlay` sits on a preview image,
 * `button` carries a label (message page).
 */
@Component({
  selector: 'app-favorite-button',
  imports: [MatButton, MatIcon, MatIconButton, MatTooltip],
  template: `
    @switch (variant()) {
      @case ('button') {
        <button matButton="outlined" type="button" [attr.aria-pressed]="on()" (click)="toggle()">
          <mat-icon [class.on]="on()">{{ on() ? 'favorite' : 'favorite_border' }}</mat-icon>
          {{ on() ? 'Favorited' : 'Favorite' }}
        </button>
      }
      @case ('overlay') {
        <button
          type="button"
          class="overlay"
          [class.on]="on()"
          [attr.aria-label]="label()"
          [attr.aria-pressed]="on()"
          [matTooltip]="label()"
          (click)="toggle()"
        >
          <mat-icon>{{ on() ? 'favorite' : 'favorite_border' }}</mat-icon>
        </button>
      }
      @default {
        <button
          matIconButton
          type="button"
          [attr.aria-label]="label()"
          [attr.aria-pressed]="on()"
          [matTooltip]="label()"
          (click)="toggle()"
        >
          <mat-icon [class.on]="on()">{{ on() ? 'favorite' : 'favorite_border' }}</mat-icon>
        </button>
      }
    }
  `,
  styles: `
    :host {
      display: inline-flex;
    }

    .on {
      color: var(--tam-favorite, #e5484d);
    }

    .overlay {
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: rgb(0 0 0 / 60%);
      color: #fff;
      cursor: pointer;

      &.on {
        color: #ff6b81;
      }

      &:focus-visible {
        outline: 2px solid var(--mat-sys-primary);
        outline-offset: 2px;
      }

      mat-icon {
        width: 20px;
        height: 20px;
        font-size: 20px;
      }
    }
  `,
})
export class FavoriteButton {
  readonly messageId = input.required<string>();
  readonly favorite = input.required<boolean>();
  readonly variant = input<'icon' | 'overlay' | 'button'>('icon');

  private readonly api = inject(FavoritesApi);
  private readonly changes = inject(MessageChanges);
  private readonly notify = inject(NotifyService);
  private readonly destroyRef = inject(DestroyRef);

  /** What the heart shows: the choice at once, the input again when the message changes. */
  protected readonly on = linkedSignal(() => this.favorite());
  private readonly pending = signal(false);
  protected readonly label = computed(() =>
    this.on() ? 'Remove from favorites' : 'Add to favorites',
  );

  protected toggle(): void {
    // One request at a time, so the answers cannot arrive in the wrong order.
    if (this.pending()) {
      return;
    }
    const id = this.messageId();
    const favorite = !this.on();
    this.on.set(favorite);
    this.pending.set(true);
    this.changes.publish(favoriteChanged(id, favorite));
    this.api
      .set(id, favorite)
      .pipe(
        finalize(() => this.pending.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        error: (error: unknown) => {
          this.on.set(!favorite);
          this.changes.publish(favoriteChanged(id, !favorite));
          this.notify.error(
            `${favorite ? 'Adding to' : 'Removing from'} favorites failed: ${toApiError(error).message}`,
          );
        },
      });
  }
}

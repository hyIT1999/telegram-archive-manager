import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { TagRefDto } from '../../shared/models';

/** A tag's color dot and name, linking to the tag's page. */
@Component({
  selector: 'app-tag-chip',
  imports: [RouterLink],
  template: `
    <a class="chip" [routerLink]="['/tags', tag().id]" [attr.title]="'Tag: ' + tag().name">
      <span class="dot" aria-hidden="true" [style.background]="tag().color"></span>
      <span class="name">{{ tag().name }}</span>
    </a>
  `,
  styles: `
    :host {
      display: inline-flex;
      min-width: 0;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      max-width: 16rem;
      padding: 2px 10px 2px 8px;
      border-radius: var(--mat-sys-corner-full);
      background: var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface);
      font: var(--mat-sys-label-medium);
      text-decoration: none;

      &:hover {
        background: var(--mat-sys-surface-container-highest);
      }

      &:focus-visible {
        outline: 2px solid var(--mat-sys-primary);
        outline-offset: 2px;
      }
    }

    .dot {
      flex: none;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--mat-sys-outline);
    }

    .name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
})
export class TagChip {
  readonly tag = input.required<TagRefDto>();
}

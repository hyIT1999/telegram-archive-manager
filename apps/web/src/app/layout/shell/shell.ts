import { Component, ElementRef, inject, linkedSignal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatSidenav, MatSidenavContainer, MatSidenavContent } from '@angular/material/sidenav';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { LayoutService } from '../../core/services/layout-service';
import { Header } from '../header/header';
import { Sidebar } from '../sidebar/sidebar';

/** Height of the sticky header; the fixed sidenav starts right below it. */
export const HEADER_HEIGHT_PX = 64;

/**
 * Signed-in layout. Desktop: the sidenav sits beside the content and stays open.
 * Handset: it becomes an overlay drawer that closes after every navigation.
 * The page itself scrolls the window, so the router's scroll restoration applies.
 */
@Component({
  selector: 'app-shell',
  imports: [Header, MatSidenav, MatSidenavContainer, MatSidenavContent, RouterOutlet, Sidebar],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell {
  protected readonly layout = inject(LayoutService);
  protected readonly headerHeight = HEADER_HEIGHT_PX;
  /** Resets to the layout's default (open on desktop, closed on handset) when the layout flips. */
  protected readonly navOpen = linkedSignal(() => !this.layout.isHandset());

  private readonly main = viewChild.required<ElementRef<HTMLElement>>('main');

  constructor() {
    inject(Router)
      .events.pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        if (this.layout.isHandset()) {
          this.navOpen.set(false);
        }
      });
  }

  protected toggleNav(): void {
    this.navOpen.update((open) => !open);
  }

  protected skipToContent(): void {
    this.main().nativeElement.focus();
  }
}

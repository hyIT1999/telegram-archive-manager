import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { Injectable, type Signal, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

/** Phones and portrait tablets get the compact layout (navigation as an overlay drawer). */
const HANDSET_QUERIES = [Breakpoints.Handset, Breakpoints.TabletPortrait];

@Injectable({ providedIn: 'root' })
export class LayoutService {
  private readonly breakpointObserver = inject(BreakpointObserver);

  readonly isHandset: Signal<boolean> = toSignal(
    this.breakpointObserver.observe(HANDSET_QUERIES).pipe(map((state) => state.matches)),
    { initialValue: this.breakpointObserver.isMatched(HANDSET_QUERIES) },
  );
}

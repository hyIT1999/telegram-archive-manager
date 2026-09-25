import {
  DestroyRef,
  Directive,
  ElementRef,
  afterNextRender,
  inject,
  input,
  output,
} from '@angular/core';

/**
 * Emits when the element comes near the viewport, e.g. to load the next page of a long list before
 * the reader reaches its end. Does nothing where IntersectionObserver is missing.
 */
@Directive({ selector: '[appInView]' })
export class InView {
  /** How far outside the viewport already counts (CSS margin). */
  readonly inViewMargin = input('600px');
  readonly appInView = output<void>();

  constructor() {
    const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      if (typeof IntersectionObserver === 'undefined') {
        return;
      }
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            this.appInView.emit();
          }
        },
        { rootMargin: this.inViewMargin() },
      );
      observer.observe(element);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }
}

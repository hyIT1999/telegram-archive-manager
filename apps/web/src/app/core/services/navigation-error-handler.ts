import { inject } from '@angular/core';
import type { NavigationError } from '@angular/router';
import { NotifyService } from './notify-service';

/**
 * Runs (in an injection context) when a navigation throws, typically because a lazy chunk
 * could not be downloaded — offline, or a new deployment replaced the old files.
 */
export function handleNavigationError(event: NavigationError): void {
  console.error('Navigation failed', event.error);
  inject(NotifyService).error('That page could not be opened. Check your connection and reload.');
}

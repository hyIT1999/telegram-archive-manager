import type { Routes } from '@angular/router';

/** Mounted once per media section; the parent route supplies `data.mediaCategory` and the title. */
export const mediaRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./media-browser-page').then((m) => m.MediaBrowserPage),
  },
];

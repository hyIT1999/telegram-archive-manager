import type { Routes } from '@angular/router';

export const tagsRoutes: Routes = [
  {
    path: '',
    title: 'Tags',
    loadComponent: () => import('./tags-page').then((m) => m.TagsPage),
  },
];

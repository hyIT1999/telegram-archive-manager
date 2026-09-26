import type { Routes } from '@angular/router';

export const tagsRoutes: Routes = [
  {
    path: '',
    title: 'Tags',
    loadComponent: () => import('./tags-page').then((m) => m.TagsPage),
  },
  {
    path: ':id',
    title: 'Tag',
    loadComponent: () => import('./tag-page').then((m) => m.TagPage),
  },
];

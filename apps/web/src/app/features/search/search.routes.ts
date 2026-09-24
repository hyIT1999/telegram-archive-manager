import type { Routes } from '@angular/router';

export const searchRoutes: Routes = [
  {
    path: '',
    title: 'Search',
    loadComponent: () => import('../../pages/search/search-page').then((m) => m.SearchPage),
  },
];

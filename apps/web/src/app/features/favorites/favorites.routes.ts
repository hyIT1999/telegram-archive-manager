import type { Routes } from '@angular/router';

export const favoritesRoutes: Routes = [
  {
    path: '',
    title: 'Favorites',
    loadComponent: () => import('./favorites-page').then((m) => m.FavoritesPage),
  },
];

import type { Route, Routes } from '@angular/router';
import { authGuard } from './core/guards/auth-guard';
import { guestGuard } from './core/guards/guest-guard';
import { MEDIA_SECTIONS } from './features/media/media-sections';

/** Videos, Images, Documents and Audio share one lazy media browser, keyed by route data. */
const mediaRoutes: Route[] = MEDIA_SECTIONS.map((section) => ({
  path: section.category,
  title: section.title,
  data: { mediaCategory: section.category },
  loadChildren: () => import('./features/media/media.routes').then((m) => m.mediaRoutes),
}));

export const routes: Routes = [
  {
    path: 'login',
    title: 'Sign in',
    canMatch: [guestGuard],
    loadComponent: () => import('./pages/login/login-page').then((m) => m.LoginPage),
  },
  {
    path: '',
    canMatch: [authGuard],
    loadComponent: () => import('./layout/shell/shell').then((m) => m.Shell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadChildren: () =>
          import('./features/dashboard/dashboard.routes').then((m) => m.dashboardRoutes),
      },
      {
        path: 'channels',
        loadChildren: () =>
          import('./features/channels/channels.routes').then((m) => m.channelsRoutes),
      },
      {
        path: 'messages',
        loadChildren: () =>
          import('./features/messages/messages.routes').then((m) => m.messagesRoutes),
      },
      ...mediaRoutes,
      {
        path: 'favorites',
        loadChildren: () =>
          import('./features/favorites/favorites.routes').then((m) => m.favoritesRoutes),
      },
      {
        path: 'tags',
        loadChildren: () => import('./features/tags/tags.routes').then((m) => m.tagsRoutes),
      },
      {
        path: 'imports',
        loadChildren: () =>
          import('./features/imports/imports.routes').then((m) => m.importsRoutes),
      },
      {
        path: 'search',
        loadChildren: () => import('./features/search/search.routes').then((m) => m.searchRoutes),
      },
      {
        path: 'settings',
        loadChildren: () =>
          import('./features/settings/settings.routes').then((m) => m.settingsRoutes),
      },
      {
        path: '**',
        title: 'Page not found',
        loadComponent: () => import('./pages/not-found/not-found-page').then((m) => m.NotFoundPage),
      },
    ],
  },
];

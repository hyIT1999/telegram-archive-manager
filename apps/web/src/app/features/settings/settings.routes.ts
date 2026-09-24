import type { Routes } from '@angular/router';

export const settingsRoutes: Routes = [
  {
    path: '',
    title: 'Settings',
    loadComponent: () => import('./settings-page').then((m) => m.SettingsPage),
  },
];

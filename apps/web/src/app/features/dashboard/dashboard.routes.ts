import type { Routes } from '@angular/router';

export const dashboardRoutes: Routes = [
  {
    path: '',
    title: 'Dashboard',
    loadComponent: () =>
      import('../../pages/dashboard/dashboard-page').then((m) => m.DashboardPage),
  },
];

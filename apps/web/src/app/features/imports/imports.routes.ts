import type { Routes } from '@angular/router';

export const importsRoutes: Routes = [
  {
    path: '',
    title: 'Import Jobs',
    loadComponent: () => import('./import-list-page').then((m) => m.ImportListPage),
  },
  {
    path: 'new',
    title: 'New import',
    loadComponent: () => import('./import-wizard-page').then((m) => m.ImportWizardPage),
  },
  {
    path: ':id',
    title: 'Import job',
    loadComponent: () =>
      import('../../pages/import-job/import-job-page').then((m) => m.ImportJobPage),
  },
];

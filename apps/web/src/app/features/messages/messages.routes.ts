import type { Routes } from '@angular/router';

export const messagesRoutes: Routes = [
  {
    path: '',
    title: 'All Messages',
    loadComponent: () => import('./message-list-page').then((m) => m.MessageListPage),
  },
  {
    path: ':id',
    title: 'Message',
    loadComponent: () =>
      import('../../pages/message-detail/message-detail-page').then((m) => m.MessageDetailPage),
  },
];

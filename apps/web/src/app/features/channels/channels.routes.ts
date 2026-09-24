import type { Routes } from '@angular/router';

export const channelsRoutes: Routes = [
  {
    path: '',
    title: 'Channels',
    loadComponent: () => import('./channel-list-page').then((m) => m.ChannelListPage),
  },
  {
    path: ':id',
    title: 'Channel',
    loadComponent: () =>
      import('../../pages/channel-detail/channel-detail-page').then((m) => m.ChannelDetailPage),
  },
];

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
  {
    path: ':id/topics/:topicId',
    title: 'Topic',
    loadComponent: () =>
      import('../../pages/channel-topic/channel-topic-page').then((m) => m.ChannelTopicPage),
  },
];

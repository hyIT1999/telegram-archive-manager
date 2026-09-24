import { Component } from '@angular/core';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { PageHeader } from '../../shared/components/page-header/page-header';

@Component({
  selector: 'app-message-list-page',
  imports: [EmptyState, PageHeader],
  template: `
    <app-page-header
      eyebrow="Library"
      title="All Messages"
      subtitle="Every archived message across your channels, newest first."
    />
    <app-empty-state
      class="surface-card"
      icon="chat"
      note="Arrives in Phase 5"
      title="Message browsing is on its way"
      message="Browsing messages with filters by channel, media type and date arrives in Phase 5."
    />
  `,
})
export class MessageListPage {}

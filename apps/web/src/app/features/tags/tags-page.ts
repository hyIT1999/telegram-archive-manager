import { Component } from '@angular/core';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { PageHeader } from '../../shared/components/page-header/page-header';

@Component({
  selector: 'app-tags-page',
  imports: [EmptyState, PageHeader],
  template: `
    <app-page-header
      eyebrow="Collections"
      title="Tags"
      subtitle="Your own labels for organizing archived messages."
    />
    <app-empty-state
      class="surface-card"
      icon="sell"
      note="Arrives in Phase 6"
      title="Tags are on their way"
      message="Creating, coloring and assigning tags to messages arrives in Phase 6."
    />
  `,
})
export class TagsPage {}

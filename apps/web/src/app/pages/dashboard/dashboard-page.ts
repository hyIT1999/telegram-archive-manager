import { formatNumber } from '@angular/common';
import { Component, LOCALE_ID, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { type StatDefinition, STAT_GROUPS } from '../../features/dashboard/stat-definitions';
import { StatsApi } from '../../features/dashboard/stats-api';
import { ErrorState } from '../../shared/components/error-state/error-state';
import { PageHeader } from '../../shared/components/page-header/page-header';
import { Skeleton } from '../../shared/components/skeleton/skeleton';
import { StatCard } from '../../shared/components/stat-card/stat-card';
import { type StatsDto, toApiError } from '../../shared/models';
import { BytesPipe } from '../../shared/pipes/bytes-pipe';

interface StatCardView extends StatDefinition {
  readonly value: string;
}

interface StatGroupView {
  readonly title: string;
  readonly stats: readonly StatCardView[];
}

@Component({
  selector: 'app-dashboard-page',
  imports: [ErrorState, MatButton, MatIcon, PageHeader, RouterLink, Skeleton, StatCard],
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.scss',
})
export class DashboardPage {
  private readonly statsApi = inject(StatsApi);
  private readonly locale = inject(LOCALE_ID);
  private readonly bytes = new BytesPipe();

  protected readonly stats = rxResource({ stream: () => this.statsApi.getStats() });

  protected readonly groups = computed<readonly StatGroupView[] | null>(() => {
    if (!this.stats.hasValue()) {
      return null;
    }
    const stats = this.stats.value();
    return STAT_GROUPS.map((group) => ({
      title: group.title,
      stats: group.stats.map((definition) => ({
        ...definition,
        value: this.formatValue(definition, stats),
      })),
    }));
  });

  protected readonly isEmptyArchive = computed(
    () => this.stats.hasValue() && this.stats.value().channels === 0,
  );

  protected readonly errorMessage = computed(() => toApiError(this.stats.error()).message);

  private formatValue(definition: StatDefinition, stats: StatsDto): string {
    const value = stats[definition.key];
    return definition.format === 'bytes'
      ? this.bytes.transform(value)
      : formatNumber(value, this.locale, '1.0-0');
  }
}

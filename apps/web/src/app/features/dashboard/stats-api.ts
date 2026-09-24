import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import type { StatsDto } from '../../shared/models';

@Injectable({ providedIn: 'root' })
export class StatsApi {
  private readonly http = inject(HttpClient);

  /** Archive-wide totals (`GET /api/stats`). */
  getStats(): Observable<StatsDto> {
    return this.http.get<StatsDto>('/api/stats');
  }
}

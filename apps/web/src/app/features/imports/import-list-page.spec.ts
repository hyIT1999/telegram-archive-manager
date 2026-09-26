import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter } from '@angular/router';
import { flushError, makeImportJob, makePage } from '../../../testing/fixtures';
import { nextRequest } from '../../../testing/http';
import { FakeEventSources, provideFakeLiveEvents } from '../../../testing/live';
import { LiveEvents } from '../../core/live/live-events';
import { IMPORT_POLLING } from './import-job-watch';
import { IMPORT_PAGE_SIZE, ImportListPage } from './import-list-page';
import { IMPORT_ENDPOINTS } from './imports-api';

describe('ImportListPage', () => {
  let fixture: ComponentFixture<ImportListPage>;
  let http: HttpTestingController;
  let sources: FakeEventSources;

  beforeEach(() => {
    sources = new FakeEventSources();
    TestBed.configureTestingModule({
      providers: [
        ...provideFakeLiveEvents(sources),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: IMPORT_POLLING, useValue: { jobMs: 20, listMs: 20 } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ImportListPage);
    TestBed.tick();
  });

  afterEach(() => http.verify());

  const page = () => fixture.nativeElement as HTMLElement;
  const rows = () => Array.from(page().querySelectorAll<HTMLAnchorElement>('a.job'));
  const text = (element: Element | undefined) =>
    element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const listRequest = () => nextRequest(http, IMPORT_ENDPOINTS.jobs);

  it('lists jobs newest first with their status and progress, linking to each', async () => {
    const running = makeImportJob({
      channel: { ...makeImportJob().channel, title: 'Daily Physics' },
    });
    const done = makeImportJob({
      status: 'COMPLETED',
      phase: 'DONE',
      mode: 'FROM_DATE',
      fromDate: '2026-08-31T17:00:00.000Z',
      processedMessages: 1_234,
      totalMessages: 1_234,
    });
    const first = await listRequest();
    expect(first.request.params.get('limit')).toBe(String(IMPORT_PAGE_SIZE));
    first.flush(makePage([running, done]));
    await fixture.whenStable();

    expect(rows().map((row) => row.getAttribute('href'))).toEqual([
      `/imports/${running.id}`,
      `/imports/${done.id}`,
    ]);
    expect(text(rows()[0])).toContain('Importing');
    expect(text(rows()[0])).toContain('Daily Physics');
    expect(text(rows()[0])).toContain('120 of about 500 messages');
    expect(rows()[0]?.querySelector('mat-progress-bar')).not.toBeNull();
    expect(text(rows()[1])).toContain('Completed');
    expect(text(rows()[1])).toContain('1,234 messages');
    expect(rows()[1]?.querySelector('mat-progress-bar')).toBeNull();

    // A running job keeps the list fresh until nothing moves any more.
    (await listRequest()).flush(
      makePage([{ ...running, status: 'COMPLETED', processedMessages: 499 }, done]),
    );
    await vi.waitFor(() => expect(text(rows()[0])).toContain('499 messages'));
    await new Promise((resolve) => setTimeout(resolve, 60));
    http.expectNone(IMPORT_ENDPOINTS.jobs);
  });

  it('loads older jobs on demand', async () => {
    const newest = makeImportJob({ status: 'COMPLETED' });
    const older = makeImportJob({ status: 'CANCELLED' });
    (await listRequest()).flush(makePage([newest], 'cursor-1'));
    await fixture.whenStable();

    const more = Array.from(page().querySelectorAll('button')).find((item) =>
      item.textContent?.includes('Load more'),
    );
    more?.click();
    const next = await listRequest();
    expect(next.request.params.get('cursor')).toBe('cursor-1');
    next.flush(makePage([older]));
    await vi.waitFor(() => expect(rows()).toHaveLength(2));
    expect(page().textContent).not.toContain('Load more');
  });

  it('invites to start a first import', async () => {
    (await listRequest()).flush(makePage([]));
    await fixture.whenStable();
    expect(page().textContent).toContain('No imports yet');
    expect(page().querySelectorAll('a[href="/imports/new"]').length).toBe(2);
  });

  it('offers a retry when the list cannot be loaded', async () => {
    flushError(await listRequest(), 500, 'boom');
    await fixture.whenStable();
    expect(page().textContent).toContain('Import jobs could not be loaded');

    page().querySelector<HTMLButtonElement>('app-error-state button')?.click();
    (await listRequest()).flush(makePage([makeImportJob({ status: 'FAILED' })]));
    await vi.waitFor(() => expect(rows()).toHaveLength(1));
    expect(text(rows()[0])).toContain('Failed');
  });
  it('keeps rows current through live updates and puts a new job on top', async () => {
    TestBed.inject(LiveEvents).connect();
    sources.ready();
    const running = makeImportJob({ createdAt: '2026-09-24T09:00:00.000Z' });
    const done = makeImportJob({ status: 'COMPLETED', createdAt: '2026-09-23T09:00:00.000Z' });
    (await listRequest()).flush(makePage([running, done]));
    await fixture.whenStable();

    sources.latest.send({ type: 'import.job', job: { ...running, processedMessages: 300 } });
    const sync = makeImportJob({
      type: 'SYNC',
      origin: 'SCHEDULE',
      status: 'PENDING',
      createdAt: '2026-09-25T09:00:00.000Z',
    });
    sources.latest.send({ type: 'import.job', job: sync });
    // An old job the list does not show stays out of it.
    sources.latest.send({
      type: 'import.job',
      job: makeImportJob({ createdAt: '2026-01-01T00:00:00.000Z' }),
    });
    await fixture.whenStable();

    expect(rows().map((row) => row.getAttribute('href'))).toEqual([
      `/imports/${sync.id}`,
      `/imports/${running.id}`,
      `/imports/${done.id}`,
    ]);
    expect(text(rows()[0])).toContain('Sync · Scheduled check');
    expect(text(rows()[1])).toContain('300 of about 500 messages');
    // Live: the list is not polled although a job runs.
    await new Promise((resolve) => setTimeout(resolve, 60));
    http.expectNone(IMPORT_ENDPOINTS.jobs);
  });

  it('shows imports or syncs only', async () => {
    const imported = makeImportJob({ status: 'COMPLETED' });
    const synced = makeImportJob({ type: 'SYNC', status: 'COMPLETED', processedMessages: 0 });
    const all = await listRequest();
    expect(all.request.params.has('type')).toBe(false);
    all.flush(makePage([synced, imported]));
    await fixture.whenStable();
    expect(text(rows()[0])).toContain('No new messages');

    const syncsToggle = Array.from(
      page().querySelectorAll<HTMLButtonElement>('mat-button-toggle button'),
    ).find((button) => button.textContent?.includes('Syncs'));
    syncsToggle?.click();
    const syncs = await listRequest();
    expect(syncs.request.params.get('type')).toBe('SYNC');
    syncs.flush(makePage([synced]));
    await vi.waitFor(() => expect(rows()).toHaveLength(1));

    // An import changing meanwhile does not belong here.
    TestBed.inject(LiveEvents).connect();
    sources.ready();
    sources.latest.send({
      type: 'import.job',
      job: { ...imported, createdAt: '2027-01-01T00:00:00.000Z' },
    });
    await fixture.whenStable();
    expect(rows()).toHaveLength(1);
  });
});

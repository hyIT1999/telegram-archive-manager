import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { flushError, makeImportJob } from '../../../testing/fixtures';
import { nextRequest } from '../../../testing/http';
import { ConfirmService } from '../../core/services/confirm-service';
import { IMPORT_ENDPOINTS } from '../../features/imports/imports-api';
import { IMPORT_POLLING } from '../../features/imports/import-job-watch';
import type { ImportJobDto } from '../../shared/models';
import { ImportJobPage } from './import-job-page';

describe('ImportJobPage', () => {
  let http: HttpTestingController;
  const confirm = { ask: vi.fn<ConfirmService['ask']>() };
  /** Slow unless a test follows a job over time. */
  const polling = { jobMs: 60_000, listMs: 60_000 };

  beforeEach(() => {
    confirm.ask.mockReset();
    polling.jobMs = 60_000;
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [{ path: 'imports/:id', component: ImportJobPage }],
          withComponentInputBinding(),
        ),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: IMPORT_POLLING, useValue: polling },
        { provide: ConfirmService, useValue: confirm },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function open(job: ImportJobDto): Promise<HTMLElement> {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(`/imports/${job.id}`, ImportJobPage);
    TestBed.tick();
    (await nextRequest(http, IMPORT_ENDPOINTS.job(job.id))).flush(job);
    await harness.fixture.whenStable();
    return harness.routeNativeElement as HTMLElement;
  }

  const text = (element: Element | null | undefined) =>
    element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const button = (page: HTMLElement, label: string) =>
    Array.from(page.querySelectorAll<HTMLButtonElement>('app-import-progress button')).find(
      (item) => item.textContent?.includes(label),
    );

  it('shows where a running import stands and follows it until it completes', async () => {
    polling.jobMs = 20;
    const job = makeImportJob({
      channel: { ...makeImportJob().channel, title: 'Daily Physics' },
      statusDetail: 'Telegram asked to wait 45 s before reading more',
    });
    const page = await open(job);

    expect(page.querySelector('h1')?.textContent).toContain('Daily Physics');
    expect(page.querySelector('.status')?.textContent).toContain('Importing');
    expect(text(page.querySelector('.bar-text'))).toBe('24 % · 120 of about 500');
    expect(text(page)).toContain('12 files · 48 MiB');
    expect(page.querySelector('app-notice')?.textContent).toContain('Telegram asked to wait 45 s');
    expect(page.querySelector(`a[href="/channels/${job.channelId}"]`)).not.toBeNull();
    expect(button(page, 'Pause')).toBeDefined();
    expect(button(page, 'Resume')).toBeUndefined();

    // Re-read while it runs, until it is done.
    (await nextRequest(http, IMPORT_ENDPOINTS.job(job.id))).flush({
      ...job,
      status: 'COMPLETED',
      phase: 'DONE',
      processedMessages: 498,
      totalMessages: 498,
      statusDetail: null,
      completedAt: '2026-09-24T09:30:00.000Z',
    });
    await vi.waitFor(() =>
      expect(page.querySelector('.status')?.textContent).toContain('Completed'),
    );
    expect(text(page.querySelector('.bar-text'))).toBe('100 % · 498 messages');
    expect(page.querySelector('app-import-progress .actions')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 60));
    http.expectNone(IMPORT_ENDPOINTS.job(job.id));
  });

  it('pauses and resumes', async () => {
    const job = makeImportJob();
    const page = await open(job);

    button(page, 'Pause')?.click();
    const pause = await nextRequest(http, IMPORT_ENDPOINTS.action(job.id, 'pause'));
    expect(pause.request.method).toBe('POST');
    pause.flush({ ...job, status: 'PAUSED' });
    await vi.waitFor(() => expect(button(page, 'Resume')).toBeDefined());
    expect(page.textContent).toContain('Paused. Everything read so far is saved');

    // From here on the job is followed: a queued job is re-read too.
    polling.jobMs = 20;
    button(page, 'Resume')?.click();
    (await nextRequest(http, IMPORT_ENDPOINTS.action(job.id, 'resume'))).flush({
      ...job,
      status: 'PENDING',
    });
    await vi.waitFor(() => expect(page.querySelector('.status')?.textContent).toContain('Queued'));
    (await nextRequest(http, IMPORT_ENDPOINTS.job(job.id))).flush({ ...job, status: 'CANCELLED' });
    await vi.waitFor(() =>
      expect(page.querySelector('.status')?.textContent).toContain('Cancelled'),
    );
  });

  it('asks before cancelling', async () => {
    const job = makeImportJob({ status: 'PAUSED' });
    const page = await open(job);

    confirm.ask.mockResolvedValueOnce(false);
    button(page, 'Cancel import')?.click();
    await vi.waitFor(() => expect(confirm.ask).toHaveBeenCalledTimes(1));
    http.expectNone(IMPORT_ENDPOINTS.action(job.id, 'cancel'));
    expect(confirm.ask.mock.calls[0]?.[0]).toMatchObject({
      destructive: true,
      confirmLabel: 'Cancel import',
    });

    confirm.ask.mockResolvedValueOnce(true);
    button(page, 'Cancel import')?.click();
    (await nextRequest(http, IMPORT_ENDPOINTS.action(job.id, 'cancel'))).flush({
      ...job,
      status: 'CANCELLED',
      completedAt: '2026-09-24T09:10:00.000Z',
    });
    await vi.waitFor(() =>
      expect(page.querySelector('.status')?.textContent).toContain('Cancelled'),
    );
    expect(page.textContent).toContain('Stopped');
  });

  it('explains an action the server refused, and shows the job as it stands', async () => {
    const job = makeImportJob({ status: 'PAUSED' });
    const page = await open(job);

    button(page, 'Resume')?.click();
    flushError(
      await nextRequest(http, IMPORT_ENDPOINTS.action(job.id, 'resume')),
      409,
      'Only a paused import can be resumed.',
      'INVALID_JOB_STATE',
    );
    (await nextRequest(http, IMPORT_ENDPOINTS.job(job.id))).flush({
      ...job,
      status: 'CANCELLED',
      completedAt: '2026-09-24T09:10:00.000Z',
    });
    await vi.waitFor(() =>
      expect(page.querySelector('.status')?.textContent).toContain('Cancelled'),
    );
    expect(page.querySelector('app-notice[role="alert"]')?.textContent).toContain(
      'Only a paused import can be resumed.',
    );
  });

  it('shows why an import failed', async () => {
    const page = await open(
      makeImportJob({
        status: 'FAILED',
        error: 'Content protection was turned on for this chat, so it can no longer be archived.',
        completedAt: '2026-09-24T09:10:00.000Z',
      }),
    );
    expect(page.querySelector('app-notice[role="alert"]')?.textContent).toContain(
      'Content protection was turned on',
    );
    expect(page.querySelector('app-import-progress .actions')).toBeNull();
  });

  it('shows "not found" for unknown jobs', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/imports/0199a0b1-0000-7000-8000-00000000dead', ImportJobPage);
    TestBed.tick();
    flushError(
      await nextRequest(http, IMPORT_ENDPOINTS.job('0199a0b1-0000-7000-8000-00000000dead')),
      404,
    );
    await harness.fixture.whenStable();

    const page = harness.routeNativeElement as HTMLElement;
    expect(page.textContent).toContain('Import job not found');
    expect(page.querySelector('a[href="/imports"]')).not.toBeNull();
  });
});

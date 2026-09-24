import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { flushError, makeChannel, makeImportJob, makePage } from '../../../testing/fixtures';
import { nextRequest } from '../../../testing/http';
import { IMPORT_POLLING } from '../../features/imports/import-job-watch';
import { IMPORT_ENDPOINTS } from '../../features/imports/imports-api';
import type { ImportJobDto } from '../../shared/models';
import { ChannelDetailPage } from './channel-detail-page';

/** Stands in for the import job page the channel page links to. */
@Component({ template: 'import job page' })
class ImportJobStub {}

describe('ChannelDetailPage', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [
            { path: 'channels/:id', component: ChannelDetailPage },
            { path: 'imports/:id', component: ImportJobStub },
          ],
          withComponentInputBinding(),
        ),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: IMPORT_POLLING, useValue: { jobMs: 60_000, listMs: 60_000 } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function open(id: string): Promise<RouterTestingHarness> {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(`/channels/${id}`, ChannelDetailPage);
    TestBed.tick();
    return harness;
  }

  it('loads the channel from the route id and shows its details', async () => {
    const channel = makeChannel({
      title: 'Daily Physics',
      username: 'dailyphysics',
      telegramChatId: '-1001234567890',
      memberCount: 2_048,
      isProtected: true,
    });
    const harness = await open(channel.id);
    http.expectOne(`/api/channels/${channel.id}`).flush(channel);
    await harness.fixture.whenStable();

    const page = harness.routeNativeElement as HTMLElement;
    expect(page.querySelector('h1')?.textContent).toContain('Daily Physics');
    // Protected chats are never imported, so the page does not look for imports.
    http.expectNone(IMPORT_ENDPOINTS.jobs);
    expect(page.textContent).toContain('@dailyphysics · Channel');
    expect(page.textContent).toContain('-1001234567890');
    expect(page.textContent).toContain('2,048');
    expect(page.textContent).toContain('Protected');
    expect(page.querySelector('a[href="https://t.me/dailyphysics"]')).not.toBeNull();
  });

  it('shows "not found" for unknown channels', async () => {
    const harness = await open('0199a0b1-0000-7000-8000-00000000dead');
    flushError(http.expectOne('/api/channels/0199a0b1-0000-7000-8000-00000000dead'), 404);
    await harness.fixture.whenStable();

    const page = harness.routeNativeElement as HTMLElement;
    expect(page.textContent).toContain('Channel not found');
    expect(page.querySelector('a[href="/channels"]')).not.toBeNull();
    expect(page.querySelector('app-error-state')).toBeNull();
  });

  it('offers a retry for other failures', async () => {
    const channel = makeChannel();
    const harness = await open(channel.id);
    flushError(http.expectOne(`/api/channels/${channel.id}`), 500, 'boom');
    await harness.fixture.whenStable();

    const page = harness.routeNativeElement as HTMLElement;
    page.querySelector<HTMLButtonElement>('app-error-state button')?.click();
    TestBed.tick();
    http.expectOne(`/api/channels/${channel.id}`).flush(channel);
    (await nextRequest(http, IMPORT_ENDPOINTS.jobs)).flush(makePage([]));
    await harness.fixture.whenStable();

    expect(page.querySelector('h1')?.textContent).toContain(channel.title);
  });
  describe('import panel', () => {
    async function openWithImports(jobs: ImportJobDto[], overrides = {}) {
      const channel = makeChannel({ isProtected: false, ...overrides });
      const harness = await open(channel.id);
      http.expectOne(`/api/channels/${channel.id}`).flush(channel);
      const list = await nextRequest(http, IMPORT_ENDPOINTS.jobs);
      expect(list.request.params.get('channelId')).toBe(channel.id);
      expect(list.request.params.get('limit')).toBe('1');
      list.flush(makePage(jobs));
      await harness.fixture.whenStable();
      return { channel, harness, page: harness.routeNativeElement as HTMLElement };
    }

    const startButton = (page: HTMLElement) =>
      Array.from(page.querySelectorAll<HTMLButtonElement>('app-channel-import-panel button')).find(
        (item) => item.textContent?.includes('Start import'),
      );

    it('shows the unfinished import of the channel instead of a new one', async () => {
      const job = makeImportJob({ status: 'PAUSED' });
      const { page } = await openWithImports([job]);

      const panel = page.querySelector('app-channel-import-panel');
      expect(panel?.querySelector('app-import-progress .status')?.textContent).toContain('Paused');
      expect(panel?.querySelector(`a[href="/imports/${job.id}"]`)).not.toBeNull();
      expect(startButton(page)).toBeUndefined();
    });

    it('imports a channel from its page and opens the new job', async () => {
      const { channel, harness, page } = await openWithImports([]);
      expect(page.textContent).toContain('Nothing of this chat is in the archive yet.');
      expect(page.querySelector('app-channel-import-panel h3')?.textContent).toContain(
        'Import the history',
      );

      startButton(page)?.click();
      const start = await nextRequest(http, IMPORT_ENDPOINTS.start(channel.id));
      expect(start.request.body).toEqual({ mode: 'ALL' });
      const job = makeImportJob({ channelId: channel.id, status: 'PENDING' });
      start.flush(job, { status: 202, statusText: 'Accepted' });

      await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe(`/imports/${job.id}`));
      expect(harness.routeNativeElement?.textContent).toContain('import job page');
    });

    it('offers to import again once the last import has ended', async () => {
      const job = makeImportJob({
        status: 'COMPLETED',
        phase: 'DONE',
        processedMessages: 500,
        totalMessages: 500,
        completedAt: '2026-09-24T09:30:00.000Z',
      });
      const { page } = await openWithImports([job]);
      expect(page.querySelector('app-channel-import-panel h3')?.textContent).toContain(
        'Import again',
      );
      expect(page.textContent).toContain('messages posted since the last import');
      expect(startButton(page)?.disabled).toBe(false);
    });

    it('explains that an old group is imported with its supergroup', async () => {
      const supergroupId = '0199a0b1-0000-7000-8000-00000000beef';
      const channel = makeChannel({
        type: 'GROUP',
        isProtected: false,
        migratedToChannelId: supergroupId,
      });
      const harness = await open(channel.id);
      http.expectOne(`/api/channels/${channel.id}`).flush(channel);
      await harness.fixture.whenStable();

      const panel = (harness.routeNativeElement as HTMLElement).querySelector(
        'app-channel-import-panel',
      );
      expect(panel?.textContent).toContain('imported together with the supergroup');
      expect(panel?.querySelector(`a[href="/channels/${supergroupId}"]`)).not.toBeNull();
      http.expectNone(IMPORT_ENDPOINTS.jobs);
    });
  });
});

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { flushError, makeChannel } from '../../../testing/fixtures';
import { ChannelDetailPage } from './channel-detail-page';

describe('ChannelDetailPage', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [{ path: 'channels/:id', component: ChannelDetailPage }],
          withComponentInputBinding(),
        ),
        provideHttpClient(),
        provideHttpClientTesting(),
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
    await harness.fixture.whenStable();

    expect(page.querySelector('h1')?.textContent).toContain(channel.title);
  });
});

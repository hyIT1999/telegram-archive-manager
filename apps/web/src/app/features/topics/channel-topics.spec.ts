import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter } from '@angular/router';
import { flushError, makeTopic, makeTopicList } from '../../../testing/fixtures';
import { nextRequest } from '../../../testing/http';
import { searchable } from '../../shared/text/searchable';
import { ChannelTopics, TOPIC_PREVIEW_COUNT, topicCounts } from './channel-topics';
import { TOPICS_WAIT_POLL_MS, TOPIC_ENDPOINTS } from './topics-api';

const CHANNEL = '0199a0b1-0000-7000-8000-000000000001';

@Component({ template: `<app-channel-topics channelId="${CHANNEL}" />`, imports: [ChannelTopics] })
class Host {}

describe('ChannelTopics', () => {
  let fixture: ComponentFixture<Host>;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: TOPICS_WAIT_POLL_MS, useValue: 5 },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Host);
    TestBed.tick();
  });

  afterEach(() => http.verify());

  const element = () => fixture.nativeElement as HTMLElement;
  const titles = () =>
    Array.from(element().querySelectorAll('.topic .title')).map((title) =>
      title.textContent?.trim(),
    );

  it('lists the topics in creation order, with what each holds', async () => {
    const optics = makeTopic({ topicId: 20, title: 'Optics', isPinned: true });
    http
      .expectOne(TOPIC_ENDPOINTS.list(CHANNEL))
      .flush(makeTopicList([optics, makeTopic({ title: 'Waves' })]));
    await fixture.whenStable();

    expect(titles()).toEqual(['Optics', 'Waves']);
    const first = element().querySelector('.topic');
    expect(first?.getAttribute('href')).toBe(`/channels/${CHANNEL}/topics/20`);
    expect(first?.textContent).toContain('10 videos · 2 documents · 12 messages');
    expect(first?.querySelector('[aria-label="Pinned"]')).not.toBeNull();
    expect(first?.textContent).toMatch(/Jan 2, 2026\s+–\s+Feb 1, 2026/);
    expect(element().textContent).not.toContain('being read from Telegram');
  });

  it('shows one date for a topic posted on a single day', async () => {
    http.expectOne(TOPIC_ENDPOINTS.list(CHANNEL)).flush(
      makeTopicList([
        makeTopic({
          firstPostedAt: '2026-01-02T08:00:00.000Z',
          lastPostedAt: '2026-01-02T09:00:00.000Z',
        }),
      ]),
    );
    await fixture.whenStable();
    const meta = element().querySelectorAll('.topic .meta')[1]?.textContent ?? '';
    expect(meta).toContain('Jan 2, 2026');
    expect(meta).not.toContain('–');
  });

  it('shows a dozen topics first, and finds one by name without accents', async () => {
    const topics = Array.from({ length: TOPIC_PREVIEW_COUNT + 3 }, (_, index) =>
      makeTopic({ title: index === 14 ? 'Bài học cuối' : `Module ${index}` }),
    );
    http.expectOne(TOPIC_ENDPOINTS.list(CHANNEL)).flush(makeTopicList(topics));
    await fixture.whenStable();
    expect(titles()).toHaveLength(TOPIC_PREVIEW_COUNT);

    const search = element().querySelector<HTMLInputElement>('input[type="search"]');
    if (search) {
      search.value = 'bai hoc';
      search.dispatchEvent(new Event('input'));
    }
    await fixture.whenStable();
    expect(titles()).toEqual(['Bài học cuối']);

    if (search) {
      search.value = '';
      search.dispatchEvent(new Event('input'));
    }
    await fixture.whenStable();
    Array.from(element().querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes(`Show all ${topics.length} topics`))
      ?.click();
    await fixture.whenStable();
    expect(titles()).toHaveLength(topics.length);
  });

  it('waits for the names from Telegram, and can ask for them again', async () => {
    http
      .expectOne(TOPIC_ENDPOINTS.list(CHANNEL))
      .flush(makeTopicList([makeTopic({ title: 'Topic #20' })], { refreshedAt: null }));
    await fixture.whenStable();
    expect(element().textContent).toContain('Topic names are being read from Telegram');

    // Read again a little later, until the worker stored the names.
    (await nextRequest(http, TOPIC_ENDPOINTS.list(CHANNEL))).flush(
      makeTopicList([makeTopic({ title: 'Optics' })]),
    );
    await fixture.whenStable();
    expect(titles()).toEqual(['Optics']);

    const refresh = Array.from(element().querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('Refresh topics'),
    );
    refresh?.click();
    const request = await nextRequest(http, TOPIC_ENDPOINTS.refresh(CHANNEL));
    expect(request.request.method).toBe('POST');
    flushError(request, 503, 'The worker is not running.', 'WORKER_UNAVAILABLE');
    await fixture.whenStable();
    expect(element().querySelector('app-notice')?.textContent).toContain(
      'The worker is not running.',
    );
  });
});

describe('topic helpers', () => {
  it('describes what a topic holds and searches without accents', () => {
    expect(
      topicCounts({ counts: { messages: 1, videos: 1, images: 0, documents: 0, audio: 2 } }),
    ).toBe('1 video · 2 audio files · 1 message');
    expect(searchable('Đường Tiến Hóa')).toBe('duong tien hoa');
  });
});

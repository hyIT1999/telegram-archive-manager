import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  makeChannel,
  makeMessage,
  makeMessagePage,
  makeTopic,
  makeTopicList,
} from '../../../testing/fixtures';
import { nextRequest } from '../../../testing/http';
import { MESSAGE_ENDPOINTS } from '../../features/messages/messages-api';
import { TOPIC_ENDPOINTS } from '../../features/topics/topics-api';
import { ChannelTopicPage } from './channel-topic-page';

describe('ChannelTopicPage', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [{ path: 'channels/:id/topics/:topicId', component: ChannelTopicPage }],
          withComponentInputBinding(),
        ),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reads a topic like a course: oldest first, with the topics around it', async () => {
    const channel = makeChannel({ title: 'Trading course', isForum: true });
    const topics = makeTopicList([
      makeTopic({ topicId: 10, title: 'Basics' }),
      makeTopic({ topicId: 20, title: 'Charts' }),
      makeTopic({ topicId: 30, title: 'Risk' }),
    ]);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(`/channels/${channel.id}/topics/20`, ChannelTopicPage);
    TestBed.tick();
    http.expectOne(`/api/channels/${channel.id}`).flush(channel);
    let answered = 0;
    await vi.waitFor(() => {
      for (const request of http.match(TOPIC_ENDPOINTS.list(channel.id))) {
        request.flush(topics);
        answered += 1;
      }
      // The page reads the topics; the feed's topic filter stays hidden (the topic is fixed).
      expect(answered).toBeGreaterThanOrEqual(1);
    });
    const feed = await nextRequest(http, MESSAGE_ENDPOINTS.list);
    expect(feed.request.params.get('channelId')).toBe(channel.id);
    expect(feed.request.params.get('topicId')).toBe('20');
    expect(feed.request.params.get('sort')).toBe('oldest');
    feed.flush(
      makeMessagePage([
        makeMessage({
          type: 'TEXT',
          media: null,
          excerpt: 'Candles explained',
          topic: { id: 20, title: 'Charts' },
        }),
      ]),
    );
    await harness.fixture.whenStable();
    for (const request of http.match(TOPIC_ENDPOINTS.list(channel.id))) {
      request.flush(topics);
    }

    const page = harness.routeNativeElement as HTMLElement;
    expect(page.querySelector('h1')?.textContent).toContain('Charts');
    expect(page.textContent).toContain('Trading course');
    expect(page.textContent).toContain('10 videos · 2 documents · 12 messages');
    expect(
      page.querySelector(`a[href="/channels/${channel.id}/topics/10"]`)?.textContent,
    ).toContain('Basics');
    expect(
      page.querySelector(`a[href="/channels/${channel.id}/topics/30"]`)?.textContent,
    ).toContain('Risk');
    expect(page.querySelector('app-message-card')?.textContent).toContain('Candles explained');
    // Every message here is in this topic: the cards do not repeat it.
    expect(page.querySelector('app-message-card .topic')).toBeNull();
  });

  it('refuses topic numbers that cannot exist', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(
      '/channels/0199a0b1-0000-7000-8000-000000000001/topics/abc',
      ChannelTopicPage,
    );
    TestBed.tick();
    for (const request of http.match(() => true)) {
      request.flush(request.request.url.endsWith('/topics') ? makeTopicList([]) : makeChannel());
    }
    await harness.fixture.whenStable();
    expect(harness.routeNativeElement?.textContent).toContain('Topic not found');
  });
});

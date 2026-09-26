import { Location } from '@angular/common';
import { type HttpRequest, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  flushError,
  makeChannel,
  makeMediaSummary,
  makeMessage,
  makeMessagePage,
  makePage,
} from '../../../testing/fixtures';
import type { MessageSummaryDto } from '../../shared/models';
import { ImageViewer } from '../media/image-viewer/image-viewer';
import { FeedFiltersBar } from './feed-filters';
import { MessageChanges, favoriteChanged, tagsChanged } from './message-changes';
import { FEED_PAGE_SIZE, MessageFeed } from './message-feed';

@Component({ template: '<app-message-feed />', imports: [MessageFeed] })
class AllMessagesHost {}

@Component({ template: '<app-message-feed category="videos" />', imports: [MessageFeed] })
class VideosHost {}

@Component({ template: '<app-message-feed category="images" />', imports: [MessageFeed] })
class ImagesHost {}

@Component({ template: '<app-message-feed category="documents" />', imports: [MessageFeed] })
class DocumentsHost {}

@Component({ template: 'message page' })
class MessageStub {}

const CHANNEL = '0199a0b1-0000-7000-8000-000000000001';

describe('MessageFeed', () => {
  let http: HttpTestingController;
  const viewer = { open: vi.fn() };

  beforeEach(() => {
    viewer.open.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'messages', component: AllMessagesHost },
          { path: 'messages/:id', component: MessageStub },
          { path: 'videos', component: VideosHost },
          { path: 'images', component: ImagesHost },
          { path: 'documents', component: DocumentsHost },
        ]),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: ImageViewer, useValue: viewer },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const isList = (cursor?: string) => (request: HttpRequest<unknown>) =>
    request.url === '/api/messages' && (request.params.get('cursor') ?? undefined) === cursor;

  /** Opens a feed page and answers the channel filter's list of channels. */
  async function open(url: string): Promise<RouterTestingHarness> {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    TestBed.tick();
    for (const request of http.match((candidate) => candidate.url === '/api/channels')) {
      request.flush(makePage([makeChannel({ id: CHANNEL, title: 'Physics Notes' })]));
    }
    return harness;
  }

  async function answer(
    harness: RouterTestingHarness,
    items: MessageSummaryDto[],
    nextCursor: string | null = null,
  ) {
    const request = http.expectOne(isList());
    request.flush(makeMessagePage(items, nextCursor, items.length + (nextCursor ? 10 : 0)));
    await harness.fixture.whenStable();
    return request;
  }

  const page = (harness: RouterTestingHarness) => harness.routeNativeElement as HTMLElement;

  it('shows skeletons, then cards with albums grouped', async () => {
    const harness = await open('/messages');
    const request = http.expectOne(isList());
    expect(request.request.params.get('limit')).toBe(String(FEED_PAGE_SIZE));
    expect(request.request.params.get('sort')).toBe('newest');
    expect(request.request.params.has('types')).toBe(false);
    harness.detectChanges();
    expect(page(harness).querySelector('app-skeleton')).not.toBeNull();

    const text = makeMessage({ type: 'TEXT', media: null, excerpt: 'Homework: chapter 3' });
    const album = [makeMessage({ mediaGroupId: '5' }), makeMessage({ mediaGroupId: '5' })];
    request.flush(makeMessagePage([text, ...album], null, 3));
    await harness.fixture.whenStable();

    const cards = page(harness).querySelectorAll('app-message-card');
    expect(cards).toHaveLength(2);
    expect(cards[0]?.textContent).toContain('Homework: chapter 3');
    expect(cards[1]?.textContent).toContain('Album · 2 files');
    expect(cards[1]?.querySelector(`a[href="/messages/${album[1]?.id}"]`)).not.toBeNull();
    expect(page(harness).querySelector('.count')?.textContent).toContain('3 messages');
  });

  it('searches the words in the URL, one card per result, with the words marked', async () => {
    const harness = await open('/messages?q=bai%202');
    const request = http.expectOne((candidate) => candidate.url === '/api/search');
    expect(request.request.params.get('q')).toBe('bai 2');
    expect(request.request.params.get('sort')).toBe('relevance');
    const name = 'Bài 2 notes.pdf';
    const found = [1, 2].map(() =>
      makeMessage({
        mediaGroupId: '5',
        media: makeMediaSummary({ fileName: name }),
        matches: {
          fileName: [
            [0, 3],
            [4, 1],
          ],
          excerpt: [],
        },
      }),
    );
    request.flush(makeMessagePage(found, null, 2));
    await harness.fixture.whenStable();

    // Results of one album stay apart, so each shows what was found in it.
    const cards = page(harness).querySelectorAll('app-message-card');
    expect(cards).toHaveLength(2);
    const marks = Array.from(cards[0]?.querySelectorAll('mark') ?? []).map((m) => m.textContent);
    expect(marks).toEqual(['Bài', '2']);
    expect(page(harness).querySelector('.count')?.textContent).toContain('2 results');
  });

  it('shows favorites and tags changed elsewhere, and keeps them for Back', async () => {
    const harness = await open('/messages');
    const message = makeMessage({ type: 'TEXT', media: null, excerpt: 'Candles' });
    await answer(harness, [message]);
    const heart = () => page(harness).querySelector('app-message-card app-favorite-button button');
    expect(heart()?.getAttribute('aria-pressed')).toBe('false');

    const tag = { id: '0199a0b1-0000-7000-8000-e00000000001', name: 'Charts', color: null };
    const changes = TestBed.inject(MessageChanges);
    changes.publish(favoriteChanged(message.id, true));
    changes.publish(tagsChanged(message.id, [tag]));
    await harness.fixture.whenStable();

    expect(heart()?.getAttribute('aria-pressed')).toBe('true');
    expect(page(harness).querySelector('app-tag-chip')?.textContent).toContain('Charts');
  });

  it('asks the api for the filters in the URL', async () => {
    await open(
      `/messages?channel=${CHANNEL}&type=documents&from=2026-01-01&to=2026-01-31&sort=oldest&downloaded=missing`,
    );
    const request = http.expectOne(isList());
    const params = request.request.params;
    expect(params.get('channelId')).toBe(CHANNEL);
    expect(params.get('types')).toBe('DOCUMENT');
    expect(params.get('from')).toBe(new Date(2026, 0, 1).toISOString());
    expect(params.get('to')).toBe(new Date(2026, 0, 31, 23, 59, 59, 999).toISOString());
    expect(params.get('sort')).toBe('oldest');
    expect(params.get('downloaded')).toBe('false');
    request.flush(makeMessagePage([]));
  });

  it('keeps filter changes in the URL and loads the new list', async () => {
    const harness = await open('/messages');
    await answer(harness, [makeMessage()]);

    const filters = harness.fixture.debugElement.query(By.directive(FeedFiltersBar))
      .componentInstance as FeedFiltersBar;
    filters.filtersChange.emit({
      q: '',
      channelId: CHANNEL,
      topicId: null,
      category: 'videos',
      tagIds: [],
      favorite: false,
      from: null,
      to: null,
      sort: 'newest',
      downloaded: 'downloaded',
    });
    await vi.waitFor(() =>
      expect(TestBed.inject(Router).url).toBe(
        `/messages?channel=${CHANNEL}&type=videos&downloaded=downloaded`,
      ),
    );
    TestBed.tick();
    const request = http.expectOne(isList());
    expect(request.request.params.get('types')).toBe('VIDEO,ANIMATION,VIDEO_NOTE');
    expect(request.request.params.get('downloaded')).toBe('true');
    request.flush(makeMessagePage([]));
    await harness.fixture.whenStable();

    // Nothing matches: the empty state offers to clear the filters.
    const empty = page(harness).querySelector('app-empty-state');
    expect(empty?.textContent).toContain('Nothing matches these filters');
    empty?.querySelector('button')?.click();
    await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe('/messages'));
    TestBed.tick();
    http.expectOne(isList()).flush(makeMessagePage([]));
    await harness.fixture.whenStable();
    expect(page(harness).querySelector('app-empty-state')?.textContent).toContain(
      'No messages yet',
    );
  });

  it('appends the next page and keeps it when the reader comes Back', async () => {
    // Back and Forward reach the router through its location listener.
    TestBed.inject(Router).setUpLocationChangeListener();
    const harness = await open('/videos');
    const first = makeMessage({ media: makeMediaSummary({ fileName: 'Lesson 1.mp4' }) });
    await answer(harness, [first], 'cursor-2');
    expect(page(harness).querySelectorAll('app-media-tile')).toHaveLength(1);

    const more = Array.from(page(harness).querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Load more'),
    );
    more?.click();
    const next = http.expectOne(isList('cursor-2'));
    expect(next.request.params.get('types')).toBe('VIDEO,ANIMATION,VIDEO_NOTE');
    const second = makeMessage({ media: makeMediaSummary({ fileName: 'Lesson 2.mp4' }) });
    next.flush(makeMessagePage([second], null, null));
    await harness.fixture.whenStable();
    const titles = () =>
      Array.from(page(harness).querySelectorAll('app-media-tile .title')).map(
        (title) => title.textContent,
      );
    expect(titles()).toEqual(['Lesson 1.mp4', 'Lesson 2.mp4']);

    // Open a video, then go Back: the list comes back as it was, without asking again.
    await harness.navigateByUrl(`/messages/${first.id}`);
    TestBed.inject(Location).back();
    await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe('/videos'));
    TestBed.tick();
    for (const request of http.match((candidate) => candidate.url === '/api/channels')) {
      request.flush(makePage([]));
    }
    await harness.fixture.whenStable();
    http.expectNone(isList());
    expect(titles()).toEqual(['Lesson 1.mp4', 'Lesson 2.mp4']);
  });

  it('shows videos as tiles with their length and preview', async () => {
    const videos = await open('/videos');
    await answer(videos, [
      makeMessage({ media: makeMediaSummary({ duration: 754, downloadStatus: 'DOWNLOADED' }) }),
    ]);
    const tile = page(videos).querySelector('app-media-tile');
    expect(tile?.textContent).toContain('12:34');
    expect(tile?.textContent).toContain('Downloaded');
    expect(tile?.querySelector('img')?.getAttribute('src')).toMatch(
      /^\/api\/media\/.+\/thumbnail$/,
    );
  });

  it('shows documents as rows that can be downloaded', async () => {
    const documents = await open('/documents');
    await answer(documents, [
      makeMessage({
        type: 'DOCUMENT',
        media: makeMediaSummary({
          type: 'DOCUMENT',
          fileName: 'notes.pdf',
          mimeType: 'application/pdf',
        }),
      }),
    ]);
    const row = page(documents).querySelector('app-media-row');
    expect(row?.textContent).toContain('notes.pdf');
    expect(row?.textContent).toContain('PDF document');
    expect(row?.querySelector('app-media-download-control button')).not.toBeNull();
  });

  it('opens images in the viewer, among the other images of the list', async () => {
    const harness = await open('/images');
    const photos = [
      makeMessage({
        type: 'PHOTO',
        media: makeMediaSummary({ type: 'PHOTO', mimeType: 'image/jpeg' }),
      }),
      makeMessage({
        type: 'PHOTO',
        media: makeMediaSummary({ type: 'PHOTO', mimeType: 'image/jpeg' }),
      }),
    ];
    await answer(harness, photos);

    page(harness).querySelectorAll<HTMLAnchorElement>('app-media-tile a')[1]?.click();
    expect(viewer.open).toHaveBeenCalledTimes(1);
    const [images, index] = viewer.open.mock.calls[0] as [{ messageId: string }[], number];
    expect(images.map((image) => image.messageId)).toEqual(photos.map((photo) => photo.id));
    expect(index).toBe(1);
    expect(TestBed.inject(Router).url).toBe('/images');
  });

  it('shows an error state and loads again on retry', async () => {
    const harness = await open('/messages');
    flushError(http.expectOne(isList()), 503, 'Database is down', 'DB_DOWN');
    await harness.fixture.whenStable();

    const error = page(harness).querySelector('app-error-state');
    expect(error?.textContent).toContain('Database is down');
    error?.querySelector('button')?.click();
    TestBed.tick();
    await answer(harness, [makeMessage({ type: 'TEXT', media: null, excerpt: 'Back again' })]);
    expect(page(harness).querySelector('app-message-card')?.textContent).toContain('Back again');
  });
});

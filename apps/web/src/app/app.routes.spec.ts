import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { By } from '@angular/platform-browser';
import {
  type ActivatedRouteSnapshot,
  Router,
  TitleStrategy,
  provideRouter,
  withComponentInputBinding,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { MEDIA_CATEGORIES } from '@tam/shared';
import {
  makeMessagePage,
  makePage,
  makeSession,
  makeSettings,
  makeStats,
  makeStorageList,
  makeTag,
  makeTagList,
  makeTelegramStatus,
  makeUser,
} from '../testing/fixtures';
import { answerSessionCheck, nextRequest } from '../testing/http';
import { routes } from './app.routes';
import { serverErrorInterceptor } from './core/interceptors/server-error-interceptor';
import { unauthorizedInterceptor } from './core/interceptors/unauthorized-interceptor';
import { PageTitleStrategy } from './core/services/page-title-strategy';
import { ChannelListPage } from './features/channels/channel-list-page';
import { FavoritesPage } from './features/favorites/favorites-page';
import { ImportListPage } from './features/imports/import-list-page';
import { ImportWizardPage } from './features/imports/import-wizard-page';
import { MediaBrowserPage } from './features/media/media-browser-page';
import { MEDIA_SECTIONS } from './features/media/media-sections';
import { MessageListPage } from './features/messages/message-list-page';
import { SettingsPage } from './features/settings/settings-page';
import { TagPage } from './features/tags/tag-page';
import { TagsPage } from './features/tags/tags-page';
import { Shell } from './layout/shell/shell';
import { NAV_ITEMS } from './layout/sidebar/nav-items';
import { ChannelDetailPage } from './pages/channel-detail/channel-detail-page';
import { ChannelTopicPage } from './pages/channel-topic/channel-topic-page';
import { DashboardPage } from './pages/dashboard/dashboard-page';
import { ImportJobPage } from './pages/import-job/import-job-page';
import { LoginPage } from './pages/login/login-page';
import { MessageDetailPage } from './pages/message-detail/message-detail-page';
import { NotFoundPage } from './pages/not-found/not-found-page';
import { SearchPage } from './pages/search/search-page';

const TAG = makeTag({ name: 'Charts' });

/** The page each sidebar entry must open. */
const SIDEBAR_PAGES: Readonly<Record<string, Type<unknown>>> = {
  '/dashboard': DashboardPage,
  '/channels': ChannelListPage,
  '/messages': MessageListPage,
  '/videos': MediaBrowserPage,
  '/images': MediaBrowserPage,
  '/documents': MediaBrowserPage,
  '/audio': MediaBrowserPage,
  '/favorites': FavoritesPage,
  '/tags': TagsPage,
  '/imports': ImportListPage,
  '/settings': SettingsPage,
};

describe('app routes', () => {
  let http: HttpTestingController;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes, withComponentInputBinding()),
        provideHttpClient(withInterceptors([unauthorizedInterceptor, serverErrorInterceptor])),
        provideHttpClientTesting(),
        { provide: TitleStrategy, useClass: PageTitleStrategy },
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  /** The component of the deepest activated route (the page inside the shell). */
  function routedPage(): Type<unknown> | null {
    let route: ActivatedRouteSnapshot = router.routerState.snapshot.root;
    while (route.firstChild) {
      route = route.firstChild;
    }
    return route.component;
  }

  /** Answers the data requests pages make on arrival, so nothing stays pending. */
  function answerPageRequests(): void {
    TestBed.tick();
    for (const request of http.match('/api/stats')) {
      request.flush(makeStats());
    }
    for (const request of http.match((candidate) => candidate.url === '/api/channels')) {
      request.flush(makePage([]));
    }
    for (const request of http.match('/api/telegram/status')) {
      request.flush(makeTelegramStatus());
    }
    for (const request of http.match('/api/storage/locations')) {
      request.flush(makeStorageList([]));
    }
    for (const request of http.match((candidate) => candidate.url === '/api/import-jobs')) {
      request.flush(makePage([]));
    }
    for (const request of http.match('/api/settings')) {
      request.flush(makeSettings());
    }
    for (const request of http.match('/api/auth/sessions')) {
      request.flush([makeSession()]);
    }
    for (const request of http.match((candidate) => candidate.url === '/api/messages')) {
      request.flush(makeMessagePage([]));
    }
    for (const request of http.match('/api/tags')) {
      request.flush(makeTagList([TAG]));
    }
  }

  async function navigateSignedIn(harness: RouterTestingHarness, url: string): Promise<void> {
    const navigation = harness.navigateByUrl(url);
    await answerSessionCheck(http, makeUser());
    await navigation;
  }

  it('sends anonymous visitors from /dashboard to /login with a returnUrl', async () => {
    const harness = await RouterTestingHarness.create();
    const navigation = harness.navigateByUrl('/dashboard');
    await answerSessionCheck(http, null);
    await navigation;

    expect(router.url).toBe('/login?returnUrl=%2Fdashboard');
    expect(routedPage()).toBe(LoginPage);
    expect(harness.fixture.debugElement.query(By.directive(Shell))).toBeNull();
    http.verify();
  });

  it('lets a signed-in user reach the dashboard inside the shell', async () => {
    const harness = await RouterTestingHarness.create();
    await navigateSignedIn(harness, '/dashboard');
    answerPageRequests();
    await harness.fixture.whenStable();

    expect(router.url).toBe('/dashboard');
    expect(routedPage()).toBe(DashboardPage);
    expect(harness.fixture.debugElement.query(By.directive(Shell))).not.toBeNull();
    expect(harness.fixture.debugElement.query(By.directive(DashboardPage))).not.toBeNull();
    expect(document.title).toBe('Dashboard · Unofficial Telegram Archive Manager');
    http.verify();
  });

  it('opens the dashboard for the root URL', async () => {
    const harness = await RouterTestingHarness.create();
    await navigateSignedIn(harness, '/');
    answerPageRequests();

    expect(router.url).toBe('/dashboard');
    expect(routedPage()).toBe(DashboardPage);
  });

  it('resolves a page for every sidebar entry', async () => {
    const harness = await RouterTestingHarness.create();
    await navigateSignedIn(harness, '/dashboard');
    answerPageRequests();

    expect(NAV_ITEMS.map((item) => item.path)).toEqual(Object.keys(SIDEBAR_PAGES));
    for (const item of NAV_ITEMS) {
      await harness.navigateByUrl(item.path);
      answerPageRequests();

      expect(router.url).toBe(item.path);
      expect(routedPage()).toBe(SIDEBAR_PAGES[item.path]);
      const page = harness.fixture.debugElement.query(By.directive(SIDEBAR_PAGES[item.path]));
      expect(page, `page for ${item.path}`).not.toBeNull();
    }
    http.verify();
  });

  it('opens a tag by id with the messages that carry it', async () => {
    const harness = await RouterTestingHarness.create();
    await navigateSignedIn(harness, `/tags/${TAG.id}`);
    (await nextRequest(http, '/api/tags')).flush(makeTagList([TAG]));
    const feed = await nextRequest(http, '/api/messages');
    expect(feed.request.params.get('tagIds')).toBe(TAG.id);
    feed.flush(makeMessagePage([]));
    answerPageRequests();
    await harness.fixture.whenStable();

    expect(routedPage()).toBe(TagPage);
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toContain('Charts');
    expect(document.title).toBe('Tag · Unofficial Telegram Archive Manager');
    http.verify();
  });

  it('gives each media section its own category and title', async () => {
    expect(MEDIA_SECTIONS.map((section) => section.category)).toEqual(
      Object.keys(MEDIA_CATEGORIES),
    );

    const harness = await RouterTestingHarness.create();
    await navigateSignedIn(harness, '/documents');
    answerPageRequests();
    await harness.fixture.whenStable();

    const page = harness.fixture.debugElement.query(By.directive(MediaBrowserPage));
    expect((page.componentInstance as MediaBrowserPage).mediaCategory()).toBe('documents');
    expect(page.nativeElement.querySelector('h1')?.textContent).toContain('Documents');
    expect(document.title).toBe('Documents · Unofficial Telegram Archive Manager');
  });

  it.each<[string, Type<unknown>]>([
    ['/channels/0199a0b1-0000-7000-8000-000000000001', ChannelDetailPage],
    ['/channels/0199a0b1-0000-7000-8000-000000000001/topics/42', ChannelTopicPage],
    ['/messages/0199a0b1-0000-7000-8000-000000000002', MessageDetailPage],
    ['/imports/new', ImportWizardPage],
    ['/imports/0199a0b1-0000-7000-8000-000000000003', ImportJobPage],
    ['/search?q=physics', SearchPage],
    ['/no/such/page', NotFoundPage],
  ])('routes %s to its page', async (url, page) => {
    const harness = await RouterTestingHarness.create();
    await navigateSignedIn(harness, url);

    expect(routedPage()).toBe(page);
    expect(harness.fixture.debugElement.query(By.directive(Shell))).not.toBeNull();
  });

  it('sends a signed-in user away from /login', async () => {
    const harness = await RouterTestingHarness.create();
    await navigateSignedIn(harness, '/login');
    answerPageRequests();

    expect(router.url).toBe('/dashboard');
    expect(routedPage()).toBe(DashboardPage);
  });
});

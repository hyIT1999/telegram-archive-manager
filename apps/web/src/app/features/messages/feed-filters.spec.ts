import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { MatChipListboxHarness } from '@angular/material/chips/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatSelectHarness } from '@angular/material/select/testing';
import {
  makeChannel,
  makePage,
  makeTag,
  makeTagList,
  makeTopic,
  makeTopicList,
} from '../../../testing/fixtures';
import { nextRequest } from '../../../testing/http';
import { TAG_ENDPOINTS } from '../tags/tags-api';
import { TOPIC_ENDPOINTS } from '../topics/topics-api';
import { FeedFiltersBar, SEARCH_DEBOUNCE_MS } from './feed-filters';
import type { FeedFilters, FeedScope } from './feed-query';

const DEFAULTS: FeedFilters = {
  q: '',
  channelId: null,
  topicId: null,
  category: null,
  tagIds: [],
  favorite: false,
  from: null,
  to: null,
  sort: 'newest',
  downloaded: 'all',
};

@Component({
  template: `<app-feed-filters
    [filters]="filters()"
    [scope]="scope()"
    [forumChannel]="forum()"
    [searchField]="searchField()"
    (filtersChange)="changes.push($event); filters.set($event)"
  />`,
  imports: [FeedFiltersBar],
})
class Host {
  readonly filters = signal<FeedFilters>(DEFAULTS);
  readonly scope = signal<FeedScope>({});
  readonly forum = signal(false);
  readonly searchField = signal(true);
  readonly changes: FeedFilters[] = [];
}

describe('FeedFiltersBar', () => {
  let fixture: ComponentFixture<Host>;
  let http: HttpTestingController;

  const forum = makeChannel({ title: 'Trading course', isForum: true });
  const oldGroup = makeChannel({
    title: 'Old group',
    type: 'GROUP',
    migratedToChannelId: forum.id,
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: SEARCH_DEBOUNCE_MS, useValue: 5 },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function render(setup: (host: Host) => void = () => undefined) {
    fixture = TestBed.createComponent(Host);
    setup(fixture.componentInstance);
    TestBed.tick();
    for (const request of http.match((candidate) => candidate.url === '/api/channels')) {
      expect(request.request.params.get('limit')).toBe('100');
      request.flush(makePage([forum, oldGroup]));
    }
    // A forum channel fixed by the page reads its topics right away.
    for (const request of http.match(TOPIC_ENDPOINTS.list(forum.id))) {
      request.flush(makeTopicList([makeTopic()]));
    }
    await fixture.whenStable();
    return TestbedHarnessEnvironment.loader(fixture);
  }

  const last = () => fixture.componentInstance.changes.at(-1);
  const element = () => fixture.nativeElement as HTMLElement;

  it('picks the kind of message with the chips', async () => {
    const loader = await render();
    const chips = await loader.getHarness(MatChipListboxHarness);
    await chips.selectChips({ text: 'Videos' });
    expect(last()?.category).toBe('videos');

    await chips.selectChips({ text: 'Text' });
    // Text messages have no files, so the file filter goes away with it.
    expect(last()).toMatchObject({ category: 'text', downloaded: 'all' });
    await fixture.whenStable();
    const selects = await loader.getAllHarnesses(MatSelectHarness);
    const labels = await Promise.all(
      selects.map(async (select) => (await select.getValueText()) || ''),
    );
    expect(labels).not.toContain('All files');
  });

  it('offers channels without their old groups, and the topics of a forum', async () => {
    const loader = await render();
    const [channelSelect] = await loader.getAllHarnesses(MatSelectHarness);
    await channelSelect?.open();
    const options = await channelSelect?.getOptions();
    const texts = await Promise.all((options ?? []).map((option) => option.getText()));
    expect(texts).toEqual(['All channels', 'Trading course']);
    // Clicked directly: the harness would wait for the topic request this choice starts.
    Array.from(document.querySelectorAll<HTMLElement>('mat-option'))
      .find((option) => option.textContent?.includes('Trading course'))
      ?.click();
    expect(last()).toMatchObject({ channelId: forum.id, topicId: null });

    TestBed.tick();
    http.expectOne(TOPIC_ENDPOINTS.list(forum.id)).flush(
      makeTopicList([
        makeTopic({
          topicId: 20,
          title: 'Charts',
          counts: { messages: 5, videos: 5, images: 0, documents: 0, audio: 0 },
        }),
      ]),
    );
    await fixture.whenStable();
    const selects = await loader.getAllHarnesses(MatSelectHarness);
    const topicSelect = selects[1];
    await topicSelect?.open();
    await topicSelect?.clickOptions({ text: 'Charts (5)' });
    expect(last()).toMatchObject({ channelId: forum.id, topicId: 20 });
  });

  it('shows only what the page does not fix', async () => {
    const loader = await render((host) => {
      host.scope.set({ channelId: forum.id, category: 'videos', favorite: true, tagId: 'tag' });
      host.filters.set({ ...DEFAULTS, channelId: forum.id, category: 'videos', favorite: true });
      host.forum.set(true);
      host.searchField.set(false);
    });

    expect(await loader.getAllHarnesses(MatChipListboxHarness)).toHaveLength(0);
    const text = element().textContent ?? '';
    expect(text).not.toContain('Channel');
    expect(text).not.toContain('Tags');
    expect(text).not.toContain('Search this list');
    expect(text).toContain('Topic');
    expect(text).toContain('Files');
  });

  it('sets dates and clears every filter at once, keeping the search', async () => {
    await render((host) => host.filters.set({ ...DEFAULTS, q: 'lens', sort: 'relevance' }));
    const from = element().querySelector<HTMLInputElement>('input[type="date"]');
    if (from) {
      from.value = '2026-01-15';
      from.dispatchEvent(new Event('change'));
    }
    expect(last()?.from).toBe('2026-01-15');
    await fixture.whenStable();

    Array.from(element().querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('Clear filters'))
      ?.click();
    expect(last()).toEqual({ ...DEFAULTS, q: 'lens', sort: 'relevance' });
  });

  it('searches once typing pauses, at once on Enter, and orders by best match', async () => {
    await render();
    const field = element().querySelector<HTMLInputElement>('input[type="search"]');
    if (!field) {
      throw new Error('no search field');
    }
    field.value = 'opt';
    field.dispatchEvent(new Event('input'));
    field.value = ' optics ';
    field.dispatchEvent(new Event('input'));
    expect(fixture.componentInstance.changes).toHaveLength(0);
    await vi.waitFor(() => expect(last()).toMatchObject({ q: 'optics', sort: 'relevance' }));
    expect(fixture.componentInstance.changes).toHaveLength(1);

    // Refining a search keeps the order chosen for it.
    fixture.componentInstance.filters.set({ ...DEFAULTS, q: 'optics', sort: 'oldest' });
    await fixture.whenStable();
    field.value = 'optics 2';
    field.dispatchEvent(new Event('input'));
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(last()).toMatchObject({ q: 'optics 2', sort: 'oldest' });

    // Ending the search returns to the page's order.
    await fixture.whenStable();
    Array.from(element().querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.getAttribute('aria-label') === 'Clear the search')
      ?.click();
    expect(last()).toMatchObject({ q: '', sort: 'newest' });
  });

  it('filters by favorites and by tags, loading the tags when the list opens', async () => {
    const loader = await render();
    const [, favorites] = await loader.getAllHarnesses(MatChipListboxHarness);
    await favorites?.selectChips({ text: /Favorites/ });
    expect(last()?.favorite).toBe(true);
    await fixture.whenStable();

    const selects = await loader.getAllHarnesses(MatSelectHarness);
    const orders = selects.at(-1);
    await orders?.open();
    const sorts = await Promise.all(((await orders?.getOptions()) ?? []).map((o) => o.getText()));
    expect(sorts).toEqual(['Newest first', 'Oldest first', 'Recently favorited']);
    await orders?.close();

    // The tag list is only asked for now.
    http.expectNone(TAG_ENDPOINTS.list);
    const red = makeTag({ name: 'Red' });
    const blue = makeTag({ name: 'Blue' });
    // Opened by clicking: the harness would wait for the tag request this starts.
    Array.from(element().querySelectorAll<HTMLElement>('mat-select'))
      .find((select) => select.closest('mat-form-field')?.textContent?.includes('Tags'))
      ?.querySelector<HTMLElement>('.mat-mdc-select-trigger')
      ?.click();
    (await nextRequest(http, TAG_ENDPOINTS.list)).flush(makeTagList([red, blue]));
    await fixture.whenStable();
    const names = Array.from(document.querySelectorAll('mat-option')).map((option) =>
      option.textContent?.trim(),
    );
    expect(names).toEqual(['Blue', 'Red']);
    Array.from(document.querySelectorAll<HTMLElement>('mat-option'))
      .find((option) => option.textContent?.includes('Red'))
      ?.click();
    expect(last()?.tagIds).toEqual([red.id]);
  });
});

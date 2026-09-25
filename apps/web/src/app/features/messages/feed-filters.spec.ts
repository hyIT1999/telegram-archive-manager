import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { MatChipListboxHarness } from '@angular/material/chips/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatSelectHarness } from '@angular/material/select/testing';
import { makeChannel, makePage, makeTopic, makeTopicList } from '../../../testing/fixtures';
import { TOPIC_ENDPOINTS } from '../topics/topics-api';
import { FeedFiltersBar } from './feed-filters';
import type { FeedFilters, FeedScope } from './feed-query';

const DEFAULTS: FeedFilters = {
  channelId: null,
  topicId: null,
  category: null,
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
    (filtersChange)="changes.push($event); filters.set($event)"
  />`,
  imports: [FeedFiltersBar],
})
class Host {
  readonly filters = signal<FeedFilters>(DEFAULTS);
  readonly scope = signal<FeedScope>({});
  readonly forum = signal(false);
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
      host.scope.set({ channelId: forum.id, category: 'videos' });
      host.filters.set({ ...DEFAULTS, channelId: forum.id, category: 'videos' });
      host.forum.set(true);
    });

    expect(await loader.getAllHarnesses(MatChipListboxHarness)).toHaveLength(0);
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).not.toContain('Channel');
    expect(element.textContent).toContain('Topic');
    expect(element.textContent).toContain('Files');
  });

  it('sets dates and clears every filter at once', async () => {
    await render();
    const element = fixture.nativeElement as HTMLElement;
    const from = element.querySelector<HTMLInputElement>('input[type="date"]');
    if (from) {
      from.value = '2026-01-15';
      from.dispatchEvent(new Event('change'));
    }
    expect(last()?.from).toBe('2026-01-15');
    await fixture.whenStable();

    const clear = Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.includes('Clear filters'),
    );
    clear?.click();
    expect(last()).toEqual(DEFAULTS);
  });
});

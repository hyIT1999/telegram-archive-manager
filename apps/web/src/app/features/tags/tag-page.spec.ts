import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { makeMessagePage, makeTag, makeTagList } from '../../../testing/fixtures';
import { nextRequest } from '../../../testing/http';
import { MESSAGE_ENDPOINTS } from '../messages/messages-api';
import { TagPage } from './tag-page';
import { TAG_ENDPOINTS } from './tags-api';

@Component({ template: 'all tags' })
class TagsStub {}

describe('TagPage', () => {
  let http: HttpTestingController;
  const tag = makeTag({ name: 'Charts', color: '#0090ff', messageCount: 4 });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [
            { path: 'tags', component: TagsStub },
            { path: 'tags/:id', component: TagPage },
          ],
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

  /** Opens the page and answers the tag list and the filters' channel list. */
  async function open(id: string) {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(`/tags/${id}`);
    (await nextRequest(http, TAG_ENDPOINTS.list)).flush(makeTagList([tag]));
    return harness;
  }

  it('lists the messages carrying the tag, under its name and color', async () => {
    const harness = await open(tag.id);
    const feed = await nextRequest(http, MESSAGE_ENDPOINTS.list);
    expect(feed.request.params.get('tagIds')).toBe(tag.id);
    feed.flush(makeMessagePage([]));
    for (const request of http.match((candidate) => candidate.url === '/api/channels')) {
      request.flush({ items: [], nextCursor: null });
    }
    await harness.fixture.whenStable();

    const page = harness.routeNativeElement as HTMLElement;
    expect(page.querySelector('h1')?.textContent).toContain('Charts');
    expect(page.textContent).toContain('4 messages');
    expect(page.textContent).toContain('Blue');
    expect(page.textContent).toContain('No message carries this tag');
    // The tag is fixed: the filters offer no other.
    expect(page.querySelector('app-feed-filters')?.textContent).not.toContain('Tags');
  });

  it('says so when the tag does not exist', async () => {
    const harness = await open('0199a0b1-0000-7000-8000-e00000000404');
    await harness.fixture.whenStable();
    expect(harness.routeNativeElement?.textContent).toContain('Tag not found');
  });

  it('deletes the tag and goes back to all tags', async () => {
    const harness = await open(tag.id);
    (await nextRequest(http, MESSAGE_ENDPOINTS.list)).flush(makeMessagePage([]));
    for (const request of http.match((candidate) => candidate.url === '/api/channels')) {
      request.flush({ items: [], nextCursor: null });
    }
    await harness.fixture.whenStable();

    Array.from((harness.routeNativeElement as HTMLElement).querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Delete'))
      ?.click();
    const confirm = await vi.waitFor(() => {
      const found = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => button.textContent?.includes('Delete tag'),
      );
      if (!found) {
        throw new Error('no confirmation yet');
      }
      return found;
    });
    confirm.click();
    const request = await nextRequest(http, TAG_ENDPOINTS.tag(tag.id));
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    (await nextRequest(http, TAG_ENDPOINTS.list)).flush(makeTagList([]));
    await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe('/tags'));
  });
});

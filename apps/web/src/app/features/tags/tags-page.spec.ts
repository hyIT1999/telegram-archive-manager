import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter } from '@angular/router';
import { flushError, makeTag, makeTagList } from '../../../testing/fixtures';
import { nextRequest } from '../../../testing/http';
import type { TagDto } from '../../shared/models';
import { TAG_COLORS } from './tag-palette';
import { TAG_ENDPOINTS } from './tags-api';
import { TAG_SEARCH_FROM, TagsPage } from './tags-page';

@Component({ template: 'tag page' })
class TagStub {}

describe('TagsPage', () => {
  let fixture: ComponentFixture<TagsPage>;
  let http: HttpTestingController;

  const zeta = makeTag({ name: 'Zeta', messageCount: 1, color: TAG_COLORS[0]?.value ?? null });
  const alpha = makeTag({ name: 'alpha', messageCount: 12 });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'tags/:id', component: TagStub }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function render(tags: TagDto[]) {
    fixture = TestBed.createComponent(TagsPage);
    (await nextRequest(http, TAG_ENDPOINTS.list)).flush(makeTagList(tags));
    await fixture.whenStable();
  }

  const element = () => fixture.nativeElement as HTMLElement;
  const rows = () =>
    Array.from(element().querySelectorAll('.row')).map((row) => [
      row.querySelector('.name')?.textContent?.trim(),
      row.querySelector('.count')?.textContent?.trim(),
    ]);
  const button = (root: ParentNode, text: string) =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((candidate) =>
      candidate.textContent?.includes(text),
    );

  it('lists the tags by name with how many messages carry them', async () => {
    await render([zeta, alpha]);
    expect(rows()).toEqual([
      ['alpha', '12 messages'],
      ['Zeta', '1 message'],
    ]);
    expect(element().querySelector('.row a')?.getAttribute('href')).toBe(`/tags/${alpha.id}`);
    expect(element().querySelector('h1')?.textContent).toContain('Tags');
    // A few tags need no search field.
    expect(element().querySelector('input[type="search"]')).toBeNull();
  });

  it('finds a tag by name without accents once there are many', async () => {
    const many = Array.from({ length: TAG_SEARCH_FROM }, (_, index) =>
      makeTag({ name: `Module ${index}` }),
    );
    await render([...many, makeTag({ name: 'Quan trọng' })]);
    const search = element().querySelector<HTMLInputElement>('input[type="search"]');
    if (search) {
      search.value = 'quan trong';
      search.dispatchEvent(new Event('input'));
    }
    await fixture.whenStable();
    expect(rows().map(([name]) => name)).toEqual(['Quan trọng']);
  });

  it('creates a tag in the dialog, and keeps it open when the name is taken', async () => {
    await render([]);
    expect(element().textContent).toContain('No tags yet');
    button(element(), 'New tag')?.click();
    await fixture.whenStable();

    const dialog = () => document.querySelector('app-tag-dialog') as HTMLElement;
    const name = dialog().querySelector('input') as HTMLInputElement;
    name.value = 'Astronomy';
    name.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    button(dialog(), 'Create tag')?.click();
    const taken = http.expectOne(TAG_ENDPOINTS.list);
    expect(taken.request.method).toBe('POST');
    expect(taken.request.body).toEqual({ name: 'Astronomy', color: TAG_COLORS[0]?.value });
    flushError(taken, 409, 'There is already a tag named “Astronomy”', 'TAG_NAME_TAKEN');
    await fixture.whenStable();
    expect(dialog().textContent).toContain('There is already a tag named “Astronomy”');

    name.value = 'Astronomy 2';
    name.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    button(dialog(), 'Create tag')?.click();
    const created = makeTag({ name: 'Astronomy 2', messageCount: 0 });
    http.expectOne((request) => request.method === 'POST').flush(created);
    // The list is read again, with the new tag.
    (await nextRequest(http, TAG_ENDPOINTS.list)).flush(makeTagList([created]));
    await fixture.whenStable();
    expect(document.querySelector('app-tag-dialog')).toBeNull();
    expect(rows()).toEqual([['Astronomy 2', '0 messages']]);
  });

  it('deletes a tag after asking', async () => {
    await render([alpha]);
    element().querySelector<HTMLButtonElement>('.row button')?.click();
    await fixture.whenStable();
    button(document, 'Delete')?.click();
    const confirm = await vi.waitFor(() => {
      const found = button(
        document.querySelector('mat-dialog-container') ?? document,
        'Delete tag',
      );
      if (!found) {
        throw new Error('no confirmation yet');
      }
      return found;
    });
    expect(document.body.textContent).toContain('It is taken off the 12 messages that carry it.');
    confirm.click();

    const request = await vi.waitFor(() => http.expectOne(TAG_ENDPOINTS.tag(alpha.id)));
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    (await nextRequest(http, TAG_ENDPOINTS.list)).flush(makeTagList([]));
    await fixture.whenStable();
    expect(element().textContent).toContain('No tags yet');
  });
});

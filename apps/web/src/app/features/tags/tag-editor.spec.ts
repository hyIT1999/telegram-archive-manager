import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { flushError, makeMessage, makeTag, makeTagList, tagRef } from '../../../testing/fixtures';
import { nextRequest } from '../../../testing/http';
import type { MessageSummaryDto, TagRefDto } from '../../shared/models';
import { MessageChanges } from '../messages/message-changes';
import { TagEditor } from './tag-editor';
import { TAG_COLORS } from './tag-palette';
import { TAG_ENDPOINTS } from './tags-api';

const MESSAGE = '0199a0b1-0000-7000-8000-d00000000001';

@Component({
  template: `<app-tag-editor [messageId]="id" [tags]="tags()" />`,
  imports: [TagEditor],
})
class Host {
  readonly id = MESSAGE;
  readonly tags = signal<readonly TagRefDto[]>([]);
}

describe('TagEditor', () => {
  let fixture: ComponentFixture<Host>;
  let http: HttpTestingController;
  let seen: MessageSummaryDto;

  const maths = makeTag({ name: 'Toán học', color: '#e5484d' });
  const physics = makeTag({ name: 'Vật lý', color: null });

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    seen = makeMessage({ id: MESSAGE });
    TestBed.inject(MessageChanges).updates.subscribe((update) => (seen = update(seen)));
    fixture = TestBed.createComponent(Host);
    fixture.componentInstance.tags.set([tagRef(physics)]);
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  const element = () => fixture.nativeElement as HTMLElement;
  const field = () => element().querySelector('input') as HTMLInputElement;
  const chips = () =>
    Array.from(element().querySelectorAll('mat-chip-row')).map((chip) =>
      chip.textContent?.replace('cancel', '').trim(),
    );
  const options = () =>
    Array.from(document.querySelectorAll('mat-option .name')).map((name) => name.textContent);

  /** Focusing the field loads the tags. */
  async function focusField() {
    field().focus();
    field().dispatchEvent(new Event('focus'));
    (await nextRequest(http, TAG_ENDPOINTS.list)).flush(makeTagList([maths, physics]));
  }

  async function type(text: string) {
    field().value = text;
    field().dispatchEvent(new Event('input'));
    await fixture.whenStable();
  }

  it('suggests the tags the message lacks, found without accents, and adds one', async () => {
    expect(chips()).toEqual(['Vật lý']);
    await focusField();
    await type('toan');

    expect(options()).toEqual(['Toán học', 'Create “toan”']);
    Array.from(document.querySelectorAll<HTMLElement>('mat-option'))[0]?.click();
    const request = http.expectOne(TAG_ENDPOINTS.messageTags(MESSAGE));
    expect(request.request.body).toEqual({ tagId: maths.id });
    request.flush({ tags: [tagRef(maths), tagRef(physics)] });
    // The counts are read again.
    (await nextRequest(http, TAG_ENDPOINTS.list)).flush(makeTagList([maths, physics]));
    await fixture.whenStable();

    expect(chips()).toEqual(['Toán học', 'Vật lý']);
    expect(seen.tags.map((tag) => tag.name)).toEqual(['Toán học', 'Vật lý']);
    expect(field().value).toBe('');
  });

  it('creates a tag from a new name, in the least used color', async () => {
    await focusField();
    await type('Astronomy');

    expect(options()).toEqual(['Create “Astronomy”']);
    document.querySelector<HTMLElement>('mat-option')?.click();
    const request = http.expectOne(TAG_ENDPOINTS.messageTags(MESSAGE));
    // Red is taken by "Toán học": the next color of the palette.
    expect(request.request.body).toEqual({ name: 'Astronomy', color: TAG_COLORS[1]?.value });
    request.flush({ tags: [tagRef(physics), { id: 'new', name: 'Astronomy', color: '#f76b15' }] });
    (await nextRequest(http, TAG_ENDPOINTS.list)).flush(makeTagList([maths, physics]));
    await fixture.whenStable();
    expect(chips()).toEqual(['Vật lý', 'Astronomy']);
  });

  it('takes a tag off, and says why when that fails', async () => {
    element().querySelector<HTMLButtonElement>('button[matChipRemove]')?.click();
    const request = http.expectOne(TAG_ENDPOINTS.messageTag(MESSAGE, physics.id));
    expect(request.request.method).toBe('DELETE');
    flushError(request, 404, 'Message not found', 'NOT_FOUND');
    await fixture.whenStable();

    expect(element().querySelector('[role="alert"]')?.textContent).toContain('Message not found');
    expect(chips()).toEqual(['Vật lý']);
  });
});

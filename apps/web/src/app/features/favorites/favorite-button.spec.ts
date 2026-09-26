import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { flushError, makeMessage } from '../../../testing/fixtures';
import { NotifyService } from '../../core/services/notify-service';
import type { MessageSummaryDto } from '../../shared/models';
import { MessageChanges } from '../messages/message-changes';
import { FavoriteButton } from './favorite-button';
import { FAVORITE_ENDPOINTS } from './favorites-api';

const MESSAGE = '0199a0b1-0000-7000-8000-d00000000001';

@Component({
  template: `<app-favorite-button
    [messageId]="id"
    [favorite]="favorite()"
    [variant]="variant()"
  />`,
  imports: [FavoriteButton],
})
class Host {
  readonly id = MESSAGE;
  readonly favorite = signal(false);
  readonly variant = signal<'icon' | 'overlay' | 'button'>('icon');
}

describe('FavoriteButton', () => {
  let fixture: ComponentFixture<Host>;
  let http: HttpTestingController;
  let seen: MessageSummaryDto;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    // What any list showing the message would make of the changes.
    seen = makeMessage({ id: MESSAGE });
    TestBed.inject(MessageChanges).updates.subscribe((update) => (seen = update(seen)));
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  const button = () =>
    (fixture.nativeElement as HTMLElement).querySelector('button') as HTMLButtonElement;

  it('turns on at once, tells the lists, and saves it', async () => {
    button().click();
    // Before the server answers (waiting for stability would wait for the request).
    fixture.detectChanges();
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(button().getAttribute('aria-label')).toBe('Remove from favorites');
    expect(seen.isFavorite).toBe(true);

    // One request at a time: a second click waits for the answer.
    button().click();
    const request = http.expectOne(FAVORITE_ENDPOINTS.favorite(MESSAGE));
    expect(request.request.method).toBe('POST');
    request.flush({ isFavorite: true, favoritedAt: '2026-09-26T00:00:00.000Z' });
    await fixture.whenStable();
    expect(button().getAttribute('aria-pressed')).toBe('true');
  });

  it('turns back and says why when the server refuses', async () => {
    const error = vi.spyOn(TestBed.inject(NotifyService), 'error').mockImplementation(() => {});
    fixture.componentInstance.favorite.set(true);
    await fixture.whenStable();

    button().click();
    const request = http.expectOne(FAVORITE_ENDPOINTS.favorite(MESSAGE));
    expect(request.request.method).toBe('DELETE');
    flushError(request, 404, 'Message not found', 'NOT_FOUND');
    await fixture.whenStable();

    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(seen.isFavorite).toBe(true);
    expect(error).toHaveBeenCalledWith('Removing from favorites failed: Message not found');
  });

  it('says what it does next to the heart on the message page', async () => {
    fixture.componentInstance.variant.set('button');
    await fixture.whenStable();
    expect(button().textContent).toContain('Favorite');

    button().click();
    fixture.detectChanges();
    expect(button().textContent).toContain('Favorited');
    http.expectOne(FAVORITE_ENDPOINTS.favorite(MESSAGE)).flush({
      isFavorite: true,
      favoritedAt: '2026-09-26T00:00:00.000Z',
    });
  });
});

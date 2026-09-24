import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Sidebar } from './sidebar';

@Component({ selector: 'app-page-stub', template: '' })
class PageStub {}

const EXPECTED_ITEMS: readonly (readonly [label: string, href: string])[] = [
  ['Dashboard', '/dashboard'],
  ['Channels', '/channels'],
  ['All Messages', '/messages'],
  ['Videos', '/videos'],
  ['Images', '/images'],
  ['Documents', '/documents'],
  ['Audio', '/audio'],
  ['Favorites', '/favorites'],
  ['Tags', '/tags'],
  ['Import Jobs', '/imports'],
  ['Settings', '/settings'],
];

describe('Sidebar', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Sidebar],
      providers: [provideRouter([{ path: '**', component: PageStub }])],
    });
  });

  function navLinks(root: HTMLElement): HTMLAnchorElement[] {
    return Array.from(root.querySelectorAll<HTMLAnchorElement>('a[mat-list-item]'));
  }

  it('renders exactly the 11 sections in order with their links', async () => {
    const fixture = TestBed.createComponent(Sidebar);
    await fixture.whenStable();

    const links = navLinks(fixture.nativeElement);
    const rendered = links.map((link) => [
      link.querySelector('[matListItemTitle]')?.textContent?.trim(),
      link.getAttribute('href'),
    ]);
    expect(rendered).toEqual(EXPECTED_ITEMS.map(([label, href]) => [label, href]));
  });

  it('is a labelled navigation landmark', async () => {
    const fixture = TestBed.createComponent(Sidebar);
    await fixture.whenStable();

    const navigation = (fixture.nativeElement as HTMLElement).querySelector('[role="navigation"]');
    expect(navigation?.getAttribute('aria-label')).toBe('Main navigation');
  });

  it('marks the section of the current page as active', async () => {
    const fixture = TestBed.createComponent(Sidebar);
    await TestBed.inject(Router).navigateByUrl('/channels/0199a0b1-0000-7000-8000-000000000001');
    await fixture.whenStable();

    const active = navLinks(fixture.nativeElement).filter(
      (link) => link.getAttribute('aria-current') === 'page',
    );
    expect(active.map((link) => link.getAttribute('href'))).toEqual(['/channels']);
  });
});

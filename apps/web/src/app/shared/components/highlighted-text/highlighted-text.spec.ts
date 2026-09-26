import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { TextRange } from '../../models';
import { highlightParts } from '../../text/highlight';
import { HighlightedText } from './highlighted-text';

describe('highlightParts', () => {
  it('marks the ranges and keeps the rest as it is', () => {
    expect(
      highlightParts('Bài 2 notes', [
        [0, 3],
        [4, 1],
      ]),
    ).toEqual([
      { text: 'Bài', marked: true },
      { text: ' ', marked: false },
      { text: '2', marked: true },
      { text: ' notes', marked: false },
    ]);
  });

  it('sorts, joins and clips ranges', () => {
    expect(
      highlightParts('abcdef', [
        [4, 10],
        [0, 2],
        [1, 2],
      ]),
    ).toEqual([
      { text: 'abc', marked: true },
      { text: 'd', marked: false },
      { text: 'ef', marked: true },
    ]);
    expect(
      highlightParts('abc', [
        [-2, 3],
        [5, 1],
      ]),
    ).toEqual([
      { text: 'a', marked: true },
      { text: 'bc', marked: false },
    ]);
  });

  it('keeps plain text plain', () => {
    expect(highlightParts('abc', null)).toEqual([{ text: 'abc', marked: false }]);
    expect(highlightParts('', [])).toEqual([]);
  });
});

@Component({
  template: `<p><app-highlighted-text [text]="text()" [ranges]="ranges()" /></p>`,
  imports: [HighlightedText],
})
class Host {
  readonly text = signal('Wave <b>zone</b>');
  readonly ranges = signal<readonly TextRange[]>([[8, 4]]);
}

describe('HighlightedText', () => {
  it('marks the words found and shows markup-like text as text', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const paragraph = (fixture.nativeElement as HTMLElement).querySelector('p');
    expect(paragraph?.textContent).toBe('Wave <b>zone</b>');
    expect(paragraph?.querySelector('b')).toBeNull();
    expect(Array.from(paragraph?.querySelectorAll('mark') ?? []).map((m) => m.textContent)).toEqual(
      ['zone'],
    );
  });
});

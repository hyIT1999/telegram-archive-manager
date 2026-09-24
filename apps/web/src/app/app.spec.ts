import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';

describe('App', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    });
  });

  it('renders only the router outlet; layouts come from the routes', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('router-outlet')).not.toBeNull();
    expect(root.children).toHaveLength(1);
  });
});

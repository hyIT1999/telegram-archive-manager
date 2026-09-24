import { TestBed } from '@angular/core/testing';
import { THEME_STORAGE_KEY, ThemeService } from './theme-service';

/** Controllable `(prefers-color-scheme: dark)` query. */
class FakeDarkSchemeQuery {
  private readonly listeners = new Set<(event: MediaQueryListEvent) => void>();

  constructor(public matches: boolean) {}

  addEventListener(_type: 'change', listener: (event: MediaQueryListEvent) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'change', listener: (event: MediaQueryListEvent) => void): void {
    this.listeners.delete(listener);
  }

  /** Simulates the user switching the OS theme. */
  change(matches: boolean): void {
    this.matches = matches;
    for (const listener of this.listeners) {
      listener({ matches } as MediaQueryListEvent);
    }
  }
}

describe('ThemeService', () => {
  let darkScheme: FakeDarkSchemeQuery;

  const appliedTheme = () => document.documentElement.getAttribute('data-theme');

  function createService(): ThemeService {
    const service = TestBed.inject(ThemeService);
    TestBed.tick();
    return service;
  }

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    darkScheme = new FakeDarkSchemeQuery(false);
    vi.spyOn(window, 'matchMedia').mockImplementation(
      () => darkScheme as unknown as MediaQueryList,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('defaults to the system preference', () => {
    darkScheme.matches = true;
    const theme = createService();

    expect(theme.mode()).toBe('system');
    expect(theme.resolvedTheme()).toBe('dark');
    expect(appliedTheme()).toBe('dark');
  });

  it('follows OS theme changes while in system mode', () => {
    const theme = createService();
    expect(appliedTheme()).toBe('light');

    darkScheme.change(true);
    TestBed.tick();

    expect(theme.resolvedTheme()).toBe('dark');
    expect(appliedTheme()).toBe('dark');
  });

  it('persists an explicit choice and applies it to html[data-theme]', () => {
    const theme = createService();

    theme.setMode('dark');
    TestBed.tick();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(appliedTheme()).toBe('dark');

    theme.setMode('light');
    TestBed.tick();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(appliedTheme()).toBe('light');
  });

  it('ignores the OS once the user picked a theme', () => {
    const theme = createService();
    theme.setMode('light');
    darkScheme.change(true);
    TestBed.tick();

    expect(appliedTheme()).toBe('light');
  });

  it('restores the stored choice on startup', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    const theme = createService();

    expect(theme.mode()).toBe('dark');
    expect(appliedTheme()).toBe('dark');
  });

  it('falls back to system mode for unknown stored values', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    const theme = createService();

    expect(theme.mode()).toBe('system');
  });
});

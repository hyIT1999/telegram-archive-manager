import { DOCUMENT, DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export interface ThemeOption {
  readonly mode: ThemeMode;
  readonly label: string;
  /** Material Symbols ligature name. */
  readonly icon: string;
}

/** Choices offered in the header menu and on the settings page. */
export const THEME_OPTIONS: readonly ThemeOption[] = [
  { mode: 'light', label: 'Light', icon: 'light_mode' },
  { mode: 'dark', label: 'Dark', icon: 'dark_mode' },
  { mode: 'system', label: 'System', icon: 'brightness_auto' },
];

/** Must match the inline script in index.html that applies the theme before bootstrap. */
export const THEME_STORAGE_KEY = 'tam-theme';
const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

/**
 * Light/dark/system theme. The resolved theme is written to `html[data-theme]`, which the global
 * stylesheet maps to `color-scheme`; in 'system' mode it follows the OS preference live.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly darkSchemeQuery = this.document.defaultView?.matchMedia?.(DARK_SCHEME_QUERY);
  private readonly systemPrefersDark = signal(this.darkSchemeQuery?.matches ?? false);
  private readonly selectedMode = signal<ThemeMode>(this.readStoredMode());

  readonly mode = this.selectedMode.asReadonly();
  readonly resolvedTheme = computed<ResolvedTheme>(() => {
    const mode = this.selectedMode();
    if (mode === 'system') {
      return this.systemPrefersDark() ? 'dark' : 'light';
    }
    return mode;
  });

  constructor() {
    const query = this.darkSchemeQuery;
    if (query) {
      const onChange = (event: MediaQueryListEvent) => this.systemPrefersDark.set(event.matches);
      query.addEventListener('change', onChange);
      inject(DestroyRef).onDestroy(() => query.removeEventListener('change', onChange));
    }

    effect(() => {
      this.document.documentElement.setAttribute('data-theme', this.resolvedTheme());
    });
  }

  setMode(mode: ThemeMode): void {
    this.selectedMode.set(mode);
    try {
      this.document.defaultView?.localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // Storage can be unavailable (private mode, blocked cookies); the choice then lasts for this tab.
    }
  }

  private readStoredMode(): ThemeMode {
    try {
      const stored = this.document.defaultView?.localStorage.getItem(THEME_STORAGE_KEY);
      return THEME_OPTIONS.find((option) => option.mode === stored)?.mode ?? 'system';
    } catch {
      return 'system';
    }
  }
}

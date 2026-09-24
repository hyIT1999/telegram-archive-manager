// Stand-ins for browser APIs that jsdom does not implement. They only need to be inert:
// specs that depend on their behaviour (e.g. ThemeService and matchMedia) install their own fakes.

if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

class InertObserver {
  observe(): void {
    // no-op
  }
  unobserve(): void {
    // no-op
  }
  disconnect(): void {
    // no-op
  }
  takeRecords(): [] {
    return [];
  }
}

if (typeof globalThis.IntersectionObserver !== 'function') {
  globalThis.IntersectionObserver = InertObserver as unknown as typeof IntersectionObserver;
}

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = InertObserver as unknown as typeof ResizeObserver;
}

// jsdom logs "Not implemented" for window.scrollTo, which the router's scroll restoration calls.
window.scrollTo = () => undefined;

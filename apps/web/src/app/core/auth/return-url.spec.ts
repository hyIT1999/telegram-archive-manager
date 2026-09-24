import { DEFAULT_AUTHENTICATED_URL, loginQueryParams, safeReturnUrl } from './return-url';

describe('safeReturnUrl', () => {
  it.each(['/channels', '/channels/abc?tab=media', '/search?q=physics#top'])(
    'keeps the in-app URL %s',
    (url) => {
      expect(safeReturnUrl(url)).toBe(url);
    },
  );

  it.each([
    null,
    undefined,
    '',
    'https://evil.example/',
    '//evil.example/path',
    '/\\evil.example',
    'channels',
    '/login',
    '/login?returnUrl=%2Fdashboard',
  ])('falls back to the dashboard for %s', (url) => {
    expect(safeReturnUrl(url)).toBe(DEFAULT_AUTHENTICATED_URL);
  });
});

describe('loginQueryParams', () => {
  it('carries the page the user wanted', () => {
    expect(loginQueryParams('/channels?cursor=x')).toEqual({ returnUrl: '/channels?cursor=x' });
  });

  it('omits the root URL and anything unsafe', () => {
    expect(loginQueryParams('/')).toEqual({});
    expect(loginQueryParams('//evil.example')).toEqual({});
    expect(loginQueryParams('/login')).toEqual({});
    expect(loginQueryParams(undefined)).toEqual({});
  });
});

/** Where a signed-in user lands when there is no (valid) page to return to. */
export const DEFAULT_AUTHENTICATED_URL = '/dashboard';

export const LOGIN_PATH = '/login';

/**
 * Accepts only app-relative URLs so `?returnUrl=` can never send the user to another origin
 * (`//evil.example`, `/\evil.example`) or loop back to the login page.
 */
export function safeReturnUrl(candidate: string | null | undefined): string {
  if (
    !candidate ||
    !candidate.startsWith('/') ||
    candidate.startsWith('//') ||
    candidate.startsWith('/\\') ||
    candidate === LOGIN_PATH ||
    candidate.startsWith(`${LOGIN_PATH}?`) ||
    candidate.startsWith(`${LOGIN_PATH}/`)
  ) {
    return DEFAULT_AUTHENTICATED_URL;
  }
  return candidate;
}

/** Query params for the login page; the root URL is the default target, so it is omitted. */
export function loginQueryParams(returnUrl: string | null | undefined): Record<string, string> {
  return returnUrl && returnUrl !== '/' && safeReturnUrl(returnUrl) === returnUrl
    ? { returnUrl }
    : {};
}

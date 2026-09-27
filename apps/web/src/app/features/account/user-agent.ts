/** Browsers, most specific first (Edge and Opera also say "Chrome", Chrome also says "Safari"). */
const BROWSERS: readonly [RegExp, string][] = [
  [/\bEdgA?\//, 'Edge'],
  [/\bOPR\/|\bOpera\b/, 'Opera'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bChrome\/|\bCriOS\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
  [/^curl\//, 'curl'],
];

/** Systems, most specific first (Android also says "Linux", iOS also says "like Mac OS X"). */
const SYSTEMS: readonly [RegExp, string][] = [
  [/\bWindows\b/, 'Windows'],
  [/\bAndroid\b/, 'Android'],
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
];

function first(userAgent: string, table: readonly [RegExp, string][]): string | null {
  return table.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null;
}

/** "Chrome on Windows", "Safari on iPhone"… from a User-Agent header, for the sessions list. */
export function describeUserAgent(userAgent: string | null): string {
  if (!userAgent) {
    return 'Unknown browser';
  }
  const browser = first(userAgent, BROWSERS);
  const system = first(userAgent, SYSTEMS);
  if (browser && system) {
    return `${browser} on ${system}`;
  }
  return browser ?? (system ? `A browser on ${system}` : 'Unknown browser');
}

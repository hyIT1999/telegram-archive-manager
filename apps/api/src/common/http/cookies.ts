/**
 * Reads one cookie from a `Cookie` request header (RFC 6265 §5.4): pairs split on `;`, name and
 * value split on the first `=`, surrounding quotes removed, value percent-decoded when valid.
 * The first occurrence wins, as browsers send the most specific path first.
 */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) {
    return undefined;
  }
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator === -1 || pair.slice(0, separator).trim() !== name) {
      continue;
    }
    let value = pair.slice(separator + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return undefined;
}

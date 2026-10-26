/** Browser-safe URL helpers for saved links (no Node imports). */

const TRACKING = /^(utm_|mc_|ref_?$|fbclid$|gclid$|igshid$|yclid$|msclkid$)/i;

/** Parses a user-entered address; adds https:// to bare hosts. Throws a readable error for anything that is not http(s). */
export function parseWebUrl(raw: string): URL {
  const text = String(raw ?? '').trim();
  if (!text || text.length > 2000) throw new Error('Enter a web address.');
  let url: URL;
  try {
    // "javascript:x" and "ftp://x" carry a scheme (and are rejected below); "example.com:8080/x" is a host and port.
    const hasScheme = /^[a-z][a-z0-9+.-]*:(?!\d+(\/|\?|#|$))/i.test(text);
    url = new URL(hasScheme ? text : `https://${text}`);
  } catch {
    throw new Error('That does not look like a web address.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http and https addresses can be saved.');
  if (url.username || url.password) throw new Error('Links with embedded credentials are not supported.');
  if (!url.hostname.includes('.') && url.hostname !== 'localhost') throw new Error('That does not look like a web address.');
  return url;
}

/**
 * A canonical form used to detect the same page saved twice: no fragment, no tracking parameters,
 * sorted query, no trailing slash, lower-case host.
 */
export function normalizeUrl(raw: string): string {
  const url = parseWebUrl(raw);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (TRACKING.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
  const query = url.searchParams.toString();
  return `${url.protocol}//${url.host}${path}${query ? `?${query}` : ''}`;
}

export const hostOf = (raw: string): string => {
  try {
    return new URL(raw).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

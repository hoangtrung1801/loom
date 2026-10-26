import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { safeHref } from './markdown.js';

export interface Clip {
  url: string;
  title: string;
  site: string;
  markdown: string;
}

/** Network seams so the clipper can be tested without the internet. */
export interface ClipHost {
  fetch?: (input: URL, init?: RequestInit) => Promise<Response>;
  resolve?: (host: string) => Promise<string[]>;
}

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;

const defaultResolve = async (host: string): Promise<string[]> => (await lookup(host, { all: true })).map((a) => a.address);

/** True for addresses a web clipper must never contact: loopback, private, link-local (cloud metadata), CGNAT, multicast. */
export function isPrivateAddress(address: string): boolean {
  const v6 = address.toLowerCase();
  if (isIP(v6) === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith('ff');
  }
  const p = address.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p as [number, number, number, number];
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

async function assertPublic(url: URL, resolve: NonNullable<ClipHost['resolve']>): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http and https pages can be clipped.');
  if (url.username || url.password) throw new Error('Links with embedded credentials are not supported.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('That address is private.');
  const addresses = isIP(host) ? [host] : await resolve(host).catch(() => []);
  if (!addresses.length) throw new Error(`Could not find ${host}.`);
  if (addresses.some(isPrivateAddress)) throw new Error('That address is private.');
}

/**
 * Fetches a public URL, following redirects by hand so every hop is re-checked against the private-address rules.
 * Returns the final response (not yet read) and its URL.
 */
export async function fetchPublic(raw: string | URL, host: ClipHost, accept: string): Promise<{ res: Response; url: URL }> {
  const doFetch = host.fetch ?? ((input, init) => fetch(input, init));
  const resolve = host.resolve ?? defaultResolve;
  let url: URL;
  try {
    url = new URL(String(raw).trim());
  } catch {
    throw new Error('That does not look like a web address.');
  }
  let res: Response | undefined;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublic(url, resolve);
    res = await doFetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
      headers: { accept, 'user-agent': 'Mozilla/5.0 (compatible; Loom/1.0)' },
    });
    const next = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!next) break;
    if (hop === MAX_REDIRECTS) throw new Error('Too many redirects.');
    url = new URL(next, url);
  }
  if (!res || !res.ok) throw new Error(`The page responded ${res?.status ?? 'with an error'}.`);
  return { res, url };
}

/** Fetches a page and returns its readable text as markdown. */
export async function clipUrl(raw: string, host: ClipHost = {}): Promise<Clip> {
  const { res, url } = await fetchPublic(raw, host, 'text/html,application/xhtml+xml,text/plain;q=0.8');
  const type = (res.headers.get('content-type') ?? '').toLowerCase();
  if (type && !/^(text\/html|application\/xhtml\+xml|text\/plain)/.test(type)) throw new Error('Only web pages and plain text can be clipped.');
  const body = new TextDecoder('utf-8', { fatal: false }).decode(await readCapped(res, MAX_BYTES));
  if (type.startsWith('text/plain')) return { url: url.href, title: url.hostname, site: url.hostname, markdown: body.trim() };
  return { url: url.href, ...extract(body, url) };
}

export interface Preview {
  url: string;
  title: string;
  description: string;
  site: string;
  /** Absolute address of the page's preview image, if it declares one. */
  image: string;
}

/** Title, description and preview image of a page: what a bookmark shows. Reads at most the first 2 MB. */
export async function fetchPreview(raw: string, host: ClipHost = {}): Promise<Preview> {
  const { res, url } = await fetchPublic(raw, host, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1');
  const type = (res.headers.get('content-type') ?? '').toLowerCase();
  if (type && !/^(text\/html|application\/xhtml\+xml)/.test(type)) return { url: url.href, title: '', description: '', site: '', image: '' };
  const html = new TextDecoder('utf-8', { fatal: false }).decode(await readCapped(res, 2 * 1024 * 1024, true));
  const head = html.replace(/<!--[\s\S]*?-->/g, '');
  const title = meta(head, 'og:title', 'twitter:title') || decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? '').replace(/\s+/g, ' ').trim();
  const description = meta(head, 'og:description', 'twitter:description', 'description');
  const site = meta(head, 'og:site_name');
  let image = '';
  const declared = meta(head, 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src');
  if (declared) {
    try {
      const abs = new URL(declared, url);
      if (abs.protocol === 'http:' || abs.protocol === 'https:') image = abs.href;
    } catch {
      /* ignore a malformed image address */
    }
  }
  return { url: url.href, title: title.slice(0, 300), description: description.replace(/\s+/g, ' ').slice(0, 1000), site: site.slice(0, 200), image };
}

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);

/** Downloads a preview image (small raster images only; SVG can carry scripts, so it is never fetched). */
export async function fetchImage(raw: string, host: ClipHost = {}): Promise<{ bytes: Uint8Array; mime: string }> {
  const { res } = await fetchPublic(raw, host, 'image/avif,image/webp,image/png,image/jpeg,image/gif');
  const mime = (res.headers.get('content-type') ?? '').toLowerCase().split(';')[0]!.trim();
  if (!IMAGE_TYPES.has(mime)) throw new Error('Not a supported image type.');
  return { bytes: await readCapped(res, 3 * 1024 * 1024), mime };
}

/** Reads a body up to `max` bytes. With `truncate` the rest is dropped silently (a page head is enough); otherwise too much is an error. */
async function readCapped(res: Response, max: number, truncate = false): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      if (!truncate) throw new Error('That page is too large to clip.');
      chunks.push(value.subarray(0, value.byteLength - (size - max)));
      break;
    }
    chunks.push(value);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©', reg: '®', trade: '™', middot: '·', bull: '•', euro: '€', pound: '£', deg: '°', times: '×', rarr: '→', larr: '←', eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', aacute: 'á', acirc: 'â', auml: 'ä', ouml: 'ö', uuml: 'ü', szlig: 'ß', ccedil: 'ç', ntilde: 'ñ', oacute: 'ó', iacute: 'í', uacute: 'ú' };
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1]!.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const DROP = /<(script|style|noscript|svg|nav|footer|aside|form|iframe|template|head|button|select|dialog)\b[\s\S]*?<\/\1\s*>/gi;

function meta(html: string, ...names: string[]): string {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    if (key && names.includes(key)) {
      const content = /content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i.exec(tag);
      const value = content?.[1] ?? content?.[2];
      if (value) return decodeEntities(value).trim();
    }
  }
  return '';
}

/** Readable text of an HTML page as markdown: prefers <article>/<main>, drops page chrome, keeps headings, lists, links, quotes and code. */
export function extract(html: string, base: URL): Omit<Clip, 'url'> {
  const title = meta(html, 'og:title', 'twitter:title') || decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim() || base.hostname;
  const site = meta(html, 'og:site_name') || base.hostname;
  let body = html.replace(/<!--[\s\S]*?-->/g, '');
  const bodyStart = /<body\b[^>]*>/i.exec(body);
  if (bodyStart) body = body.slice(bodyStart.index + bodyStart[0].length);
  body = body.replace(DROP, '');
  const pick = (tag: string): string | undefined => new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, 'i').exec(body)?.[1];
  const main = pick('article') ?? pick('main') ?? body;

  const out: string[] = [];
  const lists: { ordered: boolean; n: number }[] = [];
  let inPre = false;
  let quote = 0;
  let href: string | null = null;
  const push = (text: string): void => void out.push(text);
  const tokens = main.split(/(<[^>]+>)/);
  for (const token of tokens) {
    if (!token) continue;
    const tag = /^<\s*(\/?)([a-z0-9]+)\b([^>]*)>$/i.exec(token);
    if (!tag) {
      push(inPre ? decodeEntities(token) : decodeEntities(token).replace(/\s+/g, ' '));
      continue;
    }
    const closing = tag[1] === '/';
    const name = tag[2]!.toLowerCase();
    const attrs = tag[3] ?? '';
    const prefix = quote ? '> '.repeat(quote) : '';
    if (/^h[1-6]$/.test(name)) push(closing ? '\n\n' : `\n\n${prefix}${'#'.repeat(Number(name[1]))} `);
    else if (name === 'p' || name === 'div' || name === 'section' || name === 'tr') push(closing ? '\n\n' : `\n\n${prefix}`);
    else if (name === 'br') push(`\n${prefix}`);
    else if (name === 'hr') push('\n\n---\n\n');
    else if (name === 'ul' || name === 'ol') {
      if (closing) lists.pop();
      else lists.push({ ordered: name === 'ol', n: 0 });
      if (!lists.length || (!closing && lists.length === 1)) push('\n'); // blank line around a top-level list only
    } else if (name === 'li') {
      if (!closing) {
        const list = lists.at(-1);
        const indent = '  '.repeat(Math.max(0, lists.length - 1));
        if (list) list.n++;
        push(`\n${prefix}${indent}${list?.ordered ? `${list.n}. ` : '- '}`);
      }
    } else if (name === 'blockquote') {
      quote += closing ? -1 : 1;
      quote = Math.max(0, quote);
      push(closing ? '\n\n' : `\n\n${'> '.repeat(quote)}`);
    } else if (name === 'pre') {
      inPre = !closing;
      push(closing ? '\n```\n\n' : '\n\n```\n');
    } else if (name === 'code' && !inPre) push('`');
    else if (name === 'strong' || name === 'b') push('**');
    else if (name === 'em' || name === 'i') push('*');
    else if (name === 'td' || name === 'th') push(closing ? ' | ' : '');
    else if (name === 'a') {
      if (closing) {
        if (href) push(`](${href})`);
        href = null;
      } else {
        const target = /href\s*=\s*"([^"]*)"|href\s*=\s*'([^']*)'/i.exec(attrs);
        let abs: string | null = null;
        try {
          abs = safeHref(new URL(decodeEntities(target?.[1] ?? target?.[2] ?? ''), base).href);
        } catch {
          /* no usable link */
        }
        href = abs;
        if (href) push('[');
      }
    }
  }
  const markdown = out
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\*\*\s*\*\*/g, '')
    .trim();
  return { title: title.slice(0, 300), site, markdown };
}

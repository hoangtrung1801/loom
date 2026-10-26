import { describe, expect, it } from 'vitest';
import { clipUrl, extract, isPrivateAddress } from '../src/core/clip.js';
import { buildApp } from '../src/core/rpc.js';
import { Store } from '../src/core/store.js';

const page = (html: string, init: ResponseInit = {}) => new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, ...init });
const publicHost = { resolve: async () => ['93.184.216.34'] };

const ARTICLE = `<!doctype html><html><head><title>Ignored &amp; fallback</title>
<meta property="og:title" content="How &quot;spaced repetition&quot; works"><meta property="og:site_name" content="Learning Notes">
<style>.x{color:red}</style><script>alert(1)</script></head><body>
<nav><a href="/home">Home</a></nav>
<article><h1>Spaced repetition</h1><p>Review <strong>just</strong> before you forget. See <a href="/guide?a=1&amp;b=2">the guide</a> and <a href="javascript:alert(1)">bad</a>.</p>
<ul><li>Cards</li><li>Intervals<ul><li>Doubling</li></ul></li></ul><ol><li>One</li><li>Two</li></ol>
<blockquote>Memory is a habit.</blockquote><pre><code>if (due) review();
  next();</code></pre><p>Caf&eacute; &#233; &#x41;&nbsp;done</p></article>
<footer>© nobody</footer></body></html>`;

describe('web clipper', () => {
  it('extracts readable markdown and drops page chrome', () => {
    const clip = extract(ARTICLE, new URL('https://example.com/post/1'));
    expect(clip.title).toBe('How "spaced repetition" works');
    expect(clip.site).toBe('Learning Notes');
    expect(clip.markdown).toContain('# Spaced repetition');
    expect(clip.markdown).toContain('Review **just** before you forget.');
    expect(clip.markdown).toContain('[the guide](https://example.com/guide?a=1&b=2)');
    expect(clip.markdown).not.toContain('javascript:');
    expect(clip.markdown).toContain('- Cards');
    expect(clip.markdown).toContain('  - Doubling');
    expect(clip.markdown).toMatch(/1\. One\n2\. Two/);
    expect(clip.markdown).toContain('> Memory is a habit.');
    expect(clip.markdown).toContain('```\nif (due) review();\n  next();\n```');
    expect(clip.markdown).toContain('Café é A done');
    for (const dropped of ['alert(1)', 'Home', 'nobody', 'color:red']) expect(clip.markdown).not.toContain(dropped);
  });

  it('clips through fetch, following redirects only to public hosts', async () => {
    const seen: string[] = [];
    const fetcher = (async (input: URL | string) => {
      const url = String(input);
      seen.push(url);
      if (url === 'https://short.example/a') return new Response(null, { status: 301, headers: { location: '/b' } });
      return page(ARTICLE);
    });
    const clip = await clipUrl('https://short.example/a', { fetch: fetcher, ...publicHost });
    expect(seen).toEqual(['https://short.example/a', 'https://short.example/b']);
    expect(clip.url).toBe('https://short.example/b');

    const toPrivate = (async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } }));
    await expect(clipUrl('https://evil.example/', { fetch: toPrivate, ...publicHost })).rejects.toThrow(/private/);
  });

  it('refuses private, local and non-web addresses', async () => {
    const never = (async () => { throw new Error('must not fetch'); });
    for (const url of ['http://localhost:3000', 'http://127.0.0.1/', 'http://10.0.0.5/', 'http://192.168.1.1/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://printer.local/', 'http://user:pw@example.com/']) {
      await expect(clipUrl(url, { fetch: never, ...publicHost }), url).rejects.toThrow();
    }
    await expect(clipUrl('file:///etc/passwd', { fetch: never })).rejects.toThrow(/http/);
    await expect(clipUrl('ftp://example.com/x', { fetch: never })).rejects.toThrow(/http/);
    await expect(clipUrl('not a url', { fetch: never })).rejects.toThrow(/web address/);
    await expect(clipUrl('https://rebind.example/', { fetch: never, resolve: async () => ['93.184.216.34', '127.0.0.1'] })).rejects.toThrow(/private/);
    expect(['8.8.8.8', '1.1.1.1', '93.184.216.34'].some(isPrivateAddress)).toBe(false);
    expect(['172.16.0.1', '172.31.255.255', '100.64.0.1', '0.0.0.0', 'fd00::1', 'fe80::1', '169.254.1.1'].every(isPrivateAddress)).toBe(true);
    expect(isPrivateAddress('172.32.0.1')).toBe(false);
  });

  it('rejects non-text responses, errors and oversized pages', async () => {
    const png = (async () => new Response('x', { headers: { 'content-type': 'image/png' } }));
    await expect(clipUrl('https://a.example/', { fetch: png, ...publicHost })).rejects.toThrow(/web pages/);
    const gone = (async () => new Response('nope', { status: 404, headers: { 'content-type': 'text/html' } }));
    await expect(clipUrl('https://a.example/', { fetch: gone, ...publicHost })).rejects.toThrow(/404/);
    const huge = (async () => page('a'.repeat(6 * 1024 * 1024)));
    await expect(clipUrl('https://a.example/', { fetch: huge, ...publicHost })).rejects.toThrow(/too large/);
    const loop = (async () => new Response(null, { status: 302, headers: { location: '/again' } }));
    await expect(clipUrl('https://a.example/', { fetch: loop, ...publicHost })).rejects.toThrow(/redirects/);
  });

  it('saves a web card in the inbox with its source, and the card is searchable', async () => {
    const store = new Store(':memory:');
    const app = buildApp(store, { filesDir: null, clip: { fetch: (async () => page(ARTICLE)), ...publicHost } });
    const id = await app.methods.clipWebPage('https://example.com/post/1');
    const card = store.getCard(id)!;
    expect(card).toMatchObject({ kind: 'web', inbox: true, title: 'How "spaced repetition" works' });
    expect(JSON.parse(card.meta)).toMatchObject({ url: 'https://example.com/post/1', site: 'Learning Notes' });
    expect(store.search('forget').map((h) => h.id)).toContain(id);
    await expect(app.methods.clipWebPage('http://127.0.0.1:9/')).rejects.toThrow();
    store.close();
  });
});

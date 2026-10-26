import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseTags } from '../src/core/ai/service.js';
import type { Llm } from '../src/core/ai/provider.js';
import { fetchImage, fetchPreview } from '../src/core/clip.js';
import { buildApp } from '../src/core/rpc.js';
import { Store } from '../src/core/store.js';

const PAGE = `<html><head><title>Fallback title</title>
<meta property="og:title" content="Zebras &amp; stripes"><meta property="og:description" content="Why zebras have   stripes.">
<meta property="og:site_name" content="Wild Facts"><meta property="og:image" content="/img/zebra.png"></head><body>text</body></html>`;
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
const publicHost = { resolve: async () => ['93.184.216.34'] };

function site(routes: Record<string, () => Response>) {
  const seen: string[] = [];
  const fetch = async (input: URL | string): Promise<Response> => {
    const url = String(input);
    seen.push(url);
    const route = routes[url] ?? routes[url.split('?')[0]!];
    if (!route) return new Response('nope', { status: 404 });
    return route();
  };
  return { host: { fetch, ...publicHost }, seen };
}
const html = (body: string) => () => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });
const png = () => new Response(PNG, { headers: { 'content-type': 'image/png' } });

const dirs: string[] = [];
const stores: Store[] = [];
afterEach(() => {
  stores.splice(0).forEach((s) => s.close());
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});
function setup(clip: Parameters<typeof buildApp>[1]['clip'], llm?: Llm) {
  const dir = mkdtempSync(join(tmpdir(), 'loom-links-'));
  dirs.push(dir);
  const store = new Store(':memory:');
  stores.push(store);
  const app = buildApp(store, { filesDir: dir, clip, llmFactory: llm ? () => llm : undefined });
  return { app, store };
}

describe('link previews', () => {
  it('reads title, description, site and an absolute image address', async () => {
    const { host } = site({ 'https://wild.example/zebras': html(PAGE) });
    expect(await fetchPreview('https://wild.example/zebras', host)).toEqual({
      url: 'https://wild.example/zebras', title: 'Zebras & stripes', description: 'Why zebras have stripes.', site: 'Wild Facts', image: 'https://wild.example/img/zebra.png',
    });
  });

  it('only downloads small raster images, never SVG or pages', async () => {
    const svg = () => new Response('<svg onload="alert(1)"/>', { headers: { 'content-type': 'image/svg+xml' } });
    const big = () => new Response(new Uint8Array(4 * 1024 * 1024), { headers: { 'content-type': 'image/png' } });
    const { host } = site({ 'https://a.example/ok.png': png, 'https://a.example/x.svg': svg, 'https://a.example/big.png': big, 'https://a.example/p': html('<p>x</p>') });
    expect((await fetchImage('https://a.example/ok.png', host)).mime).toBe('image/png');
    await expect(fetchImage('https://a.example/x.svg', host)).rejects.toThrow(/supported image/);
    await expect(fetchImage('https://a.example/p', host)).rejects.toThrow(/supported image/);
    await expect(fetchImage('https://a.example/big.png', host)).rejects.toThrow(/too large/);
    await expect(fetchImage('http://127.0.0.1/a.png', host)).rejects.toThrow(/private/);
  });
});

describe('saveLink', () => {
  it('saves a bookmark with its fetched details and a preview image stored as an attachment', async () => {
    const { host } = site({ 'https://wild.example/zebras?utm_source=x': html(PAGE), 'https://wild.example/img/zebra.png': png });
    const { app, store } = setup(host);
    const saved = await app.methods.saveLink('https://wild.example/zebras?utm_source=x', { note: 'for the talk', tags: ['Animals'] });
    expect(saved).toMatchObject({ existed: false, fetchError: '' });
    const [link] = app.methods.listLinks();
    expect(link).toMatchObject({ title: 'Zebras & stripes', host: 'wild.example', description: 'Why zebras have stripes.', note: 'for the talk', tags: ['animals'] });
    expect(link!.fileId).toMatch(/^[0-9a-f]{64}$/);
    expect(app.files.has(link!.fileId)).toBe(true);
    expect(store.getCard(saved.id)).toMatchObject({ kind: 'link', fileId: link!.fileId });
  });

  it('does not touch the network for a page that is already saved, but merges the new note and tags', async () => {
    const s = site({ 'https://wild.example/zebras': html(PAGE), 'https://wild.example/img/zebra.png': png });
    const { app } = setup(s.host);
    const first = await app.methods.saveLink('https://wild.example/zebras', { tags: ['a'] });
    const calls = s.seen.length;
    const second = await app.methods.saveLink('https://WILD.example/zebras/#section', { note: 'again', tags: ['b'] });
    expect(second).toMatchObject({ id: first.id, existed: true });
    expect(s.seen.length).toBe(calls);
    expect(app.methods.listLinks()[0]).toMatchObject({ tags: ['a', 'b'], note: 'again' });
  });

  it('still saves the link when the page cannot be fetched or the address is private', async () => {
    const { app } = setup(site({}).host);
    const missing = await app.methods.saveLink('https://gone.example/page');
    expect(missing.fetchError).toMatch(/404/);
    expect(app.methods.listLinks().find((l) => l.id === missing.id)).toMatchObject({ title: 'gone.example', description: '', fileId: '' });
    const local = await app.methods.saveLink('http://localhost:3000/app', { title: 'My dev server' });
    expect(local.fetchError).toMatch(/private/);
    expect(app.methods.listLinks().find((l) => l.id === local.id)).toMatchObject({ title: 'My dev server', url: 'http://localhost:3000/app' });
    await expect(app.methods.saveLink('javascript:alert(1)')).rejects.toThrow(/http/);
    await expect(app.methods.saveLink('')).rejects.toThrow();
  });

  it('asks the model for tags only when a key is set, none were given, and the page loaded', async () => {
    const prompts: string[] = [];
    const llm: Llm = { complete: async (req) => (prompts.push(req.messages.map((m) => ('content' in m ? m.content : '')).join('\n')), { text: 'Sure! {"tags":["Wildlife","Big Cats","wildlife","#Zebras","x y z"]}', toolCalls: [] }) };
    const s = site({ 'https://wild.example/zebras': html(PAGE), 'https://wild.example/img/zebra.png': png });
    const { app } = setup(s.host, llm);

    const noKey = await app.methods.saveLink('https://wild.example/zebras?a=1');
    expect(app.methods.listLinks().find((l) => l.id === noKey.id)!.tags).toEqual([]);
    expect(prompts).toHaveLength(0);

    app.methods.setAiConfig({ provider: 'openai', model: 'm', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'sk-test' });
    app.store.addTag(noKey.id, 'wildlife'); // an existing tag the model can reuse
    const tagged = await app.methods.saveLink('https://wild.example/zebras?a=2');
    expect(app.methods.listLinks().find((l) => l.id === tagged.id)!.tags).toEqual(['big-cats', 'wildlife', 'zebras']);
    expect(prompts[0]).toContain('"wildlife"');
    expect(prompts[0]).not.toContain('sk-test');

    const given = await app.methods.saveLink('https://wild.example/zebras?a=3', { tags: ['mine'] });
    expect(app.methods.listLinks().find((l) => l.id === given.id)!.tags).toEqual(['mine']);
    expect(prompts).toHaveLength(1); // user tags win, no model call
  });

  it('survives a failing model', async () => {
    const llm: Llm = { complete: async () => { throw new Error('rate limited'); } };
    const { app } = setup(site({ 'https://wild.example/z': html(PAGE) }).host, llm);
    app.methods.setAiConfig({ provider: 'openai', model: 'm', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'sk-test' });
    const saved = await app.methods.saveLink('https://wild.example/z');
    expect(app.methods.listLinks()[0]).toMatchObject({ id: saved.id, tags: [] });
  });

  it('cleans model output into tag names', () => {
    expect(parseTags('no json here')).toEqual([]);
    expect(parseTags('{"tags":"nope"}')).toEqual([]);
    expect(parseTags('{"tags":[1,null,"  Machine Learning ","C++","ok"]}')).toEqual(['machine-learning', 'c', 'ok']);
    expect(parseTags('{"tags":["a","b","c","d"]}')).toEqual(['a', 'b', 'c']);
  });
});

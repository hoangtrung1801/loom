import { describe, expect, test } from 'vitest';
import { createFileTools, fileKind, FILE_TOOL_NAME } from './fileTools';

const respond = (body: Buffer | string, type: string, status = 200) => async () => new Response(body as any, { status, headers: { 'content-type': type } });

const tool = (fetchFn: any, canSeeImages = true, bridge: any = {}) => createFileTools({
	addr: '127.0.0.1:1', key: 'k', bridge, getTabId: () => 't', canSeeImages, fetch: fetchFn,
})[0];

describe('fileKind', () => {
	test('classifies media types', () => {
		expect(fileKind('image/png')).toBe('image');
		expect(fileKind('application/pdf')).toBe('pdf');
		expect(fileKind('text/markdown; charset=utf-8')).toBe('text');
		expect(fileKind('application/json')).toBe('text');
		expect(fileKind('video/mp4')).toBe('other');
	});
});

describe('loom_read_file', () => {
	test('is named for the app tool prefix', () => {
		expect(tool(respond('', 'text/plain')).name).toBe(FILE_TOOL_NAME);
	});

	test('returns an image as image content', async () => {
		const res: any = await tool(respond(Buffer.from('abc'), 'image/png')).execute('1', { space: 's', file: 'f' });
		expect(res.content[1]).toEqual({ type: 'image', data: Buffer.from('abc').toString('base64'), mimeType: 'image/png' });
	});

	test('does not send images to a text-only model', async () => {
		const res: any = await tool(respond(Buffer.from('abc'), 'image/png'), false).execute('1', { space: 's', file: 'f' });
		expect(res.content.every((it: any) => it.type == 'text')).toBe(true);
	});

	test('returns text files as text', async () => {
		const res: any = await tool(respond('hello', 'text/plain')).execute('1', { space: 's', file: 'f' });
		expect(res.content[0].text).toContain('hello');
	});

	test('extracts PDF text through the window', async () => {
		const bridge = { call: async () => ({ pages: 2, text: 'page text' }) };
		const res: any = await tool(respond('%PDF', 'application/pdf'), true, bridge).execute('1', { space: 's', file: 'f' });
		expect(res.content[0].text).toContain('page text');
	});

	test('fails on an HTTP error', async () => {
		await expect(tool(respond('', 'text/plain', 404)).execute('1', { space: 's', file: 'f' })).rejects.toThrow('404');
	});
});

import type { AgentTool } from '@earendil-works/pi-agent-core';
import { APP_TOOL_PREFIX } from './policy';
import type { AppToolBridge } from './appTools';

/** Largest file the agent downloads. Anything bigger is reported by its metadata only. */
export const FILE_MAX_BYTES = 10 * 1024 * 1024;
/** Anthropic rejects images above 5 MB, so a bigger one is not sent. */
export const IMAGE_MAX_BYTES = 4 * 1024 * 1024;
/** Longest edge asked from the middleware for images, which resizes best-effort. */
export const IMAGE_WIDTH = 1568;
export const FILE_TEXT_LIMIT = 16000;

export const FILE_TOOL_NAME = `${APP_TOOL_PREFIX}read_file`;

const IMAGE_TYPES = new Set([ 'image/png', 'image/jpeg', 'image/gif', 'image/webp' ]);
const TEXT_APPLICATION = /^application\/(json|xml|x-yaml|yaml|toml|javascript|typescript|x-sh|sql|csv|x-ndjson)$/;
const TEXT_SUFFIX = /\+(json|xml)$/;

export type FileKind = 'image' | 'pdf' | 'text' | 'other';

export const fileKind = (mime: string): FileKind => {
	mime = String(mime || '').split(';')[0].trim().toLowerCase();

	if (IMAGE_TYPES.has(mime)) {
		return 'image';
	};
	if (mime == 'application/pdf') {
		return 'pdf';
	};
	if (mime.startsWith('text/') || TEXT_APPLICATION.test(mime) || TEXT_SUFFIX.test(mime) || (mime == 'image/svg+xml')) {
		return 'text';
	};
	return 'other';
};

export interface FileToolsDeps {
	/** Local API host:port. */
	addr: string;
	key: string;
	bridge: AppToolBridge;
	getTabId: () => string;
	/** Whether the model takes images as input. */
	canSeeImages: boolean;
	fetch?: typeof fetch;
};

const text = (value: string) => ({ type: 'text' as const, text: value });

const readLimited = async (res: Response, max: number): Promise<Buffer | null> => {
	const length = Number(res.headers.get('content-length') || 0);

	if (length > max) {
		return null;
	};

	const data = Buffer.from(await res.arrayBuffer());
	return data.length > max ? null : data;
};

/**
 * Loom's MCP tools return a file or image block as metadata (name, type, size, id) because the
 * bytes of a file are not text. This tool downloads those bytes from the local API and hands them
 * to the model: images as image input, PDFs and text files as text.
 */
export const createFileTools = (deps: FileToolsDeps): AgentTool<any>[] => [
	{
		name: FILE_TOOL_NAME,
		label: 'Read file',
		description: [
			'Reads the content of a file or image object, for example one that appears as a file or image block when you read an object.',
			'Images are shown to you, PDFs and text files are returned as text. Other types return only their name, type and size.',
			'Takes the file object id exactly as shown by read, and the space id.',
		].join(' '),
		parameters: {
			type: 'object',
			properties: {
				space: { type: 'string', description: 'space id' },
				file: { type: 'string', description: 'file or image object id' },
			},
			required: [ 'space', 'file' ],
		},
		execute: async (_id: string, params: any, signal?: AbortSignal) => {
			const space = String(params?.space || '');
			const file = String(params?.file || '');

			if (!space || !file) {
				throw new Error('space and file are required');
			};

			const doFetch = deps.fetch || fetch;
			const base = `http://${deps.addr}/v2/spaces/${encodeURIComponent(space)}/files/${encodeURIComponent(file)}/content`;
			const res = await doFetch(`${base}?width=${IMAGE_WIDTH}`, { headers: { Authorization: `Bearer ${deps.key}` }, signal });

			if (!res.ok) {
				throw new Error(`file ${file} could not be read (HTTP ${res.status})`);
			};

			const mime = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
			const kind = fileKind(mime);
			const data = await readLimited(res, FILE_MAX_BYTES);

			if (!data) {
				return { content: [ text(`File ${file} (${mime || 'unknown type'}) is larger than ${FILE_MAX_BYTES / 1024 / 1024} MB and was not read.`) ], details: undefined };
			};

			switch (kind) {
				case 'image': {
					if (!deps.canSeeImages) {
						return { content: [ text(`File ${file} is an image (${mime}, ${data.length} bytes). The selected model cannot view images, so its content is not available.`) ], details: undefined };
					};
					if (data.length > IMAGE_MAX_BYTES) {
						return { content: [ text(`Image ${file} (${mime}, ${data.length} bytes) is too large to send to the model.`) ], details: undefined };
					};
					return {
						content: [ text(`Image ${file} (${mime}, ${data.length} bytes):`), { type: 'image' as const, data: data.toString('base64'), mimeType: mime } ],
						details: undefined,
					};
				};

				case 'pdf': {
					const result = await deps.bridge.call(deps.getTabId(), 'extract_pdf_text', { data: data.toString('base64') }, signal);

					if (result?.error) {
						throw new Error(`PDF ${file} could not be read: ${result.error}`);
					};
					return { content: [ text(`PDF ${file} (${result.pages} pages):\n${result.text || '[no extractable text, the PDF may be scanned images]'}`) ], details: undefined };
				};

				case 'text': {
					const body = data.toString('utf8');
					const cut = body.length > FILE_TEXT_LIMIT;

					return { content: [ text(`File ${file} (${mime}):\n${body.slice(0, FILE_TEXT_LIMIT)}${cut ? `\n…[truncated ${body.length - FILE_TEXT_LIMIT} characters]` : ''}`) ], details: undefined };
				};
			};

			return { content: [ text(`File ${file} has type ${mime || 'unknown'} (${data.length} bytes), which cannot be read as text or image.`) ], details: undefined };
		},
	},
];

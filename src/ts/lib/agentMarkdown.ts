/**
 * A deliberately small markdown subset for agent replies: paragraphs, headings, bullet and numbered
 * lists, fenced code, **bold**, *italic* and `code`. It produces plain data, and the component turns
 * that into React elements, so model output never reaches innerHTML.
 */

export type AgentInline = { type: 'text' | 'bold' | 'italic' | 'code'; text: string };

export type AgentBlock =
	{ type: 'paragraph' | 'heading'; inline: AgentInline[] } |
	{ type: 'list'; ordered: boolean; items: AgentInline[][] } |
	{ type: 'code'; text: string };

const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\s][^*\n]*\*)/g;

export const parseInline = (text: string): AgentInline[] => {
	const out: AgentInline[] = [];
	let last = 0;

	for (const m of text.matchAll(INLINE)) {
		const token = m[0];
		const index = m.index || 0;

		if (index > last) {
			out.push({ type: 'text', text: text.slice(last, index) });
		};

		if (token.startsWith('`')) {
			out.push({ type: 'code', text: token.slice(1, -1) });
		} else
		if (token.startsWith('**')) {
			out.push({ type: 'bold', text: token.slice(2, -2) });
		} else {
			out.push({ type: 'italic', text: token.slice(1, -1) });
		};

		last = index + token.length;
	};

	if (last < text.length) {
		out.push({ type: 'text', text: text.slice(last) });
	};
	return out;
};

export const parseAgentMarkdown = (source: string): AgentBlock[] => {
	const lines = String(source || '').replace(/\r\n/g, '\n').split('\n');
	const blocks: AgentBlock[] = [];

	let paragraph: string[] = [];
	let list: { ordered: boolean; items: AgentInline[][] } | null = null;

	const flushParagraph = () => {
		if (paragraph.length) {
			blocks.push({ type: 'paragraph', inline: parseInline(paragraph.join('\n')) });
			paragraph = [];
		};
	};

	const flushList = () => {
		if (list) {
			blocks.push({ type: 'list', ordered: list.ordered, items: list.items });
			list = null;
		};
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		if (/^\s*```/.test(line)) {
			flushParagraph();
			flushList();

			const code: string[] = [];
			i++;
			// An unterminated fence (a reply still streaming) runs to the end
			while ((i < lines.length) && !/^\s*```/.test(lines[i])) {
				code.push(lines[i++]);
			};
			blocks.push({ type: 'code', text: code.join('\n') });
			continue;
		};

		const heading = line.match(/^#{1,6}\s+(.*)$/);
		if (heading) {
			flushParagraph();
			flushList();
			blocks.push({ type: 'heading', inline: parseInline(heading[1]) });
			continue;
		};

		const item = line.match(/^\s*([-*]|\d+[.)])\s+(.*)$/);
		if (item) {
			flushParagraph();

			const ordered = /\d/.test(item[1]);
			if (list && (list.ordered !== ordered)) {
				flushList();
			};
			list = list || { ordered, items: [] };
			list.items.push(parseInline(item[2]));
			continue;
		};

		if (!line.trim()) {
			flushParagraph();
			flushList();
			continue;
		};

		flushList();
		paragraph.push(line);
	};

	flushParagraph();
	flushList();
	return blocks;
};

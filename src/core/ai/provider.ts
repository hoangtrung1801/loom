import type { AiSettings } from './config.js';

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON schema for the arguments. */
  schema: Record<string, unknown>;
}
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}
export type Message =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface CompleteRequest {
  system: string;
  messages: Message[];
  tools?: ToolSpec[];
  signal?: AbortSignal;
  onText?: (delta: string) => void;
  maxTokens?: number;
}
export interface CompleteResult {
  text: string;
  toolCalls: ToolCall[];
}
export interface Llm {
  complete(req: CompleteRequest): Promise<CompleteResult>;
}

/** Minimal server-sent-events reader: yields each `data:` payload. */
async function* sse(res: Response): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let at: number;
    while ((at = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const event = buffer.slice(0, at);
      buffer = buffer.slice(at).replace(/^\r?\n\r?\n/, '');
      const data = event.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (data) yield data;
    }
  }
  if (buffer.trim().startsWith('data:')) yield buffer.trim().slice(5).trimStart();
}

async function fail(res: Response): Promise<never> {
  let detail = '';
  try {
    detail = (await res.text()).slice(0, 300);
    const parsed = JSON.parse(detail) as { error?: { message?: string } | string };
    detail = typeof parsed.error === 'string' ? parsed.error : (parsed.error?.message ?? detail);
  } catch {
    /* keep the raw text */
  }
  throw new Error(`The AI provider returned ${res.status}${detail ? `: ${detail}` : ''}`);
}

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function anthropic(s: AiSettings): Llm {
  return {
    async complete(req) {
      const messages: unknown[] = [];
      for (const m of req.messages) {
        if (m.role === 'user') messages.push({ role: 'user', content: m.content });
        else if (m.role === 'assistant') {
          const blocks: unknown[] = [];
          if (m.content) blocks.push({ type: 'text', text: m.content });
          for (const t of m.toolCalls ?? []) blocks.push({ type: 'tool_use', id: t.id, name: t.name, input: t.args });
          messages.push({ role: 'assistant', content: blocks.length ? blocks : [{ type: 'text', text: '…' }] });
        } else {
          const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
          const last = messages.at(-1) as { role: string; content: unknown[] } | undefined;
          if (last?.role === 'user' && Array.isArray(last.content)) last.content.push(block);
          else messages.push({ role: 'user', content: [block] });
        }
      }
      const res = await fetch(`${s.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': s.apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: s.model,
          max_tokens: req.maxTokens ?? 4096,
          system: req.system,
          messages,
          stream: true,
          ...(req.tools?.length ? { tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema })) } : {}),
        }),
        signal: req.signal,
      });
      if (!res.ok) await fail(res);
      let text = '';
      const calls = new Map<number, { id: string; name: string; json: string }>();
      for await (const data of sse(res)) {
        let ev: { type?: string; index?: number; content_block?: { type: string; id?: string; name?: string }; delta?: { type?: string; text?: string; partial_json?: string }; error?: { message?: string } };
        try {
          ev = JSON.parse(data);
        } catch {
          continue;
        }
        if (ev.type === 'error') throw new Error(ev.error?.message ?? 'The AI provider reported an error.');
        if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
          calls.set(ev.index ?? 0, { id: ev.content_block.id ?? `call_${calls.size}`, name: ev.content_block.name ?? '', json: '' });
        } else if (ev.type === 'content_block_delta') {
          if (ev.delta?.type === 'text_delta' && ev.delta.text) {
            text += ev.delta.text;
            req.onText?.(ev.delta.text);
          } else if (ev.delta?.type === 'input_json_delta') {
            const c = calls.get(ev.index ?? 0);
            if (c) c.json += ev.delta.partial_json ?? '';
          }
        }
      }
      return { text, toolCalls: [...calls.values()].map((c) => ({ id: c.id, name: c.name, args: parseArgs(c.json) })) };
    },
  };
}

function openai(s: AiSettings): Llm {
  return {
    async complete(req) {
      const messages: unknown[] = [{ role: 'system', content: req.system }];
      for (const m of req.messages) {
        if (m.role === 'user') messages.push({ role: 'user', content: m.content });
        else if (m.role === 'assistant') {
          messages.push({
            role: 'assistant',
            content: m.content || null,
            ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((t) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.args) } })) } : {}),
          });
        } else messages.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
      }
      const res = await fetch(`${s.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(s.apiKey ? { authorization: `Bearer ${s.apiKey}` } : {}) },
        body: JSON.stringify({
          model: s.model,
          messages,
          stream: true,
          max_tokens: req.maxTokens ?? 4096,
          ...(req.tools?.length ? { tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } })) } : {}),
        }),
        signal: req.signal,
      });
      if (!res.ok) await fail(res);
      let text = '';
      const calls = new Map<number, { id: string; name: string; json: string }>();
      for await (const data of sse(res)) {
        if (data === '[DONE]') break;
        let ev: { choices?: { delta?: { content?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[]; error?: { message?: string } };
        try {
          ev = JSON.parse(data);
        } catch {
          continue;
        }
        if (ev.error) throw new Error(ev.error.message ?? 'The AI provider reported an error.');
        const delta = ev.choices?.[0]?.delta;
        if (delta?.content) {
          text += delta.content;
          req.onText?.(delta.content);
        }
        for (const t of delta?.tool_calls ?? []) {
          const i = t.index ?? 0;
          const c = calls.get(i) ?? { id: t.id ?? `call_${i}`, name: '', json: '' };
          if (t.id) c.id = t.id;
          if (t.function?.name) c.name += t.function.name;
          if (t.function?.arguments) c.json += t.function.arguments;
          calls.set(i, c);
        }
      }
      return { text, toolCalls: [...calls.values()].map((c) => ({ id: c.id, name: c.name, args: parseArgs(c.json) })) };
    },
  };
}

export function createLlm(settings: AiSettings): Llm {
  if (!settings.apiKey && settings.provider === 'anthropic') throw new Error('Add your API key in Settings → AI first.');
  return settings.provider === 'openai' ? openai(settings) : anthropic(settings);
}

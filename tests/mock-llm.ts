import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface MockCall {
  protocol: 'anthropic' | 'openai';
  headers: Record<string, string | string[] | undefined>;
  body: any;
}
export interface MockReply {
  text?: string;
  tools?: { id?: string; name: string; args: Record<string, unknown> }[];
  /** Hold the response open (to test cancelling). */
  hang?: boolean;
  status?: number;
}

/** A scripted stand-in for the Anthropic and OpenAI streaming APIs. */
export async function mockLlm(script: (call: MockCall, n: number) => MockReply): Promise<{ url: string; calls: MockCall[]; close(): Promise<void> }> {
  const calls: MockCall[] = [];
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const protocol = req.url?.endsWith('/messages') ? 'anthropic' : 'openai';
      const call: MockCall = { protocol, headers: req.headers, body: JSON.parse(raw || '{}') };
      calls.push(call);
      const reply = script(call, calls.length - 1);
      if (reply.status && reply.status >= 400) {
        res.writeHead(reply.status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'mock failure' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (data: unknown): void => void res.write(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
      const words = (reply.text ?? '').match(/\S+\s*/g) ?? [];
      if (protocol === 'anthropic') {
        send({ type: 'message_start' });
        let index = 0;
        if (words.length) {
          send({ type: 'content_block_start', index, content_block: { type: 'text' } });
          for (const w of words) send({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: w } });
          index++;
        }
        for (const t of reply.tools ?? []) {
          send({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: t.id ?? `toolu_${index}`, name: t.name } });
          const json = JSON.stringify(t.args);
          send({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: json.slice(0, 5) } });
          send({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: json.slice(5) } });
          index++;
        }
        send({ type: 'message_stop' });
      } else {
        for (const w of words) send({ choices: [{ delta: { content: w } }] });
        (reply.tools ?? []).forEach((t, i) => {
          const json = JSON.stringify(t.args);
          send({ choices: [{ delta: { tool_calls: [{ index: i, id: t.id ?? `call_${i}`, function: { name: t.name, arguments: json.slice(0, 5) } }] } }] });
          send({ choices: [{ delta: { tool_calls: [{ index: i, function: { arguments: json.slice(5) } }] } }] });
        });
        send('[DONE]');
      }
      if (!reply.hang) res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

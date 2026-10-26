/**
 * Word (.docx) to markdown. A .docx is a zip of XML parts; this reads the few that matter (document, numbering,
 * relationships) with no dependencies, so it runs in the renderer as well as in Node. It keeps what notes need:
 * headings, paragraphs, bold/italic/strike, links, bullet and numbered lists, and tables.
 */

const MAX_PART_BYTES = 64 * 1024 * 1024;

interface ZipEntry {
  name: string;
  method: number;
  compressed: number;
  size: number;
  offset: number;
}

const u16 = (b: Uint8Array, i: number): number => b[i]! | (b[i + 1]! << 8);
const u32 = (b: Uint8Array, i: number): number => (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;

function entries(zip: Uint8Array): Map<string, ZipEntry> {
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65_535); i--) {
    if (u32(zip, i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('This file is not a valid .docx document.');
  const count = u16(zip, end + 10);
  let p = u32(zip, end + 16);
  const out = new Map<string, ZipEntry>();
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (p + 46 > zip.length || u32(zip, p) !== 0x02014b50) throw new Error('This file is not a valid .docx document.');
    const nameLen = u16(zip, p + 28);
    const name = decoder.decode(zip.subarray(p + 46, p + 46 + nameLen));
    out.set(name, { name, method: u16(zip, p + 10), compressed: u32(zip, p + 20), size: u32(zip, p + 24), offset: u32(zip, p + 42) });
    p += 46 + nameLen + u16(zip, p + 30) + u16(zip, p + 32);
  }
  return out;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_PART_BYTES) {
      await reader.cancel();
      throw new Error('This document is too large to import.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

async function part(zip: Uint8Array, all: Map<string, ZipEntry>, name: string): Promise<string | null> {
  const e = all.get(name);
  if (!e) return null;
  if (e.size > MAX_PART_BYTES) throw new Error('This document is too large to import.');
  if (u32(zip, e.offset) !== 0x04034b50) throw new Error('This file is not a valid .docx document.');
  const start = e.offset + 30 + u16(zip, e.offset + 26) + u16(zip, e.offset + 28);
  const raw = zip.subarray(start, start + e.compressed);
  const bytes = e.method === 0 ? raw : e.method === 8 ? await inflate(raw) : null;
  if (!bytes) throw new Error('This document uses an unsupported compression method.');
  return new TextDecoder().decode(bytes);
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeXml = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1]!.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return ENT[e.toLowerCase()] ?? m;
  });

const attr = (tag: string, name: string): string | undefined => new RegExp(`${name}\\s*=\\s*"([^"]*)"`).exec(tag)?.[1];
/** `<w:b/>` is on, `<w:b w:val="0"/>` or "false" is off. */
const flag = (props: string, tag: string): boolean => {
  const m = new RegExp(`<w:${tag}(\\s[^>]*)?/?>`).exec(props);
  if (!m) return false;
  const v = attr(m[0], 'w:val');
  return v !== '0' && v !== 'false';
};

interface NumberingLevels {
  [numId: string]: { [ilvl: string]: 'bullet' | 'decimal' };
}

function parseNumbering(xml: string | null): NumberingLevels {
  const out: NumberingLevels = {};
  if (!xml) return out;
  const abstracts: Record<string, Record<string, 'bullet' | 'decimal'>> = {};
  for (const m of xml.matchAll(/<w:abstractNum\b([^>]*)>([\s\S]*?)<\/w:abstractNum>/g)) {
    const id = attr(m[1]!, 'w:abstractNumId');
    if (id === undefined) continue;
    const levels: Record<string, 'bullet' | 'decimal'> = {};
    for (const l of m[2]!.matchAll(/<w:lvl\b([^>]*)>([\s\S]*?)<\/w:lvl>/g)) {
      const fmt = attr(/<w:numFmt\b[^>]*>/.exec(l[2]!)?.[0] ?? '', 'w:val');
      levels[attr(l[1]!, 'w:ilvl') ?? '0'] = fmt === 'bullet' || fmt === 'none' ? 'bullet' : 'decimal';
    }
    abstracts[id] = levels;
  }
  for (const m of xml.matchAll(/<w:num\b([^>]*)>([\s\S]*?)<\/w:num>/g)) {
    const numId = attr(m[1]!, 'w:numId');
    const abstractId = attr(/<w:abstractNumId\b[^>]*>/.exec(m[2]!)?.[0] ?? '', 'w:val');
    if (numId !== undefined && abstractId !== undefined && abstracts[abstractId]) out[numId] = abstracts[abstractId]!;
  }
  return out;
}

function parseRels(xml: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of (xml ?? '').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id');
    const target = attr(m[0], 'Target');
    if (id && target && /^https?:\/\//i.test(unescapeXml(target))) out[id] = unescapeXml(target);
  }
  return out;
}

function runs(inner: string, rels: Record<string, string>): string {
  let out = '';
  // Hyperlinks wrap runs; everything else is a flat sequence of runs.
  const pieces = inner.split(/(<w:hyperlink\b[^>]*>[\s\S]*?<\/w:hyperlink>)/);
  for (const piece of pieces) {
    const link = /^<w:hyperlink\b([^>]*)>([\s\S]*)<\/w:hyperlink>$/.exec(piece);
    const text = runText(link ? link[2]! : piece);
    const href = link ? rels[attr(link[1]!, 'r:id') ?? ''] : undefined;
    out += href && text.trim() ? `[${text}](${href})` : text;
  }
  return out;
}

function runText(xml: string): string {
  let out = '';
  for (const r of xml.matchAll(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g)) {
    const body = r[1]!;
    const props = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(body)?.[1] ?? '';
    let text = '';
    for (const t of body.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>|<w:br\s[^>]*\/>/g)) {
      text += t[0].startsWith('<w:tab') ? '\t' : t[0].startsWith('<w:br') ? ' \n' : unescapeXml(t[1] ?? '');
    }
    if (!text) continue;
    const lead = /^\s*/.exec(text)![0];
    const trail = /\s*$/.exec(text.slice(lead.length))![0];
    let core = text.slice(lead.length, text.length - trail.length);
    if (core) {
      if (flag(props, 'strike')) core = `~~${core}~~`;
      if (flag(props, 'i')) core = `*${core}*`;
      if (flag(props, 'b')) core = `**${core}**`;
    }
    out += lead + core + trail;
  }
  return out;
}

/** Converts the bytes of a .docx file to markdown. */
export async function docxToMarkdown(bytes: Uint8Array): Promise<string> {
  const all = entries(bytes);
  const documentXml = await part(bytes, all, 'word/document.xml');
  if (!documentXml) throw new Error('This file is not a Word document.');
  const numbering = parseNumbering(await part(bytes, all, 'word/numbering.xml'));
  const rels = parseRels(await part(bytes, all, 'word/_rels/document.xml.rels'));
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(documentXml)?.[1] ?? '';

  const paragraph = (xml: string, inTable = false): string => {
    const props = /<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(xml)?.[1] ?? '';
    const text = runs(xml.replace(/<w:pPr>[\s\S]*?<\/w:pPr>/, ''), rels).replace(/\s*\n\s*/g, inTable ? ' ' : '\n');
    if (!text.trim()) return '';
    const style = attr(/<w:pStyle\b[^>]*>/.exec(props)?.[0] ?? '', 'w:val') ?? '';
    const heading = /^(?:heading|Heading)\s*([1-6])$/.exec(style);
    if (heading) return `${'#'.repeat(Number(heading[1]))} ${text.trim()}`;
    if (/^title$/i.test(style)) return `# ${text.trim()}`;
    const num = /<w:numPr>([\s\S]*?)<\/w:numPr>/.exec(props)?.[1];
    if (num && !inTable) {
      const level = attr(/<w:ilvl\b[^>]*>/.exec(num)?.[0] ?? '', 'w:val') ?? '0';
      const numId = attr(/<w:numId\b[^>]*>/.exec(num)?.[0] ?? '', 'w:val') ?? '';
      const kind = numbering[numId]?.[level] ?? (/List\s*Number/i.test(style) ? 'decimal' : 'bullet');
      return `${'  '.repeat(Math.min(Number(level) || 0, 6))}${kind === 'decimal' ? '1.' : '-'} ${text.trim().replace(/\n/g, ' ')}`;
    }
    if (/^ListBullet/i.test(style)) return `- ${text.trim()}`;
    if (/^ListNumber/i.test(style)) return `1. ${text.trim()}`;
    if (/^quote$/i.test(style)) return `> ${text.trim()}`;
    return text.trim();
  };

  const table = (xml: string): string => {
    const rows = [...xml.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)].map((r) =>
      [...r[1]!.matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)].map((c) =>
        [...c[1]!.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)].map((p) => paragraph(p[1]!, true)).filter(Boolean).join(' ').replace(/\|/g, '\\|'),
      ),
    );
    if (!rows.length) return '';
    const width = Math.max(...rows.map((r) => r.length));
    const pad = (r: string[]): string => `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`;
    return [pad(rows[0]!), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`, ...rows.slice(1).map(pad)].join('\n');
  };

  const blocks: string[] = [];
  let previousList = '';
  // Top-level blocks only: paragraphs and tables (a table's own paragraphs are consumed by `table`).
  const re = /<w:p\b[^>]*\/>|<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  for (const m of body.matchAll(re)) {
    const block = m[0];
    const out = block.startsWith('<w:tbl') ? table(block) : paragraph(/<w:p\b[^>]*>([\s\S]*)<\/w:p>/.exec(block)?.[1] ?? '');
    if (!out) continue;
    const marker = block.startsWith('<w:tbl') ? null : /^\s*(-|\d+\.)\s/.exec(out)?.[1];
    const listKind = marker ? (marker === '-' ? 'bullet' : 'ordered') : '';
    // consecutive items of one list stay tight; everything else is separated by a blank line
    if (listKind && listKind === previousList) blocks[blocks.length - 1] += `\n${out}`;
    else blocks.push(out);
    previousList = listKind;
  }
  return blocks.join('\n\n').trim();
}

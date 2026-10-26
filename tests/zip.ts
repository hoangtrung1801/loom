import { deflateRawSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Uint8Array): number => (b.reduce((c, x) => crcTable[(c ^ x) & 0xff]! ^ (c >>> 8), 0xffffffff) ^ 0xffffffff) >>> 0;

/** A minimal zip writer, just enough to build .docx fixtures. */
export function zip(files: Record<string, string>, method: 0 | 8 = 8): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const le = (n: number, bytes: number): number[] => Array.from({ length: bytes }, (_, i) => (n >>> (8 * i)) & 0xff);
  for (const [name, text] of Object.entries(files)) {
    const raw = enc.encode(text);
    const data = method === 8 ? new Uint8Array(deflateRawSync(raw)) : raw;
    const nameBytes = enc.encode(name);
    const head = [...le(0x04034b50, 4), ...le(20, 2), ...le(0, 2), ...le(method, 2), ...le(0, 4), ...le(crc32(raw), 4), ...le(data.length, 4), ...le(raw.length, 4), ...le(nameBytes.length, 2), ...le(0, 2)];
    locals.push(new Uint8Array([...head, ...nameBytes, ...data]));
    central.push(new Uint8Array([...le(0x02014b50, 4), ...le(20, 2), ...le(20, 2), ...le(0, 2), ...le(method, 2), ...le(0, 4), ...le(crc32(raw), 4), ...le(data.length, 4), ...le(raw.length, 4), ...le(nameBytes.length, 2), ...le(0, 2), ...le(0, 2), ...le(0, 2), ...le(0, 2), ...le(0, 4), ...le(offset, 4), ...nameBytes]));
    offset += locals.at(-1)!.length;
  }
  const dir = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array([...le(0x06054b50, 4), ...le(0, 2), ...le(0, 2), ...le(central.length, 2), ...le(central.length, 2), ...le(dir, 4), ...le(offset, 4), ...le(0, 2)]);
  return new Uint8Array([...locals.flatMap((l) => [...l]), ...central.flatMap((c) => [...c]), ...end]);
}

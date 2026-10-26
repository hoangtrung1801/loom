import { describe, expect, it } from 'vitest';
import { docxToMarkdown } from '../src/core/docx.js';
import { markdownToDoc } from '../src/core/markdown.js';
import { zip } from './zip.js';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const p = (text: string, props = '') => `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const DOC = `<?xml version="1.0"?><w:document ${W}><w:body>
${p('Project plan', '<w:pStyle w:val="Heading1"/>')}
<w:p><w:r><w:t xml:space="preserve">Plain, </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r><w:r><w:t xml:space="preserve"> and </w:t></w:r><w:r><w:rPr><w:i/><w:b w:val="0"/></w:rPr><w:t>italic &amp; more</w:t></w:r><w:hyperlink r:id="rId5"><w:r><w:t>a link</w:t></w:r></w:hyperlink></w:p>
${p('Goals', '<w:pStyle w:val="Heading2"/>')}
${p('Ship it', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>')}
${p('Nested point', '<w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr>')}
${p('Step one', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>')}
${p('Step two', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>')}
<w:p/>
<w:tbl><w:tr><w:tc>${p('Name')}</w:tc><w:tc>${p('Owner')}</w:tc></w:tr><w:tr><w:tc>${p('Docs')}</w:tc><w:tc>${p('Ana | Bo')}</w:tc></w:tr></w:tbl>
${p('The end')}
</w:body></w:document>`;
const NUMBERING = `<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
const RELS = `<Relationships><Relationship Id="rId5" Type="x" Target="https://example.com/spec?a=1&amp;b=2" TargetMode="External"/><Relationship Id="rId6" Type="x" Target="javascript:alert(1)"/></Relationships>`;
const FILES = { '[Content_Types].xml': '<Types/>', 'word/document.xml': DOC, 'word/numbering.xml': NUMBERING, 'word/_rels/document.xml.rels': RELS };

describe('docx import', () => {
  it('converts headings, formatting, links, lists and tables to markdown', async () => {
    const md = await docxToMarkdown(zip(FILES));
    expect(md).toContain('# Project plan');
    expect(md).toContain('Plain, **bold** and *italic & more*[a link](https://example.com/spec?a=1&b=2)');
    expect(md).toContain('## Goals');
    expect(md).toContain('- Ship it\n  - Nested point');
    expect(md).toContain('1. Step one\n1. Step two');
    expect(md).toContain('| Name | Owner |\n| --- | --- |\n| Docs | Ana \\| Bo |');
    expect(md.endsWith('The end')).toBe(true);
  });

  it('reads stored (uncompressed) parts and produces a valid card document', async () => {
    const md = await docxToMarkdown(zip(FILES, 0));
    const doc = markdownToDoc(md);
    const types = (doc.content ?? []).map((n) => n.type);
    expect(types).toEqual(expect.arrayContaining(['heading', 'paragraph', 'bullet_list', 'ordered_list', 'table']));
  });

  it('rejects files that are not Word documents', async () => {
    await expect(docxToMarkdown(new TextEncoder().encode('just text'))).rejects.toThrow(/valid .docx/);
    await expect(docxToMarkdown(zip({ 'readme.txt': 'hi' }))).rejects.toThrow(/Word document/);
    const truncated = zip(FILES).slice(0, 60);
    await expect(docxToMarkdown(truncated)).rejects.toThrow();
  });
});

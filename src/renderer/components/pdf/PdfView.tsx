import 'pdfjs-dist/web/pdf_viewer.css';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import type { CardDetail } from '../../../core/store.js';
import { api, errorMessage, fileUrl } from '../../api.js';
import { openCard } from '../../actions.js';
import { mutate, toast } from '../../store/data.js';
import { Icon } from '../Icon.js';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const SCALE = 1.25;

/** Text of every page as a toggle of "Page n" sections, so search and the AI can read a PDF like any card. */
async function extractContent(doc: PDFDocumentProxy): Promise<string> {
  const pages: unknown[] = [];
  for (let n = 1; n <= Math.min(doc.numPages, 300); n++) {
    const page = await doc.getPage(n);
    const text = (await page.getTextContent()).items.map((i) => ('str' in i ? i.str + (i.hasEOL ? '\n' : '') : '')).join(' ').replace(/[ \t]+/g, ' ').trim();
    if (!text) continue;
    pages.push({ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: `Page ${n}` }] });
    for (const para of text.split(/\n{1,}/).map((s) => s.trim()).filter(Boolean).slice(0, 200)) pages.push({ type: 'paragraph', content: [{ type: 'text', text: para.slice(0, 4000) }] });
  }
  if (!pages.length) return '';
  return JSON.stringify({
    type: 'doc',
    content: [{ type: 'toggle', attrs: { open: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: `Extracted text (${doc.numPages} pages)` }] }, ...pages] }],
  });
}

export default function PdfView({ card }: { card: CardDetail }) {
  const host = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState('');
  const [selection, setSelection] = useState<{ text: string; page: number; x: number; y: number } | null>(null);

  useEffect(() => {
    let live = true;
    let task: PDFDocumentLoadingTask | null = null;
    setDoc(null);
    setError('');
    void (async () => {
      try {
        const res = await fetch(fileUrl(card.fileId));
        if (!res.ok) throw new Error('The PDF file is missing on this device.');
        task = pdfjs.getDocument({ data: new Uint8Array(await res.arrayBuffer()) });
        const loaded = await task.promise;
        if (!live) return void task.destroy();
        setDoc(loaded);
        if (!card.content) {
          const content = await extractContent(loaded);
          if (content && live) await mutate(() => api.updateCard(card.id, { content }));
        }
      } catch (err) {
        if (live) setError(errorMessage(err));
      }
    })();
    return () => {
      live = false;
      void task?.destroy();
    };
    // Re-open only when the file changes, not when the extracted text lands in `card.content`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, card.fileId]);

  const onMouseUp = (): void => {
    const sel = window.getSelection();
    const text = sel?.toString().replace(/\s+/g, ' ').trim() ?? '';
    const anchor = sel?.anchorNode?.parentElement?.closest<HTMLElement>('[data-page]');
    if (!sel || !text || !anchor || !host.current?.contains(anchor)) return setSelection(null);
    const r = sel.getRangeAt(0).getBoundingClientRect();
    setSelection({ text: text.slice(0, 4000), page: Number(anchor.dataset.page), x: r.left + r.width / 2, y: r.top });
  };

  const highlight = async (): Promise<void> => {
    if (!selection) return;
    const { text, page } = selection;
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    try {
      const id = await api.createCard({
        title: text.slice(0, 60),
        kind: 'highlight',
        content: JSON.stringify({ type: 'doc', content: [{ type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }] }),
        meta: JSON.stringify({ sourceId: card.id, page, quote: text }),
        inbox: true,
      });
      await mutate(async () => undefined);
      toast(`Saved highlight from page ${page}`);
      void id;
    } catch (err) {
      toast(errorMessage(err));
    }
  };

  if (error) return <div className="error" role="alert">{error}</div>;
  if (!doc) return <div className="loading">Opening PDF…</div>;
  return (
    <div className="pdf" ref={host} onMouseUp={onMouseUp}>
      {Array.from({ length: doc.numPages }, (_, i) => <PdfPage key={i} doc={doc} n={i + 1} />)}
      {selection && (
        <button className="float-btn" style={{ left: selection.x, top: selection.y - 36 }} onMouseDown={(e) => e.preventDefault()} onClick={() => void highlight()}>
          <Icon name="highlight" size={14} /> Highlight
        </button>
      )}
    </div>
  );
}

function PdfPage({ doc, n }: { doc: PDFDocumentProxy; n: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 612 * SCALE, h: 792 * SCALE });
  const rendered = useRef(false);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    let cancelled = false;
    const render = async (): Promise<void> => {
      if (rendered.current) return;
      rendered.current = true;
      const page = await doc.getPage(n);
      if (cancelled) return;
      const viewport = page.getViewport({ scale: SCALE });
      setSize({ w: viewport.width, h: viewport.height });
      const ratio = window.devicePixelRatio || 1;
      const c = canvas.current!;
      c.width = Math.floor(viewport.width * ratio);
      c.height = Math.floor(viewport.height * ratio);
      await page.render({ canvas: c, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] }).promise;
      if (cancelled || !text.current) return;
      const layer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: text.current, viewport });
      await layer.render();
    };
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && void render().catch(() => undefined), { rootMargin: '600px' });
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [doc, n]);

  return (
    <div className="pdf-page" ref={wrap} data-page={n} style={{ width: size.w, height: size.h }}>
      <canvas ref={canvas} style={{ width: size.w, height: size.h }} />
      <div className="textLayer" ref={text} />
    </div>
  );
}

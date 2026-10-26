import { lazy, Suspense, useEffect, useRef } from 'react';
import { fileUrl } from '../../api.js';
import { api } from '../../api.js';
import { openByTitle, trashCard } from '../../actions.js';
import { Editor } from '../../editor/Editor.js';
import { mutate } from '../../store/data.js';
import { editCard, useCardDetail } from '../../store/edits.js';
import { CardProps } from '../CardProps.js';
import { Icon } from '../Icon.js';
import { TagEditor } from '../TagEditor.js';
import { Empty, timeAgo } from '../ui/bits.js';
import { isFileId } from '../../../core/fileid.js';
import type { CardDetail } from '../../../core/store.js';

const PdfView = lazy(() => import('../pdf/PdfView.js'));

/** The full-page view of one card. What it shows above the notes depends on the card's kind. */
export function CardPage({ id }: { id: string }) {
  const { card, loading } = useCardDetail(id);
  const scroller = useRef<HTMLDivElement>(null);

  // The table-of-contents panel asks the page to bring a block into view.
  useEffect(() => {
    const onScroll = (e: Event): void => {
      const blockId = (e as CustomEvent<string>).detail;
      const el = [...(scroller.current?.querySelectorAll<HTMLElement>('[data-block-id]') ?? [])].find((n) => n.dataset.blockId === blockId);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    window.addEventListener('loom:scroll-block', onScroll);
    return () => window.removeEventListener('loom:scroll-block', onScroll);
  }, []);

  if (loading && !card) return <div className="loading">Loading…</div>;
  if (!card) return <Empty title="This card no longer exists">It may have been deleted on another device.</Empty>;

  return (
    <div className="card-page" ref={scroller}>
      <article className="card-doc">
        <input
          className="card-title"
          value={card.title}
          placeholder={card.kind === 'journal' ? card.journalDate : 'Untitled'}
          aria-label="Card title"
          onChange={(e) => editCard(card.id, { title: e.target.value })}
        />
        <p className="card-meta">
          <span className="kind">{card.kind}</span>
          <span>Edited {timeAgo(card.updatedAt)}</span>
          <span>{card.wordCount} words</span>
          {card.inbox && <button className="link" onClick={() => void mutate(() => api.setInbox(card.id, false))}>Archive from inbox</button>}
        </p>

        <TagEditor cardId={card.id} tags={card.tags} />
        <CardProps cardId={card.id} />

        <Attachment card={card} />

        <Editor
          key={card.id}
          value={card.content}
          onChange={(json) => editCard(card.id, { content: json })}
          onOpenLink={(t) => void openByTitle(t)}
          placeholder={card.kind === 'note' || card.kind === 'journal' ? 'Write something… type / for blocks, @ to link a card' : 'Add notes…'}
          autoFocus={!card.title && !card.content}
        />

        <footer className="card-foot">
          <button className="danger-link" onClick={() => void trashCard(card.id)}><Icon name="trash" size={14} /> Move to trash</button>
        </footer>
      </article>
    </div>
  );
}

function Attachment({ card }: { card: CardDetail }) {
  if (card.kind === 'web') return <Source card={card} />;
  if (!isFileId(card.fileId)) return card.kind === 'highlight' ? <Quote card={card} /> : null;
  const url = fileUrl(card.fileId);
  switch (card.kind) {
    case 'image':
      return <img className="attachment" src={url} alt={card.title} />;
    case 'video':
      return <video className="attachment" src={url} controls preload="metadata" />;
    case 'audio':
      return <audio className="attachment" src={url} controls preload="metadata" />;
    case 'pdf':
      return <Suspense fallback={<div className="loading">Opening PDF…</div>}><PdfView card={card} /></Suspense>;
    case 'file':
      return <a className="file-link" href={url} download={card.title || 'file'}>Download {card.title || 'file'}</a>;
    default:
      return null;
  }
}

function Source({ card }: { card: CardDetail }) {
  let url = '';
  try {
    url = (JSON.parse(card.meta || '{}') as { url?: string }).url ?? '';
  } catch {
    /* no source metadata */
  }
  return /^https?:\/\//i.test(url) ? <a className="file-link" href={url} target="_blank" rel="noreferrer noopener">Open original · {new URL(url).hostname}</a> : null;
}

function Quote({ card }: { card: CardDetail }) {
  let meta: { quote?: string; page?: number; sourceId?: string } = {};
  try {
    meta = JSON.parse(card.meta || '{}') as typeof meta;
  } catch {
    /* no quote metadata */
  }
  return meta.quote ? <blockquote className="highlight-quote">{meta.quote}</blockquote> : null;
}

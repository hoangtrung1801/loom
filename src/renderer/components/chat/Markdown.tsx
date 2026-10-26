import { Fragment } from 'react';
import type { SourceRef } from '../../../core/chats.js';
import type { DocNode } from '../../../core/doc.js';
import { markdownToDoc, safeHref } from '../../../core/markdown.js';

/** Renders assistant markdown. Citation markers like [2] become buttons that open the cited block. */
export function Markdown({ text, sources = [], onCite }: { text: string; sources?: SourceRef[]; onCite?(source: SourceRef): void }) {
  const doc = markdownToDoc(text);
  return <div className="md">{(doc.content ?? []).map((n, i) => <Block key={i} node={n} sources={sources} onCite={onCite} />)}</div>;
}

interface Ctx {
  sources: SourceRef[];
  onCite?(source: SourceRef): void;
}

function Inline({ nodes, ...ctx }: { nodes?: DocNode[] } & Ctx) {
  return (
    <>
      {(nodes ?? []).map((n, i) => {
        if (n.type === 'hard_break') return <br key={i} />;
        let el: React.ReactNode = n.type === 'text' ? <Cited text={n.text ?? ''} {...ctx} /> : (n.text ?? '');
        for (const m of n.marks ?? []) {
          if (m.type === 'strong') el = <strong>{el}</strong>;
          else if (m.type === 'em') el = <em>{el}</em>;
          else if (m.type === 'code') el = <code>{n.text}</code>;
          else if (m.type === 'strike') el = <s>{el}</s>;
          else if (m.type === 'link') {
            const href = safeHref(m.attrs?.href);
            el = href ? <a href={href} target="_blank" rel="noreferrer noopener">{el}</a> : el;
          }
        }
        return <Fragment key={i}>{el}</Fragment>;
      })}
    </>
  );
}

function Cited({ text, sources, onCite }: { text: string } & Ctx) {
  return (
    <>
      {text.split(/(\[\d+\])/).map((part, i) => {
        const m = /^\[(\d+)\]$/.exec(part);
        const source = m ? sources.find((s) => s.n === Number(m[1])) : undefined;
        if (!source) return part;
        return (
          <button key={i} className="cite" title={`${source.title}: ${source.quote}`} onClick={() => onCite?.(source)}>{source.n}</button>
        );
      })}
    </>
  );
}

function Block({ node, ...ctx }: { node: DocNode } & Ctx) {
  const kids = (list?: DocNode[]): React.ReactNode => (list ?? []).map((c, i) => <Block key={i} node={c} {...ctx} />);
  switch (node.type) {
    case 'heading': {
      const Tag = `h${Math.min(6, Math.max(1, Number(node.attrs?.level) || 1) + 2)}` as 'h3';
      return <Tag><Inline nodes={node.content} {...ctx} /></Tag>;
    }
    case 'paragraph': return <p><Inline nodes={node.content} {...ctx} /></p>;
    case 'bullet_list': return <ul>{kids(node.content)}</ul>;
    case 'ordered_list': return <ol>{kids(node.content)}</ol>;
    case 'todo_list': return <ul className="todos">{kids(node.content)}</ul>;
    case 'list_item': return <li>{kids(node.content)}</li>;
    case 'todo_item': return <li><input type="checkbox" checked={!!node.attrs?.checked} readOnly /> {kids(node.content)}</li>;
    case 'blockquote':
    case 'callout': return <blockquote>{kids(node.content)}</blockquote>;
    case 'code_block': return <pre><code>{(node.content ?? []).map((c) => c.text).join('')}</code></pre>;
    case 'horizontal_rule': return <hr />;
    case 'math_block': return <pre className="math"><code>{String(node.attrs?.latex ?? '')}</code></pre>;
    case 'table':
      return (
        <table>
          <tbody>
            {(node.content ?? []).map((row, i) => (
              <tr key={i}>
                {(row.content ?? []).map((cell, j) => {
                  const Cell = cell.type === 'table_header' ? 'th' : 'td';
                  return <Cell key={j}>{kids(cell.content)}</Cell>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      );
    default: return null;
  }
}

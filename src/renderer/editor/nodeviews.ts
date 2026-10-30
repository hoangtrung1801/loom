import katex from 'katex';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Icon, type IconName } from '../components/Icon.js';
import 'katex/dist/katex.min.css';
import type { Node as PmNode } from 'prosemirror-model';
import type { EditorView, NodeView, NodeViewConstructor } from 'prosemirror-view';
import { isFileId } from '../../core/fileid.js';
import { fileUrl } from '../api.js';
import { editorEnv } from './env.js';

type GetPos = () => number | undefined;

function setAttr(view: EditorView, getPos: GetPos, attr: string, value: unknown): void {
  const pos = getPos();
  if (pos !== undefined) view.dispatch(view.state.tr.setNodeAttribute(pos, attr, value));
}

function renderMath(el: HTMLElement, latex: string, display: boolean): void {
  el.replaceChildren();
  if (!latex.trim()) {
    const empty = document.createElement('span');
    empty.className = 'math-empty';
    empty.textContent = display ? 'Empty equation — click to edit' : 'math';
    el.append(empty);
    return;
  }
  try {
    katex.render(latex, el, { displayMode: display, throwOnError: true, trust: false, output: 'htmlAndMathml' });
  } catch (err) {
    el.textContent = err instanceof Error ? err.message.replace(/^KaTeX parse error: /, '') : 'Invalid equation';
    el.classList.add('math-error');
    return;
  }
  el.classList.remove('math-error');
}

/** Equations render with KaTeX and turn into a text field on click. */
function mathView(display: boolean): NodeViewConstructor {
  return (node, view, getPos) => {
    const dom = document.createElement(display ? 'div' : 'span');
    dom.className = display ? 'math-block' : 'math-inline';
    const out = document.createElement(display ? 'div' : 'span');
    dom.append(out);
    let latex = node.attrs.latex as string;
    renderMath(out, latex, display);

    const edit = (): void => {
      if (dom.querySelector('textarea, input')) return;
      const field = document.createElement(display ? 'textarea' : 'input') as HTMLInputElement | HTMLTextAreaElement;
      field.className = 'math-field';
      field.value = latex;
      field.setAttribute('aria-label', 'LaTeX');
      field.placeholder = 'LaTeX, e.g. E = mc^2';
      if (display) (field as HTMLTextAreaElement).rows = 3;
      out.hidden = true;
      dom.append(field);
      field.focus();
      let done = false;
      const finish = (commit: boolean): void => {
        if (done) return;
        done = true;
        const next = field.value;
        field.remove();
        out.hidden = false;
        if (commit && next !== latex) setAttr(view, getPos, 'latex', next);
        view.focus();
      };
      field.addEventListener('blur', () => finish(true));
      field.addEventListener('keydown', (ev) => {
        const e = ev as KeyboardEvent;
        if (e.key === 'Escape') finish(false);
        else if (e.key === 'Enter' && (!display || e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          finish(true);
        }
        e.stopPropagation();
      });
    };
    dom.addEventListener('click', edit);

    return {
      dom,
      update(n: PmNode) {
        if (n.type !== node.type) return false;
        latex = n.attrs.latex as string;
        if (!dom.querySelector('textarea, input')) renderMath(out, latex, display);
        return true;
      },
      stopEvent: (e) => !!(e.target as HTMLElement).closest?.('textarea, input'),
      ignoreMutation: () => true,
    } satisfies NodeView;
  };
}

const mentionView: NodeViewConstructor = (node) => {
  const dom = document.createElement('span');
  dom.className = 'mention';
  const paint = (n: PmNode): void => {
    const id = n.attrs.cardId as string;
    dom.dataset.cardId = id;
    const title = editorEnv.titleOf(id);
    dom.textContent = `@${(title ?? (n.attrs.label as string)) || 'Untitled'}`;
    dom.classList.toggle('missing', title === undefined && !n.attrs.label);
  };
  let current = node;
  paint(node);
  const unsubscribe = editorEnv.subscribeTitles(() => paint(current));
  dom.addEventListener('click', (e) => {
    e.preventDefault();
    editorEnv.openCard(current.attrs.cardId as string);
  });
  return {
    dom,
    update(n) {
      if (n.type !== current.type) return false;
      current = n;
      paint(n);
      return true;
    },
    destroy: unsubscribe,
    ignoreMutation: () => true,
  };
};

const dateView: NodeViewConstructor = (node, view, getPos) => {
  const dom = document.createElement('span');
  dom.className = 'date';
  let value = node.attrs.value as string;
  const paint = (): void => {
    dom.textContent = value || 'Pick a date';
  };
  paint();
  dom.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'date';
    input.value = value;
    input.className = 'date-field';
    dom.replaceChildren(input);
    input.focus();
    try {
      input.showPicker?.();
    } catch {
      /* some platforms only open the picker from a direct user gesture */
    }
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      if (input.value && input.value !== value) setAttr(view, getPos, 'value', input.value);
      else paint();
    };
    input.addEventListener('change', finish);
    input.addEventListener('blur', finish);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        done = true;
        paint();
        view.focus();
      }
      e.stopPropagation();
    });
  });
  return {
    dom,
    update(n) {
      if (n.type !== node.type) return false;
      value = n.attrs.value as string;
      if (!dom.querySelector('input')) paint();
      return true;
    },
    stopEvent: (e) => !!(e.target as HTMLElement).closest?.('input'),
    ignoreMutation: () => true,
  };
};

function mediaView(tag: 'img' | 'audio' | 'video'): NodeViewConstructor {
  return (node) => {
    const dom = document.createElement('figure');
    dom.className = `media media-${tag}`;
    const paint = (n: PmNode): void => {
      dom.replaceChildren();
      const id = n.attrs.fileId as string;
      if (!isFileId(id)) {
        dom.textContent = 'Attachment unavailable';
        dom.classList.add('missing');
        return;
      }
      dom.classList.remove('missing');
      const el = document.createElement(tag);
      el.src = fileUrl(id);
      if (tag === 'img') {
        (el as HTMLImageElement).alt = (n.attrs.name as string) || '';
        (el as HTMLImageElement).loading = 'lazy';
        (el as HTMLImageElement).draggable = false;
      } else {
        (el as HTMLMediaElement).controls = true;
        (el as HTMLMediaElement).preload = 'metadata';
      }
      dom.append(el);
    };
    paint(node);
    return {
      dom,
      update(n) {
        if (n.type !== node.type) return false;
        if (n.attrs.fileId !== node.attrs.fileId) paint(n);
        node = n;
        return true;
      },
      stopEvent: (e) => !!(e.target as HTMLElement).closest?.('audio, video'),
      ignoreMutation: () => true,
    };
  };
}

/** Vanilla-DOM node views can't mount React, so render the Lucide glyph to markup once. */
const iconSvg = (name: IconName): string => renderToStaticMarkup(createElement(Icon, { name, size: 14 }));

const fileView: NodeViewConstructor = (node) => {
  const dom = document.createElement('div');
  dom.className = 'file-block';
  const paint = (n: PmNode): void => {
    dom.replaceChildren();
    const id = n.attrs.fileId as string;
    const icon = document.createElement('span');
    icon.className = 'file-icon';
    icon.innerHTML = iconSvg('paperclip');
    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = (n.attrs.name as string) || 'File';
    dom.append(icon, name);
    if (isFileId(id)) {
      const link = document.createElement('a');
      link.href = fileUrl(id);
      link.download = (n.attrs.name as string) || 'file';
      link.textContent = 'Download';
      link.className = 'file-link';
      dom.append(link);
    }
  };
  paint(node);
  return {
    dom,
    update(n) {
      if (n.type !== node.type) return false;
      node = n;
      paint(n);
      return true;
    },
    stopEvent: (e) => !!(e.target as HTMLElement).closest?.('a'),
    ignoreMutation: () => true,
  };
};

const todoView: NodeViewConstructor = (node, view, getPos) => {
  const dom = document.createElement('li');
  dom.className = 'todo-item';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.className = 'todo-box';
  box.setAttribute('aria-label', 'Done');
  const holder = document.createElement('span');
  holder.className = 'todo-check';
  holder.contentEditable = 'false';
  holder.append(box);
  const content = document.createElement('div');
  content.className = 'todo-content';
  dom.append(holder, content);
  const paint = (n: PmNode): void => {
    box.checked = !!n.attrs.checked;
    dom.dataset.checked = String(!!n.attrs.checked);
  };
  paint(node);
  box.addEventListener('change', () => setAttr(view, getPos, 'checked', box.checked));
  return {
    dom,
    contentDOM: content,
    update(n) {
      if (n.type !== node.type) return false;
      paint(n);
      return true;
    },
    stopEvent: (e) => e.target === box,
    ignoreMutation: (m) => m.type !== 'selection' && !content.contains(m.target),
  };
};

const toggleView: NodeViewConstructor = (node, view, getPos) => {
  const dom = document.createElement('div');
  dom.className = 'toggle';
  const button = document.createElement('button');
  button.className = 'toggle-btn';
  button.contentEditable = 'false';
  button.type = 'button';
  const body = document.createElement('div');
  body.className = 'toggle-body';
  dom.append(button, body);
  const paint = (n: PmNode): void => {
    const open = n.attrs.open !== false;
    dom.dataset.open = String(open);
    button.innerHTML = iconSvg(open ? 'chevronDown' : 'chevronRight');
    button.setAttribute('aria-label', open ? 'Collapse' : 'Expand');
    button.setAttribute('aria-expanded', String(open));
  };
  let current = node;
  paint(node);
  button.addEventListener('click', (e) => {
    e.preventDefault();
    setAttr(view, getPos, 'open', current.attrs.open === false);
  });
  return {
    dom,
    contentDOM: body,
    update(n) {
      if (n.type !== node.type) return false;
      current = n;
      paint(n);
      return true;
    },
    stopEvent: (e) => e.target === button,
    ignoreMutation: (m) => m.type !== 'selection' && !body.contains(m.target),
  };
};

export const nodeViews: Record<string, NodeViewConstructor> = {
  math_inline: mathView(false),
  math_block: mathView(true),
  mention: mentionView,
  date: dateView,
  image: mediaView('img'),
  audio: mediaView('audio'),
  video: mediaView('video'),
  file_block: fileView,
  todo_item: todoView,
  toggle: toggleView,
};

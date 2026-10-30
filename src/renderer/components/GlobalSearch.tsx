import { useEffect, useRef, useState } from 'react';
import type { AnyHit, CardKind } from '../../core/store.js';
import { CARD_KINDS } from '../../core/kinds.js';
import { api } from '../api.js';
import { openBoard, openCard, openChatTab, openTag } from '../actions.js';
import { useUi } from '../store/ui.js';
import { Icon, KIND_ICON, type IconName } from './Icon.js';
import { Highlight, useDebounced } from './ui/bits.js';
import { FilterPill } from '@/components/ui/filter-pill';
import { Command, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';

type Scope = 'whiteboards' | 'whiteboardText' | 'chats' | 'tags';
const SCOPES: { id: Scope; label: string }[] = [
  { id: 'whiteboards', label: 'Whiteboards' },
  { id: 'whiteboardText', label: 'Board text' },
  { id: 'chats', label: 'Chats' },
  { id: 'tags', label: 'Tags' },
];
const TYPE_ICON: Record<AnyHit['type'], IconName> = { card: 'card', whiteboard: 'board', text: 'text', chat: 'chat', tag: 'tag' };

/** Cmd+O: one box over cards, whiteboards, whiteboard text, chats and tags. */
export function GlobalSearch() {
  const open = useUi((s) => s.searchOpen);
  const setOpen = useUi((s) => s.setSearch);
  if (!open) return null;
  return <SearchBox close={() => setOpen(false)} />;
}

function SearchBox({ close }: { close(): void }) {
  const [query, setQuery] = useState('');
  const [kinds, setKinds] = useState<CardKind[]>([]);
  const [scopes, setScopes] = useState<Scope[]>(['whiteboards', 'whiteboardText', 'chats', 'tags']);
  const [sort, setSort] = useState<'relevance' | 'time'>('relevance');
  const [hits, setHits] = useState<AnyHit[]>([]);
  const q = useDebounced(query, 120);
  const [active, setActive] = useState('');
  const newTab = useRef(false);
  useEffect(() => {
    let live = true;
    void api
      .searchAll({
        query: q,
        kinds: kinds.length ? kinds : undefined,
        whiteboards: scopes.includes('whiteboards'),
        whiteboardText: scopes.includes('whiteboardText'),
        chats: scopes.includes('chats'),
        tags: scopes.includes('tags'),
        sort: q.trim() ? sort : 'time',
        limit: 40,
      })
      .then((h) => {
        if (!live) return;
        setHits(h);
      });
    return () => {
      live = false;
    };
  }, [q, kinds, scopes, sort]);

  const go = (h: AnyHit, newTab: boolean): void => {
    close();
    switch (h.type) {
      case 'card': return openCard(h.id, newTab);
      case 'whiteboard': return openBoard(h.id, undefined, newTab);
      case 'text': return openBoard(h.boardId, h.id, newTab);
      case 'chat': return openChatTab(h.id);
      case 'tag': return openTag(h.id, newTab);
    }
  };

  const byValue = (value: string): AnyHit | undefined => hits.find((h) => `${h.type}:${h.id}` === value);
  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      const h = byValue(active);
      if (h) { e.preventDefault(); go(h, true); }
    }
  };

  const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent aria-label="Search" showCloseButton={false} className="top-[14vh] translate-y-0 gap-0 overflow-hidden rounded-xl p-0">
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">Search cards, whiteboards, board text, chats and tags.</DialogDescription>
        <Command shouldFilter={false} value={active} onValueChange={setActive} onKeyDown={onKey} onClickCapture={(e) => { newTab.current = e.metaKey || e.ctrlKey; }}>
          <CommandInput value={query} onValueChange={setQuery} placeholder="Search everything…" aria-label="Search everything" />
          <div className="search-filters flex flex-wrap items-center gap-1 border-b px-3 py-2">
            {CARD_KINDS.map((k) => <FilterPill key={k} pressed={kinds.includes(k)} onClick={() => setKinds(toggle(kinds, k))}>{k}</FilterPill>)}
            <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" />
            {SCOPES.map((s) => <FilterPill key={s.id} pressed={scopes.includes(s.id)} onClick={() => setScopes(toggle(scopes, s.id))}>{s.label}</FilterPill>)}
            <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" />
            <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
              <SelectTrigger size="sm" className="gap-1 rounded-full px-2.5 text-xs data-[size=sm]:h-6" aria-label="Sort results"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="relevance">Relevance</SelectItem><SelectItem value="time">Last edited</SelectItem></SelectContent>
            </Select>
          </div>
          <CommandList id="search-results" className="results max-h-[50vh] p-1.5">
            {hits.length === 0 && <div className="none py-6 text-center text-muted-foreground">No results</div>}
            {hits.map((h) => (
              <CommandItem key={`${h.type}:${h.id}`} value={`${h.type}:${h.id}`} className="result flex-col items-start gap-1" onSelect={() => { go(h, newTab.current); newTab.current = false; }}>
                <span className="flex min-w-0 max-w-full items-center gap-2.5 font-medium">
                  <Icon name={h.type === 'card' ? KIND_ICON[h.kind] ?? 'card' : TYPE_ICON[h.type]} size={14} />
                  <span className="truncate"><Highlight text={h.titleMarked || h.title || 'Untitled'} /></span>
                </span>
                {h.snippet && <span className="snippet max-w-full truncate pl-6"><Highlight text={h.snippet} /></span>}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
        <footer className="dialog-foot"><kbd>↑↓</kbd> move <kbd>Enter</kbd> open <kbd>{/Mac/.test(navigator.platform) ? '⌘' : 'Ctrl '}Enter</kbd> new tab <span className="grow" /><kbd>Esc</kbd> close</footer>
      </DialogContent>
    </Dialog>
  );
}

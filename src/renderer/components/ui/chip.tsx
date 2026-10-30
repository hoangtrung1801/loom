import { Icon } from '../Icon.js';
import { Badge } from '@/components/ui/badge';

/** A removable label (tag, attached chat context): the name opens it, the × removes it. */
export function Chip({ label, title, removeLabel, onOpen, onRemove }: { label: string; title?: string; removeLabel: string; onOpen(): void; onRemove(): void }) {
  return (
    <Badge variant="secondary" className="h-[26px] gap-0.5 rounded-full py-0 pr-1 pl-2.5 font-mono text-[12.5px] font-normal text-secondary-foreground">
      <button className="chip-label max-w-[220px] truncate hover:underline" onClick={onOpen} title={title}>{label}</button>
      <button className="inline-grid size-5 place-items-center rounded-full text-muted-foreground hover:text-foreground" aria-label={removeLabel} onClick={onRemove}><Icon name="close" size={11} /></button>
    </Badge>
  );
}

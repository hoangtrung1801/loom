import { useState } from 'react';
import type { EdgeView, PlacementView } from '../../../core/store.js';
import { Icon, type IconName } from '../Icon.js';
import type { Tool } from './useBoard.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';

export const COLORS = ['', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'gray'] as const;

const TOOLS: { id: Tool; label: string; icon: IconName; hotkey: string }[] = [
  { id: 'select', label: 'Select', icon: 'select', hotkey: 'V' },
  { id: 'text', label: 'Text', icon: 'text', hotkey: 'T' },
  { id: 'section', label: 'Section', icon: 'section', hotkey: 'S' },
  { id: 'mindmap', label: 'Mind map', icon: 'mindmap', hotkey: 'M' },
  { id: 'connect', label: 'Connect', icon: 'link', hotkey: 'C' },
];

export function ToolBar({
  tool,
  setTool,
  onNewCard,
  onAddExisting,
  onUpload,
  onSearch,
  searching,
  more,
}: {
  tool: Tool;
  setTool(t: Tool): void;
  onNewCard(): void;
  onAddExisting(): void;
  onUpload(): void;
  onSearch(): void;
  searching: boolean;
  more(e: React.MouseEvent): void;
}) {
  return (
    <div className="board-toolbar" role="toolbar" aria-label="Whiteboard tools" onPointerDown={(e) => e.stopPropagation()}>
      {TOOLS.slice(0, 1).map((t) => <ToolButton {...t} key={t.id} on={tool === t.id} onClick={() => setTool(t.id)} />)}
      <button className="tool" aria-label="New card" title="New card (N)" onClick={onNewCard}><Icon name="card" /></button>
      <button className="tool" aria-label="Add existing card" title="Add an existing card" onClick={onAddExisting}><Icon name="library" /></button>
      <button className="tool" aria-label="Upload" title="Upload files" onClick={onUpload}><Icon name="upload" /></button>
      {TOOLS.slice(1).map((t) => <ToolButton {...t} key={t.id} on={tool === t.id} onClick={() => setTool(tool === t.id ? 'select' : t.id)} />)}
      <span className="sep" />
      <button className={`tool${searching ? ' on' : ''}`} aria-label="Search whiteboard" title="Search this whiteboard (⌘F)" onClick={onSearch}><Icon name="search" /></button>
      <button className="tool" aria-label="More" title="More" onClick={more}><Icon name="more" /></button>
    </div>
  );
}

function ToolButton({ label, icon, hotkey, on, onClick }: (typeof TOOLS)[number] & { on: boolean; onClick(): void }) {
  return (
    <button className={`tool${on ? ' on' : ''}`} aria-label={label} aria-pressed={on} title={`${label} (${hotkey})`} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}

export function ColorPicker({ value, onPick }: { value: string; onPick(color: string): void }) {
  return (
    <span className="swatches" role="group" aria-label="Color">
      {COLORS.map((c) => (
        <button key={c || 'none'} className={`swatch c-${c || 'none'}${value === c ? ' on' : ''}`} aria-label={c || 'No color'} aria-pressed={value === c} onClick={() => onPick(c)} />
      ))}
    </span>
  );
}

/** Appears over the selection: colors, text size, arrangement, ask AI, remove. */
export function SelectionBar({
  items,
  onColor,
  onSize,
  onFront,
  onBack,
  onAsk,
  onRemove,
}: {
  items: PlacementView[];
  onColor(color: string): void;
  onSize(delta: number): void;
  onFront(): void;
  onBack(): void;
  onAsk(): void;
  onRemove(): void;
}) {
  const colors = new Set(items.map((p) => p.color));
  const hasText = items.some((p) => p.kind === 'text');
  return (
    <div className="selection-bar" role="toolbar" aria-label="Selection" onPointerDown={(e) => e.stopPropagation()}>
      <span className="count">{items.length} selected</span>
      <ColorPicker value={colors.size === 1 ? [...colors][0]! : '__mixed'} onPick={onColor} />
      {hasText && (
        <>
          <Button variant="ghost" size="icon" aria-label="Smaller text" onClick={() => onSize(-2)}><Icon name="minus" /></Button>
          <Button variant="ghost" size="icon" aria-label="Larger text" onClick={() => onSize(2)}><Icon name="plus" /></Button>
        </>
      )}
      <Button variant="ghost" size="icon" aria-label="Bring to front" title="Bring to front" onClick={onFront}><Icon name="chevronRight" className="up" /></Button>
      <Button variant="ghost" size="icon" aria-label="Send to back" title="Send to back" onClick={onBack}><Icon name="chevronDown" /></Button>
      <Button variant="ghost" size="icon" aria-label="Ask AI" title="Ask AI about this" onClick={onAsk}><Icon name="sparkle" /></Button>
      <Button variant="ghost" size="icon" aria-label="Remove from whiteboard" title="Remove from whiteboard (Delete)" onClick={onRemove}><Icon name="trash" /></Button>
    </div>
  );
}

export function EdgeBar({ edge, onChange, onDelete }: { edge: EdgeView; onChange(patch: Partial<Pick<EdgeView, 'label' | 'color' | 'style' | 'arrow'>>): void; onDelete(): void }) {
  const [label, setLabel] = useState(edge.label);
  return (
    <div className="selection-bar" role="toolbar" aria-label="Connection" onPointerDown={(e) => e.stopPropagation()}>
      <Input
        value={label}
        placeholder="Label"
        aria-label="Connection label"
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => label !== edge.label && onChange({ label })}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); e.stopPropagation(); }}
      />
      <ColorPicker value={edge.color} onPick={(color) => onChange({ color })} />
      <NativeSelect value={edge.style} aria-label="Line style" onChange={(e) => onChange({ style: e.target.value })}>
        <NativeSelectOption value="solid">Solid</NativeSelectOption><NativeSelectOption value="dashed">Dashed</NativeSelectOption><NativeSelectOption value="dotted">Dotted</NativeSelectOption>
      </NativeSelect>
      <NativeSelect value={edge.arrow} aria-label="Arrow" onChange={(e) => onChange({ arrow: e.target.value })}>
        <NativeSelectOption value="end">Arrow →</NativeSelectOption><NativeSelectOption value="start">Arrow ←</NativeSelectOption><NativeSelectOption value="both">Both ↔</NativeSelectOption><NativeSelectOption value="none">None</NativeSelectOption>
      </NativeSelect>
      <Button variant="ghost" size="icon" aria-label="Delete connection" onClick={onDelete}><Icon name="trash" /></Button>
    </div>
  );
}

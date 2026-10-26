/** Constants the renderer shares with the core. Kept free of Node imports so the browser bundle can use them. */
export type CardKind = 'note' | 'journal' | 'pdf' | 'image' | 'video' | 'audio' | 'file' | 'highlight' | 'web';
export const CARD_KINDS: readonly CardKind[] = ['note', 'journal', 'pdf', 'image', 'video', 'audio', 'file', 'highlight', 'web'];

export const PROP_TYPES = ['text', 'number', 'date', 'select', 'multiselect', 'checkbox', 'url'] as const;
export type PropType = (typeof PROP_TYPES)[number];

import { randomUUID } from 'node:crypto';
import { normalizeTag, type CardKind, type Store } from './store.js';

import { PROP_TYPES, type PropType } from './kinds.js';
export { PROP_TYPES, type PropType };

export interface PropDef {
  id: string;
  tag: string;
  name: string;
  type: PropType;
  options: string[];
}
export interface TableRow {
  cardId: string;
  title: string;
  kind: CardKind;
  updatedAt: number;
  values: Record<string, string>;
}
export interface TagTable {
  tag: string;
  color: string;
  collection: string;
  description: string;
  props: PropDef[];
  rows: TableRow[];
}
export interface CardPropGroup {
  tag: string;
  props: (PropDef & { value: string })[];
}

/** Tag databases: a tag can have a color, a collection, and typed properties whose values live on each tagged card. */
export class TagDb {
  constructor(private readonly store: Store) {}

  setTagDef(rawTag: string, patch: { color?: string; collection?: string; description?: string }): void {
    const tag = requireTag(rawTag);
    const fields: Record<string, string | null> = { deleted_at: null };
    if (patch.color !== undefined) fields.color = patch.color.slice(0, 20);
    if (patch.collection !== undefined) fields.collection = patch.collection.trim().slice(0, 80);
    if (patch.description !== undefined) fields.description = patch.description.slice(0, 2000);
    this.store.commit([{ entity: 'tagDef', id: tag, fields }]);
  }

  /** Removes the tag from every card and deletes its definition and properties. Cards themselves are untouched. */
  deleteTag(rawTag: string): void {
    const tag = requireTag(rawTag);
    const now = Date.now();
    const changes: Parameters<Store['commit']>[0] = [{ entity: 'tagDef', id: tag, fields: { deleted_at: now } }];
    for (const r of this.store.all('SELECT id FROM card_tags WHERE tag = ? AND deleted_at IS NULL', tag)) {
      changes.push({ entity: 'cardTag', id: r.id, fields: { deleted_at: now } });
    }
    for (const p of this.store.all('SELECT id FROM tag_props WHERE tag = ? AND deleted_at IS NULL', tag)) {
      changes.push({ entity: 'tagProp', id: p.id, fields: { deleted_at: now } });
    }
    this.store.commit(changes);
  }

  /** Moves cards, definition and properties to the new name. Merging into an existing tag is allowed. */
  renameTag(rawFrom: string, rawTo: string): void {
    const from = requireTag(rawFrom);
    const to = requireTag(rawTo);
    if (from === to) return;
    const now = Date.now();
    const def = this.store.get('SELECT color, collection, description FROM tag_defs WHERE id = ? AND deleted_at IS NULL', from);
    const changes: Parameters<Store['commit']>[0] = [];
    if (def && !this.store.get('SELECT 1 AS x FROM tag_defs WHERE id = ? AND deleted_at IS NULL', to)) {
      changes.push({ entity: 'tagDef', id: to, fields: { color: def.color, collection: def.collection, description: def.description, deleted_at: null } });
    }
    if (def) changes.push({ entity: 'tagDef', id: from, fields: { deleted_at: now } });
    for (const r of this.store.all('SELECT id, card_id FROM card_tags WHERE tag = ? AND deleted_at IS NULL', from)) {
      changes.push({ entity: 'cardTag', id: r.id, fields: { deleted_at: now } });
      changes.push({ entity: 'cardTag', id: `${r.card_id}:${to}`, fields: { card_id: r.card_id, tag: to, deleted_at: null } });
    }
    for (const p of this.store.all('SELECT id FROM tag_props WHERE tag = ? AND deleted_at IS NULL', from)) {
      changes.push({ entity: 'tagProp', id: p.id, fields: { tag: to } });
    }
    this.store.commit(changes);
  }

  addTagProp(rawTag: string, input: { name: string; type?: PropType; options?: string[] }): string {
    const tag = requireTag(rawTag);
    const name = input.name.trim().slice(0, 80);
    if (!name) throw new Error('A property needs a name.');
    const type = input.type ?? 'text';
    if (!PROP_TYPES.includes(type)) throw new Error(`Unknown property type "${type}".`);
    const pos = (this.store.get('SELECT COALESCE(MAX(pos), 0) AS p FROM tag_props WHERE tag = ? AND deleted_at IS NULL', tag)?.p as number) + 1;
    const id = randomUUID();
    this.store.commit([{ entity: 'tagProp', id, fields: { tag, name, type, options: JSON.stringify(cleanOptions(input.options)), pos, deleted_at: null } }]);
    return id;
  }

  updateTagProp(id: string, patch: { name?: string; type?: PropType; options?: string[] }): void {
    if (!this.store.get('SELECT 1 AS x FROM tag_props WHERE id = ? AND deleted_at IS NULL', id)) throw new Error('Property not found.');
    const fields: Record<string, string> = {};
    if (patch.name !== undefined) fields.name = patch.name.trim().slice(0, 80) || 'Property';
    if (patch.type !== undefined) {
      if (!PROP_TYPES.includes(patch.type)) throw new Error(`Unknown property type "${patch.type}".`);
      fields.type = patch.type;
    }
    if (patch.options !== undefined) fields.options = JSON.stringify(cleanOptions(patch.options));
    this.store.commit([{ entity: 'tagProp', id, fields }]);
  }

  removeTagProp(id: string): void {
    const now = Date.now();
    const changes: Parameters<Store['commit']>[0] = [{ entity: 'tagProp', id, fields: { deleted_at: now } }];
    for (const v of this.store.all('SELECT id FROM card_props WHERE prop_id = ? AND deleted_at IS NULL', id)) {
      changes.push({ entity: 'cardProp', id: v.id, fields: { deleted_at: now } });
    }
    this.store.commit(changes);
  }

  setCardProp(cardId: string, propId: string, value: string): void {
    const prop = this.store.get('SELECT tag, type, options FROM tag_props WHERE id = ? AND deleted_at IS NULL', propId);
    if (!prop) throw new Error('Property not found.');
    if (!this.store.get('SELECT 1 AS x FROM cards WHERE id = ? AND deleted_at IS NULL', cardId)) throw new Error('Card not found.');
    const clean = validateValue(prop.type as PropType, value, parseOptions(prop.options));
    this.store.commit([
      { entity: 'cardProp', id: `${cardId}:${propId}`, fields: { card_id: cardId, prop_id: propId, value: clean, deleted_at: clean === '' ? Date.now() : null } },
    ]);
  }

  listTagProps(rawTag: string): PropDef[] {
    return this.store
      .all('SELECT id, tag, name, type, options FROM tag_props WHERE tag = ? AND deleted_at IS NULL ORDER BY pos, id', normalizeTag(rawTag))
      .map(toDef);
  }

  /** Properties of every tag on a card, with the card's values, grouped by tag (what the card's info panel shows). */
  getCardProps(cardId: string): CardPropGroup[] {
    const values = new Map(
      this.store.all('SELECT prop_id, value FROM card_props WHERE card_id = ? AND deleted_at IS NULL', cardId).map((r) => [r.prop_id as string, r.value as string]),
    );
    const out: CardPropGroup[] = [];
    for (const t of this.store.all('SELECT tag FROM card_tags WHERE card_id = ? AND deleted_at IS NULL ORDER BY tag', cardId)) {
      const props = this.listTagProps(t.tag);
      if (props.length) out.push({ tag: t.tag, props: props.map((p) => ({ ...p, value: values.get(p.id) ?? '' })) });
    }
    return out;
  }

  getTagTable(rawTag: string): TagTable {
    const tag = requireTag(rawTag);
    const def = this.store.get('SELECT color, collection, description FROM tag_defs WHERE id = ? AND deleted_at IS NULL', tag);
    const props = this.listTagProps(tag);
    const rows = this.store.all(
      `SELECT c.id, c.title, c.kind, c.updated_at FROM card_tags t JOIN cards c ON c.id = t.card_id
       WHERE t.tag = ? AND t.deleted_at IS NULL AND c.deleted_at IS NULL ORDER BY c.updated_at DESC`,
      tag,
    );
    const values = new Map<string, Record<string, string>>();
    if (props.length) {
      const ids = props.map((p) => p.id);
      for (const v of this.store.all(
        `SELECT card_id, prop_id, value FROM card_props WHERE deleted_at IS NULL AND prop_id IN (${ids.map(() => '?').join(',')})`,
        ...ids,
      )) {
        values.set(v.card_id, { ...(values.get(v.card_id) ?? {}), [v.prop_id]: v.value });
      }
    }
    return {
      tag,
      color: def?.color ?? '',
      collection: def?.collection ?? '',
      description: def?.description ?? '',
      props,
      rows: rows.map((r) => ({ cardId: r.id, title: r.title, kind: r.kind, updatedAt: r.updated_at, values: values.get(r.id) ?? {} })),
    };
  }
}

function requireTag(raw: string): string {
  const tag = normalizeTag(raw);
  if (!tag) throw new Error('Tag name is empty.');
  return tag;
}

function toDef(r: Record<string, any>): PropDef {
  return { id: r.id, tag: r.tag, name: r.name, type: r.type, options: parseOptions(r.options) };
}

function parseOptions(raw: string): string[] {
  try {
    const v = JSON.parse(raw || '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function cleanOptions(options: string[] | undefined): string[] {
  return [...new Set((options ?? []).map((o) => o.trim().slice(0, 60)).filter(Boolean))].slice(0, 100);
}

function validateValue(type: PropType, value: string, options: string[]): string {
  const v = value.trim();
  if (v === '') return '';
  switch (type) {
    case 'number':
      if (!Number.isFinite(Number(v))) throw new Error('That is not a number.');
      return String(Number(v));
    case 'date':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new Error('Dates look like 2025-01-31.');
      return v;
    case 'select':
      if (options.length && !options.includes(v)) throw new Error(`"${v}" is not one of this property's options.`);
      return v;
    case 'multiselect': {
      const parsed = JSON.parse(v) as unknown;
      if (!Array.isArray(parsed) || parsed.some((x) => typeof x !== 'string')) throw new Error('Expected a list of options.');
      const picked = [...new Set(parsed as string[])];
      if (options.length && picked.some((x) => !options.includes(x))) throw new Error('Unknown option.');
      return picked.length ? JSON.stringify(picked) : '';
    }
    case 'checkbox':
      return v === '1' || v === 'true' ? '1' : '';
    case 'url':
      if (!/^https?:\/\//i.test(v)) throw new Error('Links must start with http:// or https://');
      return v.slice(0, 2000);
    default:
      return v.slice(0, 5000);
  }
}

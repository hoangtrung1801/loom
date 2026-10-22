import { z } from 'zod';

/**
 * Every synced table is described here. Columns listed in `fields` are the only
 * ones an op may write, which keeps remote input from touching arbitrary SQL.
 */
export const ENTITIES = {
  card: { table: 'cards', fields: ['title', 'content', 'created_at', 'updated_at', 'deleted_at'] },
  whiteboard: { table: 'whiteboards', fields: ['name', 'created_at', 'updated_at', 'deleted_at'] },
  placement: {
    table: 'placements',
    fields: ['whiteboard_id', 'card_id', 'x', 'y', 'w', 'h', 'z', 'deleted_at'],
  },
  edge: { table: 'edges', fields: ['whiteboard_id', 'from_id', 'to_id', 'label', 'deleted_at'] },
  cardTag: { table: 'card_tags', fields: ['card_id', 'tag', 'deleted_at'] },
} as const;

export type EntityName = keyof typeof ENTITIES;
export const ENTITY_NAMES = Object.keys(ENTITIES) as EntityName[];

export type Scalar = string | number | null;

const MAX_FIELD_BYTES = 2_000_000;

export const opSchema = z
  .object({
    id: z.string().min(1).max(100),
    entity: z.enum(ENTITY_NAMES as [EntityName, ...EntityName[]]),
    entityId: z.string().min(1).max(200),
    fields: z.record(z.string(), z.union([z.string().max(MAX_FIELD_BYTES), z.number().finite(), z.null()])),
    ts: z.string().regex(/^\d{13}\.[0-9a-f]{4}\..{1,100}$/),
    device: z.string().min(1).max(100),
  })
  .superRefine((op, ctx) => {
    const allowed = ENTITIES[op.entity].fields as readonly string[];
    for (const key of Object.keys(op.fields)) {
      if (!allowed.includes(key)) {
        ctx.addIssue({ code: 'custom', message: `field "${key}" is not writable on ${op.entity}` });
      }
    }
  });

export type Op = z.infer<typeof opSchema>;

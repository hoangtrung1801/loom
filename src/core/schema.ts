/** Ordered migrations; `PRAGMA user_version` is the number applied. DDL is transactional, so a failure rolls back cleanly. */
export const MIGRATIONS: string[][] = [
  [
    `CREATE TABLE cards (
       id TEXT PRIMARY KEY,
       title TEXT NOT NULL DEFAULT '',
       content TEXT NOT NULL DEFAULT '',
       created_at INTEGER NOT NULL DEFAULT 0,
       updated_at INTEGER NOT NULL DEFAULT 0,
       deleted_at INTEGER
     )`,
    `CREATE TABLE whiteboards (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL DEFAULT '',
       created_at INTEGER NOT NULL DEFAULT 0,
       updated_at INTEGER NOT NULL DEFAULT 0,
       deleted_at INTEGER
     )`,
    `CREATE TABLE placements (
       id TEXT PRIMARY KEY,
       whiteboard_id TEXT NOT NULL DEFAULT '',
       card_id TEXT NOT NULL DEFAULT '',
       x REAL NOT NULL DEFAULT 0,
       y REAL NOT NULL DEFAULT 0,
       w REAL NOT NULL DEFAULT 320,
       h REAL NOT NULL DEFAULT 240,
       z INTEGER NOT NULL DEFAULT 0,
       deleted_at INTEGER
     )`,
    `CREATE INDEX placements_board ON placements(whiteboard_id) WHERE deleted_at IS NULL`,
    `CREATE INDEX placements_card ON placements(card_id) WHERE deleted_at IS NULL`,
    `CREATE TABLE edges (
       id TEXT PRIMARY KEY,
       whiteboard_id TEXT NOT NULL DEFAULT '',
       from_id TEXT NOT NULL DEFAULT '',
       to_id TEXT NOT NULL DEFAULT '',
       label TEXT NOT NULL DEFAULT '',
       deleted_at INTEGER
     )`,
    `CREATE INDEX edges_board ON edges(whiteboard_id) WHERE deleted_at IS NULL`,
    `CREATE TABLE card_tags (
       id TEXT PRIMARY KEY,
       card_id TEXT NOT NULL DEFAULT '',
       tag TEXT NOT NULL DEFAULT '',
       deleted_at INTEGER
     )`,
    `CREATE INDEX card_tags_card ON card_tags(card_id)`,
    // Local copy of every op (own and remote). seq is local; ts is the global order.
    `CREATE TABLE ops (
       seq INTEGER PRIMARY KEY AUTOINCREMENT,
       id TEXT NOT NULL UNIQUE,
       entity TEXT NOT NULL,
       entity_id TEXT NOT NULL,
       fields TEXT NOT NULL,
       ts TEXT NOT NULL,
       device TEXT NOT NULL,
       pushed INTEGER NOT NULL DEFAULT 0
     )`,
    `CREATE INDEX ops_unpushed ON ops(seq) WHERE pushed = 0`,
    // Per-field last-write-wins clock.
    `CREATE TABLE field_clock (
       entity TEXT NOT NULL,
       entity_id TEXT NOT NULL,
       field TEXT NOT NULL,
       ts TEXT NOT NULL,
       PRIMARY KEY (entity, entity_id, field)
     ) WITHOUT ROWID`,
    `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID`,
    `CREATE VIRTUAL TABLE search_index USING fts5(
       card_id UNINDEXED, title, body,
       tokenize = 'unicode61 remove_diacritics 2'
     )`,
  ],
];

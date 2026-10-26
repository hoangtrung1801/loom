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
  // v2: card kinds, journals, inbox, attachments; whiteboard objects; tag databases; chats; derived link/task indexes.
  [
    `ALTER TABLE cards ADD COLUMN kind TEXT NOT NULL DEFAULT 'note'`,
    `ALTER TABLE cards ADD COLUMN journal_date TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE cards ADD COLUMN inbox INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE cards ADD COLUMN file_id TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE cards ADD COLUMN meta TEXT NOT NULL DEFAULT ''`,
    `CREATE INDEX cards_kind ON cards(kind) WHERE deleted_at IS NULL`,
    `CREATE INDEX cards_journal ON cards(journal_date) WHERE journal_date != ''`,
    `ALTER TABLE whiteboards ADD COLUMN parent_id TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE whiteboards ADD COLUMN color TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE placements ADD COLUMN kind TEXT NOT NULL DEFAULT 'card'`,
    `ALTER TABLE placements ADD COLUMN text TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE placements ADD COLUMN color TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE placements ADD COLUMN ref_id TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE placements ADD COLUMN parent_id TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE placements ADD COLUMN section_id TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE placements ADD COLUMN size INTEGER NOT NULL DEFAULT 16`,
    `ALTER TABLE edges ADD COLUMN color TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE edges ADD COLUMN style TEXT NOT NULL DEFAULT 'solid'`,
    `ALTER TABLE edges ADD COLUMN arrow TEXT NOT NULL DEFAULT 'end'`,
    `CREATE TABLE tag_defs (
       id TEXT PRIMARY KEY,
       color TEXT NOT NULL DEFAULT '',
       collection TEXT NOT NULL DEFAULT '',
       description TEXT NOT NULL DEFAULT '',
       deleted_at INTEGER
     )`,
    `CREATE TABLE tag_props (
       id TEXT PRIMARY KEY,
       tag TEXT NOT NULL DEFAULT '',
       name TEXT NOT NULL DEFAULT '',
       type TEXT NOT NULL DEFAULT 'text',
       options TEXT NOT NULL DEFAULT '',
       pos REAL NOT NULL DEFAULT 0,
       deleted_at INTEGER
     )`,
    `CREATE INDEX tag_props_tag ON tag_props(tag)`,
    `CREATE TABLE card_props (
       id TEXT PRIMARY KEY,
       card_id TEXT NOT NULL DEFAULT '',
       prop_id TEXT NOT NULL DEFAULT '',
       value TEXT NOT NULL DEFAULT '',
       deleted_at INTEGER
     )`,
    `CREATE INDEX card_props_card ON card_props(card_id)`,
    `CREATE TABLE files (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL DEFAULT '',
       mime TEXT NOT NULL DEFAULT '',
       size INTEGER NOT NULL DEFAULT 0,
       created_at INTEGER NOT NULL DEFAULT 0,
       deleted_at INTEGER
     )`,
    `CREATE TABLE chats (
       id TEXT PRIMARY KEY,
       title TEXT NOT NULL DEFAULT '',
       context TEXT NOT NULL DEFAULT '[]',
       created_at INTEGER NOT NULL DEFAULT 0,
       updated_at INTEGER NOT NULL DEFAULT 0,
       deleted_at INTEGER
     )`,
    `CREATE TABLE chat_messages (
       id TEXT PRIMARY KEY,
       chat_id TEXT NOT NULL DEFAULT '',
       role TEXT NOT NULL DEFAULT 'user',
       content TEXT NOT NULL DEFAULT '',
       sources TEXT NOT NULL DEFAULT '[]',
       created_at INTEGER NOT NULL DEFAULT 0,
       deleted_at INTEGER
     )`,
    `CREATE INDEX chat_messages_chat ON chat_messages(chat_id, created_at)`,
    `CREATE TABLE ai_actions (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL DEFAULT '',
       prompt TEXT NOT NULL DEFAULT '',
       kind TEXT NOT NULL DEFAULT 'action',
       deleted_at INTEGER
     )`,
    // Derived from card content on every write; never synced (each device recomputes them).
    `CREATE TABLE links (
       source_id TEXT NOT NULL,
       block_id TEXT NOT NULL DEFAULT '',
       target_id TEXT NOT NULL DEFAULT '',
       target_title TEXT NOT NULL DEFAULT '',
       text TEXT NOT NULL DEFAULT ''
     )`,
    `CREATE INDEX links_source ON links(source_id)`,
    `CREATE INDEX links_target ON links(target_id)`,
    `CREATE INDEX links_title ON links(target_title)`,
    `CREATE TABLE tasks (
       card_id TEXT NOT NULL,
       block_id TEXT NOT NULL DEFAULT '',
       text TEXT NOT NULL DEFAULT '',
       checked INTEGER NOT NULL DEFAULT 0,
       due TEXT NOT NULL DEFAULT ''
     )`,
    `CREATE INDEX tasks_card ON tasks(card_id)`,
    // Everything searchable that is not a card body: whiteboard names/text, tags, chat messages.
    `CREATE VIRTUAL TABLE search_other USING fts5(
       kind UNINDEXED, ref_id UNINDEXED, title, body,
       tokenize = 'unicode61 remove_diacritics 2'
     )`,
  ],
  // v3: tasks, saved links and memos are cards with a few structured, individually-synced fields.
  [
    `ALTER TABLE cards ADD COLUMN status TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE cards ADD COLUMN priority TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE cards ADD COLUMN assignee TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE cards ADD COLUMN due TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE cards ADD COLUMN parent_id TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE cards ADD COLUMN url TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE cards ADD COLUMN completed_at INTEGER NOT NULL DEFAULT 0`,
    `CREATE INDEX cards_parent ON cards(parent_id) WHERE parent_id != '' AND deleted_at IS NULL`,
    `CREATE INDEX cards_url ON cards(url) WHERE url != '' AND deleted_at IS NULL`,
  ],
];

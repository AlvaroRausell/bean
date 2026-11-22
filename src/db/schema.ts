import * as SQLite from 'expo-sqlite';

const DB_NAME = 'bean_travel.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await migrateDatabase(db);
      return db;
    })();
  }
  return dbPromise;
}

export async function migrateDatabase(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const currentVersion = row?.user_version ?? 0;

  if (currentVersion < 1) {
    await db.execAsync(`
      BEGIN TRANSACTION;

      CREATE TABLE IF NOT EXISTS user_places (
        place_id TEXT PRIMARY KEY NOT NULL,
        status TEXT NOT NULL DEFAULT 'none',
        first_visited_year INTEGER,
        notes TEXT,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE TABLE IF NOT EXISTS year_collections (
        id TEXT PRIMARY KEY NOT NULL,
        year INTEGER NOT NULL,
        title TEXT NOT NULL,
        collection_type TEXT NOT NULL DEFAULT 'visited',
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE TABLE IF NOT EXISTS collection_items (
        id TEXT PRIMARY KEY NOT NULL,
        collection_id TEXT NOT NULL,
        place_id TEXT NOT NULL,
        visit_month INTEGER,
        notes TEXT,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        FOREIGN KEY (collection_id) REFERENCES year_collections(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_collection_items_collection
        ON collection_items(collection_id);
      CREATE INDEX IF NOT EXISTS idx_collection_items_place
        ON collection_items(place_id);

      CREATE TABLE IF NOT EXISTS travel_goals (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        target_count INTEGER NOT NULL,
        target_year INTEGER NOT NULL,
        scope TEXT NOT NULL DEFAULT 'world',
        scope_value TEXT,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE TABLE IF NOT EXISTS user_profile (
        id TEXT PRIMARY KEY NOT NULL,
        birth_year INTEGER,
        home_place_id TEXT,
        counting_mode TEXT NOT NULL DEFAULT 'uk_split_un',
        include_territories INTEGER NOT NULL DEFAULT 0,
        map_theme TEXT NOT NULL DEFAULT 'midnight',
        default_projection TEXT NOT NULL DEFAULT '2d',
        last_backup_at TEXT,
        updated_at TEXT NOT NULL
      );

      PRAGMA user_version = 1;
      COMMIT;
    `);
  }

  if (currentVersion < 2) {
    const cols = await db.getAllAsync<{ name: string }>(
      'PRAGMA table_info(user_places)'
    );
    const hasFav = cols.some((c) => c.name === 'is_favorite');
    await db.execAsync(`
      BEGIN TRANSACTION;
      ${
        hasFav
          ? ''
          : 'ALTER TABLE user_places ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0;'
      }
      PRAGMA user_version = 2;
      COMMIT;
    `);
  }
}

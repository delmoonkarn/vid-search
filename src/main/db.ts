import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { cacheDir } from "./paths";
import { DEFAULT_SETTINGS, Settings } from "../shared/types";

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  const dir = cacheDir();
  fs.mkdirSync(dir, { recursive: true });
  db = new DatabaseSync(path.join(dir, "library.db"));
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA temp_store = MEMORY");
  db.exec(SCHEMA);
  return db;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS roots (
  id        INTEGER PRIMARY KEY,
  path      TEXT NOT NULL UNIQUE,
  last_scan INTEGER
);

CREATE TABLE IF NOT EXISTS folders (
  id           INTEGER PRIMARY KEY,
  root_id      INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
  parent_id    INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  path         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  sort_key     TEXT NOT NULL,
  search       TEXT NOT NULL,
  direct_count INTEGER NOT NULL DEFAULT 0,
  total_count  INTEGER NOT NULL DEFAULT 0,
  total_size   INTEGER NOT NULL DEFAULT 0,
  cover_fp     TEXT,
  seen         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_folders_root ON folders(root_id);

CREATE TABLE IF NOT EXISTS videos (
  id        INTEGER PRIMARY KEY,
  root_id   INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
  folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  path      TEXT NOT NULL UNIQUE,
  name      TEXT NOT NULL,
  ext       TEXT NOT NULL,
  sort_key  TEXT NOT NULL,
  path_key  TEXT NOT NULL,
  search    TEXT NOT NULL,
  size      INTEGER NOT NULL,
  mtime     INTEGER NOT NULL,
  fp        TEXT NOT NULL,
  sidecar   TEXT,
  seen      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_videos_folder ON videos(folder_id);
CREATE INDEX IF NOT EXISTS idx_videos_root ON videos(root_id);
CREATE INDEX IF NOT EXISTS idx_videos_fp ON videos(fp);

-- Keyed by content fingerprint (size + mtime), not by path, so renaming or
-- moving a file, or the drive coming back under another letter, reuses the
-- existing thumbnail and probe results instead of re-reading the HDD.
CREATE TABLE IF NOT EXISTS media (
  fp         TEXT PRIMARY KEY,
  first_seen INTEGER NOT NULL,
  duration   REAL,
  width      INTEGER,
  height     INTEGER,
  vcodec     TEXT,
  thumb      INTEGER NOT NULL DEFAULT 0,
  thumb_ver  INTEGER NOT NULL DEFAULT 0,
  thumb_pos  REAL,
  opened_at  INTEGER,
  error      TEXT
);
CREATE INDEX IF NOT EXISTS idx_media_thumb ON media(thumb);

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

/** Run fn inside BEGIN/COMMIT. Not re-entrant — don't nest. */
export function tx<T>(fn: () => T): T {
  const d = getDb();
  d.exec("BEGIN");
  try {
    const r = fn();
    d.exec("COMMIT");
    return r;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

export function getMeta(key: string): string | null {
  const r = getDb().prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  return r?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  getDb()
    .prepare("INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}

export function getSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(getMeta("settings") ?? "{}") };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch };
  next.workers = Math.min(6, Math.max(1, Math.round(next.workers)));
  setMeta("settings", JSON.stringify(next));
  return next;
}

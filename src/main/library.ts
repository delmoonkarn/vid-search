import fs from "node:fs";
import path from "node:path";
import { getDb, tx } from "./db";
import {
  Crumb,
  FolderItem,
  ListQuery,
  ListResult,
  RootInfo,
  SortBy,
  SortDir,
  TreeNode,
  VideoItem,
  normalizeSearch,
} from "../shared/types";

// fs.existsSync on a sleeping USB drive can block for seconds, so callers on
// the hot path read a cached answer and the check refreshes in the background.
const onlineCache = new Map<string, { ok: boolean; at: number }>();

export function isOnline(p: string): boolean {
  const c = onlineCache.get(p);
  if (!c) {
    const ok = fs.existsSync(p);
    onlineCache.set(p, { ok, at: Date.now() });
    return ok;
  }
  if (Date.now() - c.at > 15_000) {
    c.at = Date.now();
    fs.promises.access(p).then(
      () => (c.ok = true),
      () => (c.ok = false)
    );
  }
  return c.ok;
}

export function setOnline(p: string, ok: boolean) {
  onlineCache.set(p, { ok, at: Date.now() });
}

/** Split a query into include / exclude ("-word") terms, already normalised. */
function parseQuery(q: string): { inc: string[]; exc: string[] } {
  const inc: string[] = [];
  const exc: string[] = [];
  for (const raw of q.trim().split(/\s+/)) {
    if (!raw) continue;
    const neg = raw.startsWith("-") && raw.length > 1;
    const t = normalizeSearch(neg ? raw.slice(1) : raw);
    if (!t) continue;
    // normalizeSearch may split "s01.e02" into two words; each must match.
    for (const w of t.split(" ")) (neg ? exc : inc).push(w);
  }
  return { inc, exc };
}

function videoOrder(sort: SortBy, dir: SortDir): string {
  const d = dir === "desc" ? "DESC" : "ASC";
  switch (sort) {
    case "name":
      return `v.sort_key ${d}, v.id`;
    case "path":
      return `v.root_id ${d}, v.path_key ${d}`;
    case "mtime":
      return `v.mtime ${d}, v.sort_key`;
    case "added":
      return `m.first_seen ${d}, v.mtime ${d}, v.sort_key`;
    case "size":
      return `v.size ${d}, v.sort_key`;
    case "duration":
      return `m.duration ${d} NULLS LAST, v.sort_key`;
    case "opened":
      return `m.opened_at ${d} NULLS LAST, v.sort_key`;
    case "random":
      return "v.id"; // shuffled in JS afterwards, see seededShuffle
  }
}

/** Fisher–Yates with a seeded PRNG: same seed → same order, so live updates don't reshuffle the grid. */
function seededShuffle<T>(arr: T[], seed: number): T[] {
  let a = seed >>> 0 || 1;
  const rnd = () => {
    // mulberry32
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function folderOrder(sort: SortBy, dir: SortDir): string {
  const d = dir === "desc" ? "DESC" : "ASC";
  if (sort === "size") return `f.total_size ${d}, f.sort_key`;
  if (sort === "name" || sort === "path") return `f.sort_key ${d}`;
  return "f.sort_key";
}

const VIDEO_COLS = `
  v.id, v.folder_id, v.root_id, v.name, v.ext, f.name AS folder, v.path, v.size, v.mtime, v.fp,
  m.duration, m.width, m.height, m.thumb, m.thumb_ver, m.opened_at
`;

const FOLDER_COLS = `
  f.id, f.name, f.path, f.total_count, f.total_size, f.cover_fp,
  (SELECT count(*) FROM folders c WHERE c.parent_id = f.id AND c.total_count > 0) AS sub_count,
  coalesce(cm.thumb, 0) AS cover_thumb, coalesce(cm.thumb_ver, 0) AS cover_ver
`;

const SUBTREE = `
  WITH RECURSIVE sub(id) AS (
    SELECT ? UNION ALL SELECT f2.id FROM folders f2 JOIN sub ON f2.parent_id = sub.id
  )
`;

export function list(q: ListQuery): ListResult {
  const db = getDb();
  const { inc, exc } = parseQuery(q.query);
  const searching = inc.length > 0 || exc.length > 0;
  const folderId = q.view.kind === "folder" ? q.view.id : null;

  const where: string[] = [];
  const params: (string | number)[] = [];
  let prefix = "";
  if (folderId != null) {
    if (q.recursive || searching) {
      prefix = SUBTREE;
      params.push(folderId);
      where.push("v.folder_id IN (SELECT id FROM sub)");
    } else {
      where.push("v.folder_id = ?");
      params.push(folderId);
    }
  }
  for (const t of inc) {
    where.push("instr(v.search, ?) > 0");
    params.push(t);
  }
  for (const t of exc) {
    where.push("instr(v.search, ?) = 0");
    params.push(t);
  }

  const videos = db
    .prepare(
      `${prefix}
       SELECT ${VIDEO_COLS}
       FROM videos v JOIN folders f ON f.id = v.folder_id JOIN media m ON m.fp = v.fp
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY ${videoOrder(q.sort, q.dir)}`
    )
    .all(...params) as VideoItem[];
  if (q.sort === "random") seededShuffle(videos, q.seed);

  // Folders: children of the current folder when browsing; matching folder
  // names anywhere (in scope) when searching; none in the flat "All" view.
  let folders: FolderItem[] = [];
  if (searching && inc.length > 0) {
    const fw: string[] = ["f.total_count > 0"];
    const fp: (string | number)[] = [];
    let fprefix = "";
    if (folderId != null) {
      fprefix = SUBTREE;
      fp.push(folderId);
      fw.push("f.id IN (SELECT id FROM sub) AND f.id <> ?");
      fp.push(folderId);
    }
    for (const t of inc) {
      fw.push("instr(f.search, ?) > 0");
      fp.push(t);
    }
    for (const t of exc) {
      fw.push("instr(f.search, ?) = 0");
      fp.push(t);
    }
    folders = db
      .prepare(
        `${fprefix}
         SELECT ${FOLDER_COLS} FROM folders f LEFT JOIN media cm ON cm.fp = f.cover_fp
         WHERE ${fw.join(" AND ")} ORDER BY f.sort_key LIMIT 300`
      )
      .all(...fp) as FolderItem[];
  } else if (folderId != null && !q.recursive) {
    folders = db
      .prepare(
        `SELECT ${FOLDER_COLS} FROM folders f LEFT JOIN media cm ON cm.fp = f.cover_fp
         WHERE f.parent_id = ? AND f.total_count > 0 ORDER BY ${folderOrder(q.sort, q.dir)}`
      )
      .all(folderId) as FolderItem[];
  }

  const crumbs = folderId != null ? ancestors(folderId) : [];
  let offline = false;
  if (folderId != null) {
    const r = db
      .prepare("SELECT r.path FROM folders f JOIN roots r ON r.id = f.root_id WHERE f.id = ?")
      .get(folderId) as { path: string } | undefined;
    offline = !!r && !isOnline(r.path);
  }

  let totalSize = 0;
  for (const v of videos) totalSize += v.size;
  return { folders, videos, crumbs, totalSize, offline };
}

export function ancestors(folderId: number): Crumb[] {
  const rows = getDb()
    .prepare(
      `WITH RECURSIVE up(id, parent_id, name, depth) AS (
         SELECT id, parent_id, name, 0 FROM folders WHERE id = ?
         UNION ALL
         SELECT f.id, f.parent_id, f.name, up.depth + 1 FROM folders f JOIN up ON f.id = up.parent_id
       )
       SELECT id, name FROM up ORDER BY depth DESC`
    )
    .all(folderId) as Crumb[];
  return rows;
}

export function tree(): TreeNode[] {
  return getDb()
    .prepare(
      `SELECT id, parent_id, root_id, name, path, total_count FROM folders
       WHERE total_count > 0 ORDER BY sort_key`
    )
    .all() as TreeNode[];
}

export function roots(): RootInfo[] {
  const rows = getDb()
    .prepare(
      `SELECT r.id, r.path, r.last_scan,
         (SELECT id FROM folders f WHERE f.root_id = r.id AND f.parent_id IS NULL LIMIT 1) AS folder_id,
         (SELECT count(*) FROM videos v WHERE v.root_id = r.id) AS video_count,
         (SELECT coalesce(sum(size), 0) FROM videos v WHERE v.root_id = r.id) AS total_size
       FROM roots r ORDER BY r.path`
    )
    .all() as Omit<RootInfo, "online">[];
  return rows.map((r) => ({ ...r, online: isOnline(r.path) }));
}

/** Normalise a picked folder path: absolute, no trailing slash (except "E:\"). */
export function cleanRootPath(p: string): string {
  let r = path.resolve(p);
  if (r.length > 3 && /[\\/]$/.test(r)) r = r.slice(0, -1);
  return r;
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent.toLowerCase(), child.toLowerCase());
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Add a root. Overlapping roots would fight over the same folder rows, so:
 * a folder inside an existing root is refused; a folder that contains
 * existing roots replaces them (their thumbnails are reused via fingerprints).
 */
export function addRoot(p: string): { id: number; replaced: number } {
  const db = getDb();
  const clean = cleanRootPath(p);
  const existing = db.prepare("SELECT id, path FROM roots").all() as { id: number; path: string }[];
  for (const r of existing) {
    if (isInside(clean, r.path)) throw new Error(`Already in your library (inside ${r.path}).`);
  }
  const covered = existing.filter((r) => isInside(r.path, clean));
  for (const r of covered) db.prepare("DELETE FROM roots WHERE id = ?").run(r.id);
  const row = db.prepare("INSERT INTO roots(path) VALUES (?) RETURNING id").get(clean) as { id: number };
  return { id: row.id, replaced: covered.length };
}

export function removeRoot(id: number): void {
  getDb().prepare("DELETE FROM roots WHERE id = ?").run(id);
}

/**
 * The drive came back under a different letter (or the folder was moved):
 * rewrite stored paths instead of rescanning from scratch.
 */
export function relocateRoot(id: number, newPath: string): void {
  const db = getDb();
  const clean = cleanRootPath(newPath);
  const r = db.prepare("SELECT path FROM roots WHERE id = ?").get(id) as { path: string } | undefined;
  if (!r) throw new Error("Unknown library folder");
  const others = db.prepare("SELECT path FROM roots WHERE id <> ?").all(id) as { path: string }[];
  for (const o of others) {
    if (isInside(clean, o.path) || isInside(o.path, clean)) throw new Error(`Overlaps ${o.path}`);
  }
  const old = r.path;
  const move = (p: string) => {
    const rel = path.relative(old, p);
    return rel ? path.join(clean, rel) : clean;
  };
  tx(() => {
    db.prepare("UPDATE roots SET path = ? WHERE id = ?").run(clean, id);
    const updF = db.prepare("UPDATE folders SET path = ?, name = ? WHERE id = ?");
    for (const f of db.prepare("SELECT id, path, name, parent_id FROM folders WHERE root_id = ?").all(id) as {
      id: number;
      path: string;
      name: string;
      parent_id: number | null;
    }[]) {
      updF.run(move(f.path), f.parent_id == null ? path.basename(clean) || clean : f.name, f.id);
    }
    const updV = db.prepare("UPDATE videos SET path = ?, sidecar = ? WHERE id = ?");
    for (const v of db.prepare("SELECT id, path, sidecar FROM videos WHERE root_id = ?").all(id) as {
      id: number;
      path: string;
      sidecar: string | null;
    }[]) {
      updV.run(move(v.path), v.sidecar ? move(v.sidecar) : null, v.id);
    }
  });
  onlineCache.delete(old);
}

export function videoById(id: number): { path: string; fp: string; folder_id: number } | null {
  return (
    (getDb().prepare("SELECT path, fp, folder_id FROM videos WHERE id = ?").get(id) as
      | { path: string; fp: string; folder_id: number }
      | undefined) ?? null
  );
}

export function folderPath(id: number): string | null {
  const r = getDb().prepare("SELECT path FROM folders WHERE id = ?").get(id) as { path: string } | undefined;
  return r?.path ?? null;
}

export function markOpened(fp: string): void {
  getDb().prepare("UPDATE media SET opened_at = ? WHERE fp = ?").run(Date.now(), fp);
}

/** Drop media rows + thumbnail files no video points at any more. */
export function pruneOrphans(thumbFile: (fp: string) => string): number {
  const db = getDb();
  const orphans = db
    .prepare("SELECT fp FROM media m WHERE NOT EXISTS (SELECT 1 FROM videos v WHERE v.fp = m.fp)")
    .all() as { fp: string }[];
  for (const o of orphans) fs.rmSync(thumbFile(o.fp), { force: true });
  db.prepare("DELETE FROM media WHERE NOT EXISTS (SELECT 1 FROM videos v WHERE v.fp = media.fp)").run();
  return orphans.length;
}

export function cacheStats(thumbsDir: string): { thumbs: number; bytes: number; orphans: number } {
  let thumbs = 0;
  let bytes = 0;
  try {
    for (const shard of fs.readdirSync(thumbsDir)) {
      const d = path.join(thumbsDir, shard);
      for (const f of fs.readdirSync(d)) {
        if (!f.endsWith(".jpg")) continue;
        thumbs++;
        bytes += fs.statSync(path.join(d, f)).size;
      }
    }
  } catch {
    /* no thumbs yet */
  }
  const o = getDb()
    .prepare("SELECT count(*) AS n FROM media m WHERE NOT EXISTS (SELECT 1 FROM videos v WHERE v.fp = m.fp)")
    .get() as { n: number };
  return { thumbs, bytes, orphans: o.n };
}

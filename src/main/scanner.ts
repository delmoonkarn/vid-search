import fs from "node:fs/promises";
import path from "node:path";
import { getDb, tx } from "./db";
import { IMAGE_EXTS, VIDEO_EXTS, naturalKey, normalizeSearch, ScanProgress } from "../shared/types";

// Folders that are never worth walking (Windows system dirs, NAS metadata, etc.).
const SKIP_DIRS = new Set([
  "system volume information",
  "$recycle.bin",
  "recycler",
  "@eadir",
  "#recycle",
  "#snapshot",
  ".@__thumb",
  "node_modules",
  "found.000",
]);

function skipDir(name: string): boolean {
  const n = name.toLowerCase();
  return n.startsWith(".") || n.startsWith("$") || SKIP_DIRS.has(n);
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i <= 0 ? "" : name.slice(i + 1).toLowerCase();
}

function stem(name: string): string {
  const i = name.lastIndexOf(".");
  return i <= 0 ? name : name.slice(0, i);
}

/** Pick an image next to the video that should be used as its thumbnail. */
function findSidecar(videoStem: string, images: Map<string, string>): string | null {
  const s = videoStem.toLowerCase();
  for (const k of [s, `${s}-thumb`, `${s}-fanart`, `${s}-poster`]) {
    const hit = images.get(k);
    if (hit) return hit;
  }
  return null;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export type ScanResult = { files: number; added: number; removed: number };

/**
 * Walk one library root and sync the DB with what's on disk.
 *
 * Built for slow external HDDs:
 *  - Quick mode (default) only stat()s files it has never seen; known paths
 *    are just marked as still present. One readdir per folder, nothing else.
 *  - `full` re-stats every file, catching files replaced under the same name.
 *  - If the root disappears mid-scan (drive unplugged) nothing is deleted.
 *
 * `onTick` is called every few seconds so the UI can refresh while a big
 * first scan is still running.
 */
export async function scanRoot(
  root: { id: number; path: string },
  full: boolean,
  onProgress: (p: ScanProgress) => void,
  onTick: () => void
): Promise<ScanResult> {
  const db = getDb();
  const gen = Date.now();

  try {
    await fs.access(root.path);
  } catch {
    throw new Error(`Folder not reachable (drive disconnected?): ${root.path}`);
  }

  const known = new Map<string, { id: number; sidecar: string | null; fp: string }>();
  for (const r of db.prepare("SELECT id, path, sidecar, fp FROM videos WHERE root_id = ?").all(root.id) as {
    id: number;
    path: string;
    sidecar: string | null;
    fp: string;
  }[]) {
    known.set(r.path, r);
  }

  const upsertFolder = db.prepare(`
    INSERT INTO folders(root_id, parent_id, path, name, sort_key, search, seen)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      root_id = excluded.root_id, parent_id = excluded.parent_id, name = excluded.name,
      sort_key = excluded.sort_key, search = excluded.search, seen = excluded.seen
    RETURNING id
  `);
  const upsertVideo = db.prepare(`
    INSERT INTO videos(root_id, folder_id, path, name, ext, sort_key, path_key, search, size, mtime, fp, sidecar, seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      root_id = excluded.root_id, folder_id = excluded.folder_id, name = excluded.name, ext = excluded.ext,
      sort_key = excluded.sort_key, path_key = excluded.path_key, search = excluded.search,
      size = excluded.size, mtime = excluded.mtime, fp = excluded.fp, sidecar = excluded.sidecar, seen = excluded.seen
  `);
  const insertMedia = db.prepare("INSERT INTO media(fp, first_seen) VALUES (?, ?) ON CONFLICT(fp) DO NOTHING");
  const touchVideo = db.prepare("UPDATE videos SET seen = ?, folder_id = ?, sidecar = ? WHERE id = ?");
  // A new/removed sidecar image means the automatic thumbnail should be redone.
  const resetAutoThumb = db.prepare("UPDATE media SET thumb = 0 WHERE fp = ? AND thumb_pos IS NULL");

  let dirs = 0;
  let files = 0;
  let added = 0;
  let lastReport = 0;
  let lastTick = Date.now();

  const queue: { dir: string; parentId: number | null }[] = [{ dir: root.path, parentId: null }];
  while (queue.length > 0) {
    const { dir, parentId } = queue.shift()!;

    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    const subs: string[] = [];
    const vids: string[] = [];
    const images = new Map<string, string>();
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!skipDir(e.name)) subs.push(path.join(dir, e.name));
      } else if (e.isFile() || e.isSymbolicLink()) {
        const ext = extOf(e.name);
        if (VIDEO_EXTS.has(ext)) vids.push(e.name);
        else if (IMAGE_EXTS.has(ext)) images.set(stem(e.name).toLowerCase(), path.join(dir, e.name));
      }
    }

    const name = path.basename(dir) || dir; // "E:\\" has no basename
    const rel = path.relative(root.path, dir);
    const folderId = (
      upsertFolder.get(root.id, parentId, dir, name, naturalKey(name), normalizeSearch(path.basename(dir) || dir), gen) as {
        id: number;
      }
    ).id;

    const touched: { id: number; sidecar: string | null; prevSidecar: string | null; fp: string }[] = [];
    const fresh: string[] = [];
    for (const v of vids) {
      const p = path.join(dir, v);
      const k = known.get(p);
      if (k && !full) {
        touched.push({ id: k.id, sidecar: findSidecar(stem(v), images), prevSidecar: k.sidecar, fp: k.fp });
      } else {
        fresh.push(v);
      }
    }

    const stats = await mapLimit(fresh, 16, async (v) => {
      try {
        const s = await fs.stat(path.join(dir, v));
        return { v, size: s.size, mtime: Math.floor(s.mtimeMs) };
      } catch {
        return null;
      }
    });

    tx(() => {
      for (const t of touched) {
        touchVideo.run(gen, folderId, t.sidecar, t.id);
        if (t.sidecar !== t.prevSidecar) resetAutoThumb.run(t.fp);
      }
      for (const s of stats) {
        if (!s) continue;
        const p = path.join(dir, s.v);
        const title = stem(s.v);
        const ext = extOf(s.v);
        const fp = `${s.size}-${s.mtime}`;
        const sidecar = findSidecar(title, images);
        const prev = known.get(p);
        upsertVideo.run(
          root.id,
          folderId,
          p,
          title,
          ext,
          naturalKey(title),
          naturalKey(rel + "/" + title),
          normalizeSearch(`${title} ${ext} ${rel}`),
          s.size,
          s.mtime,
          fp,
          sidecar,
          gen
        );
        insertMedia.run(fp, gen);
        if (prev && prev.sidecar !== sidecar) resetAutoThumb.run(fp);
        if (!prev) added++;
      }
    });

    files += touched.length + stats.filter(Boolean).length;
    dirs++;
    for (const s of subs) queue.push({ dir: s, parentId: folderId });

    const now = Date.now();
    if (now - lastReport > 120) {
      lastReport = now;
      onProgress({ running: true, root: root.path, dirs, files, added, current: dir });
    }
    if (now - lastTick > 4000) {
      lastTick = now;
      aggregate(root.id);
      onTick();
    }
  }

  // If the drive vanished mid-walk every readdir after that point failed;
  // deleting "unseen" rows now would wipe the library. Bail out instead.
  try {
    await fs.access(root.path);
  } catch {
    throw new Error(`Drive went away during the scan: ${root.path}`);
  }

  const removed = tx(() => {
    const r = db.prepare("DELETE FROM videos WHERE root_id = ? AND seen <> ?").run(root.id, gen);
    db.prepare("DELETE FROM folders WHERE root_id = ? AND seen <> ?").run(root.id, gen);
    db.prepare("UPDATE roots SET last_scan = ? WHERE id = ?").run(gen, root.id);
    return Number(r.changes);
  });
  aggregate(root.id);

  onProgress({ running: false, root: root.path, dirs, files, added, current: "" });
  return { files, added, removed };
}

/**
 * Recompute per-folder counts, sizes and covers for one root.
 * Cover = the folder's first video (natural order), else bubbled up from the
 * first subfolder that has one.
 */
export function aggregate(rootId: number): void {
  const db = getDb();
  const folders = db
    .prepare("SELECT id, parent_id, sort_key FROM folders WHERE root_id = ? ORDER BY sort_key")
    .all(rootId) as { id: number; parent_id: number | null; sort_key: string }[];
  const direct = new Map<number, { count: number; size: number; cover: string | null }>();
  for (const r of db
    .prepare("SELECT folder_id, size, fp FROM videos WHERE root_id = ? ORDER BY folder_id, sort_key")
    .all(rootId) as { folder_id: number; size: number; fp: string }[]) {
    const d = direct.get(r.folder_id);
    if (d) {
      d.count++;
      d.size += r.size;
    } else {
      direct.set(r.folder_id, { count: 1, size: r.size, cover: r.fp });
    }
  }

  const byId = new Map(folders.map((f) => [f.id, f]));
  const children = new Map<number, number[]>();
  for (const f of folders) {
    if (f.parent_id != null) {
      const list = children.get(f.parent_id);
      if (list) list.push(f.id);
      else children.set(f.parent_id, [f.id]);
    }
  }

  const total = new Map<number, { count: number; size: number }>();
  for (const f of folders) total.set(f.id, { count: 0, size: 0 });
  for (const [fid, d] of direct) {
    let cur: number | null | undefined = fid;
    while (cur != null) {
      const t = total.get(cur);
      if (!t) break;
      t.count += d.count;
      t.size += d.size;
      cur = byId.get(cur)?.parent_id;
    }
  }

  const coverMemo = new Map<number, string | null>();
  const coverOf = (id: number): string | null => {
    if (coverMemo.has(id)) return coverMemo.get(id)!;
    coverMemo.set(id, null); // cycle guard
    let c = direct.get(id)?.cover ?? null;
    if (!c) {
      for (const k of children.get(id) ?? []) {
        c = coverOf(k);
        if (c) break;
      }
    }
    coverMemo.set(id, c);
    return c;
  };

  const upd = db.prepare(
    "UPDATE folders SET direct_count = ?, total_count = ?, total_size = ?, cover_fp = ? WHERE id = ?"
  );
  tx(() => {
    for (const f of folders) {
      const t = total.get(f.id)!;
      upd.run(direct.get(f.id)?.count ?? 0, t.count, t.size, coverOf(f.id), f.id);
    }
  });
}

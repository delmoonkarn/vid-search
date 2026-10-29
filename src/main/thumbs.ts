import fs from "node:fs";
import path from "node:path";
import { getDb, getSettings } from "./db";
import { thumbFile } from "./paths";
import { coverThumb, frameThumb, imageThumb, probe, ProbeInfo } from "./ffmpeg";
import { MediaUpdate, ThumbProgress, ThumbState } from "../shared/types";

/**
 * Background thumbnail + metadata generator.
 *
 * Work comes from `media.thumb = 0` rows. Jobs the UI is currently showing
 * (`prioritize`) jump the queue; the rest go in path order, which keeps the
 * HDD head moving mostly forward. Concurrency is low on purpose — parallel
 * random reads are what make a spinning disk crawl.
 *
 * Thumbnail source, best first:
 *   1. a sidecar image next to the file (yt-dlp / Kodi / Plex style)
 *   2. embedded cover art (MP4 covr atom, MKV cover attachment)
 *   3. a frame at ~20% in; if it's near-black or flat, try 45% and 70%
 * A user "pick another frame" sets thumb_pos, which forces (3) at that spot.
 */

type Job = { fp: string; path: string; sidecar: string | null; root_id: number; thumb_pos: number | null };

const AUTO_POSITIONS = [0.2, 0.45, 0.7];
// A 480px JPEG of a black/flat frame is only a few KB; real content is 15–60 KB.
const FLAT_BYTES_PER_PX = 0.06;

let emitUpdate: (u: MediaUpdate[]) => void = () => {};
let emitProgress: (p: ThumbProgress) => void = () => {};

let userPaused = false;
let scanning = false;
const running = new Map<string, string>(); // fp -> file path
let priority: string[] = [];
let backlog: Job[] = [];
let backlogExhausted = false;
const offlineRoots = new Set<number>();
const skipped = new Set<string>(); // fps that failed for a transient reason this session
let done = 0;

const pendingUpdates = new Map<string, MediaUpdate>();
let flushTimer: NodeJS.Timeout | null = null;
let progressTimer: NodeJS.Timeout | null = null;

export function initThumbs(onUpdate: (u: MediaUpdate[]) => void, onProgress: (p: ThumbProgress) => void) {
  emitUpdate = onUpdate;
  emitProgress = onProgress;
}

export function setScanning(v: boolean) {
  scanning = v;
  if (!v) {
    offlineRoots.clear();
    resetBacklog();
  }
  pump();
  queueProgress();
}

export function setPaused(v: boolean) {
  userPaused = v;
  pump();
  queueProgress();
}

/** Called when rows were added/changed so the backlog is re-read from the DB. */
export function resetBacklog() {
  backlog = [];
  backlogExhausted = false;
  pump();
  queueProgress();
}

export function prioritize(fps: string[]) {
  priority = fps.filter((fp) => !running.has(fp));
  pump();
}

/** Ask for a different frame: step the position forward and regenerate. */
export function regenerate(fp: string): void {
  const db = getDb();
  const row = db.prepare("SELECT thumb_pos FROM media WHERE fp = ?").get(fp) as { thumb_pos: number | null } | undefined;
  if (!row) return;
  let pos = (row.thumb_pos ?? AUTO_POSITIONS[0]) + 0.17;
  if (pos > 0.92) pos -= 0.84;
  db.prepare("UPDATE media SET thumb = 0, thumb_pos = ?, error = NULL WHERE fp = ?").run(pos, fp);
  skipped.delete(fp);
  priority = [fp, ...priority.filter((x) => x !== fp)];
  pump();
}

/** Back to automatic thumbnail choice (sidecar → cover art → frame). */
export function resetToAuto(fp: string): void {
  getDb().prepare("UPDATE media SET thumb = 0, thumb_pos = NULL, error = NULL WHERE fp = ?").run(fp);
  skipped.delete(fp);
  priority = [fp, ...priority.filter((x) => x !== fp)];
  pump();
}

export function retryFailed(): void {
  getDb().prepare("UPDATE media SET thumb = 0, error = NULL WHERE thumb = -1").run();
  skipped.clear();
  resetBacklog();
}

function workerLimit(): number {
  return scanning ? 1 : getSettings().workers;
}

function jobFor(fp: string): Job | null {
  const r = getDb()
    .prepare(
      `SELECT m.fp, v.path, v.sidecar, v.root_id, m.thumb_pos
       FROM media m JOIN videos v ON v.fp = m.fp
       WHERE m.fp = ? AND m.thumb = 0 LIMIT 1`
    )
    .get(fp) as Job | undefined;
  return r ?? null;
}

function refillBacklog() {
  if (backlogExhausted) return;
  const offline = [...offlineRoots].join(",") || "-1";
  const rows = getDb()
    .prepare(
      `SELECT m.fp, min(v.path) AS path, v.sidecar, v.root_id, m.thumb_pos
       FROM media m JOIN videos v ON v.fp = m.fp
       WHERE m.thumb = 0 AND v.root_id NOT IN (${offline})
       GROUP BY m.fp
       ORDER BY path
       LIMIT 400`
    )
    .all() as Job[];
  backlog = rows.filter((j) => !running.has(j.fp) && !skipped.has(j.fp) && !offlineRoots.has(j.root_id));
  if (backlog.length === 0) backlogExhausted = true;
}

function nextJob(): Job | null {
  while (priority.length > 0) {
    const fp = priority.shift()!;
    if (running.has(fp) || skipped.has(fp)) continue;
    const j = jobFor(fp);
    if (j && !offlineRoots.has(j.root_id)) return j;
  }
  // While a scan is reading the disk, only do what the user is looking at.
  if (scanning) return null;
  while (true) {
    if (backlog.length === 0) {
      refillBacklog();
      if (backlog.length === 0) return null;
    }
    const j = backlog.shift()!;
    if (running.has(j.fp) || skipped.has(j.fp) || offlineRoots.has(j.root_id)) continue;
    // The backlog is a snapshot; a priority request may have done this one since.
    if (jobFor(j.fp)) return j;
  }
}

function pump() {
  if (userPaused) return;
  while (running.size < workerLimit()) {
    const job = nextJob();
    if (!job) break;
    running.set(job.fp, job.path);
    queueProgress();
    runJob(job)
      .catch(() => {})
      .finally(() => {
        running.delete(job.fp);
        queueProgress();
        pump();
      });
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

function isFlat(file: string): boolean {
  try {
    // Size per pixel is a cheap stand-in for "is there anything in this frame".
    const size = fs.statSync(file).size;
    return size < 480 * 270 * FLAT_BYTES_PER_PX;
  } catch {
    return true;
  }
}

async function runJob(job: Job): Promise<void> {
  const db = getDb();
  if (!(await exists(job.path))) {
    // Either the drive is gone or the file moved since the last scan. Don't
    // mark it failed — a rescan will sort it out.
    const root = db.prepare("SELECT path FROM roots WHERE id = ?").get(job.root_id) as { path: string } | undefined;
    if (root && !(await exists(root.path))) offlineRoots.add(job.root_id);
    skipped.add(job.fp);
    return;
  }

  const out = thumbFile(job.fp);
  const tmp = out + ".tmp.jpg";
  fs.mkdirSync(path.dirname(out), { recursive: true });

  let info: ProbeInfo | null = null;
  let probeErr: string | null = null;
  try {
    info = await probe(job.path);
    db.prepare("UPDATE media SET duration = ?, width = ?, height = ?, vcodec = ? WHERE fp = ?").run(
      info.duration,
      info.width,
      info.height,
      info.vcodec,
      job.fp
    );
  } catch (e) {
    probeErr = (e as Error).message;
  }

  let ok = false;
  let err: string | null = probeErr;
  const manual = job.thumb_pos != null;

  if (!manual && job.sidecar && (await exists(job.sidecar))) {
    try {
      await imageThumb(job.sidecar, tmp);
      ok = true;
    } catch (e) {
      err = (e as Error).message;
    }
  }
  if (!ok && !manual && info?.coverStream != null) {
    try {
      await coverThumb(job.path, info.coverStream, tmp);
      ok = !isFlat(tmp);
    } catch (e) {
      err = (e as Error).message;
    }
  }
  if (!ok && (info?.width || !info)) {
    const fallbackInfo: ProbeInfo = info ?? {
      duration: null, width: null, height: null, vcodec: null, sar: 1, hdr: false, coverStream: null,
    };
    const dur = fallbackInfo.duration;
    const positions = manual ? [job.thumb_pos!] : AUTO_POSITIONS;
    let bestSize = 0;
    const best = tmp + ".best.jpg";
    for (const p of positions) {
      const at = dur ? Math.min(dur * p, Math.max(0, dur - 1)) : 0;
      try {
        await frameThumb(job.path, at, fallbackInfo, tmp);
        const size = fs.statSync(tmp).size;
        if (manual || !isFlat(tmp)) {
          ok = true;
          break;
        }
        // Keep the most detailed of the flat candidates in case none pass.
        if (size > bestSize) {
          bestSize = size;
          fs.copyFileSync(tmp, best);
        }
      } catch (e) {
        err = (e as Error).message;
      }
      if (!dur) break;
    }
    if (!ok && bestSize > 0) {
      fs.renameSync(best, tmp);
      ok = true;
    }
    fs.rmSync(best, { force: true });
  }

  let state: ThumbState;
  if (ok) {
    fs.renameSync(tmp, out);
    db.prepare("UPDATE media SET thumb = 1, thumb_ver = thumb_ver + 1, error = NULL WHERE fp = ?").run(job.fp);
    state = 1;
    done++;
  } else {
    fs.rmSync(tmp, { force: true });
    if (!(await exists(job.path))) {
      skipped.add(job.fp); // unplugged mid-job
      return;
    }
    db.prepare("UPDATE media SET thumb = -1, error = ? WHERE fp = ?").run(err ?? "no video stream", job.fp);
    state = -1;
  }

  const m = db.prepare("SELECT thumb_ver, duration, width, height FROM media WHERE fp = ?").get(job.fp) as {
    thumb_ver: number;
    duration: number | null;
    width: number | null;
    height: number | null;
  };
  pendingUpdates.set(job.fp, { fp: job.fp, thumb: state, ...m });
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      const list = [...pendingUpdates.values()];
      pendingUpdates.clear();
      emitUpdate(list);
    }, 250);
  }
}

function queueProgress() {
  if (progressTimer) return;
  progressTimer = setTimeout(() => {
    progressTimer = null;
    emitProgress(getProgress());
  }, 300);
}

export function getProgress(): ThumbProgress {
  const r = getDb()
    .prepare(
      `SELECT sum(m.thumb = 0) AS pending, sum(m.thumb = -1) AS failed FROM media m
       WHERE m.thumb <> 1 AND EXISTS (SELECT 1 FROM videos v WHERE v.fp = m.fp)`
    )
    .get() as { pending: number | null; failed: number | null };
  const first = running.values().next();
  return {
    pending: r.pending ?? 0,
    done,
    failed: r.failed ?? 0,
    paused: userPaused,
    waitingForScan: scanning,
    current: first.done ? null : path.basename(first.value),
  };
}

export function kick() {
  pump();
  queueProgress();
}

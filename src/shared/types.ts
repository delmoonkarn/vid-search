// Types + tiny pure helpers shared by main and renderer. Must not import any
// Node or Electron module — the renderer bundles this file too.

/** Everything ffmpeg can usually demux. Lower-case, no dot. */
export const VIDEO_EXTS = new Set([
  "mp4", "m4v", "mkv", "mk3d", "webm", "avi", "mov", "qt", "wmv", "asf", "flv", "f4v",
  "mpg", "mpeg", "mpe", "mpv", "m1v", "m2v", "m2p", "ps", "vob", "evo",
  "ts", "m2ts", "mts", "tp", "trp", "tsv",
  "3gp", "3g2", "ogv", "ogm", "ogx", "divx", "xvid", "rm", "rmvb", "dv", "mxf", "nut",
  "amv", "wtv", "dvr-ms", "bik", "nsv", "vro", "h264", "h265", "hevc", "264", "265", "y4m", "ivf",
]);

/** Images next to a video that we treat as its thumbnail (yt-dlp, Kodi, Plex…). */
export const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "webp", "bmp"]);

export type SortBy = "name" | "path" | "mtime" | "added" | "size" | "duration" | "opened" | "random";
export type SortDir = "asc" | "desc";

/** 0 = not generated yet, 1 = ready, -1 = ffmpeg could not make one. */
export type ThumbState = 0 | 1 | -1;

export type VideoItem = {
  id: number;
  folder_id: number;
  root_id: number;
  name: string; // file name without extension
  ext: string;
  folder: string; // parent folder name
  path: string;
  size: number;
  mtime: number;
  fp: string;
  duration: number | null;
  width: number | null;
  height: number | null;
  thumb: ThumbState;
  thumb_ver: number;
  opened_at: number | null;
};

export type FolderItem = {
  id: number;
  name: string;
  path: string;
  total_count: number;
  sub_count: number;
  total_size: number;
  cover_fp: string | null;
  cover_thumb: ThumbState;
  cover_ver: number;
};

export type TreeNode = {
  id: number;
  parent_id: number | null;
  root_id: number;
  name: string;
  path: string;
  total_count: number;
};

export type RootInfo = {
  id: number;
  path: string;
  folder_id: number | null;
  online: boolean;
  video_count: number;
  total_size: number;
  last_scan: number | null;
};

export type View = { kind: "all" } | { kind: "folder"; id: number };

export type ListQuery = {
  view: View;
  recursive: boolean;
  query: string;
  sort: SortBy;
  dir: SortDir;
  seed: number;
};

export type Crumb = { id: number; name: string };

export type ListResult = {
  folders: FolderItem[];
  videos: VideoItem[];
  crumbs: Crumb[];
  totalSize: number;
  offline: boolean;
};

export type ScanProgress = {
  running: boolean;
  root: string;
  dirs: number;
  files: number;
  added: number;
  current: string;
};

export type ScanDone = { root: string; files: number; added: number; removed: number; error?: string };

export type ThumbProgress = {
  pending: number;
  done: number;
  failed: number;
  paused: boolean;
  waitingForScan: boolean;
  current: string | null;
};

/** Pushed to the renderer whenever probe/thumbnail info for a fingerprint changes. */
export type MediaUpdate = {
  fp: string;
  thumb: ThumbState;
  thumb_ver: number;
  duration: number | null;
  width: number | null;
  height: number | null;
};

export type Settings = {
  /** Absolute path to a player .exe, or null = Windows default app for the file type. */
  player: string | null;
  scanOnStartup: boolean;
  /** Parallel ffmpeg jobs. 1–2 is best for a spinning HDD. */
  workers: number;
};

export const DEFAULT_SETTINGS: Settings = { player: null, scanOnStartup: true, workers: 2 };

/**
 * Search normalisation used for both the indexed text and the query, so
 * "show name s01" matches "Show.Name.S01E02.mkv". Punctuation commonly used as
 * word separators in file names collapses to a single space.
 */
export function normalizeSearch(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s._\-–—,;:+=~'"`!?@#$%^&*()[\]{}<>|/\\]+/g, " ")
    .trim();
}

/** Zero-pad digit runs so plain string ORDER BY sorts "Ep 2" before "Ep 10". */
export function naturalKey(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\d+/g, (d) => d.replace(/^0+(?=\d)/, "").padStart(12, "0"));
}

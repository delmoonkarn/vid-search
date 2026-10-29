import { contextBridge, ipcRenderer } from "electron";
import type {
  ListQuery,
  ListResult,
  MediaUpdate,
  RootInfo,
  ScanDone,
  ScanProgress,
  Settings,
  ThumbProgress,
  TreeNode,
} from "../shared/types";

type Result = { ok: boolean; error?: string };

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const l = (_: unknown, p: T) => cb(p);
  ipcRenderer.on(channel, l);
  return () => ipcRenderer.removeListener(channel, l);
}

const api = {
  list: (q: ListQuery): Promise<ListResult> => ipcRenderer.invoke("library:list", q),
  tree: (): Promise<TreeNode[]> => ipcRenderer.invoke("library:tree"),

  roots: (): Promise<RootInfo[]> => ipcRenderer.invoke("roots:list"),
  addRoot: (): Promise<Result> => ipcRenderer.invoke("roots:add"),
  removeRoot: (id: number): Promise<void> => ipcRenderer.invoke("roots:remove", id),
  relocateRoot: (id: number): Promise<Result> => ipcRenderer.invoke("roots:relocate", id),
  scan: (id: number | null, full = false): Promise<void> => ipcRenderer.invoke("roots:scan", id, full),
  scanStatus: (): Promise<ScanProgress | null> => ipcRenderer.invoke("scan:status"),

  open: (id: number): Promise<Result> => ipcRenderer.invoke("video:open", id),
  openWith: (id: number): Promise<Result> => ipcRenderer.invoke("video:open-with", id),
  reveal: (id: number): Promise<void> => ipcRenderer.invoke("video:reveal", id),
  revealFolder: (id: number): Promise<string> => ipcRenderer.invoke("folder:reveal", id),
  copy: (text: string): Promise<void> => ipcRenderer.invoke("clipboard:write", text),

  prioritize: (fps: string[]): Promise<void> => ipcRenderer.invoke("thumbs:prioritize", fps),
  regenerate: (fp: string): Promise<void> => ipcRenderer.invoke("thumbs:regenerate", fp),
  autoThumb: (fp: string): Promise<void> => ipcRenderer.invoke("thumbs:auto", fp),
  retryFailed: (): Promise<void> => ipcRenderer.invoke("thumbs:retry-failed"),
  pauseThumbs: (paused: boolean): Promise<void> => ipcRenderer.invoke("thumbs:pause", paused),
  thumbProgress: (): Promise<ThumbProgress> => ipcRenderer.invoke("thumbs:progress"),

  settings: (): Promise<Settings> => ipcRenderer.invoke("settings:get"),
  saveSettings: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke("settings:set", patch),
  pickPlayer: (): Promise<string | null> => ipcRenderer.invoke("settings:pick-player"),

  cacheStats: (): Promise<{ thumbs: number; bytes: number; orphans: number }> => ipcRenderer.invoke("cache:stats"),
  pruneCache: (): Promise<number> => ipcRenderer.invoke("cache:prune"),
  info: (): Promise<{ cacheDir: string; binaries: { ffmpeg: boolean; ffprobe: boolean } }> =>
    ipcRenderer.invoke("app:info"),
  openCacheFolder: (): Promise<string> => ipcRenderer.invoke("app:open-cache"),

  onScanProgress: (cb: (p: ScanProgress) => void) => on("scan:progress", cb),
  onScanDone: (cb: (d: ScanDone) => void) => on("scan:done", cb),
  onLibraryChanged: (cb: () => void) => on("library:changed", cb),
  onMediaUpdated: (cb: (u: MediaUpdate[]) => void) => on("media:updated", cb),
  onThumbProgress: (cb: (p: ThumbProgress) => void) => on("thumbs:progress", cb),
};

contextBridge.exposeInMainWorld("api", api);

export type Api = typeof api;

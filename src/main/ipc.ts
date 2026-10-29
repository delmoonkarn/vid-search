import { BrowserWindow, clipboard, dialog, ipcMain, shell } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { getDb, getSettings, saveSettings } from "./db";
import { cacheDir, thumbFile, thumbsDir } from "./paths";
import { binariesOk } from "./ffmpeg";
import {
  addRoot,
  cacheStats,
  folderPath,
  list,
  markOpened,
  pruneOrphans,
  relocateRoot,
  removeRoot,
  roots,
  setOnline,
  tree,
  videoById,
} from "./library";
import { scanRoot } from "./scanner";
import {
  getProgress,
  kick,
  prioritize,
  regenerate,
  resetBacklog,
  resetToAuto,
  retryFailed,
  setPaused,
  setScanning,
} from "./thumbs";
import { ListQuery, ScanDone, ScanProgress, Settings } from "../shared/types";

let win: BrowserWindow | null = null;

export function setWindow(w: BrowserWindow | null) {
  win = w;
}

export function send(channel: string, payload?: unknown) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// ---- scan orchestration: one scan at a time, requests queue up ----

type ScanReq = { rootId: number; full: boolean; quiet: boolean };
const scanQueue: ScanReq[] = [];
let scanBusy = false;
let lastProgress: ScanProgress | null = null;

export function requestScan(rootId: number | null, full: boolean, quiet = false) {
  const ids =
    rootId == null
      ? (getDb().prepare("SELECT id FROM roots ORDER BY path").all() as { id: number }[]).map((r) => r.id)
      : [rootId];
  for (const id of ids) {
    const existing = scanQueue.find((q) => q.rootId === id);
    if (existing) existing.full ||= full;
    else scanQueue.push({ rootId: id, full, quiet });
  }
  void drainScans();
}

async function drainScans() {
  if (scanBusy) return;
  scanBusy = true;
  setScanning(true);
  try {
    while (scanQueue.length > 0) {
      const req = scanQueue.shift()!;
      const root = getDb().prepare("SELECT id, path FROM roots WHERE id = ?").get(req.rootId) as
        | { id: number; path: string }
        | undefined;
      if (!root) continue;
      let done: ScanDone;
      try {
        const r = await scanRoot(
          root,
          req.full,
          (p) => {
            lastProgress = p;
            send("scan:progress", p);
          },
          () => send("library:changed")
        );
        setOnline(root.path, true);
        done = { root: root.path, ...r };
      } catch (e) {
        setOnline(root.path, fs.existsSync(root.path));
        done = { root: root.path, files: 0, added: 0, removed: 0, error: req.quiet ? undefined : (e as Error).message };
      }
      send("scan:done", done);
      send("library:changed");
    }
  } finally {
    lastProgress = null;
    scanBusy = false;
    setScanning(false);
    send("scan:progress", { running: false, root: "", dirs: 0, files: 0, added: 0, current: "" } satisfies ScanProgress);
  }
}

// ---- opening files ----

function launch(exe: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { detached: true, stdio: "ignore", windowsHide: false });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

async function openVideo(id: number, mode: "default" | "chooser"): Promise<{ ok: boolean; error?: string }> {
  const v = videoById(id);
  if (!v) return { ok: false, error: "Video is no longer in the library." };
  try {
    await fs.promises.access(v.path);
  } catch {
    return { ok: false, error: "File not found — is the drive connected?" };
  }
  try {
    if (mode === "chooser") {
      // Windows' own "How do you want to open this file?" picker.
      await launch("rundll32.exe", ["shell32.dll,OpenAs_RunDLL", v.path]);
    } else {
      const player = getSettings().player;
      if (player) {
        await launch(player, [v.path]);
      } else {
        const err = await shell.openPath(v.path);
        if (err) return { ok: false, error: err };
      }
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  markOpened(v.fp);
  return { ok: true };
}

export function registerIpc() {
  ipcMain.handle("library:list", (_e, q: ListQuery) => list(q));
  ipcMain.handle("library:tree", () => tree());

  ipcMain.handle("roots:list", () => roots());
  ipcMain.handle("roots:add", async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: "Add a video folder",
      properties: ["openDirectory"],
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false };
    try {
      const { id } = addRoot(r.filePaths[0]);
      send("library:changed");
      requestScan(id, false);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });
  ipcMain.handle("roots:remove", (_e, id: number) => {
    removeRoot(id);
    resetBacklog();
    send("library:changed");
  });
  ipcMain.handle("roots:relocate", async (_e, id: number) => {
    const r = await dialog.showOpenDialog(win!, {
      title: "Where is this folder now?",
      properties: ["openDirectory"],
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false };
    try {
      relocateRoot(id, r.filePaths[0]);
      send("library:changed");
      requestScan(id, false);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });
  ipcMain.handle("roots:scan", (_e, id: number | null, full: boolean) => requestScan(id, full));
  ipcMain.handle("scan:status", () => lastProgress);

  ipcMain.handle("video:open", (_e, id: number) => openVideo(id, "default"));
  ipcMain.handle("video:open-with", (_e, id: number) => openVideo(id, "chooser"));
  ipcMain.handle("video:reveal", (_e, id: number) => {
    const v = videoById(id);
    if (v) shell.showItemInFolder(v.path);
  });
  ipcMain.handle("folder:reveal", async (_e, id: number) => {
    const p = folderPath(id);
    return p ? shell.openPath(p) : "Folder not found";
  });
  ipcMain.handle("clipboard:write", (_e, text: string) => clipboard.writeText(text));

  ipcMain.handle("thumbs:prioritize", (_e, fps: string[]) => prioritize(fps));
  ipcMain.handle("thumbs:regenerate", (_e, fp: string) => regenerate(fp));
  ipcMain.handle("thumbs:auto", (_e, fp: string) => resetToAuto(fp));
  ipcMain.handle("thumbs:retry-failed", () => retryFailed());
  ipcMain.handle("thumbs:pause", (_e, v: boolean) => setPaused(v));
  ipcMain.handle("thumbs:progress", () => getProgress());

  ipcMain.handle("settings:get", () => getSettings());
  ipcMain.handle("settings:set", (_e, patch: Partial<Settings>) => {
    const s = saveSettings(patch);
    kick();
    return s;
  });
  ipcMain.handle("settings:pick-player", async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: "Pick your video player",
      properties: ["openFile"],
      filters: [{ name: "Programs", extensions: ["exe"] }],
    });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });

  ipcMain.handle("cache:stats", () => cacheStats(thumbsDir()));
  ipcMain.handle("cache:prune", () => pruneOrphans(thumbFile));
  ipcMain.handle("app:info", () => ({ cacheDir: cacheDir(), binaries: binariesOk() }));
  ipcMain.handle("app:open-cache", () => shell.openPath(cacheDir()));
}

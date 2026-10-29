import { app } from "electron";
import path from "node:path";

/**
 * The app folder: project root in dev, the folder holding the .exe when
 * packaged. Cache + Electron runtime data live here (not %APPDATA%), same as
 * the manga reader, so the whole app stays self-contained.
 */
export function appRoot(): string {
  return app.isPackaged ? path.dirname(app.getPath("exe")) : app.getAppPath();
}

export function cacheDir(): string {
  return path.join(appRoot(), "cache");
}

export function thumbsDir(): string {
  return path.join(cacheDir(), "thumbs");
}

/** Fingerprints are "<size>-<mtimeMs>", already filename-safe. Sharded by the last 2 digits. */
export function thumbFile(fp: string): string {
  return path.join(thumbsDir(), fp.slice(-2), `${fp}.jpg`);
}

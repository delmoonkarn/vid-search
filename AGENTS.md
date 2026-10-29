# Working on this codebase

Notes for the next dev (or AI agent). `README.md` is for end users.

## 30-second summary

Electron + React + TypeScript desktop app, sibling of `del-manga-reader`. The
user adds one or more library folders (usually on a slow external HDD). The
main process walks them, stores every video in SQLite, and a background queue
runs ffprobe/ffmpeg to get length/resolution and a JPEG thumbnail into
`cache/thumbs/`. The UI only ever reads the cache — the HDD is touched by the
scanner, the thumbnail queue, and when the user opens a file.

Videos are **never played in-app**. Click → `shell.openPath` (Windows default
app) or a user-chosen player .exe. That's deliberate: in-app playback was tried
before and dropped.

## Architecture

```
┌──────── Renderer (Chromium) ────────┐   ┌──────────── Main (Node) ─────────────┐
│ React UI, Zustand (store.ts)        │   │ ipc.ts      IPC handlers, scan queue,│
│ Virtualised grid (Grid.tsx)         │   │             open-with-default-app    │
│ <img src="thumb://t/<fp>.jpg?v=N">  │◄──┤ library.ts  all read queries, roots  │
│ lib/media.ts: live per-fp updates   │   │ scanner.ts  directory walk → DB      │
│                                     │   │ thumbs.ts   background ffmpeg queue  │
│ window.api.* ── ipcRenderer ───────►│   │ ffmpeg.ts   probe / frame / cover    │
└─────────────────────────────────────┘   │ db.ts       node:sqlite + schema     │
                                          └──────────────────────────────────────┘
src/shared/types.ts — types + pure helpers imported by BOTH sides (no Node imports!)
```

Unlike the manga reader, row/query types are **not** duplicated: both sides
import them from `src/shared/types.ts`. Keep that file free of Node/Electron
imports or the renderer bundle breaks.

## Key ideas (read before changing the scanner or thumbnails)

- **Fingerprint (`fp`) = `"<size>-<mtimeMs>"`.** Thumbnails and probe data live
  in the `media` table and `cache/thumbs/<last2>/<fp>.jpg`, keyed by fp — not by
  path. Rename/move a file, or re-plug the drive as another letter, and the
  thumbnail is reused without reading the file again.
- **Quick scan** (default) only `stat()`s files whose path it has never seen.
  Known paths are just marked `seen`. `full` re-stats everything.
- **Never delete on a vanished drive.** `scanRoot` checks the root before and
  after walking; if it's gone, it throws before the "delete unseen rows" step.
- **Thumbnail queue** (`thumbs.ts`): `prioritize()` (what's on screen) first,
  then a path-ordered backlog. 1 job while a scan runs (on-screen only),
  `settings.workers` otherwise. Missing file → `skipped` for the session, not
  marked failed.
- **Thumbnail source order:** sidecar image → embedded cover art
  (`attached_pic`) → frame at 20/45/70% (first one that isn't near-black/flat,
  judged by JPEG bytes per pixel). `media.thumb_pos` non-null = user picked
  "another frame" → frame at exactly that fraction.
- Frame grab first tries `-skip_frame nokey -noaccurate_seek` (reads only a few
  MB even on 50 GB remuxes), then an accurate seek, then frame 0 (needed for
  index-less `.ts`).
- **Search** = `instr()` over a pre-normalised `search` column (lowercase,
  NFKC, punctuation → space). Query is normalised with the same
  `normalizeSearch()`. Natural sort uses a pre-computed zero-padded `sort_key`.
- `isOnline()` caches drive presence: `existsSync` on a sleeping USB disk can
  block the main thread for seconds.

## Database (`cache/library.db`)

- `roots` — library folders the user added. Overlapping roots are refused /
  merged in `addRoot`.
- `folders` — every walked directory. `direct_count`, `total_count`,
  `total_size`, `cover_fp` are recomputed by `aggregate()` after each scan.
  UI only shows folders with `total_count > 0`.
- `videos` — one row per file path. `fp` links to `media`.
- `media` — per-fingerprint: duration, size, codec, thumb state
  (0 pending / 1 ready / -1 failed), `thumb_ver` (cache-buster), `opened_at`.
  Rows outlive their videos on purpose; Settings → "Clean up unused thumbnails"
  prunes them.
- `meta` — settings JSON, window bounds.

No migrations yet. If you change the schema, bump `PRAGMA user_version` and
migrate in `getDb()`; or tell the user to delete `cache/library.db` (thumbnails
in `cache/thumbs/` are reused automatically after the rescan).

## Recipes

### Add a sort option
1. Add the literal to `SortBy` in `src/shared/types.ts`.
2. Add a case in `videoOrder()` (and `folderOrder()` if folders should follow) in `src/main/library.ts`.
3. Add it to `SORTS` + `DEFAULT_DIR` in `src/renderer/components/Toolbar.tsx`.

### Add an IPC endpoint
1. `ipcMain.handle("ns:action", …)` in `src/main/ipc.ts`.
2. Typed wrapper in `src/main/preload.ts` (`Api` type flows to the renderer).

### Show more on a card
`src/renderer/components/Cards.tsx`. New column → add to `VIDEO_COLS` in
`library.ts` and to `VideoItem` in `shared/types.ts`. Card text height is fixed
(`INFO_H`) because the virtualised grid needs constant row heights.

### Support another extension
`VIDEO_EXTS` in `src/shared/types.ts`, then a quick rescan.

## Gotchas

- **Preload must be CJS** (`preload.cjs`), same reason as the manga reader.
- **`node:sqlite`** comes with Electron's Node (24.x). Keep it in the main
  externals in `vite.config.ts`. No better-sqlite3 / native rebuilds needed.
- **ffmpeg-static / @ffprobe-installer** must stay external — they find their
  `.exe` relative to their package dir. For a packaged build, `asarUnpack` them
  (`ffmpeg.ts` already rewrites `app.asar` → `app.asar.unpacked`).
- **Single instance lock** — two instances would run two queues on one disk.
- **Dev server port is 5174** so it can run next to the manga reader (5173).
- Mouse back/forward come in as DOM `mouseup` with `button` 3/4.

## Verifying changes

```bash
npx tsc --noEmit
npx tsc --noEmit --noUnusedLocals --noUnusedParameters
npx vite build      # builds renderer + main + preload
```
Ctrl+R in the window reloads the renderer; main restarts on save in `npm run dev`.

## Ideas not done yet
- Packaged .exe (electron-builder config like the manga reader's, plus asarUnpack for ffmpeg).
- Auto-detect a re-plugged drive by volume serial instead of "Change location…".
- Hover-scrub previews (sprite sheets) — costs a lot more HDD time per file.
- Filters (resolution / length / extension chips).

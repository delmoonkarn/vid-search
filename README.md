# Vid Search (local)

A fast thumbnail browser + search for folders of videos — built for libraries on a slow external HDD. Everything stays on your disk.

It doesn't play anything itself: clicking a video opens it in your normal player (the Windows default app for that file type, or a program you pick).

What it does
- Scans your video folders once, then keeps titles, folders, sizes, lengths and thumbnails in a local cache. Browsing and searching never touch the external drive again — even works with the drive unplugged.
- Every format ffmpeg can read: mp4, mkv, avi, mov, wmv, webm, flv, ts/m2ts, mpg/vob, 3gp, ogv, rmvb, …
- Thumbnails: uses a sidecar image (`Movie.jpg`, `Movie-thumb.jpg`, yt-dlp `.webp`) or embedded cover art if present, otherwise a frame ~20% in (skips black/flat frames, tone-maps HDR, fixes anamorphic DVDs). Right-click → *pick another frame* if you don't like it.
- Whatever is on screen gets its thumbnail first; the rest fill in in the background (pausable).
- Instant search over file name + folder path. Dots/underscores/dashes don't matter (`show name s01e2` finds `Show.Name.S01E02.mkv`), `-word` excludes.
- Sort by name (natural: Ep 2 before Ep 10), folder path, date modified, date added, size, length, recently opened, random.
- Folder tree, breadcrumbs, "include subfolders", play random.
- Renamed/moved files and a drive that comes back as a different letter keep their thumbnails (Settings → *Change location…*).

Quick start
```bash
npm install
npm run dev   # or double-click run.bat
```
Then **Add folder…** and pick your video folder(s).

Shortcuts
- `Ctrl+F` or `/` — search · `Esc` — clear search
- `Alt+←` / `Backspace` / mouse back button — back
- `F5` — quick rescan
- Right-click a video — Open with…, Show in Explorer, Copy path, thumbnail options

Tech
- Electron + React + TypeScript + Vite + Tailwind
- SQLite via Node's built-in `node:sqlite` (no native modules to compile)
- ffmpeg / ffprobe from `ffmpeg-static` / `@ffprobe-installer/ffprobe`
- Row-virtualised grid (`@tanstack/react-virtual`), so 50k videos scroll fine

Data locations
- `cache/library.db` — the index (safe to delete; it'll rescan)
- `cache/thumbs/` — thumbnails (≈ 15–40 KB each)
- `userdata/` — Electron runtime data

Requirements
- Node.js 20+
- Windows (also runs on macOS/Linux for development)

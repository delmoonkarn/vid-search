import { app, BrowserWindow, protocol, screen } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { appRoot, thumbFile } from "./paths";
import { getDb, getMeta, getSettings, setMeta } from "./db";
import { registerIpc, requestScan, send, setWindow } from "./ipc";
import { initThumbs, kick } from "./thumbs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !!process.env.VITE_DEV_SERVER_URL;

// Keep all Electron-managed data inside the app folder instead of %APPDATA%.
// Must happen before app.whenReady().
{
  const root = appRoot();
  app.setPath("userData", path.join(root, "userdata"));
  app.setPath("sessionData", path.join(root, "userdata"));
  app.setPath("logs", path.join(root, "userdata", "logs"));
}

// Two instances would run two thumbnail queues against the same disk.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

protocol.registerSchemesAsPrivileged([
  { scheme: "thumb", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let mainWindow: BrowserWindow | null = null;

type Bounds = { x?: number; y?: number; width: number; height: number; maximized?: boolean };

function savedBounds(): Bounds {
  try {
    const b = JSON.parse(getMeta("window") ?? "") as Bounds;
    // Ignore positions on a monitor that's no longer attached.
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return b.x != null && b.y != null && b.x < a.x + a.width - 100 && b.x + b.width > a.x + 100 && b.y >= a.y - 10 && b.y < a.y + a.height - 100;
    });
    return visible ? b : { width: b.width, height: b.height, maximized: b.maximized };
  } catch {
    return { width: 1400, height: 880 };
  }
}

function createWindow() {
  const b = savedBounds();
  const win = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    minWidth: 760,
    minHeight: 500,
    backgroundColor: "#0a0a0a",
    autoHideMenuBar: true,
    title: "Vid Search",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  if (b.maximized) win.maximize();

  const remember = () => {
    if (win.isDestroyed() || win.isMinimized()) return;
    const n = win.getNormalBounds();
    setMeta("window", JSON.stringify({ ...n, maximized: win.isMaximized() }));
  };
  win.on("close", remember);

  if (isDev) win.loadURL(process.env.VITE_DEV_SERVER_URL!);
  else win.loadFile(path.join(__dirname, "../../dist/index.html"));

  mainWindow = win;
  setWindow(win);
  win.on("closed", () => {
    mainWindow = null;
    setWindow(null);
  });
  return win;
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  if (!gotLock) return;
  // thumb://t/<fingerprint>.jpg?v=<version> → cached JPEG on the local disk.
  protocol.handle("thumb", async (req) => {
    const m = /^\/([0-9]+-[0-9]+)\.jpg$/.exec(new URL(req.url).pathname);
    if (!m) return new Response("bad thumb url", { status: 400 });
    try {
      const data = await fs.readFile(thumbFile(m[1]));
      return new Response(data, {
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "max-age=31536000, immutable" },
      });
    } catch {
      return new Response("missing", { status: 404 });
    }
  });

  getDb();
  registerIpc();
  initThumbs(
    (u) => send("media:updated", u),
    (p) => send("thumbs:progress", p)
  );
  const win = createWindow();

  win.webContents.once("did-finish-load", () => {
    if (getSettings().scanOnStartup) requestScan(null, false, true);
    else kick();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

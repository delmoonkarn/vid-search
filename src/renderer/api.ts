import type { Api } from "../main/preload";

declare global {
  interface Window {
    api: Api;
  }
}

if (!window.api) {
  const msg =
    "window.api is undefined — Electron preload did not load. " +
    "Check the terminal running `npm run dev` for errors and verify dist-electron/preload/preload.cjs exists.";
  document.body.innerHTML = `<pre style="color:#fca5a5;background:#000;padding:24px;white-space:pre-wrap;font-family:ui-monospace,monospace;">${msg}</pre>`;
  throw new Error(msg);
}

export const api = window.api;

/** URL for a cached thumbnail. `ver` busts Chromium's image cache after a regenerate. */
export function thumbUrl(fp: string, ver: number): string {
  return `thumb://t/${fp}.jpg?v=${ver}`;
}

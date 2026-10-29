export function formatDuration(sec: number | null | undefined): string {
  if (!sec || !isFinite(sec)) return "";
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? h + ":" : ""}${mm}:${String(r).padStart(2, "0")}`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

/** "4K" / "1080p" / … from the frame size, using the short side so portrait clips still read right. */
export function resolutionLabel(w: number | null, h: number | null): string | null {
  if (!w || !h) return null;
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  if (long >= 7000) return "8K";
  if (long >= 3400 || short >= 2000) return "4K";
  if (long >= 2400 || short >= 1400) return "1440p";
  if (long >= 1800 || short >= 1000) return "1080p";
  if (long >= 1200 || short >= 700) return "720p";
  return `${short}p`;
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export const nf = new Intl.NumberFormat();

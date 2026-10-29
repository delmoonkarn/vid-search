import { useEffect, useState } from "react";
import { api } from "../api";
import { formatDate, formatSize, nf } from "../lib/format";
import { toast } from "../lib/toast";
import type { RootInfo, Settings } from "../../shared/types";
import { DriveIcon, PlusIcon, XIcon } from "./icons";

type Props = { roots: RootInfo[]; scanning: boolean; onClose: () => void; onAddRoot: () => void };

export default function SettingsDialog({ roots, scanning, onClose, onAddRoot }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [stats, setStats] = useState<{ thumbs: number; bytes: number; orphans: number } | null>(null);
  const [info, setInfo] = useState<{ cacheDir: string; binaries: { ffmpeg: boolean; ffprobe: boolean } } | null>(null);

  useEffect(() => {
    api.settings().then(setSettings);
    api.cacheStats().then(setStats);
    api.info().then(setInfo);
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const update = async (patch: Partial<Settings>) => setSettings(await api.saveSettings(patch));

  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-6" onMouseDown={onClose}>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-full overflow-y-auto rounded-lg bg-neutral-900 ring-1 ring-neutral-700 shadow-2xl"
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-neutral-800">
          <h2 className="font-semibold">Settings</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-neutral-800 text-neutral-400">
            <XIcon size={16} />
          </button>
        </div>

        <div className="p-5 space-y-7 text-sm">
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium text-neutral-200">Library folders</h3>
              <button
                onClick={onAddRoot}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-xs"
              >
                <PlusIcon size={13} /> Add folder
              </button>
            </div>
            {roots.length === 0 && <p className="text-neutral-500">No folders yet.</p>}
            <div className="space-y-2">
              {roots.map((r) => (
                <div key={r.id} className="rounded-md bg-neutral-950 ring-1 ring-neutral-800 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <DriveIcon size={15} className={r.online ? "text-emerald-400" : "text-neutral-600"} />
                    <span className="font-mono text-[13px] truncate flex-1" title={r.path}>
                      {r.path}
                    </span>
                    {!r.online && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-900/50 text-amber-200">offline</span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-neutral-500">
                    {nf.format(r.video_count)} videos · {formatSize(r.total_size)}
                    {r.last_scan ? ` · scanned ${formatDate(r.last_scan)}` : ""}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                    <SmallBtn disabled={scanning || !r.online} onClick={() => api.scan(r.id, false)}>
                      Quick rescan
                    </SmallBtn>
                    <SmallBtn
                      disabled={scanning || !r.online}
                      onClick={() => api.scan(r.id, true)}
                      title="Re-check size/date of every file (catches files replaced under the same name)"
                    >
                      Full rescan
                    </SmallBtn>
                    <SmallBtn
                      onClick={async () => {
                        const res = await api.relocateRoot(r.id);
                        if (res.error) toast(res.error, "error");
                        else if (res.ok) toast("Folder moved — thumbnails kept", "ok");
                      }}
                      title="Drive came back as a different letter, or you moved the folder"
                    >
                      Change location…
                    </SmallBtn>
                    <SmallBtn
                      danger
                      onClick={() => {
                        if (confirm(`Remove ${r.path} from the library?\n\nNothing on the drive is touched.`))
                          api.removeRoot(r.id);
                      }}
                    >
                      Remove
                    </SmallBtn>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {settings && (
            <section>
              <h3 className="font-medium text-neutral-200 mb-2">Open videos with</h3>
              <label className="flex items-center gap-2 py-1 cursor-pointer">
                <input
                  type="radio"
                  checked={settings.player == null}
                  onChange={() => update({ player: null })}
                  className="accent-indigo-500"
                />
                <span>
                  Windows default app <span className="text-neutral-500">(whatever opens videos when you double-click them)</span>
                </span>
              </label>
              <label className="flex items-center gap-2 py-1 cursor-pointer">
                <input
                  type="radio"
                  checked={settings.player != null}
                  onChange={async () => {
                    const exe = await api.pickPlayer();
                    if (exe) update({ player: exe });
                  }}
                  className="accent-indigo-500"
                />
                <span>Specific program</span>
              </label>
              {settings.player && (
                <div className="ml-6 mt-1 flex items-center gap-2">
                  <span className="font-mono text-xs text-neutral-400 truncate flex-1" title={settings.player}>
                    {settings.player}
                  </span>
                  <SmallBtn
                    onClick={async () => {
                      const exe = await api.pickPlayer();
                      if (exe) update({ player: exe });
                    }}
                  >
                    Change…
                  </SmallBtn>
                </div>
              )}
              <p className="mt-2 text-xs text-neutral-500">
                Right-click a video → <span className="text-neutral-300">Open with…</span> to pick a different app for a single file.
              </p>
            </section>
          )}

          {settings && (
            <section>
              <h3 className="font-medium text-neutral-200 mb-2">Scanning & thumbnails</h3>
              <label className="flex items-center gap-2 py-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.scanOnStartup}
                  onChange={(e) => update({ scanOnStartup: e.target.checked })}
                  className="accent-indigo-500"
                />
                <span>Quick-scan library folders when the app starts</span>
              </label>
              <div className="flex items-center gap-3 py-1">
                <span>Thumbnail jobs at once</span>
                <select
                  value={settings.workers}
                  onChange={(e) => update({ workers: +e.target.value })}
                  className="px-2 py-1 bg-neutral-950 border border-neutral-800 rounded text-xs"
                >
                  {[1, 2, 3, 4, 6].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-neutral-500">1–2 for a spinning external HDD, 4+ for SSDs</span>
              </div>
            </section>
          )}

          <section>
            <h3 className="font-medium text-neutral-200 mb-2">Cache</h3>
            <div className="text-xs text-neutral-400 space-y-1">
              <div>
                Location: <span className="font-mono text-neutral-300">{info?.cacheDir}</span>{" "}
                <button onClick={() => api.openCacheFolder()} className="text-indigo-300 hover:underline">
                  open
                </button>
              </div>
              {stats && (
                <div>
                  {nf.format(stats.thumbs)} thumbnails · {formatSize(stats.bytes)}
                  {stats.orphans > 0 && ` · ${nf.format(stats.orphans)} for files no longer in the library`}
                </div>
              )}
              {info && (!info.binaries.ffmpeg || !info.binaries.ffprobe) && (
                <div className="text-red-300">ffmpeg/ffprobe missing — run npm install again.</div>
              )}
            </div>
            {stats && stats.orphans > 0 && (
              <div className="mt-2">
                <SmallBtn
                  onClick={async () => {
                    const n = await api.pruneCache();
                    toast(`Removed ${nf.format(n)} unused thumbnails`, "ok");
                    setStats(await api.cacheStats());
                  }}
                  title="Thumbnails are kept after a file disappears so a re-plugged drive or moved folder doesn't need them again"
                >
                  Clean up unused thumbnails
                </SmallBtn>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function SmallBtn({
  children,
  onClick,
  disabled,
  danger,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`px-2 py-1 rounded ring-1 disabled:opacity-40 ${
        danger
          ? "ring-red-900 text-red-300 hover:bg-red-950"
          : "ring-neutral-700 text-neutral-300 hover:bg-neutral-800"
      }`}
    >
      {children}
    </button>
  );
}

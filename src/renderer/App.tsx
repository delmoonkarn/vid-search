import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { useStore } from "./store";
import { applyMediaUpdates } from "./lib/media";
import { nf } from "./lib/format";
import { toast } from "./lib/toast";
import type {
  FolderItem,
  ListResult,
  RootInfo,
  ScanProgress,
  ThumbProgress,
  TreeNode,
  VideoItem,
  View,
} from "../shared/types";
import Sidebar from "./components/Sidebar";
import Toolbar from "./components/Toolbar";
import Grid, { GridItem } from "./components/Grid";
import ContextMenu, { MenuItem, MenuState } from "./components/ContextMenu";
import SettingsDialog from "./components/SettingsDialog";
import Toasts from "./components/Toasts";
import { FilmIcon, PlusIcon } from "./components/icons";

// Scroll position per list (folder + sort + query), so Back lands where you were.
const offsets = new Map<string, number>();

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function App() {
  const s = useStore();
  const [roots, setRoots] = useState<RootInfo[]>([]);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [result, setResult] = useState<{ key: string; data: ListResult } | null>(null);
  const [scan, setScan] = useState<ScanProgress | null>(null);
  const [thumbs, setThumbs] = useState<ThumbProgress | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Typing stays instant; the query itself fires once you pause for a beat.
  const query = useDebounced(s.query, 120);
  const searching = query.trim().length > 0;
  const effView: View = searching && s.searchAll ? { kind: "all" } : s.view;
  const recursive = s.recursive && effView.kind === "folder";
  const key = JSON.stringify([effView, recursive, query.trim(), s.sortBy, s.sortDir, s.sortBy === "random" ? s.seed : 0]);

  const loadLibrary = useCallback(async () => {
    const [r, t] = await Promise.all([api.roots(), api.tree()]);
    setRoots(r);
    setTree(t);
    setLoaded(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .list({ view: effView, recursive, query: query.trim(), sort: s.sortBy, dir: s.sortDir, seed: s.seed })
      .then((data) => {
        if (cancelled) return;
        // The folder disappeared in a rescan (renamed/deleted on disk).
        if (effView.kind === "folder" && data.crumbs.length === 0) {
          useStore.getState().go({ kind: "all" });
          return;
        }
        setResult({ key, data });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, s.refreshKey]);

  useEffect(() => {
    loadLibrary();
    api.thumbProgress().then(setThumbs);
    api.scanStatus().then((p) => p && setScan(p));
    const offs = [
      api.onLibraryChanged(() => {
        loadLibrary();
        useStore.getState().refresh();
      }),
      api.onMediaUpdated(applyMediaUpdates),
      api.onThumbProgress(setThumbs),
      api.onScanProgress(setScan),
      api.onScanDone((d) => {
        if (d.error) toast(d.error, "error");
        else if (d.added > 0) toast(`${nf.format(d.added)} new video${d.added === 1 ? "" : "s"} in ${d.root}`, "ok");
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [loadLibrary]);

  // Keep the sidebar tree opened down to wherever we are.
  const crumbIds = result?.data.crumbs.map((c) => c.id).join(",") ?? "";
  useEffect(() => {
    const ids = crumbIds ? crumbIds.split(",").map(Number) : [];
    const st = useStore.getState();
    for (const id of ids.slice(0, -1)) if (!st.expanded[id]) st.toggleExpanded(id, true);
  }, [crumbIds]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT";
      const st = useStore.getState();
      if ((e.ctrlKey && e.key.toLowerCase() === "f") || (e.key === "/" && !typing)) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        st.goBack();
      } else if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        st.goForward();
      } else if (e.key === "Backspace" && !typing) {
        e.preventDefault();
        st.goBack();
      } else if (e.key === "F5") {
        e.preventDefault();
        api.scan(null);
      }
    };
    // Mouse side buttons.
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        useStore.getState().goBack();
      } else if (e.button === 4) {
        e.preventDefault();
        useStore.getState().goForward();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mouseup", onMouse);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mouseup", onMouse);
    };
  }, []);

  const addRoot = useCallback(async () => {
    const r = await api.addRoot();
    if (r.error) toast(r.error, "error");
  }, []);

  const openVideo = useCallback(async (v: VideoItem) => {
    toast(`Opening ${v.name}…`);
    const r = await api.open(v.id);
    if (!r.ok) toast(r.error ?? "Could not open the file", "error");
  }, []);

  const goFolder = useCallback((id: number) => useStore.getState().go({ kind: "folder", id }), []);
  const openFolder = useCallback((f: FolderItem) => goFolder(f.id), [goFolder]);

  const playRandomIn = useCallback(
    async (folderId: number) => {
      const r = await api.list({
        view: { kind: "folder", id: folderId },
        recursive: true,
        query: "",
        sort: "random",
        dir: "asc",
        seed: Math.floor(Math.random() * 1e9),
      });
      if (r.videos[0]) openVideo(r.videos[0]);
      else toast("No videos in that folder");
    },
    [openVideo]
  );

  const folderMenuItems = useCallback(
    (id: number, path?: string): MenuItem[] => [
      { label: "Open", onClick: () => goFolder(id) },
      { label: "Play random video from here", onClick: () => playRandomIn(id) },
      "sep",
      {
        label: "Show in Explorer",
        onClick: async () => {
          const err = await api.revealFolder(id);
          if (err) toast(err, "error");
        },
      },
      ...(path
        ? [
            {
              label: "Copy path",
              onClick: () => {
                api.copy(path);
                toast("Path copied");
              },
            },
          ]
        : []),
    ],
    [goFolder, playRandomIn]
  );

  const videoMenu = useCallback(
    (e: React.MouseEvent, v: VideoItem) => {
      const st = useStore.getState();
      const here = st.view.kind === "folder" && st.view.id === v.folder_id && !st.recursive && !st.query;
      const items: MenuItem[] = [
        { label: "Play", hint: "click", onClick: () => openVideo(v) },
        {
          label: "Open with…",
          hint: "pick app",
          onClick: async () => {
            const r = await api.openWith(v.id);
            if (!r.ok) toast(r.error ?? "Could not open", "error");
          },
        },
        "sep",
        { label: "Show in Explorer", onClick: () => api.reveal(v.id) },
        ...(here ? [] : [{ label: "Go to folder", onClick: () => goFolder(v.folder_id) }]),
        {
          label: "Copy path",
          onClick: () => {
            api.copy(v.path);
            toast("Path copied");
          },
        },
        {
          label: "Copy name",
          onClick: () => {
            api.copy(v.name);
            toast("Name copied");
          },
        },
        "sep",
        { label: "Thumbnail: pick another frame", onClick: () => api.regenerate(v.fp) },
        { label: "Thumbnail: automatic", onClick: () => api.autoThumb(v.fp) },
      ];
      setMenu({ x: e.clientX, y: e.clientY, items });
    },
    [openVideo, goFolder]
  );

  const folderMenu = useCallback(
    (e: React.MouseEvent, f: FolderItem) => setMenu({ x: e.clientX, y: e.clientY, items: folderMenuItems(f.id, f.path) }),
    [folderMenuItems]
  );
  const treeMenu = useCallback(
    (e: React.MouseEvent, id: number) => setMenu({ x: e.clientX, y: e.clientY, items: folderMenuItems(id) }),
    [folderMenuItems]
  );
  const closeMenu = useCallback(() => setMenu(null), []);
  // A menu belongs to the cards it was opened on.
  useEffect(() => setMenu(null), [result?.key]);

  const data = result?.data;
  const items = useMemo<GridItem[]>(
    () =>
      data
        ? [
            ...data.folders.map((f) => ({ kind: "folder" as const, f })),
            ...data.videos.map((v) => ({ kind: "video" as const, v })),
          ]
        : [],
    [data]
  );

  const totalVideos = roots.reduce((n, r) => n + r.video_count, 0);
  const showFolder = effView.kind === "all" || searching || recursive;

  const playRandom = () => {
    const vids = data?.videos ?? [];
    if (vids.length) openVideo(vids[Math.floor(Math.random() * vids.length)]);
  };

  return (
    <div className="h-screen flex bg-neutral-950 text-neutral-100">
      <Sidebar
        roots={roots}
        tree={tree}
        totalVideos={totalVideos}
        scan={scan}
        thumbs={thumbs}
        onAddRoot={addRoot}
        onSettings={() => setSettingsOpen(true)}
        onFolderMenu={treeMenu}
      />

      <main className="flex-1 min-w-0 flex flex-col">
        <Toolbar
          ref={searchRef}
          crumbs={data?.crumbs ?? []}
          videoCount={data?.videos.length ?? 0}
          folderCount={data?.folders.length ?? 0}
          totalSize={data?.totalSize ?? 0}
          libraryCount={totalVideos}
          offline={!!data?.offline}
          onPlayRandom={playRandom}
        />

        {loaded && roots.length === 0 ? (
          <Welcome onAdd={addRoot} />
        ) : result && items.length === 0 ? (
          <EmptyState
            searching={searching}
            query={query}
            inFolderScope={s.view.kind === "folder" && !s.searchAll}
            scanning={!!scan?.running}
            onSearchEverywhere={() => s.setSearchAll(true)}
          />
        ) : result ? (
          <Grid
            key={result.key}
            items={items}
            cardWidth={s.cardWidth}
            initialOffset={offsets.get(result.key) ?? 0}
            onOffset={(y) => offsets.set(result.key, y)}
            showFolder={showFolder}
            onOpenVideo={openVideo}
            onOpenFolder={openFolder}
            onVideoMenu={videoMenu}
            onFolderMenu={folderMenu}
            onGoFolder={goFolder}
          />
        ) : null}
      </main>

      {menu && <ContextMenu menu={menu} onClose={closeMenu} />}
      {settingsOpen && (
        <SettingsDialog
          roots={roots}
          scanning={!!scan?.running}
          onClose={() => setSettingsOpen(false)}
          onAddRoot={addRoot}
        />
      )}
      <Toasts />
    </div>
  );
}

function Welcome({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <div className="mx-auto w-14 h-14 rounded-xl bg-indigo-600/20 ring-1 ring-indigo-500/40 flex items-center justify-center text-indigo-300">
          <FilmIcon size={28} />
        </div>
        <h1 className="mt-5 text-xl font-semibold">Add your video folders</h1>
        <p className="mt-2 text-sm text-neutral-400 leading-relaxed">
          Vid Search reads each folder once and keeps titles, thumbnails and lengths on this PC. After that, browsing and
          searching never wait on the external drive — it only gets touched when you actually open a video, which plays in
          your normal video player.
        </p>
        <button
          onClick={onAdd}
          className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 text-sm font-medium"
        >
          <PlusIcon size={16} /> Add folder…
        </button>
      </div>
    </div>
  );
}

function EmptyState(p: {
  searching: boolean;
  query: string;
  inFolderScope: boolean;
  scanning: boolean;
  onSearchEverywhere: () => void;
}) {
  return (
    <div className="flex-1 flex items-center justify-center p-8 text-center text-sm text-neutral-500">
      {p.searching ? (
        <div>
          <div>
            Nothing matches <span className="text-neutral-200">“{p.query}”</span>
            {p.inFolderScope && " in this folder"}.
          </div>
          {p.inFolderScope && (
            <button onClick={p.onSearchEverywhere} className="mt-3 text-indigo-300 hover:underline">
              Search everywhere instead
            </button>
          )}
        </div>
      ) : p.scanning ? (
        "Scanning… videos show up here as they're found."
      ) : (
        "No videos here."
      )}
    </div>
  );
}

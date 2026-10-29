import { memo, useMemo } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { nf } from "../lib/format";
import type { RootInfo, ScanProgress, ThumbProgress, TreeNode } from "../../shared/types";
import { ChevronRight, DriveIcon, FilmIcon, FolderIcon, GearIcon, PauseIcon, PlayIcon, PlusIcon, RefreshIcon } from "./icons";

type Props = {
  roots: RootInfo[];
  tree: TreeNode[];
  totalVideos: number;
  scan: ScanProgress | null;
  thumbs: ThumbProgress | null;
  onAddRoot: () => void;
  onSettings: () => void;
  onFolderMenu: (e: React.MouseEvent, id: number) => void;
};

export default function Sidebar(p: Props) {
  const view = useStore((s) => s.view);
  const go = useStore((s) => s.go);
  const query = useStore((s) => s.query);
  const searchAll = useStore((s) => s.searchAll);

  const children = useMemo(() => {
    const m = new Map<number, TreeNode[]>();
    for (const n of p.tree) {
      if (n.parent_id == null) continue;
      const l = m.get(n.parent_id);
      if (l) l.push(n);
      else m.set(n.parent_id, [n]);
    }
    return m;
  }, [p.tree]);
  const byId = useMemo(() => new Map(p.tree.map((n) => [n.id, n])), [p.tree]);

  const allActive = view.kind === "all" || (!!query && searchAll);
  const activeId = !allActive && view.kind === "folder" ? view.id : null;

  return (
    <aside className="w-64 shrink-0 flex flex-col border-r border-neutral-900 bg-[#0e0e0e]">
      <div className="px-4 pt-4 pb-3 flex items-center gap-2">
        <div className="w-7 h-7 rounded-md bg-indigo-600 flex items-center justify-center">
          <FilmIcon size={16} className="text-white" />
        </div>
        <div className="font-semibold tracking-tight">Vid Search</div>
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 text-sm">
        <button
          onClick={() => go({ kind: "all" })}
          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded ${
            allActive ? "bg-indigo-600/20 text-indigo-100" : "text-neutral-300 hover:bg-neutral-800/70"
          }`}
        >
          <FilmIcon size={15} className="shrink-0 text-indigo-300" />
          <span className="flex-1 text-left">All videos</span>
          <span className="text-xs text-neutral-500 tabular-nums">{nf.format(p.totalVideos)}</span>
        </button>

        <div className="mt-4 mb-1 px-2 flex items-center justify-between text-[11px] uppercase tracking-wider text-neutral-500">
          <span>Library folders</span>
          <button onClick={p.onAddRoot} title="Add a folder" className="p-0.5 rounded hover:bg-neutral-800 hover:text-neutral-200">
            <PlusIcon size={14} />
          </button>
        </div>

        {p.roots.map((r) => {
          const node = r.folder_id != null ? byId.get(r.folder_id) : undefined;
          return (
            <div key={r.id} className="mb-1">
              {node ? (
                <TreeRow
                  node={node}
                  depth={0}
                  isRoot
                  offline={!r.online}
                  childMap={children}
                  activeId={activeId}
                  onMenu={p.onFolderMenu}
                />
              ) : (
                <div className="flex items-center gap-2 px-2 py-1.5 text-neutral-500" title={r.path}>
                  <DriveIcon size={15} className="shrink-0" />
                  <span className="truncate flex-1">{r.path}</span>
                  <span className="text-[10px]">{r.online ? (p.scan?.running ? "scanning…" : "empty") : "offline"}</span>
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <StatusPanel scan={p.scan} thumbs={p.thumbs} />

      <div className="border-t border-neutral-900 p-2 flex gap-1">
        <button
          onClick={p.onSettings}
          className="flex-1 flex items-center gap-2 px-2 py-1.5 rounded text-sm text-neutral-300 hover:bg-neutral-800"
        >
          <GearIcon size={15} /> Settings
        </button>
        <button
          onClick={() => api.scan(null)}
          disabled={!!p.scan?.running}
          title="Quick rescan all folders (F5)"
          className="px-2 py-1.5 rounded text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
        >
          <RefreshIcon size={15} className={p.scan?.running ? "animate-spin" : ""} />
        </button>
      </div>
    </aside>
  );
}

type RowProps = {
  node: TreeNode;
  depth: number;
  isRoot?: boolean;
  offline?: boolean;
  childMap: Map<number, TreeNode[]>;
  activeId: number | null;
  onMenu: (e: React.MouseEvent, id: number) => void;
};

const TreeRow = memo(function TreeRow({ node, depth, isRoot, offline, childMap, activeId, onMenu }: RowProps) {
  const go = useStore((s) => s.go);
  const open = useStore((s) => !!s.expanded[node.id]);
  const toggle = useStore((s) => s.toggleExpanded);
  const kids = childMap.get(node.id) ?? [];
  const active = activeId === node.id;
  return (
    <>
      <div
        onClick={() => go({ kind: "folder", id: node.id })}
        onContextMenu={(e) => {
          e.preventDefault();
          onMenu(e, node.id);
        }}
        title={node.path}
        className={`group flex items-center gap-1 pr-2 py-1 rounded cursor-pointer ${
          active ? "bg-indigo-600/25 text-indigo-50" : "text-neutral-300 hover:bg-neutral-800/70"
        } ${offline ? "opacity-60" : ""}`}
        style={{ paddingLeft: 4 + depth * 14 }}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggle(node.id);
          }}
          className={`w-4 h-4 shrink-0 flex items-center justify-center rounded hover:bg-neutral-700 ${
            kids.length ? "" : "invisible"
          }`}
        >
          <ChevronRight size={12} className={`transition-transform ${open ? "rotate-90" : ""}`} />
        </button>
        {isRoot ? (
          <DriveIcon size={14} className="shrink-0 text-neutral-400" />
        ) : (
          <FolderIcon size={14} className="shrink-0 text-amber-300/80" />
        )}
        <span className="truncate flex-1 ml-1">{node.name}</span>
        {offline && <span className="text-[10px] px-1 rounded bg-neutral-800 text-neutral-400">offline</span>}
        <span className="text-[11px] text-neutral-500 tabular-nums">{nf.format(node.total_count)}</span>
      </div>
      {open &&
        kids.map((k) => (
          <TreeRow key={k.id} node={k} depth={depth + 1} childMap={childMap} activeId={activeId} onMenu={onMenu} />
        ))}
    </>
  );
});

function StatusPanel({ scan, thumbs }: { scan: ScanProgress | null; thumbs: ThumbProgress | null }) {
  const scanning = !!scan?.running;
  const total = thumbs ? thumbs.done + thumbs.pending : 0;
  const pct = total > 0 ? Math.round((thumbs!.done / total) * 100) : 100;
  if (!scanning && (!thumbs || (thumbs.pending === 0 && thumbs.failed === 0))) {
    return thumbs && thumbs.done > 0 ? (
      <div className="px-4 py-2 text-xs text-neutral-500 border-t border-neutral-900">All thumbnails ready</div>
    ) : null;
  }
  return (
    <div className="px-3 py-2.5 border-t border-neutral-900 text-xs space-y-2">
      {scanning && (
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-neutral-300">
            <RefreshIcon size={12} className="animate-spin shrink-0" />
            <span className="truncate">Scanning {scan!.root}</span>
          </div>
          <div className="mt-0.5 text-neutral-500 tabular-nums">
            {nf.format(scan!.files)} videos · {nf.format(scan!.dirs)} folders
            {scan!.added > 0 && <span className="text-emerald-400"> · {nf.format(scan!.added)} new</span>}
          </div>
          <div className="text-neutral-600 truncate" title={scan!.current}>
            {scan!.current}
          </div>
        </div>
      )}
      {thumbs && thumbs.pending > 0 && (
        <div>
          <div className="flex items-center gap-2 text-neutral-300">
            <span className="flex-1">
              Thumbnails{" "}
              <span className="text-neutral-500 tabular-nums">
                {nf.format(thumbs.done)} / {nf.format(total)}
              </span>
            </span>
            <button
              onClick={() => api.pauseThumbs(!thumbs.paused)}
              title={thumbs.paused ? "Resume" : "Pause (frees up the drive)"}
              className="p-1 rounded hover:bg-neutral-800"
            >
              {thumbs.paused ? <PlayIcon size={11} /> : <PauseIcon size={12} />}
            </button>
          </div>
          <div className="mt-1 h-1 rounded bg-neutral-800 overflow-hidden">
            <div className={`h-full ${thumbs.paused ? "bg-neutral-500" : "bg-indigo-500"}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 text-neutral-600 truncate">
            {thumbs.paused
              ? "Paused"
              : thumbs.waitingForScan
                ? "On-screen only until the scan finishes"
                : (thumbs.current ?? "")}
          </div>
        </div>
      )}
      {thumbs && thumbs.failed > 0 && (
        <div className="flex items-center justify-between text-neutral-500">
          <span>{nf.format(thumbs.failed)} without preview</span>
          <button onClick={() => api.retryFailed()} className="text-indigo-300 hover:underline">
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

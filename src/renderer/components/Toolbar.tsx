import { forwardRef } from "react";
import { useStore } from "../store";
import { formatSize, nf } from "../lib/format";
import type { Crumb, SortBy } from "../../shared/types";
import { ArrowUpDown, ChevronLeft, ChevronRight, GridIcon, LayersIcon, SearchIcon, ShuffleIcon, XIcon } from "./icons";

const SORTS: { value: SortBy; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "path", label: "Folder path" },
  { value: "mtime", label: "Date modified" },
  { value: "added", label: "Date added" },
  { value: "size", label: "File size" },
  { value: "duration", label: "Length" },
  { value: "opened", label: "Recently opened" },
  { value: "random", label: "Random" },
];

// Sensible first direction when switching sort: newest / biggest / longest first.
const DEFAULT_DIR: Record<SortBy, "asc" | "desc"> = {
  name: "asc",
  path: "asc",
  mtime: "desc",
  added: "desc",
  size: "desc",
  duration: "desc",
  opened: "desc",
  random: "asc",
};

type Props = {
  crumbs: Crumb[];
  videoCount: number;
  folderCount: number;
  totalSize: number;
  libraryCount: number;
  offline: boolean;
  onPlayRandom: () => void;
};

const Toolbar = forwardRef<HTMLInputElement, Props>(function Toolbar(p, searchRef) {
  const s = useStore();
  const inFolder = s.view.kind === "folder";
  const searching = s.query.trim().length > 0;
  const scopeAll = !inFolder || s.searchAll;

  const title =
    searching && scopeAll ? "Search results" : s.view.kind === "all" ? "All videos" : (p.crumbs.at(-1)?.name ?? "Folder");

  return (
    <header className="shrink-0 border-b border-neutral-900 bg-neutral-950/95 px-4 pt-3 pb-2.5 space-y-2.5">
      <div className="flex items-center gap-2">
        <div className="flex">
          <IconBtn title="Back (Alt+←, mouse back)" disabled={!s.back.length && !s.query} onClick={s.goBack}>
            <ChevronLeft size={16} />
          </IconBtn>
          <IconBtn title="Forward (Alt+→)" disabled={!s.forward.length} onClick={s.goForward}>
            <ChevronRight size={16} />
          </IconBtn>
        </div>

        <div className="relative flex-1 max-w-2xl">
          <SearchIcon size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
          <input
            ref={searchRef}
            value={s.query}
            onChange={(e) => s.setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                if (s.query) s.setQuery("");
                else e.currentTarget.blur();
              }
            }}
            placeholder={`Search ${scopeAll ? `${nf.format(p.libraryCount)} videos` : "this folder"}…  (Ctrl+F)`}
            spellCheck={false}
            className="w-full pl-8 pr-8 py-1.5 bg-neutral-900 border border-neutral-800 rounded-md text-sm placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
          />
          {s.query && (
            <button
              onClick={() => s.setQuery("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-neutral-500 hover:text-neutral-200"
              title="Clear (Esc)"
            >
              <XIcon size={13} />
            </button>
          )}
        </div>

        {inFolder && (
          <div className="flex rounded-md ring-1 ring-neutral-800 text-xs overflow-hidden" title="Where to search">
            <button
              onClick={() => s.setSearchAll(false)}
              className={`px-2 py-1.5 ${!s.searchAll ? "bg-neutral-800 text-neutral-100" : "text-neutral-500 hover:text-neutral-300"}`}
            >
              This folder
            </button>
            <button
              onClick={() => s.setSearchAll(true)}
              className={`px-2 py-1.5 ${s.searchAll ? "bg-neutral-800 text-neutral-100" : "text-neutral-500 hover:text-neutral-300"}`}
            >
              Everywhere
            </button>
          </div>
        )}

        <div className="flex items-center gap-1 ml-auto">
          <select
            value={s.sortBy}
            onChange={(e) => {
              const by = e.target.value as SortBy;
              s.setSort(by, DEFAULT_DIR[by]);
            }}
            title="Sort"
            className="px-2 py-1.5 bg-neutral-900 border border-neutral-800 rounded-md text-xs text-neutral-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {SORTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {s.sortBy === "random" ? (
            <IconBtn title="Shuffle again" onClick={s.reshuffle}>
              <ShuffleIcon size={15} />
            </IconBtn>
          ) : (
            <IconBtn
              title={s.sortDir === "asc" ? "Ascending" : "Descending"}
              onClick={() => s.setSort(s.sortBy, s.sortDir === "asc" ? "desc" : "asc")}
            >
              <ArrowUpDown dir={s.sortDir} size={15} />
            </IconBtn>
          )}
        </div>

        <label className="hidden lg:flex items-center gap-1.5 text-neutral-500" title="Card size">
          <GridIcon size={13} />
          <input
            type="range"
            min={150}
            max={460}
            step={10}
            value={s.cardWidth}
            onChange={(e) => s.setCardWidth(+e.target.value)}
            className="vs-range w-24"
          />
        </label>

        <button
          onClick={p.onPlayRandom}
          disabled={p.videoCount === 0}
          title="Play a random video from this view"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-xs font-medium"
        >
          <ShuffleIcon size={13} /> Random
        </button>
      </div>

      <div className="flex items-center gap-3 min-w-0 text-sm">
        <div className="flex items-center gap-1 min-w-0 flex-1">
          {inFolder && !(searching && s.searchAll) ? (
            p.crumbs.map((c, i) => (
              <span key={c.id} className="flex items-center gap-1 min-w-0">
                {i > 0 && <ChevronRight size={12} className="shrink-0 text-neutral-600" />}
                <button
                  onClick={() => s.go({ kind: "folder", id: c.id })}
                  className={`truncate max-w-[16rem] hover:text-indigo-300 ${
                    i === p.crumbs.length - 1 ? "text-neutral-100 font-medium" : "text-neutral-400"
                  }`}
                  title={c.name}
                >
                  {c.name}
                </button>
              </span>
            ))
          ) : (
            <span className="font-medium text-neutral-100">{title}</span>
          )}
          {p.offline && (
            <span
              className="ml-2 shrink-0 text-[11px] px-1.5 py-0.5 rounded bg-amber-900/50 text-amber-200"
              title="Browsing the cached library. Connect the drive to open videos."
            >
              drive offline
            </span>
          )}
        </div>

        {inFolder && !searching && (
          <button
            onClick={() => s.setRecursive(!s.recursive)}
            title="Show every video under this folder in one list"
            className={`shrink-0 flex items-center gap-1.5 px-2 py-0.5 rounded text-xs ring-1 ${
              s.recursive ? "bg-indigo-600/25 ring-indigo-500/60 text-indigo-100" : "ring-neutral-800 text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <LayersIcon size={12} /> Include subfolders
          </button>
        )}

        <div className="shrink-0 text-xs text-neutral-500 tabular-nums">
          {p.folderCount > 0 && `${nf.format(p.folderCount)} folder${p.folderCount === 1 ? "" : "s"} · `}
          {nf.format(p.videoCount)} video{p.videoCount === 1 ? "" : "s"}
          {p.totalSize > 0 && ` · ${formatSize(p.totalSize)}`}
        </div>
      </div>
    </header>
  );
});

export default Toolbar;

function IconBtn({
  children,
  onClick,
  title,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

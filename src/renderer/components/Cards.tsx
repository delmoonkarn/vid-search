import { memo, useState } from "react";
import { thumbUrl } from "../api";
import { useMedia } from "../lib/media";
import { formatDuration, formatSize, nf, resolutionLabel } from "../lib/format";
import type { FolderItem, ThumbState, VideoItem } from "../../shared/types";
import { FilmIcon, FolderIcon, PlayIcon } from "./icons";

/** Height of the text block under each thumbnail. The grid relies on it being fixed. */
export const INFO_H = 66;

function Thumb({ fp, state, ver, label }: { fp: string | null; state: ThumbState; ver: number; label: string }) {
  const [contain, setContain] = useState(false);
  if (!fp || state !== 1) {
    return (
      <div
        className={`absolute inset-0 flex flex-col items-center justify-center gap-1 text-neutral-600 ${
          state === 0 && fp ? "vs-shimmer" : "bg-neutral-900"
        }`}
      >
        <FilmIcon size={22} />
        <span className="text-[10px] uppercase tracking-wider">{state === -1 ? `${label} · no preview` : label}</span>
      </div>
    );
  }
  const url = thumbUrl(fp, ver);
  return (
    <>
      {contain && (
        <img src={url} aria-hidden className="absolute inset-0 w-full h-full object-cover blur-xl scale-125 opacity-40" />
      )}
      <img
        src={url}
        decoding="async"
        draggable={false}
        onLoad={(e) => {
          const i = e.currentTarget;
          // Portrait posters / 4:3 / ultrawide frames: show whole image over a blurred fill.
          setContain(Math.abs(i.naturalWidth / i.naturalHeight - 16 / 9) > 0.2);
        }}
        className={`absolute inset-0 w-full h-full ${contain ? "object-contain" : "object-cover"} transition-transform duration-300 group-hover:scale-[1.04]`}
      />
    </>
  );
}

type VideoCardProps = {
  v: VideoItem;
  showFolder: boolean;
  onOpen: (v: VideoItem) => void;
  onMenu: (e: React.MouseEvent, v: VideoItem) => void;
  onFolder: (folderId: number) => void;
};

export const VideoCard = memo(function VideoCard({ v, showFolder, onOpen, onMenu, onFolder }: VideoCardProps) {
  const m = useMedia(v.fp, v);
  const res = resolutionLabel(m.width, m.height);
  const dur = formatDuration(m.duration);
  return (
    <div
      className="group min-w-0"
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e, v);
      }}
    >
      <button
        onClick={() => onOpen(v)}
        title={v.path}
        className="relative block w-full aspect-video rounded-md overflow-hidden bg-neutral-900 ring-1 ring-neutral-800 hover:ring-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 transition"
      >
        <Thumb fp={v.fp} state={m.thumb} ver={m.thumb_ver} label={v.ext} />
        {res && <span className="vs-badge absolute top-1.5 left-1.5">{res}</span>}
        {dur && <span className="vs-badge absolute bottom-1.5 right-1.5">{dur}</span>}
        {v.opened_at && (
          <span className="absolute bottom-0 left-0 h-0.5 w-full bg-indigo-500/70" title="Opened from Vid Search before" />
        )}
        <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition bg-black/25">
          <span className="w-11 h-11 rounded-full bg-black/60 ring-1 ring-white/20 flex items-center justify-center text-white">
            <PlayIcon size={20} className="ml-0.5" />
          </span>
        </span>
      </button>
      <div className="pt-2" style={{ height: INFO_H }}>
        <div className="text-[13px] leading-5 text-neutral-100 line-clamp-2 break-words" title={v.name}>
          {v.name}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs leading-4 text-neutral-500 min-w-0">
          {showFolder ? (
            <button
              onClick={() => onFolder(v.folder_id)}
              className="flex items-center gap-1 min-w-0 hover:text-indigo-300"
              title={`Go to folder: ${v.folder}`}
            >
              <FolderIcon size={12} className="shrink-0" />
              <span className="truncate">{v.folder}</span>
            </button>
          ) : (
            <span className="uppercase">{v.ext}</span>
          )}
          <span className="ml-auto shrink-0 tabular-nums">{formatSize(v.size)}</span>
        </div>
      </div>
    </div>
  );
});

type FolderCardProps = {
  f: FolderItem;
  onOpen: (f: FolderItem) => void;
  onMenu: (e: React.MouseEvent, f: FolderItem) => void;
};

export const FolderCard = memo(function FolderCard({ f, onOpen, onMenu }: FolderCardProps) {
  const m = useMedia(f.cover_fp, {
    thumb: f.cover_thumb,
    thumb_ver: f.cover_ver,
    duration: null,
    width: null,
    height: null,
  });
  return (
    <div
      className="group min-w-0"
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e, f);
      }}
    >
      <button
        onClick={() => onOpen(f)}
        title={f.path}
        className="relative block w-full aspect-video focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded-md"
      >
        {/* stacked sheets so folders read differently from videos at a glance */}
        <span className="absolute inset-x-4 top-0 bottom-3 rounded-md bg-neutral-800/70" />
        <span className="absolute inset-x-2 top-1 bottom-1.5 rounded-md bg-neutral-800" />
        <span className="absolute inset-x-0 top-2 bottom-0 rounded-md overflow-hidden bg-neutral-900 ring-1 ring-neutral-700 group-hover:ring-amber-400 transition">
          <Thumb fp={f.cover_fp} state={m.thumb} ver={m.thumb_ver} label="folder" />
          <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
          <span className="absolute bottom-1.5 left-2 flex items-center gap-1.5 text-xs font-medium text-amber-100">
            <FolderIcon size={14} className="text-amber-300" />
            {nf.format(f.total_count)} video{f.total_count === 1 ? "" : "s"}
          </span>
        </span>
      </button>
      <div className="pt-2" style={{ height: INFO_H }}>
        <div className="text-[13px] leading-5 font-medium text-amber-50 line-clamp-2 break-words" title={f.name}>
          {f.name}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs leading-4 text-neutral-500">
          {f.sub_count > 0 && (
            <span>
              {f.sub_count} folder{f.sub_count === 1 ? "" : "s"}
            </span>
          )}
          <span className="ml-auto tabular-nums">{formatSize(f.total_size)}</span>
        </div>
      </div>
    </div>
  );
});

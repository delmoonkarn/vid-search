import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { api } from "../api";
import { thumbStateOf } from "../lib/media";
import type { FolderItem, VideoItem } from "../../shared/types";
import { FolderCard, INFO_H, VideoCard } from "./Cards";

export type GridItem = { kind: "folder"; f: FolderItem } | { kind: "video"; v: VideoItem };

const PAD = 16;
const GAP = 14;

type Props = {
  items: GridItem[];
  cardWidth: number;
  initialOffset: number;
  onOffset: (y: number) => void;
  showFolder: boolean;
  onOpenVideo: (v: VideoItem) => void;
  onOpenFolder: (f: FolderItem) => void;
  onVideoMenu: (e: React.MouseEvent, v: VideoItem) => void;
  onFolderMenu: (e: React.MouseEvent, f: FolderItem) => void;
  onGoFolder: (id: number) => void;
};

/**
 * Row-virtualised card grid: only the rows on screen (plus a few) exist in
 * the DOM, so 50k videos scroll as smoothly as 50. Whatever is on screen is
 * also sent to the thumbnail queue as top priority.
 */
export default function Grid(p: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current!;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const inner = Math.max(0, width - PAD * 2);
  const cols = Math.max(1, Math.floor((inner + GAP) / (p.cardWidth + GAP)));
  const cw = (inner - GAP * (cols - 1)) / cols;
  const rowH = Math.round((cw * 9) / 16) + INFO_H + GAP;
  const rowCount = Math.ceil(p.items.length / cols);

  const v = useVirtualizer({
    count: rowCount,
    getScrollElement: () => ref.current,
    estimateSize: () => rowH,
    overscan: 3,
    paddingStart: PAD,
    paddingEnd: PAD,
  });

  useEffect(() => {
    v.measure();
  }, [rowH, cols, v]);

  // Restore the scroll position once real widths are known.
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (restored.current || width === 0) return;
    restored.current = true;
    if (p.initialOffset > 0 && ref.current) ref.current.scrollTop = p.initialOffset;
  }, [width, p.initialOffset]);

  const rows = v.getVirtualItems();
  const first = rows[0]?.index ?? 0;
  const last = rows[rows.length - 1]?.index ?? -1;

  // Ask the main process to do visible thumbnails first.
  const items = p.items;
  const visibleKey = `${first}:${last}:${cols}:${items.length}`;
  useEffect(() => {
    const t = setTimeout(() => {
      const fps: string[] = [];
      for (let i = first * cols; i < Math.min(items.length, (last + 1) * cols); i++) {
        const it = items[i];
        if (it.kind === "video") {
          if (thumbStateOf(it.v.fp, it.v.thumb) === 0) fps.push(it.v.fp);
        } else if (it.f.cover_fp && thumbStateOf(it.f.cover_fp, it.f.cover_thumb) === 0) {
          fps.push(it.f.cover_fp);
        }
      }
      if (fps.length) void api.prioritize(fps);
    }, 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey, items]);

  const gridStyle = useMemo(() => ({ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: GAP }), [cols]);

  return (
    <div ref={ref} className="flex-1 min-h-0 overflow-y-auto" onScroll={(e) => p.onOffset(e.currentTarget.scrollTop)}>
      <div style={{ height: v.getTotalSize(), position: "relative" }}>
        {rows.map((row) => (
          <div
            key={row.key}
            className="grid absolute"
            style={{ ...gridStyle, top: row.start, left: PAD, right: PAD, height: rowH - GAP }}
          >
            {items.slice(row.index * cols, row.index * cols + cols).map((it) =>
              it.kind === "video" ? (
                <VideoCard
                  key={`v${it.v.id}`}
                  v={it.v}
                  showFolder={p.showFolder}
                  onOpen={p.onOpenVideo}
                  onMenu={p.onVideoMenu}
                  onFolder={p.onGoFolder}
                />
              ) : (
                <FolderCard key={`f${it.f.id}`} f={it.f} onOpen={p.onOpenFolder} onMenu={p.onFolderMenu} />
              )
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

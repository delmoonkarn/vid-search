import { useCallback, useSyncExternalStore } from "react";
import type { MediaUpdate, ThumbState } from "../../shared/types";

/**
 * Live thumbnail / probe info keyed by fingerprint. The list query gives each
 * card its starting values; updates pushed from the thumbnail queue land here
 * and only the cards showing that fingerprint re-render.
 */
type Info = { thumb: ThumbState; thumb_ver: number; duration: number | null; width: number | null; height: number | null };

const map = new Map<string, Info>();
const listeners = new Map<string, Set<() => void>>();

export function applyMediaUpdates(list: MediaUpdate[]) {
  for (const u of list) {
    map.set(u.fp, { thumb: u.thumb, thumb_ver: u.thumb_ver, duration: u.duration, width: u.width, height: u.height });
    listeners.get(u.fp)?.forEach((l) => l());
  }
}

export function useMedia(fp: string | null, fallback: Info): Info {
  const subscribe = useCallback(
    (cb: () => void) => {
      if (!fp) return () => {};
      let set = listeners.get(fp);
      if (!set) listeners.set(fp, (set = new Set()));
      set.add(cb);
      return () => {
        set!.delete(cb);
        if (set!.size === 0) listeners.delete(fp);
      };
    },
    [fp]
  );
  const info = useSyncExternalStore(subscribe, () => (fp ? map.get(fp) : undefined));
  // A fresh list query is newer than an old pushed update only if its version is higher.
  if (!info || fallback.thumb_ver > info.thumb_ver) return fallback;
  return info;
}

/** Current known thumb state, for deciding what to prioritise. */
export function thumbStateOf(fp: string, fallback: ThumbState): ThumbState {
  return map.get(fp)?.thumb ?? fallback;
}

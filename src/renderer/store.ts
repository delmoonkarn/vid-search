import { create } from "zustand";
import type { SortBy, SortDir, View } from "../shared/types";

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
function save(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

export const sameView = (a: View, b: View) =>
  a.kind === b.kind && (a.kind === "all" || (b.kind === "folder" && a.id === b.id));

type State = {
  view: View;
  back: View[];
  forward: View[];
  query: string;
  /** Search the whole library (true) or only inside the current folder. */
  searchAll: boolean;
  recursive: boolean;
  sortBy: SortBy;
  sortDir: SortDir;
  seed: number;
  cardWidth: number;
  /** Bumped to force a re-query (scan finished, settings changed…). */
  refreshKey: number;
  expanded: Record<number, boolean>;

  go: (v: View) => void;
  goBack: () => void;
  goForward: () => void;
  setQuery: (q: string) => void;
  setSearchAll: (v: boolean) => void;
  setRecursive: (v: boolean) => void;
  setSort: (by: SortBy, dir: SortDir) => void;
  reshuffle: () => void;
  setCardWidth: (w: number) => void;
  refresh: () => void;
  toggleExpanded: (id: number, open?: boolean) => void;
};

export const useStore = create<State>((set, get) => ({
  view: load<View>("view", { kind: "all" }),
  back: [],
  forward: [],
  query: "",
  searchAll: load("searchAll", true),
  recursive: load("recursive", false),
  sortBy: load<SortBy>("sortBy", "name"),
  sortDir: load<SortDir>("sortDir", "asc"),
  seed: Math.floor(Math.random() * 1e9),
  cardWidth: load("cardWidth", 240),
  refreshKey: 0,
  expanded: load<Record<number, boolean>>("expanded", {}),

  go: (v) => {
    const s = get();
    if (sameView(v, s.view) && !s.query) return;
    save("view", v);
    set({ view: v, back: [...s.back, s.view].slice(-100), forward: [], query: "" });
  },
  goBack: () => {
    const s = get();
    if (s.query) return set({ query: "" });
    const prev = s.back[s.back.length - 1];
    if (!prev) return;
    save("view", prev);
    set({ view: prev, back: s.back.slice(0, -1), forward: [s.view, ...s.forward] });
  },
  goForward: () => {
    const s = get();
    const next = s.forward[0];
    if (!next) return;
    save("view", next);
    set({ view: next, back: [...s.back, s.view], forward: s.forward.slice(1) });
  },
  setQuery: (q) => set({ query: q }),
  setSearchAll: (v) => {
    save("searchAll", v);
    set({ searchAll: v });
  },
  setRecursive: (v) => {
    save("recursive", v);
    set({ recursive: v });
  },
  setSort: (by, dir) => {
    save("sortBy", by);
    save("sortDir", dir);
    set({ sortBy: by, sortDir: dir, seed: by === "random" ? Math.floor(Math.random() * 1e9) : get().seed });
  },
  reshuffle: () => set({ seed: Math.floor(Math.random() * 1e9) }),
  setCardWidth: (w) => {
    save("cardWidth", w);
    set({ cardWidth: w });
  },
  refresh: () => set((s) => ({ refreshKey: s.refreshKey + 1 })),
  toggleExpanded: (id, open) =>
    set((s) => {
      const expanded = { ...s.expanded, [id]: open ?? !s.expanded[id] };
      save("expanded", expanded);
      return { expanded };
    }),
}));

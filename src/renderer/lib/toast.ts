import { create } from "zustand";

export type Toast = { id: number; text: string; kind: "info" | "error" | "ok" };

type ToastState = { toasts: Toast[]; push: (text: string, kind?: Toast["kind"]) => void; dismiss: (id: number) => void };

let nextId = 1;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (text, kind = "info") => {
    const id = nextId++;
    set({ toasts: [...get().toasts.slice(-3), { id, text, kind }] });
    setTimeout(() => get().dismiss(id), kind === "error" ? 6000 : 3000);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = (text: string, kind?: Toast["kind"]) => useToasts.getState().push(text, kind);

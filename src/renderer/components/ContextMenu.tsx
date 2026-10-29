import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type MenuItem = { label: string; onClick: () => void; hint?: string; danger?: boolean } | "sep";
export type MenuState = { x: number; y: number; items: MenuItem[] };

export default function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y });

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.min(menu.x, window.innerWidth - r.width - 6),
      top: Math.min(menu.y, window.innerHeight - r.height - 6),
    });
  }, [menu]);

  useEffect(() => {
    const close = (e: Event) => {
      if (e instanceof MouseEvent && ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", close, true);
    window.addEventListener("wheel", close, true);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", close, true);
      window.removeEventListener("wheel", close, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={pos}
      className="fixed z-50 min-w-[210px] py-1 rounded-md bg-neutral-900 ring-1 ring-neutral-700 shadow-2xl text-sm"
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.items.map((it, i) =>
        it === "sep" ? (
          <div key={i} className="my-1 h-px bg-neutral-800" />
        ) : (
          <button
            key={i}
            onClick={() => {
              onClose();
              it.onClick();
            }}
            className={`w-full flex items-center justify-between gap-6 px-3 py-1.5 text-left hover:bg-indigo-600 hover:text-white ${
              it.danger ? "text-red-300" : "text-neutral-200"
            }`}
          >
            <span>{it.label}</span>
            {it.hint && <span className="text-xs text-neutral-500">{it.hint}</span>}
          </button>
        )
      )}
    </div>
  );
}

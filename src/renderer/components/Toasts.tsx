import { useToasts } from "../lib/toast";

export default function Toasts() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 items-end pointer-events-none">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={`pointer-events-auto max-w-md text-left px-3.5 py-2 rounded-md text-sm shadow-lg ring-1 ${
            t.kind === "error"
              ? "bg-red-950 text-red-100 ring-red-800"
              : t.kind === "ok"
                ? "bg-emerald-950 text-emerald-100 ring-emerald-800"
                : "bg-neutral-900 text-neutral-100 ring-neutral-700"
          }`}
        >
          {t.text}
        </button>
      ))}
    </div>
  );
}

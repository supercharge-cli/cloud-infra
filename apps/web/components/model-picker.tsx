"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CatalogModel } from "@/lib/provider-defaults";

type Props = {
  value: string;
  options: CatalogModel[];
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
};

function matches(model: CatalogModel, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    model.name.toLowerCase().includes(q) ||
    model.id.toLowerCase().includes(q)
  );
}

export function ModelPicker({
  value,
  options,
  onChange,
  placeholder = "Search models by name…",
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const selected = options.find((m) => m.id === value);

  const filtered = useMemo(() => {
    const hits = options.filter((m) => matches(m, query));
    if (
      query.trim() &&
      !hits.some((m) => m.id.toLowerCase() === query.trim().toLowerCase())
    ) {
      return [
        ...hits,
        { id: query.trim(), name: `Use “${query.trim()}”` },
      ].slice(0, 80);
    }
    return hits.slice(0, 80);
  }, [options, query]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  function pick(id: string) {
    onChange(id);
    setQuery("");
    setOpen(false);
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen(true);
          setQuery("");
        }}
        className="field flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="min-w-0 flex-1 truncate">
          {selected ? (
            <>
              <span className="text-zinc-100">{selected.name}</span>
              {selected.name !== selected.id ? (
                <span className="ml-2 font-mono text-[11px] text-zinc-500">
                  {selected.id}
                </span>
              ) : null}
            </>
          ) : value ? (
            <span className="font-mono text-zinc-200">{value}</span>
          ) : (
            <span className="text-zinc-500">{placeholder}</span>
          )}
        </span>
        <span className="text-zinc-500">▾</span>
      </button>
      {open ? (
        <div className="absolute z-40 mt-1 w-full overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-xl">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlight((i) => Math.min(i + 1, Math.max(0, filtered.length - 1)));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlight((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const hit = filtered[highlight];
                if (hit) pick(hit.id);
                else if (query.trim()) pick(query.trim());
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
            placeholder={
              options.length
                ? `Search ${options.length} models…`
                : "Type a model id"
            }
            className="w-full border-b border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none"
          />
          <ul className="max-h-72 overflow-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-4 text-center text-xs text-zinc-500">
                No matches. Type an id and press Enter.
              </li>
            ) : (
              filtered.map((model, i) => {
                const active = i === highlight;
                const current = model.id === value;
                return (
                  <li key={`${model.id}-${i}`}>
                    <button
                      type="button"
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => pick(model.id)}
                      className={`flex w-full flex-col items-start px-3 py-2 text-left ${
                        active ? "bg-zinc-800" : "hover:bg-zinc-900"
                      }`}
                    >
                      <span className="flex w-full items-center gap-2">
                        <span className="truncate text-sm text-zinc-100">
                          {model.name}
                        </span>
                        {current ? (
                          <span className="rounded bg-emerald-950 px-1.5 py-0.5 text-[10px] text-emerald-400">
                            selected
                          </span>
                        ) : null}
                      </span>
                      {model.name !== model.id ? (
                        <span className="truncate font-mono text-[11px] text-zinc-500">
                          {model.id}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

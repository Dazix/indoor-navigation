import { DoorOpen, MapPin, Search, X } from 'lucide-react';
import { useId, useState, type KeyboardEvent } from 'react';
import { searchPlaces } from '../../services/placeSearch';
import type { MapData } from '../../types/map';

interface LocationSearchProps {
  map: MapData;
  placeholder: string;
  onPick: (nodeId: string) => void;
  className?: string;
}

/** Search field over location and room names with a keyboard-navigable result list. */
export function LocationSearch({ map, placeholder, onPick, className = '' }: LocationSearchProps) {
  const listId = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const results = searchPlaces(map, query);
  const expanded = open && query.trim() !== '';

  const pick = (nodeId: string) => {
    onPick(nodeId);
    setQuery('');
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      if (results.length === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + results.length) % results.length);
    } else if (e.key === 'Enter') {
      const match = results[Math.min(active, results.length - 1)];
      if (match) {
        e.preventDefault();
        pick(match.nodeId);
      }
    } else if (e.key === 'Escape') {
      if (query) setQuery('');
      else e.currentTarget.blur();
      setOpen(false);
    }
  };

  return (
    <div className={`relative ${className}`}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
      <input
        type="search"
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={expanded && results[active] ? `${listId}-${String(active)}` : undefined}
        aria-label={placeholder}
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
        }}
        onBlur={() => {
          setOpen(false);
        }}
        onKeyDown={onKeyDown}
        className="w-full rounded-xl border border-slate-300 bg-white py-2 pr-8 pl-9 text-sm shadow-sm outline-none placeholder:text-slate-400 focus:border-brand-500 dark:border-slate-700 dark:bg-slate-800 [&::-webkit-search-cancel-button]:hidden"
      />
      {query && (
        <button
          type="button"
          aria-label="Clear search"
          onMouseDown={(e) => {
            e.preventDefault(); // keep focus in the field
          }}
          onClick={() => {
            setQuery('');
          }}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        >
          <X className="size-4" />
        </button>
      )}
      {expanded && (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-900"
        >
          {results.length === 0 ? (
            <li className="px-3 py-2 text-xs text-slate-500">No location matches “{query.trim()}”.</li>
          ) : (
            results.map((m, i) => (
              <li
                key={m.nodeId}
                id={`${listId}-${String(i)}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault(); // pick before the field loses focus
                  pick(m.nodeId);
                }}
                onMouseEnter={() => {
                  setActive(i);
                }}
                className={`flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm ${
                  i === active ? 'bg-brand-50 dark:bg-brand-900/30' : ''
                }`}
              >
                {m.kind === 'room' ? (
                  <DoorOpen className="size-4 shrink-0 text-slate-400" />
                ) : (
                  <MapPin className="size-4 shrink-0 text-slate-400" />
                )}
                <span className="min-w-0 flex-1 truncate font-medium text-slate-900 dark:text-white">
                  {m.label}
                </span>
                {m.detail && <span className="shrink-0 truncate text-[11px] text-slate-400">{m.detail}</span>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
